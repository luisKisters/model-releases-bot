import { describe, expect, it } from "vitest";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { sourceRegistry } from "../src/lib/radar/sources";
import { parseSourceContent } from "../src/lib/radar/parsers";
import { isBaselinePollRun, shouldSendNotification } from "../src/lib/radar/notificationGate";
import type { SourceConfig } from "../src/lib/radar/types";

// Red-team cases: all must be rejected by the article gate before any article
// extraction, LLM call, or Telegram send can occur.
const RED_TEAM_CASES: Array<{
  id: string;
  description: string;
  candidate: { provider: string; title: string; url: string };
  expectedReason: string;
  expectedLab?: string;
}> = [
  {
    id: "deepseek-huggingface-org-update",
    description: "DeepSeek Hugging Face org update",
    candidate: {
      provider: "DeepSeek",
      title: "deepseek-ai/DeepSeek-V4-Pro-DSpark updated: added model weights",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
    },
    expectedReason: "not_official_domain",
    expectedLab: "DeepSeek",
  },
  {
    id: "xiaomi-mimo-huggingface",
    description: "Xiaomi MiMo Hugging Face org update",
    candidate: {
      provider: "XiaomiMiMo",
      title: "MiMo-7B-RL-Zero: Xiaomi first open-source reasoning model",
      url: "https://huggingface.co/XiaomiMiMo/MiMo-7B-RL-Zero",
    },
    expectedReason: "unselected_lab",
  },
  {
    id: "cohere-changelog",
    description: "Cohere changelog entry",
    candidate: {
      provider: "Cohere",
      title: "Classification endpoint now supports 1000 classes",
      url: "https://docs.cohere.com/changelog/classification-endpoint",
    },
    expectedReason: "unselected_lab",
  },
  {
    id: "openrouter-gemini-catalog",
    description: "OpenRouter Gemini model page",
    candidate: {
      provider: "Google Gemini",
      title: "google/gemini-2.5-pro - OpenRouter",
      url: "https://openrouter.ai/google/gemini-2.5-pro",
    },
    expectedReason: "unsupported_source_host",
    expectedLab: "Google Gemini",
  },
  {
    id: "google-ai-studio-docs",
    description: "Google AI Studio / Gemini API docs page",
    candidate: {
      provider: "Google Gemini",
      title: "Gemini API models documentation",
      url: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro",
    },
    expectedReason: "unsupported_source_host",
    expectedLab: "Google Gemini",
  },
  {
    id: "nvidia-blackwell-broad",
    description: "Broad NVIDIA Blackwell post (not Nemotron-specific)",
    candidate: {
      provider: "NVIDIA",
      title: "NVIDIA Blackwell AI inference platform update",
      url: "https://blogs.nvidia.com/blog/blackwell-ai-inference-platform/",
    },
    expectedReason: "not_official_domain",
    expectedLab: "NVIDIA Nemotron",
  },
  {
    id: "deepseek-generic-models-index",
    description: "Generic docs/models index page",
    candidate: {
      provider: "DeepSeek",
      title: "DeepSeek Models",
      url: "https://api-docs.deepseek.com/docs/models/",
    },
    expectedReason: "not_dedicated_article",
    expectedLab: "DeepSeek",
  },
  {
    id: "benchmark-only-page",
    description: "Third-party benchmark-only page",
    candidate: {
      provider: "ArtificialAnalysis",
      title: "DeepSeek V3 benchmark comparison on MMLU and HumanEval",
      url: "https://artificialanalysis.ai/models/deepseek-v3",
    },
    expectedReason: "unselected_lab",
  },
  {
    id: "third-party-article",
    description: "Third-party article about a model release",
    candidate: {
      provider: "TechCrunch",
      title: "DeepSeek's new model beats GPT-4 on major benchmarks",
      url: "https://techcrunch.com/2025/01/01/deepseek-model-release/",
    },
    expectedReason: "unselected_lab",
  },
];

describe("red-team source eligibility", () => {
  describe("article gate rejects all red-team cases", () => {
    for (const testCase of RED_TEAM_CASES) {
      it(`rejects ${testCase.description}`, () => {
        const decision = evaluateArticleGate(testCase.candidate);

        expect(decision.shouldSend).toBe(false);
        expect(decision.reason).toBe(testCase.expectedReason);

        if (testCase.expectedLab !== undefined) {
          expect(decision.lab).toBe(testCase.expectedLab);
        }
      });
    }
  });

  it("every red-team rejection produces a non-empty structured reason string", () => {
    for (const testCase of RED_TEAM_CASES) {
      const decision = evaluateArticleGate(testCase.candidate);
      expect(decision.shouldSend).toBe(false);
      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it("all red-team reasons are drawn from known structured reason codes", () => {
    const knownReasons = new Set([
      "unselected_lab",
      "missing_article_url",
      "invalid_article_url",
      "unsupported_source_host",
      "not_official_domain",
      "not_dedicated_article",
      "lab_specific_requirement_failed",
      "not_model_release",
    ]);

    for (const testCase of RED_TEAM_CASES) {
      const decision = evaluateArticleGate(testCase.candidate);
      expect(
        knownReasons.has(decision.reason),
        `Unexpected reason "${decision.reason}" for case "${testCase.id}"`,
      ).toBe(true);
    }
  });

  it("source registry excludes all known bad source domains", () => {
    const serialized = JSON.stringify(sourceRegistry).toLowerCase();

    const excludedDomains = [
      "huggingface.co/deepseek-ai",
      "huggingface.co/xiaomimimo",
      "docs.cohere.com/changelog",
      "openrouter.ai",
      "ai.google.dev",
      "blogs.nvidia.com",
      "artificialanalysis.ai",
      "techcrunch.com",
    ];

    for (const domain of excludedDomains) {
      expect(serialized, `Registry must not contain domain: ${domain}`).not.toContain(domain);
    }
  });

  it("no enabled+notifying source in registry belongs to an excluded provider", () => {
    const excludedProviders = ["Cohere", "Qwen", "Kimi", "MiniMax", "Z.ai", "XiaomiMiMo"];

    for (const provider of excludedProviders) {
      const found = sourceRegistry.filter(
        (source) => source.provider === provider && source.enabled && source.notify,
      );
      expect(
        found,
        `Provider "${provider}" must have no enabled+notifying sources`,
      ).toHaveLength(0);
    }
  });

  it("discovery-only sources have notify=false so they cannot directly send", () => {
    const discoveryOnly = sourceRegistry.filter((source) => !source.notify);
    // Changelog, release-collection, and discovery-feed sources must exist and have notify=false
    expect(discoveryOnly.length).toBeGreaterThan(0);

    const discoverySourceIds = discoveryOnly.map((source) => source.sourceId);
    // Changelog and discovery sources that must NOT notify directly
    const expectedDiscovery = [
      "deepgram-changelog-rss",
      "deepgram-blog",
      "elevenlabs-changelog-rss",
      "elevenlabs-blog",
      "assemblyai-releases",
      "assemblyai-blog",
    ];

    for (const expectedId of expectedDiscovery) {
      expect(
        discoverySourceIds,
        `Source "${expectedId}" should be discovery-only (notify=false)`,
      ).toContain(expectedId);
    }
  });

  it("parser propagates shouldNotify=false for signals whose URLs are not on official domains", () => {
    const deepseekHfSource: SourceConfig = {
      sourceId: "deepseek-hf-stale",
      provider: "DeepSeek",
      label: "DeepSeek HuggingFace (stale)",
      url: "https://huggingface.co/deepseek-ai",
      parser: "huggingfaceOrg",
      confidence: "official",
      signalType: "release_note",
      pollEveryMinutes: 5,
      enabled: true,
      notify: true,
    };

    const fakePayload = JSON.stringify([
      { id: "deepseek-ai/DeepSeek-V4-Pro-DSpark", lastModified: "2026-04-24" },
      { id: "deepseek-ai/DeepSeek-V4-Flash", lastModified: "2026-04-24" },
    ]);

    const signals = parseSourceContent(deepseekHfSource, fakePayload);

    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(
        signal.shouldNotify,
        `Signal from HuggingFace URL "${signal.url}" must have shouldNotify=false`,
      ).toBe(false);
    }
  });

  it("stale source IDs from excluded labs are not in the current registry", () => {
    const currentSourceIds = new Set(sourceRegistry.map((source) => source.sourceId));

    // These source IDs represent the old/excluded sources that must be disabled
    // by disableStaleSources when source sync runs
    const excludedSourceIds = [
      "deepseek-ai-huggingface",
      "deepseek-huggingface",
      "xiaomi-mimo-huggingface",
      "xiaomimimo-huggingface",
      "cohere-blog",
      "cohere-changelog-rss",
      "qwen-huggingface",
      "kimi-moonshot",
      "minimax-hf",
    ];

    for (const staleId of excludedSourceIds) {
      expect(
        currentSourceIds.has(staleId),
        `Excluded source "${staleId}" must not be in the current registry`,
      ).toBe(false);
    }
  });

  it("baseline poll run (no prior content hash) must not send notifications", () => {
    // A source polled for the first time has no lastContentHash
    expect(isBaselinePollRun(undefined)).toBe(true);
    expect(isBaselinePollRun(null)).toBe(true);
    expect(isBaselinePollRun("")).toBe(true);

    // A source polled previously has a non-empty lastContentHash
    expect(isBaselinePollRun("abc123hash")).toBe(false);
    expect(isBaselinePollRun("sha256:deadbeef")).toBe(false);
  });

  it("shouldSendNotification blocks all notifications during baseline run", () => {
    // Baseline runs must never send notifications regardless of signal state
    expect(shouldSendNotification(true, true)).toBe(false);
    expect(shouldSendNotification(true, false)).toBe(false);
  });

  it("shouldSendNotification gates on signal shouldNotify for non-baseline runs", () => {
    expect(shouldSendNotification(false, true)).toBe(true);
    expect(shouldSendNotification(false, false)).toBe(false);
  });

  it("Cohere-like providers rejected via article gate before any LLM or Telegram path", () => {
    // If a Cohere signal somehow reached the pipeline, the gate must stop it
    const cohereDecision = evaluateArticleGate({
      provider: "Cohere",
      title: "Cohere Command A now available",
      url: "https://cohere.com/blog/command-a",
    });
    expect(cohereDecision.shouldSend).toBe(false);
    expect(cohereDecision.reason).toBe("unselected_lab");

    const cohereChangelogDecision = evaluateArticleGate({
      provider: "Cohere",
      title: "Classification endpoint update",
      url: "https://docs.cohere.com/changelog/classification-endpoint",
    });
    expect(cohereChangelogDecision.shouldSend).toBe(false);
    expect(cohereChangelogDecision.reason).toBe("unselected_lab");
  });

  it("Hugging Face links for DeepSeek are rejected as non-official-domain", () => {
    for (const hfPath of [
      "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
      "https://huggingface.co/deepseek-ai/DeepSeek-V3-Base",
      "https://huggingface.co/deepseek-ai/deepseek-vl2",
    ]) {
      const decision = evaluateArticleGate({
        provider: "DeepSeek",
        title: "DeepSeek model on Hugging Face",
        url: hfPath,
      });
      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toBe("not_official_domain");
      expect(decision.lab).toBe("DeepSeek");
    }
  });
});
