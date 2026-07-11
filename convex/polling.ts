import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { pollSource } from "../src/lib/radar/poller";
import { sourceRegistry } from "../src/lib/radar/sources";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { formatTelegramSignal, sendSourceFailureAlert, sendTelegramMessage } from "../src/lib/radar/telegram";
import type { PollSourceInput, SignalConfidence, SignalType, SourceParser } from "../src/lib/radar/types";

const TELEGRAM_SEND_SPACING_MS = 3200;

export const pollDueSources = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
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

        for (const notification of failure.notificationsToSend) {
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
        const candidateResult = await ctx.runMutation(
          internal.releases.createOrSkipCandidate,
          {
            canonicalArticleUrl: signal.url,
            lab: gateDecision.lab ?? source.provider,
            provider: source.provider,
            sourceId: source.sourceId,
            sourceUrl: source.url,
            title: signal.title,
            modelNames: signal.modelNames,
            releaseDate: undefined,
            gateResult: {
              shouldSend: gateDecision.shouldSend,
              reasons: gateDecision.reason ? [gateDecision.reason] : [],
            },
            baseline: isBaseline,
            now: Date.now(),
          },
        );

        // Skip — gate rejected, baseline run, or duplicate candidate
        if (!gateDecision.shouldSend || isBaseline || !candidateResult.created) {
          continue;
        }

        notificationAttempts += 1;
        lastTelegramSendAt = await waitForTelegramPace(lastTelegramSendAt);
        const sent = await sendTelegramMessage(formatTelegramSignal({
          provider: source.provider,
          title: signal.title,
          url: signal.url,
          sourceLabel: source.label,
          confidence: signal.confidence,
          summary: signal.summary,
          modelNames: signal.modelNames,
          alertKind: gateDecision.alertKind ?? "model_release",
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
