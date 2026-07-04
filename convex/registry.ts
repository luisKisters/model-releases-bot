import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { normalizeModelName } from "../src/lib/radar/text";
import { findStaleSourcesToDisable } from "../src/lib/radar/staleSourceSync";

const STALE_SOURCE_DISABLE_BATCH_SIZE = 500;

const sourceConfig = v.object({
  sourceId: v.string(),
  provider: v.string(),
  label: v.string(),
  url: v.string(),
  parser: v.string(),
  confidence: v.string(),
  signalType: v.string(),
  pollEveryMinutes: v.number(),
  enabled: v.boolean(),
  notify: v.boolean(),
  urlIncludes: v.optional(v.array(v.string())),
});

export const syncSources = internalMutation({
  args: { sources: v.array(sourceConfig), now: v.number() },
  handler: async (ctx, args) => {
    const configuredSourceIds = new Set(args.sources.map((source) => source.sourceId));

    for (const source of args.sources) {
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_source_id", (q) => q.eq("sourceId", source.sourceId))
        .unique();

      if (existing) {
        const sourceChanged =
          existing.url !== source.url ||
          existing.parser !== source.parser ||
          existing.enabled !== source.enabled;
        await ctx.db.patch(existing._id, {
          provider: source.provider,
          label: source.label,
          url: source.url,
          parser: source.parser,
          confidence: source.confidence,
          signalType: source.signalType,
          pollEveryMinutes: source.pollEveryMinutes,
          enabled: source.enabled,
          notify: source.notify,
          urlIncludes: source.urlIncludes,
          nextPollAt: sourceChanged ? args.now : existing.nextPollAt,
          failureCount: sourceChanged ? 0 : existing.failureCount,
          lastError: sourceChanged ? "" : existing.lastError,
        });
      } else {
        await ctx.db.insert("sources", {
          ...source,
          nextPollAt: args.now,
          failureCount: 0,
        });
      }
    }

    await disableStaleSources(ctx, configuredSourceIds);
  },
});

async function disableStaleSources(
  ctx: MutationCtx,
  configuredSourceIds: Set<string>,
) {
  const enabledSources = await ctx.db
    .query("sources")
    .withIndex("by_next_poll", (q) => q.eq("enabled", true))
    .take(STALE_SOURCE_DISABLE_BATCH_SIZE);

  const staleIds = new Set(findStaleSourcesToDisable(configuredSourceIds, enabledSources));

  for (const source of enabledSources) {
    if (!staleIds.has(source.sourceId)) {
      continue;
    }

    await ctx.db.patch(source._id, {
      enabled: false,
      notify: false,
      failureCount: 0,
      lastError: "disabled: source removed from registry",
    });
  }
}

export const getDueSources = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sources")
      .withIndex("by_next_poll", (q) => q.eq("enabled", true).lte("nextPollAt", args.now))
      .take(args.limit);
  },
});

export const startPollRun = internalMutation({
  args: { now: v.number(), checkedSources: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pollRuns", {
      startedAt: args.now,
      checkedSources: args.checkedSources,
      changedSources: 0,
      failedSources: 0,
      createdSignals: 0,
      notificationAttempts: 0,
      status: "running",
    });
  },
});

export const finishPollRun = internalMutation({
  args: {
    runId: v.id("pollRuns"),
    finishedAt: v.number(),
    changedSources: v.number(),
    failedSources: v.number(),
    createdSignals: v.number(),
    notificationAttempts: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      finishedAt: args.finishedAt,
      changedSources: args.changedSources,
      failedSources: args.failedSources,
      createdSignals: args.createdSignals,
      notificationAttempts: args.notificationAttempts,
      status: args.status,
    });
  },
});

export const recordPollSuccess = internalMutation({
  args: {
    sourceId: v.string(),
    now: v.number(),
    statusCode: v.number(),
    contentHash: v.optional(v.string()),
    etag: v.optional(v.string()),
    lastModified: v.optional(v.string()),
    parsedSignals: v.array(
      v.object({
        title: v.string(),
        url: v.optional(v.string()),
        summary: v.optional(v.string()),
        modelNames: v.array(v.string()),
        fingerprint: v.string(),
        confidence: v.string(),
        signalType: v.string(),
        shouldNotify: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .unique();

    if (!source) {
      return { createdSignals: 0, notificationsToSend: [] };
    }

    const isBaseline = !source.lastContentHash;
    const nextPollAt = args.now + source.pollEveryMinutes * 60_000;
    const notificationsToSend = [];
    let createdSignals = 0;

    if (args.contentHash) {
      await ctx.db.insert("snapshots", {
        sourceId: source.sourceId,
        contentHash: args.contentHash,
        fetchedAt: args.now,
        itemCount: args.parsedSignals.length,
        sampleTitles: args.parsedSignals.slice(0, 5).map((signal) => signal.title),
      });
    }

    for (const signal of args.parsedSignals) {
      const existingSignal = await ctx.db
        .query("signals")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", signal.fingerprint))
        .unique();

      if (existingSignal) {
        await ctx.db.patch(existingSignal._id, { lastSeenAt: args.now, rawHash: args.contentHash ?? "" });
        continue;
      }

      await ctx.db.insert("signals", {
        fingerprint: signal.fingerprint,
        provider: source.provider,
        sourceId: source.sourceId,
        sourceLabel: source.label,
        sourceUrl: source.url,
        title: signal.title,
        url: signal.url,
        summary: signal.summary,
        modelNames: signal.modelNames,
        confidence: signal.confidence,
        signalType: signal.signalType,
        firstSeenAt: args.now,
        lastSeenAt: args.now,
        rawHash: args.contentHash ?? "",
        notified: false,
        baseline: isBaseline,
      });
      createdSignals += 1;

      for (const modelName of signal.modelNames) {
        await upsertModel(ctx, source.provider, modelName, args.now);
      }

      if (!isBaseline && signal.shouldNotify) {
        notificationsToSend.push({
          fingerprint: signal.fingerprint,
          provider: source.provider,
          title: signal.title,
          url: signal.url,
          sourceLabel: source.label,
          confidence: signal.confidence,
          modelNames: signal.modelNames,
        });
      }
    }

    await ctx.db.patch(source._id, {
      nextPollAt,
      lastPolledAt: args.now,
      lastSuccessAt: args.now,
      lastContentHash: args.contentHash ?? source.lastContentHash,
      etag: args.etag ?? source.etag,
      lastModified: args.lastModified ?? source.lastModified,
      failureCount: 0,
      lastError: "",
    });

    return { createdSignals, notificationsToSend };
  },
});

export const recordPollFailure = internalMutation({
  args: {
    sourceId: v.string(),
    now: v.number(),
    error: v.string(),
    statusCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .unique();

    if (!source) {
      return { notificationsToSend: [] };
    }

    const failureCount = source.failureCount + 1;
    await ctx.db.patch(source._id, {
      nextPollAt: args.now + source.pollEveryMinutes * 60_000,
      lastPolledAt: args.now,
      failureCount,
      lastError: args.statusCode ? `${args.statusCode}: ${args.error}` : args.error,
    });

    if (failureCount !== 10) {
      return { notificationsToSend: [] };
    }

    const fingerprint = `${source.sourceId}:failure:${failureCount}`;
    await ctx.db.insert("signals", {
      fingerprint,
      provider: source.provider,
      sourceId: source.sourceId,
      sourceLabel: source.label,
      sourceUrl: source.url,
      title: `${source.label} failed 10 times`,
      url: source.url,
      modelNames: [],
      confidence: "weak_page_change",
      signalType: "source_failure",
      firstSeenAt: args.now,
      lastSeenAt: args.now,
      rawHash: "",
      notified: false,
      baseline: false,
    });

    return {
      notificationsToSend: [
        {
          fingerprint,
          provider: source.provider,
          title: `${source.label} failed 10 times: ${args.error}`,
          url: source.url,
          sourceLabel: source.label,
          confidence: "source_failure",
          modelNames: [],
        },
      ],
    };
  },
});

export const recordNotification = internalMutation({
  args: {
    fingerprint: v.optional(v.string()),
    channel: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      signalFingerprint: args.fingerprint,
      channel: args.channel,
      status: args.status,
      error: args.error,
      createdAt: args.now,
    });

    if (args.fingerprint && args.status === "sent") {
      const signal = await ctx.db
        .query("signals")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint!))
        .unique();

      if (signal) {
        await ctx.db.patch(signal._id, { notified: true });
      }
    }
  },
});

async function upsertModel(
  ctx: MutationCtx,
  provider: string,
  name: string,
  now: number,
) {
  const normalizedName = normalizeModelName(provider, name);
  const existing = await ctx.db
    .query("models")
    .withIndex("by_normalized_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      lastSeenAt: now,
      sourceCount: existing.sourceCount + 1,
      aliases: existing.aliases.includes(name) ? existing.aliases : [...existing.aliases, name],
    });
    return;
  }

  await ctx.db.insert("models", {
    normalizedName,
    provider,
    name,
    aliases: [name],
    firstSeenAt: now,
    lastSeenAt: now,
    sourceCount: 1,
  });
}
