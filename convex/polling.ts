import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { pollSource } from "../src/lib/radar/poller";
import { sourceRegistry } from "../src/lib/radar/sources";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { extractArticle } from "../src/lib/radar/browserTools";
import {
  buildReleaseClassifierEvidence,
  runReleaseClassifier,
  type ReleaseClassifierOutput,
} from "../src/lib/radar/classifier";
import { CostTracker, createLlmRouter } from "../src/lib/radar/llm";
import { detectEvidenceLinks } from "../src/lib/radar/systemCards";
import { formatTelegramSignal, sendSourceFailureAlert, sendTelegramMarkdownMessage } from "../src/lib/radar/telegram";
import type { PollSourceInput, SignalConfidence, SignalType, SourceParser } from "../src/lib/radar/types";

const TELEGRAM_SEND_SPACING_MS = 3200;

export const pollDueSources = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const telegramSendsEnabled = process.env.RADAR_TELEGRAM_SEND_ENABLED === "true";
    await ctx.runMutation(internal.registry.syncSources, { sources: sourceRegistry, now });

    const dueSources = await ctx.runQuery(internal.registry.getDueSources, { now, limit: 12 });
    const runId = await ctx.runMutation(internal.registry.startPollRun, {
      now,
      checkedSources: dueSources.length,
    });

    let changedSources = 0;
    let failedSources = 0;
    let createdSignals = 0;
    let notificationAttempts = 0;
    let lastTelegramSendAt = 0;

    for (const source of dueSources) {
      const result = await pollSource(toPollInput(source));

      if (!result.ok) {
        failedSources += 1;
        const failure = await ctx.runMutation(internal.registry.recordPollFailure, {
          sourceId: result.sourceId,
          now: Date.now(),
          error: result.error,
          statusCode: result.statusCode,
        });

        for (const notification of telegramSendsEnabled ? failure.notificationsToSend : []) {
          notificationAttempts += 1;
          lastTelegramSendAt = await waitForTelegramPace(lastTelegramSendAt);
          const sent = await sendSourceFailureAlert({
            sourceId: notification.sourceId,
            sourceLabel: notification.sourceLabel,
            error: notification.failureError,
            timestamp: new Date(Date.now()).toISOString(),
          });
          await ctx.runMutation(internal.registry.recordNotification, {
            fingerprint: notification.fingerprint,
            channel: "telegram",
            status: sent.ok ? "sent" : "failed",
            error: sent.error,
            now: Date.now(),
          });
        }
        continue;
      }

      const success = await ctx.runMutation(internal.registry.recordPollSuccess, {
        sourceId: result.sourceId,
        now: Date.now(),
        statusCode: result.statusCode,
        contentHash: result.contentHash,
        etag: result.etag,
        lastModified: result.lastModified,
        parsedSignals: result.parsedSignals,
      });

      if (result.changed) {
        changedSources += 1;
      }
      createdSignals += success.createdSignals;

      // Check every parsed article-like signal, including discovery sources.
      // The source role controls raw signal notification, but official articles
      // that pass the article gate should still become release candidates.
      const createdSignalFingerprints = new Set(success.createdSignalFingerprints);
      for (const signal of result.parsedSignals) {
        if (!signal.url) continue;
        if (!createdSignalFingerprints.has(signal.fingerprint)) continue;

        const gateDecision = evaluateArticleGate({
          provider: source.provider,
          title: signal.title,
          url: signal.url,
          summary: signal.summary,
        });

        const isBaseline = !source.lastContentHash;
        const classifierDecision = gateDecision.shouldSend && !isBaseline
          ? await classifyReleaseCandidate({
              title: signal.title,
              summary: signal.summary,
              url: signal.url,
            })
          : null;
        const classifierApproved = classifierDecision?.is_new_model_release === true;
        const shouldSend = gateDecision.shouldSend && classifierApproved;
        const modelNames = uniqueStrings([
          ...signal.modelNames,
          ...(classifierDecision?.model_names ?? []),
        ]);
        const candidateResult = await ctx.runMutation(
          internal.releases.createOrSkipCandidate,
          {
            canonicalArticleUrl: signal.url,
            lab: gateDecision.lab ?? source.provider,
            provider: source.provider,
            sourceId: source.sourceId,
            sourceUrl: source.url,
            title: signal.title,
            modelNames,
            releaseDate: undefined,
            gateResult: {
              shouldSend,
              reasons: [
                gateDecision.reason,
                ...(classifierDecision ? [`classifier: ${classifierDecision.reason}`] : []),
              ],
            },
            baseline: isBaseline,
            now: Date.now(),
          },
        );

        // Skip — deterministic gate rejected, AI classifier rejected/failed,
        // baseline run, duplicate candidate, or production sends are disabled.
        if (!shouldSend || isBaseline || !candidateResult.created || !telegramSendsEnabled) {
          continue;
        }

        notificationAttempts += 1;
        lastTelegramSendAt = await waitForTelegramPace(lastTelegramSendAt);
        const systemCard = await inspectSystemCard(signal.url);
        const sent = await sendTelegramMarkdownMessage(formatTelegramSignal({
          provider: source.provider,
          title: signal.title,
          url: signal.url,
          sourceLabel: source.label,
          confidence: signal.confidence,
          summary: signal.summary,
          modelNames,
          alertKind: gateDecision.alertKind ?? "model_release",
          systemCard,
        }));
        await ctx.runMutation(internal.registry.recordNotification, {
          fingerprint: signal.fingerprint,
          channel: "telegram",
          status: sent.ok ? "sent" : "failed",
          error: sent.error,
          now: Date.now(),
        });
      }
    }

    await ctx.runMutation(internal.registry.finishPollRun, {
      runId,
      finishedAt: Date.now(),
      changedSources,
      failedSources,
      createdSignals,
      notificationAttempts,
      status: failedSources > 0 ? "completed_with_failures" : "completed",
    });
  },
});

async function classifyReleaseCandidate(input: {
  title: string;
  summary?: string;
  url: string;
}): Promise<ReleaseClassifierOutput> {
  try {
    const article = await extractArticle(input.url, {
      timeoutMs: 15_000,
      maxRetries: 1,
      probeImages: false,
    });
    const tracker = new CostTracker(readClassifierCostCap());
    const router = createLlmRouter({
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      timeoutMs: 30_000,
    });

    return await runReleaseClassifier(
      {
        title: article.title ?? input.title,
        articleText: buildReleaseClassifierEvidence({
          title: input.title,
          articleBody: article.body,
          summary: input.summary,
        }),
      },
      router,
      tracker,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Release classification failed closed for ${input.url}: ${detail}`);
    return {
      is_new_model_release: false,
      model_names: [],
      reason: "Article fetch or release classification failed; treated as not a release.",
    };
  }
}

function readClassifierCostCap(): number {
  const configured = Number(process.env.MODEL_RELEASES_MAX_COST_USD ?? "1");
  return Number.isFinite(configured) && configured > 0 ? configured : 1;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toPollInput(source: {
  sourceId: string;
  provider: string;
  label: string;
  url: string;
  parser: string;
  confidence: string;
  signalType: string;
  pollEveryMinutes: number;
  enabled: boolean;
  notify: boolean;
  sourceRole?: string;
  urlIncludes?: string[];
  lastContentHash?: string;
  etag?: string;
  lastModified?: string;
}): PollSourceInput {
  return {
    ...source,
    parser: source.parser as SourceParser,
    confidence: source.confidence as SignalConfidence,
    signalType: source.signalType as SignalType,
    // DB rows pre-dating the sourceRole field default to sendable to preserve
    // existing notify behaviour. New syncs will always store the real role.
    sourceRole: normalizeSourceRole(source.sourceRole, source.notify),
  };
}

async function inspectSystemCard(url: string): Promise<{
  status: "linked" | "not_linked" | "unavailable";
  url?: string;
  label?: string;
}> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "model-release-radar/0.1 (+https://github.com)",
      },
    });
    if (!response.ok) {
      return { status: "unavailable" };
    }

    const html = await response.text();
    const evidence = detectEvidenceLinks(html, url).find((link) =>
      link.kind === "system_card" || link.kind === "safety_card" || link.kind === "technical_report",
    );
    if (!evidence) {
      return { status: "not_linked" };
    }

    return {
      status: "linked",
      url: evidence.url,
      label: evidence.anchorText ?? evidence.kind.replaceAll("_", " "),
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function waitForTelegramPace(lastTelegramSendAt: number) {
  const now = Date.now();
  const waitMs = Math.max(0, TELEGRAM_SEND_SPACING_MS - (now - lastTelegramSendAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return Date.now();
}

function normalizeSourceRole(
  sourceRole: string | undefined,
  notify: boolean,
): "sendable" | "discovery" {
  if (sourceRole === "sendable" || sourceRole === "discovery") {
    return sourceRole;
  }

  return notify ? "sendable" : "discovery";
}
