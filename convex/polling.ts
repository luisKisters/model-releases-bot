import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { pollSource } from "../src/lib/radar/poller";
import { sourceRegistry } from "../src/lib/radar/sources";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { formatTelegramSignal, sendTelegramMessage } from "../src/lib/radar/telegram";
import type { PollSourceInput, SignalConfidence, SignalType, SourceParser } from "../src/lib/radar/types";

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
          const sent = await sendTelegramMessage(formatTelegramSignal(notification));
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

      // For each signal that passed the source-level notify gate, check the article gate
      // and persist release candidates. Only verified candidates trigger Telegram.
      for (const notification of success.notificationsToSend) {
        // Run article gate before persisting a candidate
        const gateDecision = evaluateArticleGate({
          provider: source.provider,
          title: notification.title,
          url: notification.url,
        });

        const isBaseline = !source.lastContentHash;
        const candidateResult = await ctx.runMutation(
          internal.releases.createOrSkipCandidate,
          {
            canonicalArticleUrl: notification.url ?? notification.fingerprint,
            lab: gateDecision.lab ?? source.provider,
            provider: source.provider,
            sourceId: source.sourceId,
            sourceUrl: source.url,
            title: notification.title,
            modelNames: notification.modelNames,
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

        // Candidate is new and gate passed. The full verification pipeline
        // (article extraction → evidence → verifier → release note) must approve
        // before any Telegram message is sent. Trigger it via radar:smoke or a
        // dedicated pipeline cron — do not send here.
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
    sourceRole: source.notify ? "sendable" : "discovery",
  };
}
