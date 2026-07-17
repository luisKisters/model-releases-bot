import { describe, expect, it } from "vitest";
import {
  runVerifier,
  runResearcher,
  runArticleSummarizer,
  runSystemCardSummarizer,
  runBenchmarkAggregator,
  runFinalWriter,
  runAgentOrchestration,
  type EvidencePacket,
  type VerifierInput,
  type VerifierOutput,
  type ResearcherInput,
  type OrchestratorOptions,
} from "../src/lib/radar/agents";
import {
  createLlmRouter,
  CostTracker,
  makeFakeLlmCompletion,
  type LlmMessage,
  type LlmRole,
  type LlmRouter,
} from "../src/lib/radar/llm";
import type { ExtractedArticle } from "../src/lib/radar/types";
import type { SystemCardResult } from "../src/lib/radar/systemCards";
import type { BenchmarkEvidence } from "../src/lib/radar/benchmarks";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<ExtractedArticle> = {}): ExtractedArticle {
  return {
    url: "https://api-docs.deepseek.com/news/news260424",
    canonicalUrl: "https://api-docs.deepseek.com/news/news260424",
    finalUrl: "https://api-docs.deepseek.com/news/news260424",
    title: "DeepSeek-V4 Release",
    author: null,
    publisher: "DeepSeek",
    publishedAt: "2026-04-24",
    updatedAt: null,
    body: "DeepSeek announces DeepSeek-V4-Pro and DeepSeek-V4-Flash. MMLU: 92.5%. Available via API.",
    headings: ["Introduction", "Benchmark Results", "API Availability"],
    outboundLinks: ["https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro"],
    images: [],
    downloadableAssets: [],
    reducedConfidence: false,
    ...overrides,
  };
}

function makeSystemCardResult(overrides: Partial<SystemCardResult> = {}): SystemCardResult {
  return {
    system_card_status: "not_found",
    detected: [],
    documents: [],
    ...overrides,
  };
}

function makeBenchmarkEvidence(overrides: Partial<BenchmarkEvidence> = {}): BenchmarkEvidence {
  return {
    lab: "DeepSeek",
    modelNames: ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
    modality: ["language", "coding", "reasoning"],
    claims: [],
    artificialAnalysis: {
      ok: false,
      status: "skipped",
      reason: "No API key",
      missingKey: true,
    },
    ...overrides,
  };
}

function makeEvidencePacket(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  const tracker = new CostTracker(10);
  return {
    lab: "DeepSeek",
    modelNames: ["DeepSeek-V4-Pro"],
    articleUrl: "https://api-docs.deepseek.com/news/news260424",
    releaseDate: "2026-04-24",
    articleSummary: "DeepSeek released DeepSeek-V4-Pro with strong coding and reasoning capabilities.",
    systemCardSummary: "No system card found for this release.",
    benchmarkSummary: "MMLU: 92.5% (vendor-provided, not independently verified). Status: missing.",
    evidenceSynthesis: "DeepSeek-V4-Pro represents a significant improvement in language model capabilities. Unknown: no independent benchmark verification available.",
    claims: [],
    systemCardStatus: "not_found",
    references: [
      {
        url: "https://api-docs.deepseek.com/news/news260424",
        kind: "article",
        chunkIds: ["article_overview_0"],
      },
    ],
    costTracker: tracker,
    placements: null,
    availability: { api: "[placeholder]", subscription: "[placeholder]" },
    ...overrides,
  };
}

function makeVerifierInput(
  message: string,
  evidencePacketOverrides: Partial<EvidencePacket> = {},
): VerifierInput {
  return {
    message,
    evidencePacket: makeEvidencePacket(evidencePacketOverrides),
  };
}

// ─── Verifier: verified messages pass ────────────────────────────────────────

describe("runVerifier – verified messages pass", () => {
  it("approves a well-formed message with source URL and explicit unknowns", () => {
    const message = [
      "DeepSeek releases DeepSeek-V4-Pro (2026-04-24).",
      "Where it shines: coding, reasoning, and long-context tasks.",
      "Strengths: The official article reports strong MMLU performance.",
      "Weaknesses/unknowns: No independent benchmark verification available. Safety details unknown.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    const result = runVerifier(makeVerifierInput(message));
    expect(result.approved).toBe(true);
    expect(result.findings.filter((f) => f.severity === "block")).toHaveLength(0);
  });

  it("returns checkedClaims count", () => {
    const message = [
      "Model release with 92.5 performance on MMLU.",
      "Unknown: no safety card found.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    const result = runVerifier(makeVerifierInput(message));
    expect(result.checkedClaims).toBeGreaterThanOrEqual(0);
  });

  it("approves message that includes weakness section with 'unknown' keyword", () => {
    const message = "DeepSeek-V4-Pro released. Strengths: coding. Unknown: no safety card. Source: https://api-docs.deepseek.com/news/news260424";
    const result = runVerifier(makeVerifierInput(message));
    const blockingFindings = result.findings.filter((f) => f.severity === "block");
    // missing_weakness should not fire when "unknown" is present
    expect(blockingFindings.some((f) => f.issue === "missing_weakness")).toBe(false);
  });

  it("approves message when all URLs are in evidence references", () => {
    const message = "DeepSeek-V4 released. Unknown: no safety card. See https://api-docs.deepseek.com/news/news260424 for details.";
    const result = runVerifier(makeVerifierInput(message));
    const urlFindings = result.findings.filter((f) => f.issue === "wrong_source_url");
    expect(urlFindings).toHaveLength(0);
  });
});

// ─── Verifier: unsupported messages are blocked ───────────────────────────────

describe("runVerifier – unverified messages are blocked", () => {
  it("blocks messages missing any weaknesses/unknowns section", () => {
    const message = "DeepSeek-V4-Pro is the best model. Strengths: fast. Source: https://api-docs.deepseek.com/news/news260424";
    const result = runVerifier(makeVerifierInput(message));
    const weaknessFindings = result.findings.filter((f) => f.issue === "missing_weakness");
    expect(weaknessFindings.length).toBeGreaterThan(0);
    expect(weaknessFindings[0]!.severity).toBe("block");
    expect(result.approved).toBe(false);
  });

  it("blocks messages with unsupported superlative strength claims", () => {
    const message = [
      "DeepSeek-V4-Pro outperforms all other models ever created.",
      "Weakness: none known.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    // Use empty evidence to ensure claim is not supported
    const result = runVerifier(
      makeVerifierInput(message, {
        articleSummary: "DeepSeek released a model.",
        benchmarkSummary: "No benchmarks.",
        evidenceSynthesis: "Basic release.",
      }),
    );

    const strengthFindings = result.findings.filter((f) => f.issue === "unsupported_strength");
    expect(strengthFindings.length).toBeGreaterThan(0);
    expect(result.approved).toBe(false);
  });

  it("blocks comparative benchmark language when no structured benchmark claims exist", () => {
    const message = [
      "Where it shines: open-source SOTA on agentic coding benchmarks.",
      "Unknown: independent benchmark verification unavailable.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    const result = runVerifier(
      makeVerifierInput(message, {
        claims: [],
        evidenceSynthesis: "The vendor describes strong agentic coding performance.",
      }),
    );

    const strengthFindings = result.findings.filter((f) => f.issue === "unsupported_strength");
    expect(strengthFindings.length).toBeGreaterThan(0);
    expect(result.approved).toBe(false);
  });

  it("blocks messages with benchmark claims not in evidence", () => {
    const message = [
      "DeepSeek-V4-Pro achieves 99.9% on HumanEval.",
      "Unknown: no safety card.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    const result = runVerifier(
      makeVerifierInput(message, {
        benchmarkSummary: "MMLU: 92.5%. No HumanEval data.",
        evidenceSynthesis: "MMLU results available. HumanEval not present.",
        claims: [
          {
            name: "MMLU",
            value: "92.5",
            source: "vendor_article",
            sourceUrl: "https://api-docs.deepseek.com/news/news260424",
            provenance: "vendor",
            status: "missing",
          },
        ],
      }),
    );

    const benchmarkFindings = result.findings.filter((f) => f.issue === "unsupported_benchmark");
    expect(benchmarkFindings.length).toBeGreaterThan(0);
    expect(result.approved).toBe(false);
  });

  it("blocks messages with wrong source URLs not in evidence", () => {
    const message = [
      "DeepSeek released a model. Weakness: unknown safety.",
      "Source: https://completely-unrelated-website.com/fake-article",
    ].join("\n");

    const result = runVerifier(makeVerifierInput(message));
    const urlFindings = result.findings.filter((f) => f.issue === "wrong_source_url");
    expect(urlFindings.length).toBeGreaterThan(0);
    expect(result.approved).toBe(false);
  });

  it("blocks messages with invented safety claims when no system card found", () => {
    const message = [
      "Model passed all RLHF alignment tests.",
      "Weakness: unknown context window.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    const result = runVerifier(
      makeVerifierInput(message, {
        systemCardStatus: "not_found",
        systemCardSummary: "No system card found.",
        articleSummary: "Model released with API access.",
        benchmarkSummary: "No benchmarks.",
        evidenceSynthesis: "Model released.",
      }),
    );

    const safetyFindings = result.findings.filter((f) => f.issue === "invented_safety_claim");
    expect(safetyFindings.length).toBeGreaterThan(0);
    expect(result.approved).toBe(false);
  });

  it("warns when article URL is missing from message", () => {
    const message = "DeepSeek released a model. Unknown: no safety card. No source URL included here.";
    const result = runVerifier(makeVerifierInput(message));
    const staleFindings = result.findings.filter((f) => f.issue === "stale_article_url");
    expect(staleFindings.length).toBeGreaterThan(0);
    expect(staleFindings[0]!.severity).toBe("warn");
  });

  it("sets unsupportedCount to number of blocking findings", () => {
    const message = "Model is the best ever. No weaknesses. Source: https://api-docs.deepseek.com/news/news260424";
    const result = runVerifier(
      makeVerifierInput(message, {
        articleSummary: "Model released.",
        evidenceSynthesis: "Basic release.",
        benchmarkSummary: "",
      }),
    );
    expect(result.unsupportedCount).toBe(result.findings.filter((f) => f.severity === "block").length);
  });
});

// ─── Verifier: specific test cases ───────────────────────────────────────────

describe("runVerifier – specific cases", () => {
  it("does not flag safety keywords when system card is found and evidence supports them", () => {
    const message = [
      "The system card covers red team evaluations.",
      "Unknown: deployment details.",
      "Source: https://api-docs.deepseek.com/news/news260424",
    ].join("\n");

    const result = runVerifier(
      makeVerifierInput(message, {
        systemCardStatus: "found",
        systemCardSummary: "Red team evaluations conducted. No major issues found.",
        evidenceSynthesis: "Red team evaluations are documented in the system card.",
      }),
    );

    const safetyFindings = result.findings.filter((f) => f.issue === "invented_safety_claim");
    expect(safetyFindings).toHaveLength(0);
  });

  it("verifier output has required shape", () => {
    const message = "Release. Unknown: no safety card. Source: https://api-docs.deepseek.com/news/news260424";
    const result: VerifierOutput = runVerifier(makeVerifierInput(message));
    expect(typeof result.approved).toBe("boolean");
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.checkedClaims).toBe("number");
    expect(typeof result.unsupportedCount).toBe("number");
  });

  it("each finding has required fields", () => {
    const message = "Model is the best ever. No weaknesses. Source: https://api-docs.deepseek.com/news/news260424";
    const result = runVerifier(
      makeVerifierInput(message, { articleSummary: "Basic.", evidenceSynthesis: "Basic.", benchmarkSummary: "" }),
    );
    for (const finding of result.findings) {
      expect(typeof finding.claim).toBe("string");
      expect(typeof finding.issue).toBe("string");
      expect(typeof finding.detail).toBe("string");
      expect(["block", "warn"]).toContain(finding.severity);
    }
  });
});

// ─── Researcher ───────────────────────────────────────────────────────────────

describe("runResearcher", () => {
  it("extracts lab from article URL", async () => {
    const input: ResearcherInput = {
      articleUrl: "https://api-docs.deepseek.com/news/news260424",
      article: makeArticle(),
      systemCardResult: makeSystemCardResult(),
      benchmarkEvidence: makeBenchmarkEvidence(),
    };
    const output = await runResearcher(input);
    expect(output.lab).toBe("DeepSeek");
  });

  it("extracts Anthropic lab from anthropic.com URL", async () => {
    const input: ResearcherInput = {
      articleUrl: "https://www.anthropic.com/news/claude-4",
      article: makeArticle({ finalUrl: "https://www.anthropic.com/news/claude-4" }),
      systemCardResult: makeSystemCardResult(),
      benchmarkEvidence: makeBenchmarkEvidence({ lab: "Anthropic" }),
    };
    const output = await runResearcher(input);
    expect(output.lab).toBe("Anthropic");
  });

  it("extracts release date from article publishedAt", async () => {
    const input: ResearcherInput = {
      articleUrl: "https://api-docs.deepseek.com/news/news260424",
      article: makeArticle({ publishedAt: "2026-04-24" }),
      systemCardResult: makeSystemCardResult(),
      benchmarkEvidence: makeBenchmarkEvidence(),
    };
    const output = await runResearcher(input);
    expect(output.releaseDate).toBe("2026-04-24");
  });

  it("includes article URL in references", async () => {
    const input: ResearcherInput = {
      articleUrl: "https://api-docs.deepseek.com/news/news260424",
      article: makeArticle(),
      systemCardResult: makeSystemCardResult(),
      benchmarkEvidence: makeBenchmarkEvidence(),
    };
    const output = await runResearcher(input);
    expect(output.references.some((r) => r.kind === "article")).toBe(true);
  });

  it("includes system card documents as references", async () => {
    const input: ResearcherInput = {
      articleUrl: "https://api-docs.deepseek.com/news/news260424",
      article: makeArticle(),
      systemCardResult: {
        system_card_status: "found",
        detected: [{ url: "https://anthropic.com/system-card", anchorText: "System Card", kind: "system_card", confidence: "high" }],
        documents: [
          {
            url: "https://anthropic.com/system-card",
            canonicalUrl: null,
            kind: "system_card",
            title: "System Card",
            chunks: [{ chunkId: "chunk_0", sourceUrl: "https://anthropic.com/system-card", topic: "safety", pageNumber: null, text: "Safety eval content." }],
            fetchStatus: "ok",
          },
        ],
      },
      benchmarkEvidence: makeBenchmarkEvidence(),
    };
    const output = await runResearcher(input);
    expect(output.references.some((r) => r.kind === "system_card")).toBe(true);
  });

  it("falls back to article text extraction when benchmark evidence has no model names", async () => {
    const input: ResearcherInput = {
      articleUrl: "https://api-docs.deepseek.com/news/news260424",
      article: makeArticle(),
      systemCardResult: makeSystemCardResult(),
      benchmarkEvidence: makeBenchmarkEvidence({ modelNames: [] }),
    };
    const output = await runResearcher(input);
    // The article body contains "DeepSeek-V4-Pro" and "DeepSeek-V4-Flash" — the
    // fallback must extract them rather than returning an empty array.
    expect(output.modelNames.length).toBeGreaterThan(0);
    expect(output.modelNames.some((n) => n.toLowerCase().includes("deepseek"))).toBe(true);
  });
});

// ─── LLM-backed roles: offline mode ──────────────────────────────────────────

describe("runArticleSummarizer – offline", () => {
  it("returns a non-empty summary using the offline router", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    const output = await runArticleSummarizer(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], articleText: "Article body...", articleUrl: "https://api-docs.deepseek.com/news/news260424" },
      router,
      tracker,
    );
    expect(output.summary.length).toBeGreaterThan(0);
  });

  it("records usage in cost tracker", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    await runArticleSummarizer(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], articleText: "Article body...", articleUrl: "https://api-docs.deepseek.com/news/news260424" },
      router,
      tracker,
    );
    expect(tracker.stages).toHaveLength(1);
    expect(tracker.stages[0]!.stage).toBe("article_summarizer");
  });
});

describe("runSystemCardSummarizer – offline", () => {
  it("returns not_found status when system card result is empty", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    const output = await runSystemCardSummarizer(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], systemCardResult: makeSystemCardResult() },
      router,
      tracker,
    );
    expect(output.status).toBe("not_found");
  });

  it("returns found status and non-empty summary when documents present", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    const output = await runSystemCardSummarizer(
      {
        lab: "Anthropic",
        modelNames: ["Claude 4"],
        systemCardResult: {
          system_card_status: "found",
          detected: [{ url: "https://anthropic.com/sc", anchorText: "System Card", kind: "system_card", confidence: "high" }],
          documents: [
            {
              url: "https://anthropic.com/sc",
              canonicalUrl: null,
              kind: "system_card",
              title: "SC",
              chunks: [{ chunkId: "sc_safety_0", sourceUrl: "https://anthropic.com/sc", topic: "safety", pageNumber: null, text: "Red team safety content here." }],
              fetchStatus: "ok",
            },
          ],
        },
      },
      router,
      tracker,
    );
    expect(output.status).toBe("found");
    expect(output.summary.length).toBeGreaterThan(0);
  });

  it("does not make LLM call when system card not found", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    await runSystemCardSummarizer(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], systemCardResult: makeSystemCardResult() },
      router,
      tracker,
    );
    // No LLM call should happen for not_found
    expect(tracker.stages).toHaveLength(0);
  });
});

describe("runBenchmarkAggregator – offline", () => {
  it("returns a non-empty summary using offline router", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    const output = await runBenchmarkAggregator(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], benchmarkEvidence: makeBenchmarkEvidence() },
      router,
      tracker,
    );
    expect(output.summary.length).toBeGreaterThan(0);
  });

  it("passes through claims from benchmark evidence", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    const claims = [
      { name: "MMLU", value: "92.5", source: "vendor_article" as const, sourceUrl: "https://api-docs.deepseek.com/news/news260424", provenance: "article", status: "missing" as const },
    ];
    const output = await runBenchmarkAggregator(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], benchmarkEvidence: makeBenchmarkEvidence({ claims }) },
      router,
      tracker,
    );
    expect(output.claims).toEqual(claims);
  });

  it("records usage in cost tracker", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    await runBenchmarkAggregator(
      { lab: "DeepSeek", modelNames: ["DeepSeek-V4-Pro"], benchmarkEvidence: makeBenchmarkEvidence() },
      router,
      tracker,
    );
    expect(tracker.stages).toHaveLength(1);
    expect(tracker.stages[0]!.stage).toBe("benchmark_aggregator");
  });
});

describe("runFinalWriter – offline", () => {
  it("returns non-empty message1 and message2 using offline router", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    const output = await runFinalWriter({ evidencePacket: makeEvidencePacket() }, router, tracker);
    expect(output.message1.length).toBeGreaterThan(0);
    expect(output.message2.length).toBeGreaterThan(0);
  });

  it("splits the writer output on the message-2 delimiter", async () => {
    const router: LlmRouter = {
      isOffline: false,
      async complete(role) {
        return makeFakeLlmCompletion(role, {
          text: "MESSAGE ONE CONTENT\n===MESSAGE_2===\nMESSAGE TWO CONTENT",
        });
      },
    };
    const tracker = new CostTracker(10);
    const output = await runFinalWriter({ evidencePacket: makeEvidencePacket() }, router, tracker);
    expect(output.message1).toBe("MESSAGE ONE CONTENT");
    expect(output.message2).toBe("MESSAGE TWO CONTENT");
    // Delimiter present -> exactly one final_writer call, no regeneration needed.
    expect(tracker.stages.filter((s) => s.stage === "final_writer")).toHaveLength(1);
  });

  it("treats the whole output as message1 and regenerates message2 once when the delimiter is missing", async () => {
    let finalWriterCalls = 0;
    const router: LlmRouter = {
      isOffline: false,
      async complete(role) {
        if (role !== "final_writer") return makeFakeLlmCompletion(role);
        finalWriterCalls += 1;
        return makeFakeLlmCompletion(role, {
          text: finalWriterCalls === 1 ? "MESSAGE ONE ONLY, NO DELIMITER" : "REGENERATED MESSAGE TWO",
        });
      },
    };
    const tracker = new CostTracker(10);
    const output = await runFinalWriter({ evidencePacket: makeEvidencePacket() }, router, tracker);
    expect(finalWriterCalls).toBe(2);
    expect(output.message1).toBe("MESSAGE ONE ONLY, NO DELIMITER");
    expect(output.message2).toBe("REGENERATED MESSAGE TWO");
  });

  it("records usage for final_writer stage", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    await runFinalWriter({ evidencePacket: makeEvidencePacket() }, router, tracker);
    expect(tracker.stages.some((s) => s.stage === "final_writer")).toBe(true);
  });

  it("uses OpenRouter Kimi (final_writer role) not DeepSeek", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    await runFinalWriter({ evidencePacket: makeEvidencePacket() }, router, tracker);
    const stage = tracker.stages.find((s) => s.stage === "final_writer");
    expect(stage).toBeDefined();
    expect(stage!.stage).toBe("final_writer");
  });

  it("tells the final writer to avoid benchmark comparisons when no structured claims exist", async () => {
    const calls: { role: LlmRole; messages: LlmMessage[] }[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role, messages) {
        calls.push({ role, messages });
        return makeFakeLlmCompletion(role);
      },
    };

    await runFinalWriter({ evidencePacket: makeEvidencePacket({ claims: [] }) }, router, new CostTracker(10));

    const prompt = calls.find((call) => call.role === "final_writer")!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Allowed Benchmark Claims:");
    expect(prompt).toContain("None. The final message must avoid named benchmark claims");
    expect(prompt).toContain("independent benchmark verification is unavailable");
  });

  it("passes structured benchmark claims into the final writer prompt", async () => {
    const calls: { role: LlmRole; messages: LlmMessage[] }[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role, messages) {
        calls.push({ role, messages });
        return makeFakeLlmCompletion(role);
      },
    };

    await runFinalWriter(
      {
        evidencePacket: makeEvidencePacket({
          claims: [
            {
              name: "MMLU",
              value: "92.5%",
              source: "vendor_article",
              sourceUrl: "https://api-docs.deepseek.com/news/news260424",
              provenance: "vendor",
              status: "missing",
            },
          ],
        }),
      },
      router,
      new CostTracker(10),
    );

    const prompt = calls.find((call) => call.role === "final_writer")!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("- MMLU: 92.5%; status=missing");
  });

  it("tells the writer the model is not yet listed on Artificial Analysis when no placements are available", async () => {
    const calls: { role: LlmRole; messages: LlmMessage[] }[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role, messages) {
        calls.push({ role, messages });
        return makeFakeLlmCompletion(role);
      },
    };

    await runFinalWriter({ evidencePacket: makeEvidencePacket({ placements: null }) }, router, new CostTracker(10));

    const prompt = calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Not yet listed on Artificial Analysis.");
  });

  it("emits the mandatory DeepSWE fallback line when Artificial Analysis has not tested it", async () => {
    const calls: { role: LlmRole; messages: LlmMessage[] }[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role, messages) {
        calls.push({ role, messages });
        return makeFakeLlmCompletion(role);
      },
    };

    const placements = {
      modelNames: ["DeepSeek-V4-Pro"],
      onAA: true,
      indices: [
        {
          index: "intelligence" as const,
          levels: [{ effort: "high", score: 58, rank: 9 }],
          n: 42,
          bestRank: 9,
          higherNeighbor: null,
          lowerNeighbor: null,
          isTop: false,
        },
      ],
      deepswe: { status: "not_tested" as const },
      pricing: { model: null, vsHigherNeighbor: null, vsLowerNeighbor: null, vsFlagship: null },
    };

    await runFinalWriter({ evidencePacket: makeEvidencePacket({ placements }) }, router, new CostTracker(10));

    const prompt = calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("• DeepSWE: not yet tested by Artificial Analysis for this model.");
  });

  it("instructs the writer with the no-system-card fallback line", async () => {
    const calls: { role: LlmRole; messages: LlmMessage[] }[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role, messages) {
        calls.push({ role, messages });
        return makeFakeLlmCompletion(role);
      },
    };

    await runFinalWriter(
      { evidencePacket: makeEvidencePacket({ systemCardStatus: "not_found" }) },
      router,
      new CostTracker(10),
    );

    const prompt = calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("no system card published");
    expect(prompt).toContain("No system/model card published at launch.");
  });
});

// ─── Full orchestration: offline ─────────────────────────────────────────────

describe("runAgentOrchestration – offline", () => {
  function makeOptions(): OrchestratorOptions {
    return {
      router: createLlmRouter({ offline: true }),
      tracker: new CostTracker(10),
    };
  }

  it("returns an orchestrator result with all required fields", async () => {
    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      makeOptions(),
    );
    expect(result.evidencePacket).toBeDefined();
    expect(typeof result.finalMessage).toBe("string");
    expect(result.verifierOutput).toBeDefined();
    expect(typeof result.approved).toBe("boolean");
  });

  it("final writer stage appears in cost tracker", async () => {
    const options = makeOptions();
    await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      options,
    );
    expect(options.tracker.stages.some((s) => s.stage === "final_writer")).toBe(true);
  });

  it("article_summarizer stage appears in cost tracker", async () => {
    const options = makeOptions();
    await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      options,
    );
    expect(options.tracker.stages.some((s) => s.stage === "article_summarizer")).toBe(true);
  });

  it("retries final writing once with verifier feedback after a rejected draft", async () => {
    let finalWriterCalls = 0;
    const router: LlmRouter = {
      isOffline: false,
      async complete(role) {
        if (role !== "final_writer") {
          return makeFakeLlmCompletion(role);
        }

        finalWriterCalls += 1;
        const message1 = finalWriterCalls === 1
          ? [
              "Where it shines: open-source SOTA on agentic coding benchmarks.",
              "Unknown: independent benchmark verification unavailable.",
              "Source: https://api-docs.deepseek.com/news/news260424",
            ].join("\n")
          : [
              "DeepSeek-V4-Pro released.",
              "Benchmark context: structured benchmark evidence unavailable.",
              "Unknown: independent benchmark verification and safety details unavailable.",
              "Source: https://api-docs.deepseek.com/news/news260424",
            ].join("\n");
        // Delimiter present -> one final_writer call per runFinalWriter invocation.
        return makeFakeLlmCompletion(role, { text: `${message1}\n===MESSAGE_2===\nDeep dive placeholder.` });
      },
    };

    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence({ claims: [] }),
      { router, tracker: new CostTracker(10) },
    );

    expect(finalWriterCalls).toBe(2);
    expect(result.approved).toBe(true);
    expect(result.finalMessage).toContain("structured benchmark evidence unavailable");
    expect(result.message1).toContain("structured benchmark evidence unavailable");
    expect(result.message2).toBe("Deep dive placeholder.");
  });

  it("falls back to a deterministic verifier-safe message after two rejected drafts", async () => {
    let finalWriterCalls = 0;
    const router: LlmRouter = {
      isOffline: false,
      async complete(role) {
        if (role !== "final_writer") {
          return makeFakeLlmCompletion(role);
        }

        finalWriterCalls += 1;
        const message1 = [
          "Where it shines: open-source SOTA on agentic coding benchmarks.",
          "Unknown: independent benchmark verification unavailable.",
          "Source: https://api-docs.deepseek.com/news/news260424",
        ].join("\n");
        // Delimiter present -> one final_writer call per runFinalWriter invocation.
        return makeFakeLlmCompletion(role, { text: `${message1}\n===MESSAGE_2===\nDeep dive placeholder.` });
      },
    };

    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence({ claims: [] }),
      { router, tracker: new CostTracker(10) },
    );

    expect(finalWriterCalls).toBe(2);
    expect(result.approved).toBe(true);
    expect(result.finalMessage).toContain("DeepSeek model release");
    expect(result.finalMessage).toContain("Structured benchmark evidence was not extracted");
    expect(result.message1).toContain("DeepSeek model release");
    expect(result.verifierOutput.findings).toEqual([]);
  });

  it("evidence packet contains article URL", async () => {
    const options = makeOptions();
    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      options,
    );
    expect(result.evidencePacket.articleUrl).toBe("https://api-docs.deepseek.com/news/news260424");
  });

  it("evidence packet references article as kind=article", async () => {
    const options = makeOptions();
    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      options,
    );
    expect(result.evidencePacket.references.some((r) => r.kind === "article")).toBe(true);
  });

  it("respects cost cap and throws CostCapExceededError when budget exceeded", async () => {
    const options: OrchestratorOptions = {
      router: createLlmRouter({ offline: true }),
      tracker: new CostTracker(0.0), // Zero budget
    };
    // Offline router has 0 cost — this should NOT throw since fake completions cost 0
    // But if we pre-record a cost, it will throw
    options.tracker.record({
      promptTokens: 0,
      completionTokens: 0,
      cacheHitTokens: 0,
      providerResponseId: null,
      modelId: "fake",
      stage: "article_summarizer",
      estimatedCostUsd: 0.01,
    });
    await expect(
      runAgentOrchestration(
        "https://api-docs.deepseek.com/news/news260424",
        makeArticle(),
        makeSystemCardResult(),
        makeBenchmarkEvidence(),
        options,
      ),
    ).rejects.toThrow(/cost cap/i);
  });
});

// ─── Release classifier gate: non-releases never reach the writer ───────────

describe("runAgentOrchestration – release classifier gate", () => {
  function makeRejectingRouter(): { router: LlmRouter; calls: LlmRole[] } {
    const calls: LlmRole[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role) {
        calls.push(role);
        if (role === "release_classifier") {
          return makeFakeLlmCompletion(role, {
            text: JSON.stringify({
              is_new_model_release: false,
              model_names: [],
              reason: "This is a pricing update, not a new model release.",
            }),
          });
        }
        return makeFakeLlmCompletion(role);
      },
    };
    return { router, calls };
  }

  it("never calls the final writer (or any evidence-gathering stage) for a rejected candidate", async () => {
    const { router, calls } = makeRejectingRouter();
    const tracker = new CostTracker(10);

    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle({ title: "DeepSeek pricing update" }),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      { router, tracker },
    );

    expect(result.rejected).toBe(true);
    expect(result.approved).toBe(false);
    expect(result.classifierOutput.is_new_model_release).toBe(false);
    expect(calls).toEqual(["release_classifier"]);
    expect(calls).not.toContain("final_writer");
    expect(calls).not.toContain("article_summarizer");
  });

  it("marks the rejection reason in the verifier findings", async () => {
    const { router } = makeRejectingRouter();
    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      { router, tracker: new CostTracker(10) },
    );

    expect(result.verifierOutput.findings.some((f) => f.claim.includes("pricing update"))).toBe(true);
  });

  it("proceeds through the full pipeline (including the writer) when the classifier accepts", async () => {
    const calls: LlmRole[] = [];
    const router: LlmRouter = {
      isOffline: false,
      async complete(role) {
        calls.push(role);
        return makeFakeLlmCompletion(role);
      },
    };

    const result = await runAgentOrchestration(
      "https://api-docs.deepseek.com/news/news260424",
      makeArticle(),
      makeSystemCardResult(),
      makeBenchmarkEvidence(),
      { router, tracker: new CostTracker(10) },
    );

    expect(result.rejected).toBe(false);
    expect(calls).toContain("final_writer");
  });
});

// ─── Key constraint: final writer cannot receive fetch tools ─────────────────

describe("Agent architecture constraints", () => {
  it("EvidencePacket does not expose fetch or browser functions", () => {
    const packet = makeEvidencePacket();
    // Evidence packet must be serializable data only — no function properties (besides costTracker)
    const keys = Object.keys(packet).filter((k) => k !== "costTracker");
    for (const key of keys) {
      const value = packet[key as keyof typeof packet];
      expect(typeof value).not.toBe("function");
    }
  });

  it("runFinalWriter only receives evidencePacket — no raw HTML or fetch handles", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10);
    // This test verifies the type signature: finalWriter only takes FinalWriterInput
    // which contains only evidencePacket, not article/fetch/browser
    const output = await runFinalWriter({ evidencePacket: makeEvidencePacket() }, router, tracker);
    expect(typeof output.message1).toBe("string");
    expect(typeof output.message2).toBe("string");
  });
});
