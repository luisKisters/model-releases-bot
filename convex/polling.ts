import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { pollSource } from "../src/lib/radar/poller";
import { sourceRegistry } from "../src/lib/radar/sources";
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

      for (const notification of success.notificationsToSend) {
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
  };
}
