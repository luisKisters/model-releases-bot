import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ─── Validators ───────────────────────────────────────────────────────────────

const gateResultValidator = v.object({
  shouldSend: v.boolean(),
  reasons: v.array(v.string()),
});

const evidenceDocumentInputValidator = v.object({
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
});

const evidenceChunkInputValidator = v.object({
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
});

const benchmarkRowInputValidator = v.object({
  name: v.string(),
  value: v.optional(v.string()),
  source: v.union(v.literal("vendor"), v.literal("independent"), v.literal("unknown")),
  status: v.union(
    v.literal("supported"),
    v.literal("contradicted"),
    v.literal("missing"),
    v.literal("not_comparable"),
  ),
  sourceUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const llmUsageInputValidator = v.object({
  stage: v.string(),
  modelId: v.string(),
  promptTokens: v.number(),
  completionTokens: v.number(),
  cacheHitTokens: v.number(),
  providerResponseId: v.optional(v.string()),
  estimatedCostUsd: v.number(),
});

const verifierFindingInputValidator = v.object({
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
});

// ─── Candidate queries ────────────────────────────────────────────────────────

export const getCandidateByCanonicalUrl = internalQuery({
  args: { canonicalArticleUrl: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("releaseCandidates")
      .withIndex("by_canonical_url", (q) =>
        q.eq("canonicalArticleUrl", args.canonicalArticleUrl),
      )
      .unique();
  },
});

export const getPendingCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("releaseCandidates")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(args.limit);
  },
});

export const getCandidateById = internalQuery({
  args: { id: v.id("releaseCandidates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getReleaseNoteByCanonicalUrl = internalQuery({
  args: { canonicalArticleUrl: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("verifiedReleaseNotes")
      .withIndex("by_canonical_url", (q) =>
        q.eq("canonicalArticleUrl", args.canonicalArticleUrl),
      )
      .unique();
  },
});

// ─── Candidate mutations ──────────────────────────────────────────────────────

export const createOrSkipCandidate = internalMutation({
  args: {
    canonicalArticleUrl: v.string(),
    lab: v.string(),
    provider: v.string(),
    sourceId: v.string(),
    sourceUrl: v.string(),
    title: v.string(),
    modelNames: v.array(v.string()),
    releaseDate: v.optional(v.string()),
    gateResult: gateResultValidator,
    baseline: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ id: Id<"releaseCandidates">; created: boolean }> => {
    const existing = await ctx.db
      .query("releaseCandidates")
      .withIndex("by_canonical_url", (q) =>
        q.eq("canonicalArticleUrl", args.canonicalArticleUrl),
      )
      .unique();

    if (existing) {
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("releaseCandidates", {
      canonicalArticleUrl: args.canonicalArticleUrl,
      lab: args.lab,
      provider: args.provider,
      sourceId: args.sourceId,
      sourceUrl: args.sourceUrl,
      title: args.title,
      discoveredAt: args.now,
      modelNames: args.modelNames,
      releaseDate: args.releaseDate,
      gateResult: args.gateResult,
      status: "pending",
      baseline: args.baseline,
    });

    return { id, created: true };
  },
});

export const markCandidateProcessing = internalMutation({
  args: { id: v.id("releaseCandidates"), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "processing", processedAt: args.now });
  },
});

export const markCandidateFailed = internalMutation({
  args: {
    id: v.id("releaseCandidates"),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error,
      processedAt: args.now,
    });
  },
});

// ─── Article snapshots ────────────────────────────────────────────────────────

export const upsertArticleSnapshot = internalMutation({
  args: {
    releaseCandidateId: v.id("releaseCandidates"),
    canonicalUrl: v.string(),
    finalUrl: v.string(),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    publisher: v.optional(v.string()),
    publishedAt: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
    bodyPreview: v.string(),
    headings: v.array(v.string()),
    outboundLinkCount: v.number(),
    imageCount: v.number(),
    downloadableAssetCount: v.number(),
    reducedConfidence: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("articleSnapshots")
      .withIndex("by_candidate", (q) =>
        q.eq("releaseCandidateId", args.releaseCandidateId),
      )
      .unique();

    const data = {
      releaseCandidateId: args.releaseCandidateId,
      canonicalUrl: args.canonicalUrl,
      finalUrl: args.finalUrl,
      title: args.title,
      author: args.author,
      publisher: args.publisher,
      publishedAt: args.publishedAt,
      updatedAt: args.updatedAt,
      bodyPreview: args.bodyPreview,
      headings: args.headings,
      outboundLinkCount: args.outboundLinkCount,
      imageCount: args.imageCount,
      downloadableAssetCount: args.downloadableAssetCount,
      reducedConfidence: args.reducedConfidence,
      fetchedAt: args.now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("articleSnapshots", data);
  },
});

// ─── Evidence persistence ─────────────────────────────────────────────────────

export const insertEvidenceDocument = internalMutation({
  args: {
    releaseCandidateId: v.id("releaseCandidates"),
    document: evidenceDocumentInputValidator,
    chunks: v.array(evidenceChunkInputValidator),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"evidenceDocuments">> => {
    const docId = await ctx.db.insert("evidenceDocuments", {
      releaseCandidateId: args.releaseCandidateId,
      url: args.document.url,
      canonicalUrl: args.document.canonicalUrl,
      kind: args.document.kind,
      fetchStatus: args.document.fetchStatus,
      fetchError: args.document.fetchError,
      pageCount: args.document.pageCount,
      fetchedAt: args.now,
    });

    for (const chunk of args.chunks) {
      await ctx.db.insert("evidenceChunks", {
        evidenceDocumentId: docId,
        releaseCandidateId: args.releaseCandidateId,
        chunkId: chunk.chunkId,
        sourceUrl: chunk.sourceUrl,
        topic: chunk.topic,
        pageNumber: chunk.pageNumber,
        text: chunk.text,
      });
    }

    return docId;
  },
});

// ─── Benchmark evidence ───────────────────────────────────────────────────────

export const insertBenchmarkRows = internalMutation({
  args: {
    releaseCandidateId: v.id("releaseCandidates"),
    rows: v.array(benchmarkRowInputValidator),
  },
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      await ctx.db.insert("benchmarkEvidenceRows", {
        releaseCandidateId: args.releaseCandidateId,
        name: row.name,
        value: row.value,
        source: row.source,
        status: row.status,
        sourceUrl: row.sourceUrl,
        notes: row.notes,
      });
    }
  },
});

// ─── LLM usage ───────────────────────────────────────────────────────────────

export const insertLlmUsageRecords = internalMutation({
  args: {
    releaseCandidateId: v.id("releaseCandidates"),
    records: v.array(llmUsageInputValidator),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    for (const rec of args.records) {
      await ctx.db.insert("llmUsageRecords", {
        releaseCandidateId: args.releaseCandidateId,
        stage: rec.stage,
        modelId: rec.modelId,
        promptTokens: rec.promptTokens,
        completionTokens: rec.completionTokens,
        cacheHitTokens: rec.cacheHitTokens,
        providerResponseId: rec.providerResponseId,
        estimatedCostUsd: rec.estimatedCostUsd,
        recordedAt: args.now,
      });
    }
  },
});

// ─── Verified release note persistence ───────────────────────────────────────

export const persistVerifiedReleaseNote = internalMutation({
  args: {
    releaseCandidateId: v.id("releaseCandidates"),
    canonicalArticleUrl: v.string(),
    lab: v.string(),
    modelNames: v.array(v.string()),
    title: v.string(),
    releaseDate: v.optional(v.string()),
    plainTextMessage: v.string(),
    telegramMessage: v.string(),
    verifierStatus: v.union(
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("unverified"),
    ),
    checkedClaims: v.number(),
    unsupportedCount: v.number(),
    totalCostUsd: v.number(),
    findings: v.array(verifierFindingInputValidator),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{
    noteId: Id<"verifiedReleaseNotes">;
    candidateStatus: "verified" | "rejected";
  }> => {
    const candidateStatus = args.verifierStatus === "verified" ? "verified" : "rejected";

    const noteId = await ctx.db.insert("verifiedReleaseNotes", {
      releaseCandidateId: args.releaseCandidateId,
      canonicalArticleUrl: args.canonicalArticleUrl,
      lab: args.lab,
      modelNames: args.modelNames,
      title: args.title,
      releaseDate: args.releaseDate,
      plainTextMessage: args.plainTextMessage,
      telegramMessage: args.telegramMessage,
      verifierStatus: args.verifierStatus,
      checkedClaims: args.checkedClaims,
      unsupportedCount: args.unsupportedCount,
      totalCostUsd: args.totalCostUsd,
      createdAt: args.now,
      notified: false,
    });

    for (const finding of args.findings) {
      await ctx.db.insert("verifierFindings", {
        verifiedReleaseNoteId: noteId,
        releaseCandidateId: args.releaseCandidateId,
        claim: finding.claim,
        issue: finding.issue,
        detail: finding.detail,
        severity: finding.severity,
      });
    }

    await ctx.db.patch(args.releaseCandidateId, {
      status: candidateStatus,
      processedAt: args.now,
    });

    return { noteId, candidateStatus };
  },
});

export const markReleaseNoteNotified = internalMutation({
  args: {
    noteId: v.id("verifiedReleaseNotes"),
    releaseCandidateId: v.id("releaseCandidates"),
    channel: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      releaseCandidateId: args.releaseCandidateId,
      channel: args.channel,
      status: args.status,
      error: args.error,
      createdAt: args.now,
    });

    if (args.status === "sent") {
      await ctx.db.patch(args.noteId, { notified: true, sentAt: args.now });
    }
  },
});

// ─── Dashboard helpers ────────────────────────────────────────────────────────

export const getRecentReleaseCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("releaseCandidates")
      .withIndex("by_status", (q) => q.eq("status", "verified"))
      .order("desc")
      .take(args.limit);
  },
});

export const getRecentVerifiedNotes = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("verifiedReleaseNotes")
      .withIndex("by_created")
      .order("desc")
      .take(args.limit);
  },
});
