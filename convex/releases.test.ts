// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ─── Source sync and stale-source disable ─────────────────────────────────────

describe("source sync", () => {
  test("syncs new sources into the database", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    await t.mutation(internal.registry.syncSources, {
      sources: [
        {
          sourceId: "openai-news",
          provider: "openai",
          label: "OpenAI News",
          url: "https://openai.com/news",
          parser: "html",
          confidence: "official",
          signalType: "release_note",
          pollEveryMinutes: 60,
          enabled: true,
          notify: true,
        },
      ],
      now,
    });

    const dueSources = await t.query(internal.registry.getDueSources, { now, limit: 10 });
    expect(dueSources).toHaveLength(1);
    expect(dueSources[0].sourceId).toBe("openai-news");
    expect(dueSources[0].enabled).toBe(true);
  });

  test("disables stale sources not in the current registry", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    // First sync — add two sources
    await t.mutation(internal.registry.syncSources, {
      sources: [
        {
          sourceId: "openai-news",
          provider: "openai",
          label: "OpenAI News",
          url: "https://openai.com/news",
          parser: "html",
          confidence: "official",
          signalType: "release_note",
          pollEveryMinutes: 60,
          enabled: true,
          notify: true,
        },
        {
          sourceId: "deepseek-ai-hf",
          provider: "deepseek",
          label: "DeepSeek HuggingFace",
          url: "https://huggingface.co/deepseek-ai",
          parser: "huggingfaceOrg",
          confidence: "weak_page_change",
          signalType: "repo_activity",
          pollEveryMinutes: 60,
          enabled: true,
          notify: false,
        },
      ],
      now,
    });

    // Second sync — only openai remains; deepseek-ai-hf is stale
    await t.mutation(internal.registry.syncSources, {
      sources: [
        {
          sourceId: "openai-news",
          provider: "openai",
          label: "OpenAI News",
          url: "https://openai.com/news",
          parser: "html",
          confidence: "official",
          signalType: "release_note",
          pollEveryMinutes: 60,
          enabled: true,
          notify: true,
        },
      ],
      now,
    });

    const allDue = await t.query(internal.registry.getDueSources, { now, limit: 10 });
    // Only openai-news should remain enabled
    expect(allDue.every((s: { sourceId: string }) => s.sourceId === "openai-news")).toBe(true);
  });

  test("re-enabled changed sources clear old hashes so the next poll is baseline", async () => {
    const t = convexTest(schema, modules);
    const source = {
      sourceId: "qwen-rss",
      provider: "Qwen",
      label: "Qwen blog RSS",
      url: "https://qwenlm.github.io/blog/index.xml",
      parser: "rssAtom",
      confidence: "official",
      signalType: "release_note",
      pollEveryMinutes: 5,
      enabled: true,
      notify: true,
    };

    await t.mutation(internal.registry.syncSources, { sources: [source], now: 1000 });
    await t.mutation(internal.registry.recordPollSuccess, {
      sourceId: "qwen-rss",
      now: 1100,
      statusCode: 200,
      contentHash: "old-hash",
      parsedSignals: [],
    });

    await t.mutation(internal.registry.syncSources, { sources: [], now: 2000 });
    await t.mutation(internal.registry.syncSources, { sources: [source], now: 3000 });

    const dueSources = await t.query(internal.registry.getDueSources, { now: 3000, limit: 10 });
    const reenabled = dueSources.find((s: { sourceId: string }) => s.sourceId === "qwen-rss");
    expect(reenabled).toBeDefined();
    expect(reenabled!.enabled).toBe(true);
    expect(reenabled!.lastContentHash).toBe("");
    expect(reenabled!.etag).toBe("");
    expect(reenabled!.lastModified).toBe("");
  });

  test("recordPollSuccess reports only newly created signal fingerprints", async () => {
    const t = convexTest(schema, modules);
    const source = {
      sourceId: "openai-news-rss",
      provider: "OpenAI",
      label: "OpenAI news RSS",
      url: "https://openai.com/news/rss.xml",
      parser: "rssAtom",
      confidence: "official",
      signalType: "release_note",
      pollEveryMinutes: 5,
      enabled: true,
      notify: true,
    };
    const signal = {
      title: "Introducing GPT-5.7",
      url: "https://openai.com/index/gpt-5-7",
      modelNames: ["GPT-5.7"],
      fingerprint: "gpt57",
      confidence: "official",
      signalType: "release_note",
      shouldNotify: true,
    };

    await t.mutation(internal.registry.syncSources, { sources: [source], now: 1000 });
    const first = await t.mutation(internal.registry.recordPollSuccess, {
      sourceId: "openai-news-rss",
      now: 1100,
      statusCode: 200,
      contentHash: "hash-1",
      parsedSignals: [signal],
    });
    const second = await t.mutation(internal.registry.recordPollSuccess, {
      sourceId: "openai-news-rss",
      now: 1200,
      statusCode: 200,
      contentHash: "hash-2",
      parsedSignals: [signal],
    });

    expect(first.createdSignals).toBe(1);
    expect(first.createdSignalFingerprints).toEqual(["gpt57"]);
    expect(second.createdSignals).toBe(0);
    expect(second.createdSignalFingerprints).toEqual([]);
  });

  test("disabled deepseek HuggingFace source after stale sync", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    await t.mutation(internal.registry.syncSources, {
      sources: [
        {
          sourceId: "deepseek-hf",
          provider: "deepseek",
          label: "deepseek-ai HuggingFace",
          url: "https://huggingface.co/deepseek-ai",
          parser: "huggingfaceOrg",
          confidence: "weak_page_change",
          signalType: "repo_activity",
          pollEveryMinutes: 60,
          enabled: true,
          notify: false,
        },
        {
          sourceId: "xiaomi-mimo-hf",
          provider: "xiaomi",
          label: "XiaomiMiMo HuggingFace",
          url: "https://huggingface.co/XiaomiMiMo",
          parser: "huggingfaceOrg",
          confidence: "weak_page_change",
          signalType: "repo_activity",
          pollEveryMinutes: 60,
          enabled: true,
          notify: false,
        },
      ],
      now,
    });

    // Simulate new registry with no stale sources — empty sync
    await t.mutation(internal.registry.syncSources, {
      sources: [],
      now,
    });

    const dueSources = await t.query(internal.registry.getDueSources, { now, limit: 10 });
    expect(dueSources).toHaveLength(0);
  });
});

// ─── Release candidate persistence ───────────────────────────────────────────

describe("release candidate persistence", () => {
  test("creates a new release candidate", async () => {
    const t = convexTest(schema, modules);
    const now = 2000;

    const result = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://deepseek.com/news/v4",
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-api-docs",
      sourceUrl: "https://api-docs.deepseek.com/news",
      title: "DeepSeek-V4 Release",
      modelNames: ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
      releaseDate: "2026-04-24",
      gateResult: { shouldSend: true, reasons: ["official_dedicated_model_release_article"] },
      baseline: false,
      now,
    });

    expect(result.created).toBe(true);
    expect(result.id).toBeTruthy();

    const candidate = await t.query(internal.releases.getCandidateByCanonicalUrl, {
      canonicalArticleUrl: "https://deepseek.com/news/v4",
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.lab).toBe("DeepSeek");
    expect(candidate!.status).toBe("pending");
    expect(candidate!.baseline).toBe(false);
    expect(candidate!.deliveryStatus).toBe("pending");
    expect(candidate!.modelNames).toEqual(["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"]);
  });

  test("retries approved deliveries and deduplicates equivalent official sources", async () => {
    const t = convexTest(schema, modules);
    const deliveryKey = "google:gemini-3.6-flash";
    const base = {
      lab: "Google",
      provider: "Google",
      sourceUrl: "https://blog.google/rss/",
      title: "Introducing Gemini 3.6 Flash",
      modelNames: ["Gemini 3.6 Flash"],
      gateResult: { shouldSend: true, reasons: ["approved"] },
      baseline: false,
      deliveryKey,
    };
    const first = await t.mutation(internal.releases.createOrSkipCandidate, {
      ...base,
      canonicalArticleUrl: "https://blog.google/gemini-3-6-flash/",
      sourceId: "google-blog",
      now: 1000,
    });
    const second = await t.mutation(internal.releases.createOrSkipCandidate, {
      ...base,
      canonicalArticleUrl: "https://deepmind.google/gemini-3-6-flash/",
      sourceId: "deepmind-blog",
      now: 1001,
    });

    const due = await t.query(internal.releases.getPendingApprovedDeliveries, {
      now: 2000,
      limit: 10,
    });
    expect(due).toHaveLength(2);

    const firstClaim = await t.mutation(internal.releases.claimCandidateDelivery, {
      id: first.id,
      deliveryKey,
      now: 2000,
    });
    expect(firstClaim.claimed).toBe(true);
    if (!firstClaim.claimed) throw new Error("Expected the first delivery to be claimed");
    await t.mutation(internal.releases.finishCandidateDelivery, {
      id: first.id,
      receiptId: firstClaim.receiptId,
      status: "sent",
      now: 2100,
    });

    const duplicateClaim = await t.mutation(internal.releases.claimCandidateDelivery, {
      id: second.id,
      deliveryKey,
      now: 2200,
    });
    expect(duplicateClaim).toEqual({ claimed: false, reason: "duplicate" });
    const duplicate = await t.query(internal.releases.getCandidateById, { id: second.id });
    expect(duplicate!.deliveryStatus).toBe("duplicate");
  });

  test("failed delivery becomes due again after exponential backoff", async () => {
    const t = convexTest(schema, modules);
    const candidate = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://qwen.ai/blog/qwen-next",
      lab: "Qwen",
      provider: "Qwen",
      sourceId: "qwen-blog",
      sourceUrl: "https://qwen.ai/blog",
      title: "Qwen Next",
      modelNames: ["Qwen Next"],
      gateResult: { shouldSend: true, reasons: ["approved"] },
      baseline: false,
      deliveryKey: "qwen:qwen-next",
      now: 1000,
    });
    const claim = await t.mutation(internal.releases.claimCandidateDelivery, {
      id: candidate.id,
      deliveryKey: "qwen:qwen-next",
      now: 2000,
    });
    if (!claim.claimed) throw new Error("Expected delivery to be claimed");
    await t.mutation(internal.releases.finishCandidateDelivery, {
      id: candidate.id,
      receiptId: claim.receiptId,
      status: "failed",
      error: "temporary Telegram failure",
      now: 2100,
    });

    expect(await t.query(internal.releases.getPendingApprovedDeliveries, {
      now: 2100 + 5 * 60_000 - 1,
      limit: 10,
    })).toHaveLength(0);
    expect(await t.query(internal.releases.getPendingApprovedDeliveries, {
      now: 2100 + 5 * 60_000,
      limit: 10,
    })).toHaveLength(1);
  });

  test("duplicate candidate creation is skipped", async () => {
    const t = convexTest(schema, modules);
    const now = 2000;
    const url = "https://deepseek.com/news/v4";

    const first = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: url,
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-api-docs",
      sourceUrl: "https://api-docs.deepseek.com/news",
      title: "DeepSeek-V4 Release",
      modelNames: ["DeepSeek-V4-Pro"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    const second = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: url,
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-api-docs",
      sourceUrl: "https://api-docs.deepseek.com/news",
      title: "DeepSeek-V4 Release Again",
      modelNames: ["DeepSeek-V4-Pro"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now: now + 1000,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  test("duplicate detection uses canonical URL, not title", async () => {
    const t = convexTest(schema, modules);
    const now = 2000;

    await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://openai.com/news/gpt-5",
      lab: "OpenAI",
      provider: "openai",
      sourceId: "openai-news",
      sourceUrl: "https://openai.com/news",
      title: "GPT-5",
      modelNames: ["GPT-5"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    // Same title, different URL → should create a new candidate
    const result = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://openai.com/news/gpt-5-turbo",
      lab: "OpenAI",
      provider: "openai",
      sourceId: "openai-news",
      sourceUrl: "https://openai.com/news",
      title: "GPT-5",
      modelNames: ["GPT-5-Turbo"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    expect(result.created).toBe(true);
  });

  test("baseline candidates are created but not notified", async () => {
    const t = convexTest(schema, modules);
    const now = 2000;

    const result = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://anthropic.com/news/claude-4",
      lab: "Anthropic",
      provider: "anthropic",
      sourceId: "anthropic-news",
      sourceUrl: "https://anthropic.com/news",
      title: "Claude 4",
      modelNames: ["Claude 4"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: true, // This is a baseline run
      now,
    });

    expect(result.created).toBe(true);
    const candidate = await t.query(internal.releases.getCandidateByCanonicalUrl, {
      canonicalArticleUrl: "https://anthropic.com/news/claude-4",
    });
    expect(candidate!.baseline).toBe(true);
    expect(candidate!.status).toBe("pending");
  });
});

// ─── Verified send and unverified block ──────────────────────────────────────

describe("verified release note persistence", () => {
  async function createCandidate(
    t: ReturnType<typeof convexTest>,
    url = "https://deepseek.com/news/v4",
  ) {
    const result = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: url,
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-api-docs",
      sourceUrl: "https://api-docs.deepseek.com",
      title: "DeepSeek V4",
      modelNames: ["DeepSeek-V4-Pro"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now: 1000,
    });
    return result.id;
  }

  test("verified release note is persisted and candidate marked verified", async () => {
    const t = convexTest(schema, modules);
    const candidateId = await createCandidate(t);

    const { noteId, candidateStatus } = await t.mutation(
      internal.releases.persistVerifiedReleaseNote,
      {
        releaseCandidateId: candidateId,
        canonicalArticleUrl: "https://deepseek.com/news/v4",
        lab: "DeepSeek",
        modelNames: ["DeepSeek-V4-Pro"],
        title: "DeepSeek: DeepSeek-V4-Pro",
        releaseDate: "2026-04-24",
        plainTextMessage: "DeepSeek V4 Pro is available. Unknown: context window.",
        telegramMessage: "DeepSeek V4 Pro is available.\n- Unknown: context window.",
        verifierStatus: "verified",
        checkedClaims: 3,
        unsupportedCount: 0,
        totalCostUsd: 0.0012,
        findings: [],
        now: 2000,
      },
    );

    expect(noteId).toBeTruthy();
    expect(candidateStatus).toBe("verified");

    const candidate = await t.query(internal.releases.getCandidateById, { id: candidateId });
    expect(candidate!.status).toBe("verified");

    const note = await t.query(internal.releases.getReleaseNoteByCanonicalUrl, {
      canonicalArticleUrl: "https://deepseek.com/news/v4",
    });
    expect(note).not.toBeNull();
    expect(note!.verifierStatus).toBe("verified");
    expect(note!.notified).toBe(false);
    expect(note!.totalCostUsd).toBe(0.0012);
  });

  test("rejected release note blocks notification", async () => {
    const t = convexTest(schema, modules);
    const candidateId = await createCandidate(t, "https://openai.com/news/gpt-5");

    const { candidateStatus } = await t.mutation(
      internal.releases.persistVerifiedReleaseNote,
      {
        releaseCandidateId: candidateId,
        canonicalArticleUrl: "https://openai.com/news/gpt-5",
        lab: "OpenAI",
        modelNames: ["GPT-5"],
        title: "OpenAI: GPT-5",
        plainTextMessage: "GPT-5 achieves SOTA on every benchmark known to man.",
        telegramMessage: "GPT-5 achieves SOTA on every benchmark known to man.",
        verifierStatus: "rejected",
        checkedClaims: 5,
        unsupportedCount: 2,
        totalCostUsd: 0.0008,
        findings: [
          {
            claim: "SOTA on every benchmark",
            issue: "unsupported_benchmark",
            detail: "Benchmark claim not traced to evidence.",
            severity: "block",
          },
        ],
        now: 2000,
      },
    );

    expect(candidateStatus).toBe("rejected");

    const candidate = await t.query(internal.releases.getCandidateById, { id: candidateId });
    expect(candidate!.status).toBe("rejected");

    const note = await t.query(internal.releases.getReleaseNoteByCanonicalUrl, {
      canonicalArticleUrl: "https://openai.com/news/gpt-5",
    });
    expect(note!.verifierStatus).toBe("rejected");
    expect(note!.notified).toBe(false);
  });

  test("markReleaseNoteNotified sets notified=true on send", async () => {
    const t = convexTest(schema, modules);
    const candidateId = await createCandidate(t);

    const { noteId } = await t.mutation(internal.releases.persistVerifiedReleaseNote, {
      releaseCandidateId: candidateId,
      canonicalArticleUrl: "https://deepseek.com/news/v4",
      lab: "DeepSeek",
      modelNames: ["DeepSeek-V4-Pro"],
      title: "DeepSeek: DeepSeek-V4-Pro",
      plainTextMessage: "DeepSeek V4 Pro. Unknown: pricing.",
      telegramMessage: "DeepSeek V4 Pro.\n- Unknown: pricing.",
      verifierStatus: "verified",
      checkedClaims: 1,
      unsupportedCount: 0,
      totalCostUsd: 0.001,
      findings: [],
      now: 2000,
    });

    await t.mutation(internal.releases.markReleaseNoteNotified, {
      noteId,
      releaseCandidateId: candidateId,
      channel: "telegram",
      status: "sent",
      now: 3000,
    });

    const note = await t.query(internal.releases.getReleaseNoteByCanonicalUrl, {
      canonicalArticleUrl: "https://deepseek.com/news/v4",
    });
    expect(note!.notified).toBe(true);
    expect(note!.sentAt).toBe(3000);
  });

  test("markReleaseNoteNotified on failure does not set notified", async () => {
    const t = convexTest(schema, modules);
    const candidateId = await createCandidate(t);

    const { noteId } = await t.mutation(internal.releases.persistVerifiedReleaseNote, {
      releaseCandidateId: candidateId,
      canonicalArticleUrl: "https://deepseek.com/news/v4",
      lab: "DeepSeek",
      modelNames: ["DeepSeek-V4-Pro"],
      title: "DeepSeek: DeepSeek-V4-Pro",
      plainTextMessage: "DeepSeek V4 Pro. Unknown: pricing.",
      telegramMessage: "DeepSeek V4 Pro.\n- Unknown: pricing.",
      verifierStatus: "verified",
      checkedClaims: 1,
      unsupportedCount: 0,
      totalCostUsd: 0.001,
      findings: [],
      now: 2000,
    });

    await t.mutation(internal.releases.markReleaseNoteNotified, {
      noteId,
      releaseCandidateId: candidateId,
      channel: "telegram",
      status: "failed",
      error: "Telegram API error",
      now: 3000,
    });

    const note = await t.query(internal.releases.getReleaseNoteByCanonicalUrl, {
      canonicalArticleUrl: "https://deepseek.com/news/v4",
    });
    expect(note!.notified).toBe(false);
  });
});

// ─── Notification records ─────────────────────────────────────────────────────

describe("notification records", () => {
  test("recordNotification creates a notification record", async () => {
    const t = convexTest(schema, modules);
    const now = 5000;

    await t.mutation(internal.registry.recordNotification, {
      fingerprint: "some:fingerprint",
      channel: "telegram",
      status: "sent",
      now,
    });

    // Verify by creating a second notification and querying both
    await t.mutation(internal.registry.recordNotification, {
      fingerprint: "another:fingerprint",
      channel: "telegram",
      status: "failed",
      error: "network error",
      now: now + 1,
    });

    const notifications = await t.run(async (ctx) => {
      return ctx.db.query("notifications").collect();
    });
    expect(notifications).toHaveLength(2);
    expect(notifications[0].signalFingerprint).toBe("some:fingerprint");
    expect(notifications[0].status).toBe("sent");
    expect(notifications[1].signalFingerprint).toBe("another:fingerprint");
    expect(notifications[1].status).toBe("failed");
    expect(notifications[1].error).toBe("network error");
  });
});

// ─── Evidence persistence ─────────────────────────────────────────────────────

describe("evidence document and chunk persistence", () => {
  test("inserts evidence document with chunks", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    const candidateResult = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://deepseek.com/news/v4",
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-api-docs",
      sourceUrl: "https://api-docs.deepseek.com",
      title: "DeepSeek V4",
      modelNames: ["DeepSeek-V4-Pro"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    const docId = await t.mutation(internal.releases.insertEvidenceDocument, {
      releaseCandidateId: candidateResult.id,
      document: {
        url: "https://arxiv.org/abs/2504.xxxxx",
        kind: "technical_report",
        fetchStatus: "ok",
        pageCount: 42,
      },
      chunks: [
        {
          chunkId: "tech_report_safety_0",
          sourceUrl: "https://arxiv.org/abs/2504.xxxxx",
          topic: "safety",
          text: "The model was evaluated for safety using standard red-teaming protocols.",
        },
        {
          chunkId: "tech_report_benchmarks_0",
          sourceUrl: "https://arxiv.org/abs/2504.xxxxx",
          topic: "benchmarks_evals",
          text: "DeepSeek-V4-Pro achieves 85.2 on MATH benchmark.",
        },
      ],
      now,
    });

    expect(docId).toBeTruthy();
  });
});
