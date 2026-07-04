import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sources: defineTable({
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
    nextPollAt: v.number(),
    lastPolledAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastContentHash: v.optional(v.string()),
    etag: v.optional(v.string()),
    lastModified: v.optional(v.string()),
    failureCount: v.number(),
    lastError: v.optional(v.string()),
  }).index("by_source_id", ["sourceId"]).index("by_next_poll", ["enabled", "nextPollAt"]),

  snapshots: defineTable({
    sourceId: v.string(),
    contentHash: v.string(),
    fetchedAt: v.number(),
    itemCount: v.number(),
    sampleTitles: v.array(v.string()),
  }).index("by_source_fetched", ["sourceId", "fetchedAt"]),

  signals: defineTable({
    fingerprint: v.string(),
    provider: v.string(),
    sourceId: v.string(),
    sourceLabel: v.string(),
    sourceUrl: v.string(),
    title: v.string(),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
    modelNames: v.array(v.string()),
    confidence: v.string(),
    signalType: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    rawHash: v.string(),
    notified: v.boolean(),
    baseline: v.boolean(),
  }).index("by_fingerprint", ["fingerprint"]).index("by_first_seen", ["firstSeenAt"]),

  models: defineTable({
    normalizedName: v.string(),
    provider: v.string(),
    name: v.string(),
    aliases: v.array(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    sourceCount: v.number(),
  }).index("by_normalized_name", ["normalizedName"]).index("by_last_seen", ["lastSeenAt"]),

  notifications: defineTable({
    signalFingerprint: v.optional(v.string()),
    channel: v.string(),
    status: v.string(),
    createdAt: v.number(),
    error: v.optional(v.string()),
  }).index("by_created", ["createdAt"]),

  pollRuns: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    checkedSources: v.number(),
    changedSources: v.number(),
    failedSources: v.number(),
    createdSignals: v.number(),
    notificationAttempts: v.number(),
    status: v.string(),
  }).index("by_started", ["startedAt"]),
});
