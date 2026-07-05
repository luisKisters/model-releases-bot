// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal, api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const baseSrc = {
  provider: "OpenAI",
  label: "OpenAI news",
  url: "https://openai.com/news",
  parser: "rssAtom",
  confidence: "official",
  signalType: "release_note",
  pollEveryMinutes: 5,
  enabled: true,
  notify: true,
};

const discoverySrc = {
  sourceId: "anthropic-news",
  provider: "Anthropic",
  label: "Anthropic news",
  url: "https://www.anthropic.com/news",
  parser: "html",
  confidence: "official",
  signalType: "release_note",
  pollEveryMinutes: 15,
  enabled: true,
  notify: false, // discovery-only
};

describe("dashboard overview shape", () => {
  test("overview query returns expected top-level keys", async () => {
    const t = convexTest(schema, modules);

    const overview = await t.query(api.dashboard.overview, {});

    expect(overview).toMatchObject({
      telegramConfigured: expect.any(Boolean),
      secrets: expect.objectContaining({
        telegram: expect.any(Boolean),
        deepseek: expect.any(Boolean),
        openrouter: expect.any(Boolean),
        artificialAnalysis: expect.any(Boolean),
      }),
      missingSecrets: expect.any(Array),
      sources: expect.any(Array),
      activeSourceCount: expect.any(Number),
      disabledSourceCount: expect.any(Number),
      sendableSourceCount: expect.any(Number),
      discoverySourceCount: expect.any(Number),
      signals: expect.any(Array),
      models: expect.any(Array),
      notifications: expect.any(Array),
      releaseCandidates: expect.any(Array),
      verifiedNotes: expect.any(Array),
      latestSignalCount: expect.any(Number),
      latestModelCount: expect.any(Number),
      evalScoreSummary: expect.objectContaining({
        verifiedNoteCount: expect.any(Number),
        rejectedNoteCount: expect.any(Number),
        totalUnsupportedClaims: expect.any(Number),
      }),
      failedSources: expect.any(Array),
    });
  });

  test("secret values are never exposed — only booleans", async () => {
    const t = convexTest(schema, modules);
    const overview = await t.query(api.dashboard.overview, {});

    // Secrets object only contains booleans
    for (const [key, val] of Object.entries(overview.secrets)) {
      expect(typeof val, `secrets.${key} must be boolean`).toBe("boolean");
    }
    // No raw API key strings anywhere
    const json = JSON.stringify(overview);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(json).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(json).not.toMatch(/DEEPSEEK_API_KEY/);
  });

  test("active vs disabled source counts are accurate", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    await t.mutation(internal.registry.syncSources, {
      sources: [
        { ...baseSrc, sourceId: "openai-news-rss" },
        discoverySrc,
      ],
      now,
    });

    // Disable openai-news-rss by removing it from registry on second sync
    await t.mutation(internal.registry.syncSources, {
      sources: [discoverySrc],
      now,
    });

    const overview = await t.query(api.dashboard.overview, {});

    // anthropic-news is active discovery; openai-news-rss is disabled
    expect(overview.activeSourceCount).toBe(1);
    expect(overview.disabledSourceCount).toBe(1);
    expect(overview.sendableSourceCount).toBe(0); // no notify=true active source
    expect(overview.discoverySourceCount).toBe(1); // anthropic-news
  });

  test("disabled stale sources appear in sources list", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    await t.mutation(internal.registry.syncSources, {
      sources: [
        { ...baseSrc, sourceId: "openai-news-rss" },
        discoverySrc,
      ],
      now,
    });

    // Stale sync removes openai-news-rss
    await t.mutation(internal.registry.syncSources, {
      sources: [discoverySrc],
      now,
    });

    const overview = await t.query(api.dashboard.overview, {});
    const sourceIds = overview.sources.map((s: { sourceId: string }) => s.sourceId);

    expect(sourceIds).toContain("openai-news-rss"); // still visible, just disabled
    expect(sourceIds).toContain("anthropic-news");

    const openaiRow = overview.sources.find((s: { sourceId: string }) => s.sourceId === "openai-news-rss");
    expect(openaiRow!.enabled).toBe(false);
    expect(openaiRow!.lastError).toBe("disabled: source removed from registry");
  });

  test("sendable vs discovery source labeling", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    await t.mutation(internal.registry.syncSources, {
      sources: [
        { ...baseSrc, sourceId: "openai-news-rss" }, // notify: true = sendable
        discoverySrc,                                   // notify: false = discovery
      ],
      now,
    });

    const overview = await t.query(api.dashboard.overview, {});

    const openaiRow = overview.sources.find((s: { sourceId: string }) => s.sourceId === "openai-news-rss");
    const anthropicRow = overview.sources.find((s: { sourceId: string }) => s.sourceId === "anthropic-news");

    expect(openaiRow!.notify).toBe(true);   // sendable
    expect(anthropicRow!.notify).toBe(false); // discovery-only
  });

  test("lastSentNotification is null when no sends have occurred", async () => {
    const t = convexTest(schema, modules);
    const overview = await t.query(api.dashboard.overview, {});
    expect(overview.lastSentNotification).toBeNull();
  });

  test("lastSentNotification points to the latest sent notification", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.registry.recordNotification, {
      channel: "telegram",
      status: "failed",
      error: "network timeout",
      now: 1000,
    });
    await t.mutation(internal.registry.recordNotification, {
      channel: "telegram",
      status: "sent",
      now: 2000,
    });

    const overview = await t.query(api.dashboard.overview, {});
    expect(overview.lastSentNotification).not.toBeNull();
    expect(overview.lastSentNotification!.status).toBe("sent");
    expect(overview.lastSentNotification!.createdAt).toBe(2000);
  });

  test("evalScoreSummary counts verified vs rejected notes", async () => {
    const t = convexTest(schema, modules);
    const now = 3000;

    // Create two candidates
    const r1 = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://deepseek.com/news/v4a",
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-news",
      sourceUrl: "https://api-docs.deepseek.com/news",
      title: "DeepSeek-V4a",
      modelNames: ["DeepSeek-V4-Pro"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    const r2 = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://deepseek.com/news/v4b",
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-news",
      sourceUrl: "https://api-docs.deepseek.com/news",
      title: "DeepSeek-V4b",
      modelNames: ["DeepSeek-V4-Flash"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    // Persist one verified, one rejected note
    await t.mutation(internal.releases.persistVerifiedReleaseNote, {
      releaseCandidateId: r1.id,
      canonicalArticleUrl: "https://deepseek.com/news/v4a",
      lab: "DeepSeek",
      modelNames: ["DeepSeek-V4-Pro"],
      title: "DeepSeek-V4a",
      plainTextMessage: "test",
      telegramMessage: "test",
      verifierStatus: "verified",
      checkedClaims: 5,
      unsupportedCount: 0,
      totalCostUsd: 0.05,
      findings: [],
      now,
    });

    await t.mutation(internal.releases.persistVerifiedReleaseNote, {
      releaseCandidateId: r2.id,
      canonicalArticleUrl: "https://deepseek.com/news/v4b",
      lab: "DeepSeek",
      modelNames: ["DeepSeek-V4-Flash"],
      title: "DeepSeek-V4b",
      plainTextMessage: "test",
      telegramMessage: "test",
      verifierStatus: "rejected",
      checkedClaims: 3,
      unsupportedCount: 2,
      totalCostUsd: 0.03,
      findings: [
        { claim: "best model ever", issue: "unsupported_strength", detail: "not in article", severity: "block" },
      ],
      now,
    });

    const overview = await t.query(api.dashboard.overview, {});
    expect(overview.evalScoreSummary.verifiedNoteCount).toBe(1);
    expect(overview.evalScoreSummary.rejectedNoteCount).toBe(1);
    expect(overview.evalScoreSummary.totalUnsupportedClaims).toBe(2);
  });

  test("release candidates include evidence doc urls and total cost", async () => {
    const t = convexTest(schema, modules);
    const now = 4000;

    const cand = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://deepseek.com/news/v4c",
      lab: "DeepSeek",
      provider: "deepseek",
      sourceId: "deepseek-news",
      sourceUrl: "https://api-docs.deepseek.com/news",
      title: "DeepSeek-V4c",
      modelNames: ["DeepSeek-V4-Pro"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    // Insert an evidence document
    await t.mutation(internal.releases.insertEvidenceDocument, {
      releaseCandidateId: cand.id,
      document: {
        url: "https://arxiv.org/abs/2501.12345",
        kind: "technical_report",
        fetchStatus: "ok",
      },
      chunks: [],
      now,
    });

    // Insert LLM usage records
    await t.mutation(internal.releases.insertLlmUsageRecords, {
      releaseCandidateId: cand.id,
      records: [
        {
          stage: "article_summarizer",
          modelId: "deepseek-chat",
          promptTokens: 1000,
          completionTokens: 200,
          cacheHitTokens: 0,
          estimatedCostUsd: 0.01,
        },
        {
          stage: "final_writer",
          modelId: "openrouter/kimi-k2",
          promptTokens: 500,
          completionTokens: 150,
          cacheHitTokens: 0,
          estimatedCostUsd: 0.02,
        },
      ],
      now,
    });

    const overview = await t.query(api.dashboard.overview, {});
    const row = overview.releaseCandidates.find(
      (c: { canonicalArticleUrl: string }) => c.canonicalArticleUrl === "https://deepseek.com/news/v4c",
    );
    expect(row).toBeDefined();
    expect(row!.evidenceDocUrls).toContain("https://arxiv.org/abs/2501.12345");
    expect(row!.totalCostUsd).toBeCloseTo(0.03, 4);
  });

  test("verified notes include verifier findings", async () => {
    const t = convexTest(schema, modules);
    const now = 5000;

    const cand = await t.mutation(internal.releases.createOrSkipCandidate, {
      canonicalArticleUrl: "https://openai.com/blog/gpt-5",
      lab: "OpenAI",
      provider: "openai",
      sourceId: "openai-news-rss",
      sourceUrl: "https://openai.com/news",
      title: "GPT-5",
      modelNames: ["GPT-5"],
      gateResult: { shouldSend: true, reasons: [] },
      baseline: false,
      now,
    });

    await t.mutation(internal.releases.persistVerifiedReleaseNote, {
      releaseCandidateId: cand.id,
      canonicalArticleUrl: "https://openai.com/blog/gpt-5",
      lab: "OpenAI",
      modelNames: ["GPT-5"],
      title: "GPT-5",
      plainTextMessage: "test",
      telegramMessage: "test",
      verifierStatus: "rejected",
      checkedClaims: 4,
      unsupportedCount: 1,
      totalCostUsd: 0.04,
      findings: [
        {
          claim: "Best coding model",
          issue: "unsupported_benchmark",
          detail: "No independent benchmark supports this",
          severity: "block",
        },
      ],
      now,
    });

    const overview = await t.query(api.dashboard.overview, {});
    const note = overview.verifiedNotes.find(
      (n: { canonicalArticleUrl: string }) => n.canonicalArticleUrl === "https://openai.com/blog/gpt-5",
    );
    expect(note).toBeDefined();
    expect(note!.findings).toHaveLength(1);
    expect(note!.findings[0].issue).toBe("unsupported_benchmark");
    expect(note!.findings[0].severity).toBe("block");
  });

  test("failed sources are included with failure details", async () => {
    const t = convexTest(schema, modules);
    const now = 1000;

    await t.mutation(internal.registry.syncSources, {
      sources: [{ ...baseSrc, sourceId: "openai-news-rss" }],
      now,
    });

    // Record 10 failures to trigger source_failure signal
    for (let i = 0; i < 10; i++) {
      await t.mutation(internal.registry.recordPollFailure, {
        sourceId: "openai-news-rss",
        now: now + i * 1000,
        error: "connection refused",
        statusCode: 503,
      });
    }

    const overview = await t.query(api.dashboard.overview, {});
    expect(overview.failedSources.length).toBeGreaterThan(0);

    const failedRow = overview.failedSources.find(
      (s: { sourceId: string }) => s.sourceId === "openai-news-rss",
    );
    expect(failedRow).toBeDefined();
    expect(failedRow!.failureCount).toBe(10);
    expect(failedRow!.lastError).toContain("503");
  });
});
