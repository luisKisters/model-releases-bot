import { describe, expect, it } from "vitest";
import {
  evaluateOffline,
  type EvalFixtureCase,
  type EvalFixtureData,
} from "../src/lib/radar/eval";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function positiveCase(overrides: Partial<EvalFixtureCase> = {}): EvalFixtureCase {
  return {
    id: "test-positive",
    provider: "OpenAI",
    title: "Introducing GPT-5",
    url: "https://openai.com/index/gpt-5/",
    summary: "GPT-5 is the latest model from OpenAI, available as gpt-5.",
    expected: {
      shouldSend: true,
      lab: "OpenAI",
      modelNames: ["gpt-5"],
      releaseDate: "2025-05-16",
      canonicalUrl: "https://openai.com/index/gpt-5/",
      systemCardStatus: "linked",
      benchmarkExpectations: [{ name: "MMLU", status: "vendor_provided" }],
      expectedUnknowns: ["independent_benchmark_verification"],
    },
    ...overrides,
  };
}

function negativeCase(overrides: Partial<EvalFixtureCase> = {}): EvalFixtureCase {
  return {
    id: "test-negative",
    provider: "Cohere",
    title: "Introducing Command A",
    url: "https://cohere.com/blog/command-a",
    expected: {
      shouldSend: false,
      rejectionReason: "unselected_lab",
    },
    ...overrides,
  };
}

function deepseekV4Case(): EvalFixtureCase {
  return {
    id: "deepseek-v4",
    provider: "DeepSeek",
    title: "DeepSeek-V4-Pro and DeepSeek-V4-Flash model release",
    url: "https://api-docs.deepseek.com/news/news260424",
    summary:
      "DeepSeek releases DeepSeek-V4-Pro and DeepSeek-V4-Flash via the DeepSeek API.",
    expected: {
      shouldSend: true,
      lab: "DeepSeek",
      modelNames: ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
      releaseDate: "2026-04-24",
      canonicalUrl: "https://api-docs.deepseek.com/news/news260424",
      systemCardStatus: "linked",
      benchmarkExpectations: [
        { name: "MMLU", status: "vendor_provided" },
        { name: "HumanEval", status: "vendor_provided" },
      ],
      expectedUnknowns: ["independent_benchmark_verification"],
    },
  };
}

function minimalValidFixtureData(): EvalFixtureData {
  const allLabPositives: EvalFixtureCase[] = [
    {
      id: "openai-gpt5",
      provider: "OpenAI",
      title: "Introducing GPT-5",
      url: "https://openai.com/index/gpt-5/",
      summary: "GPT-5 is the latest OpenAI model.",
      expected: {
        shouldSend: true,
        lab: "OpenAI",
        modelNames: ["gpt-5"],
        releaseDate: "2025-05-16",
        systemCardStatus: "linked",
        benchmarkExpectations: [{ name: "MMLU", status: "vendor_provided" }],
        expectedUnknowns: ["independent_benchmark_verification"],
      },
    },
    {
      id: "anthropic-claude",
      provider: "Anthropic",
      title: "Introducing Claude Opus 4",
      url: "https://www.anthropic.com/news/claude-opus-4",
      expected: {
        shouldSend: true,
        lab: "Anthropic",
        modelNames: ["claude-opus-4"],
        releaseDate: "2025-07-22",
        systemCardStatus: "linked",
        benchmarkExpectations: [{ name: "GPQA", status: "vendor_provided" }],
        expectedUnknowns: ["independent_benchmark_verification"],
      },
    },
    {
      id: "google-gemini",
      provider: "Google Gemini",
      title: "Gemini 2.5 Pro available now",
      url: "https://deepmind.google/technologies/gemini/gemini-2-5-pro/",
      expected: {
        shouldSend: true,
        lab: "Google Gemini",
        modelNames: ["gemini-2.5-pro"],
        releaseDate: "2025-05-20",
        systemCardStatus: "linked",
        benchmarkExpectations: [{ name: "MMLU", status: "vendor_provided" }],
        expectedUnknowns: ["independent_benchmark_verification"],
      },
    },
    {
      id: "mistral-small",
      provider: "Mistral",
      title: "Introducing Mistral Small 4",
      url: "https://mistral.ai/news/mistral-small-4/",
      expected: {
        shouldSend: true,
        lab: "Mistral",
        modelNames: ["mistral-small-latest"],
        releaseDate: "2026-03-16",
        systemCardStatus: "not_found",
        benchmarkExpectations: [{ name: "MMLU", status: "vendor_provided" }],
        expectedUnknowns: ["safety_card"],
      },
    },
    deepseekV4Case(),
    {
      id: "meta-llama",
      provider: "Meta Llama",
      title: "Introducing Llama 4: multimodal intelligence",
      url: "https://ai.meta.com/blog/llama-4-multimodal-intelligence/",
      summary: "Meta releases Llama 4 Scout and Llama 4 Maverick with multimodal support.",
      expected: {
        shouldSend: true,
        lab: "Meta Llama",
        modelNames: ["llama-4-scout"],
        releaseDate: "2025-04-05",
        systemCardStatus: "linked",
        benchmarkExpectations: [{ name: "MMLU", status: "vendor_provided" }],
        expectedUnknowns: ["independent_benchmark_verification"],
      },
    },
    {
      id: "xai-grok",
      provider: "xAI",
      title: "Announcing Grok 4",
      url: "https://x.ai/news/grok-4",
      expected: {
        shouldSend: true,
        lab: "xAI",
        modelNames: ["grok-4"],
        releaseDate: "2025-06-15",
        systemCardStatus: "not_found",
        benchmarkExpectations: [{ name: "GPQA", status: "vendor_provided" }],
        expectedUnknowns: ["safety_card"],
      },
    },
    {
      id: "nvidia-nemotron",
      provider: "NVIDIA Nemotron",
      title: "NVIDIA Llama Nemotron Ultra open model delivers reasoning accuracy",
      url: "https://developer.nvidia.com/blog/nvidia-llama-nemotron-ultra-open-model-delivers-groundbreaking-reasoning-accuracy/",
      summary: "NVIDIA releases Llama Nemotron Ultra 253B as nemotron-ultra-253b.",
      expected: {
        shouldSend: true,
        lab: "NVIDIA Nemotron",
        modelNames: ["nemotron-ultra-253b"],
        releaseDate: "2025-04-07",
        systemCardStatus: "not_found",
        benchmarkExpectations: [{ name: "GPQA", status: "vendor_provided" }],
        expectedUnknowns: ["safety_card"],
      },
    },
    {
      id: "deepgram-nova",
      provider: "Deepgram",
      title: "Introducing Nova-3: Deepgram's most accurate speech model",
      url: "https://deepgram.com/learn/nova-3-speech-model",
      expected: {
        shouldSend: true,
        lab: "Deepgram",
        modelNames: ["Nova-3"],
        releaseDate: "2024-11-01",
        systemCardStatus: "not_found",
        benchmarkExpectations: [{ name: "WER", status: "vendor_provided" }],
        expectedUnknowns: ["safety_card"],
      },
    },
    {
      id: "elevenlabs-eleven-v3-ga",
      provider: "ElevenLabs",
      title: "Eleven v3 is Now Generally Available",
      url: "https://elevenlabs.io/blog/eleven-v3-is-now-generally-available",
      expected: {
        shouldSend: true,
        lab: "ElevenLabs",
        modelNames: ["Eleven v3"],
        releaseDate: "2026-02-02",
        systemCardStatus: "not_found",
        benchmarkExpectations: [{ name: "MOS", status: "vendor_provided" }],
        expectedUnknowns: ["safety_card"],
      },
    },
    {
      id: "assemblyai-universal",
      provider: "AssemblyAI",
      title: "AssemblyAI unveils Universal-1 speech model",
      url: "https://www.assemblyai.com/blog/announcing-universal-1",
      expected: {
        shouldSend: true,
        lab: "AssemblyAI",
        modelNames: ["Universal-1"],
        releaseDate: "2024-01-23",
        systemCardStatus: "not_found",
        benchmarkExpectations: [{ name: "WER", status: "vendor_provided" }],
        expectedUnknowns: ["safety_card"],
      },
    },
  ];

  const negatives: EvalFixtureCase[] = [
    negativeCase(),
    {
      id: "deepseek-hf-excluded",
      provider: "DeepSeek",
      title: "deepseek-ai/DeepSeek-V4-Pro-DSpark updated",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
      expected: { shouldSend: false, lab: "DeepSeek", rejectionReason: "not_official_domain" },
    },
  ];

  return { version: 3, cases: [...allLabPositives, ...negatives] };
}

// ─── Success cases ────────────────────────────────────────────────────────────

describe("evaluateOffline — success cases", () => {
  it("returns ok=true for a minimal valid fixture set", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true, maxCostUsd: 0 });
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("scores all 10 dimensions as numbers (no not_scored)", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    const scores = report.scores;
    for (const [dim, score] of Object.entries(scores)) {
      expect(score, `Dimension "${dim}" must not be not_scored`).not.toBe(
        "not_scored",
      );
      expect(typeof score, `Dimension "${dim}" must be a number`).toBe(
        "number",
      );
    }
  });

  it("sourceEligibility is 1.0 when all cases are correctly gated", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.sourceEligibility).toBe(1);
  });

  it("systemCardCoverage is 1.0 when all positive fixtures have systemCardStatus", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.systemCardCoverage).toBe(1);
  });

  it("benchmarkCoverage is 1.0 when all positive fixtures have benchmarkExpectations", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.benchmarkCoverage).toBe(1);
  });

  it("llmRouting is 1.0 (static check passes with correct routing config)", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.llmRouting).toBe(1);
  });

  it("costAccounting is 1.0 (math checks pass)", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.costAccounting).toBe(1);
  });

  it("verifierPrecision is 1.0 when all positive fixture messages pass verifier", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.verifierPrecision).toBe(1);
  });

  it("unsupportedClaimCount is 1.0 when no blocking verifier findings", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.unsupportedClaimCount).toBe(1);
  });

  it("concision is 1.0 when all messages are under Telegram limit", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.scores.concision).toBe(1);
  });

  it("produces a human-readable summary string", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    expect(report.humanSummary).toContain("Offline Eval Report");
    expect(report.humanSummary).toContain("Source Eligibility");
    expect(report.humanSummary).toContain("Verifier Precision");
  });

  it("verifier approves all positive fixture synthetic messages", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    const positiveCases = report.evaluatedCases.filter(
      (c) => c.expectedShouldSend,
    );
    for (const c of positiveCases) {
      expect(
        c.verifierApproved,
        `Positive fixture "${c.id}" should be approved by verifier`,
      ).toBe(true);
    }
  });

  it("all positive fixture synthetic messages contain required sections", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    const positiveCases = report.evaluatedCases.filter(
      (c) => c.expectedShouldSend,
    );
    for (const c of positiveCases) {
      const cov = c.syntheticMessageCoverage;
      expect(cov, `Coverage missing for "${c.id}"`).toBeDefined();
      expect(
        cov!.hasSourceUrl,
        `"${c.id}" synthetic message missing source URL`,
      ).toBe(true);
      expect(
        cov!.hasWeaknesses,
        `"${c.id}" synthetic message missing weaknesses`,
      ).toBe(true);
    }
  });

  it("all URLs in positive fixture synthetic messages are in evidence", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    const positiveCases = report.evaluatedCases.filter(
      (c) => c.expectedShouldSend,
    );
    for (const c of positiveCases) {
      expect(
        c.urlsInEvidenceCheck?.urlsNotInEvidence,
        `"${c.id}" has URLs not in evidence`,
      ).toHaveLength(0);
    }
  });
});

// ─── Failure cases ────────────────────────────────────────────────────────────

describe("evaluateOffline — failure cases", () => {
  it("fails when any fixture has not_scored dimensions due to empty case list", () => {
    // An empty fixture list makes extractionCoverage and others not_scored
    const data: EvalFixtureData = { version: 1, cases: [] };
    const report = evaluateOffline(data, { offline: true });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("not_scored"))).toBe(true);
  });

  it("fails when required deepseek-v4 fixture is missing", () => {
    const data: EvalFixtureData = {
      version: 1,
      cases: [positiveCase()],
    };
    const report = evaluateOffline(data, { offline: true });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("deepseek-v4"))).toBe(true);
  });

  it("fails when a fixture with shouldSend:false is accepted by the gate", () => {
    // Supply a URL that the gate would accept (official domain) but mark it as excluded
    const data: EvalFixtureData = {
      version: 1,
      cases: [
        ...minimalValidFixtureData().cases,
        {
          id: "false-positive-test",
          provider: "OpenAI",
          title: "Introducing GPT-6",
          url: "https://openai.com/index/gpt-6/",
          expected: {
            shouldSend: false, // marked excluded but gate will accept it
            rejectionReason: "test_false_positive",
          },
        },
      ],
    };
    const report = evaluateOffline(data, { offline: true });
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.includes("False positive")),
    ).toBe(true);
  });

  it("fails when a lab is missing a positive fixture", () => {
    // Remove all Anthropic fixtures
    const data = minimalValidFixtureData();
    data.cases = data.cases.filter(
      (c) => c.provider !== "Anthropic" && c.expected?.lab !== "Anthropic",
    );
    const report = evaluateOffline(data, { offline: true });
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.includes("Anthropic")),
    ).toBe(true);
  });

  it("reports sourceEligibility < 1 when a gate decision mismatches expected", () => {
    // A false negative: gate rejects a URL we expected to pass.
    // Per plan requirements, only false positives (shouldSend:false accepted) cause ok=false.
    // A mismatched score is reflected in sourceEligibility being < 1.
    const data: EvalFixtureData = {
      version: 1,
      cases: [
        ...minimalValidFixtureData().cases,
        {
          id: "wrong-eligibility",
          provider: "OpenAI",
          title: "GPT-4 release",
          url: "https://huggingface.co/openai/gpt-4", // HF URL; gate rejects, expected=true
          expected: {
            shouldSend: true,
            lab: "OpenAI",
            modelNames: [],
            systemCardStatus: "not_found",
            benchmarkExpectations: [],
            expectedUnknowns: [],
          },
        },
      ],
    };
    const report = evaluateOffline(data, { offline: true });
    // sourceEligibility is < 1 because one case has a gate mismatch
    expect(Number(report.scores.sourceEligibility)).toBeLessThan(1);
    // The wrong-eligibility case is marked as incorrect
    const wrongCase = report.evaluatedCases.find((c) => c.id === "wrong-eligibility");
    expect(wrongCase?.sourceEligibilityCorrect).toBe(false);
  });

  it("produces a machine-readable JSON-serializable report", () => {
    const data = minimalValidFixtureData();
    const report = evaluateOffline(data, { offline: true });
    // Should not throw
    const serialized = JSON.stringify(report);
    const parsed = JSON.parse(serialized);
    expect(parsed.ok).toBe(report.ok);
    expect(parsed.mode).toBe("offline");
    expect(Array.isArray(parsed.evaluatedCases)).toBe(true);
    expect(parsed.humanSummary).toBeTruthy();
  });
});
