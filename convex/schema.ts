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
    sourceRole: v.optional(v.string()),
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
    releaseCandidateId: v.optional(v.id("releaseCandidates")),
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

  // Release candidates discovered from sources (pre-verification)
  releaseCandidates: defineTable({
    // Identity — deduplicated by canonicalArticleUrl
    canonicalArticleUrl: v.string(),
    lab: v.string(),
    provider: v.string(),
    sourceId: v.string(),
    sourceUrl: v.string(),
    title: v.string(),
    discoveredAt: v.number(),
    // Release metadata extracted from the article
    modelNames: v.array(v.string()),
    releaseDate: v.optional(v.string()),
    // Gate result
    gateResult: v.object({
      shouldSend: v.boolean(),
      reasons: v.array(v.string()),
    }),
    // Processing status
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("failed"),
    ),
    // Set to true on the first run so we never send old releases as new
    baseline: v.boolean(),
    processedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_canonical_url", ["canonicalArticleUrl"])
    .index("by_lab_discovered", ["lab", "discoveredAt"])
    .index("by_status", ["status"]),

  // Article snapshots (sanitized article body/metadata, separate from source hash snapshots)
  articleSnapshots: defineTable({
    releaseCandidateId: v.id("releaseCandidates"),
    canonicalUrl: v.string(),
    finalUrl: v.string(),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    publisher: v.optional(v.string()),
    publishedAt: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
    bodyPreview: v.string(), // First 2000 chars of body
    headings: v.array(v.string()),
    outboundLinkCount: v.number(),
    imageCount: v.number(),
    downloadableAssetCount: v.number(),
    reducedConfidence: v.boolean(),
    fetchedAt: v.number(),
  }).index("by_candidate", ["releaseCandidateId"]),

  // Evidence documents (system cards, technical reports, PDFs)
  evidenceDocuments: defineTable({
    releaseCandidateId: v.id("releaseCandidates"),
    url: v.string(),
    canonicalUrl: v.optional(v.string()),
    kind: v.union(
      v.literal("system_card"),
      v.literal("model_card"),
      v.literal("safety_card"),
      v.literal("technical_report"),
      v.literal("pdf"),
      v.literal("model_repo"),
      v.literal("model_docs"),
    ),
    fetchStatus: v.union(v.literal("ok"), v.literal("failed"), v.literal("skipped")),
    fetchError: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    fetchedAt: v.number(),
  })
    .index("by_candidate", ["releaseCandidateId"])
    .index("by_candidate_kind", ["releaseCandidateId", "kind"]),

  // Evidence chunks (text excerpts from evidence documents)
  evidenceChunks: defineTable({
    evidenceDocumentId: v.id("evidenceDocuments"),
    releaseCandidateId: v.id("releaseCandidates"),
    chunkId: v.string(),
    sourceUrl: v.string(),
    topic: v.union(
      v.literal("overview"),
      v.literal("capabilities"),
      v.literal("benchmarks_evals"),
      v.literal("safety"),
      v.literal("misuse_limitations"),
      v.literal("deployment"),
      v.literal("data_training"),
      v.literal("pricing_api"),
      v.literal("unknown_other"),
    ),
    pageNumber: v.optional(v.number()),
    text: v.string(),
  })
    .index("by_document", ["evidenceDocumentId"])
    .index("by_candidate", ["releaseCandidateId"])
    .index("by_candidate_topic", ["releaseCandidateId", "topic"]),

  // Benchmark evidence rows per release candidate
  benchmarkEvidenceRows: defineTable({
    releaseCandidateId: v.id("releaseCandidates"),
    name: v.string(),
    value: v.optional(v.string()),
    source: v.union(
      v.literal("vendor_article"),
      v.literal("system_card"),
      v.literal("technical_report"),
      v.literal("artificial_analysis"),
      v.literal("official_benchmark"),
      v.literal("other"),
    ),
    status: v.union(
      v.literal("supported"),
      v.literal("contradicted"),
      v.literal("missing"),
      v.literal("not_comparable"),
    ),
    sourceUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_candidate", ["releaseCandidateId"]),

  // LLM usage and cost per release candidate
  llmUsageRecords: defineTable({
    releaseCandidateId: v.id("releaseCandidates"),
    stage: v.string(),
    modelId: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    cacheHitTokens: v.number(),
    providerResponseId: v.optional(v.string()),
    estimatedCostUsd: v.number(),
    recordedAt: v.number(),
  }).index("by_candidate", ["releaseCandidateId"]),

  // Verified release notes (final, after verifier approval)
  verifiedReleaseNotes: defineTable({
    releaseCandidateId: v.id("releaseCandidates"),
    canonicalArticleUrl: v.string(),
    lab: v.string(),
    modelNames: v.array(v.string()),
    title: v.string(),
    releaseDate: v.optional(v.string()),
    // Rendered outputs
    plainTextMessage: v.string(),
    telegramMessage: v.string(),
    // Verification
    verifierStatus: v.union(
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("unverified"),
    ),
    checkedClaims: v.number(),
    unsupportedCount: v.number(),
    // Cost totals
    totalCostUsd: v.number(),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    notified: v.boolean(),
  })
    .index("by_candidate", ["releaseCandidateId"])
    .index("by_canonical_url", ["canonicalArticleUrl"])
    .index("by_created", ["createdAt"]),

  // Verifier findings per release note
  verifierFindings: defineTable({
    verifiedReleaseNoteId: v.id("verifiedReleaseNotes"),
    releaseCandidateId: v.id("releaseCandidates"),
    claim: v.string(),
    issue: v.union(
      v.literal("unsupported_strength"),
      v.literal("unsupported_benchmark"),
      v.literal("missing_weakness"),
      v.literal("wrong_source_url"),
      v.literal("stale_article_url"),
      v.literal("invented_safety_claim"),
      v.literal("other"),
    ),
    detail: v.string(),
    severity: v.union(v.literal("block"), v.literal("warn")),
  }).index("by_release_note", ["verifiedReleaseNoteId"]),
});
