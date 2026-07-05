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
    expect(candidate!.modelNames).toEqual(["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"]);
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
