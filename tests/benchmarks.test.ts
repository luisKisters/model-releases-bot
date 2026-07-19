import { describe, expect, it, vi } from "vitest";
import {
  extractBenchmarkClaims,
  extractClaimsFromChunks,
  queryArtificialAnalysis,
  resolveClaimStatuses,
  aggregateBenchmarkEvidence,
  getLabModalities,
  type BenchmarkClaim,
  type ArtificialAnalysisRow,
} from "../src/lib/radar/benchmarks";
import type { EvidenceChunk } from "../src/lib/radar/systemCards";

// --- Helpers ---

function makeAAFetch(
  body: unknown,
  { status = 200 }: { status?: number } = {},
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response);
}

function chunk(text: string, topic: "benchmarks_evals" | "safety" | "overview", sourceUrl = "https://example.com/card"): EvidenceChunk {
  return { chunkId: "c1", sourceUrl, topic, pageNumber: null, text };
}

// --- getLabModalities ---

describe("getLabModalities", () => {
  it("returns language/coding/reasoning/multimodal for OpenAI", () => {
    const mods = getLabModalities("OpenAI");
    expect(mods).toContain("language");
    expect(mods).toContain("coding");
    expect(mods).toContain("reasoning");
    expect(mods).toContain("multimodal");
  });

  it("returns stt/latency for Deepgram", () => {
    const mods = getLabModalities("Deepgram");
    expect(mods).toContain("stt");
    expect(mods).toContain("latency");
    expect(mods).not.toContain("language");
  });

  it("returns tts/latency for ElevenLabs", () => {
    const mods = getLabModalities("ElevenLabs");
    expect(mods).toContain("tts");
    expect(mods).toContain("latency");
    expect(mods).not.toContain("coding");
  });

  it("returns stt for AssemblyAI", () => {
    const mods = getLabModalities("AssemblyAI");
    expect(mods).toContain("stt");
  });

  it("falls back to language for unknown labs", () => {
    const mods = getLabModalities("UnknownLab");
    expect(mods).toEqual(["language"]);
  });

  it("does not include stt/tts for language-only labs", () => {
    const mods = getLabModalities("Mistral");
    expect(mods).not.toContain("stt");
    expect(mods).not.toContain("tts");
  });
});

// --- extractBenchmarkClaims ---

describe("extractBenchmarkClaims – vendor article text", () => {
  it("extracts MMLU score from colon pattern", () => {
    const text = "Our model achieves MMLU: 92.1% on the standard benchmark.";
    const claims = extractBenchmarkClaims(text, "vendor_article", "https://example.com/release");
    const mmlu = claims.find((c) => c.name === "MMLU");
    expect(mmlu).toBeDefined();
    expect(mmlu?.value).toContain("92.1");
    expect(mmlu?.source).toBe("vendor_article");
    expect(mmlu?.sourceUrl).toBe("https://example.com/release");
    expect(mmlu?.status).toBe("missing"); // not yet resolved
  });

  it("extracts HumanEval score from 'scored X on' pattern", () => {
    const text = "The model scored 87.3% on HumanEval, outperforming previous baselines.";
    const claims = extractBenchmarkClaims(text, "vendor_article", "https://example.com/release");
    const he = claims.find((c) => c.name === "HumanEval");
    expect(he).toBeDefined();
    expect(he?.value).toContain("87.3");
  });

  it("extracts GPQA score", () => {
    const text = "GPQA Diamond score: 59.8%.";
    const claims = extractBenchmarkClaims(text, "vendor_article", "https://example.com/release");
    const gpqa = claims.find((c) => c.name === "GPQA");
    expect(gpqa).toBeDefined();
  });

  it("extracts SWE-bench score", () => {
    const text = "We achieve 41.0% on SWE-bench Verified.";
    const claims = extractBenchmarkClaims(text, "vendor_article", "https://example.com/release");
    const swe = claims.find((c) => c.name === "SWE-bench");
    expect(swe).toBeDefined();
  });

  it("does not duplicate the same benchmark from the same source", () => {
    const text = "MMLU: 92% and MMLU score: 92% on the same page.";
    const claims = extractBenchmarkClaims(text, "vendor_article", "https://example.com/release");
    const mmluClaims = claims.filter((c) => c.name === "MMLU");
    expect(mmluClaims.length).toBe(1);
  });

  it("returns empty array when no benchmark patterns match", () => {
    const text = "This is a release announcement with no benchmark data at all.";
    const claims = extractBenchmarkClaims(text, "vendor_article", null);
    expect(claims).toHaveLength(0);
  });

  it("extracts GSM8K score from system card source", () => {
    const text = "GSM8K accuracy: 95.4%";
    const claims = extractBenchmarkClaims(text, "system_card", "https://example.com/system-card");
    const gsm = claims.find((c) => c.name === "GSM8K");
    expect(gsm).toBeDefined();
    expect(gsm?.source).toBe("system_card");
  });

  it("records provenance string for every claim", () => {
    const text = "MMLU: 90%, HumanEval: 80%";
    const claims = extractBenchmarkClaims(text, "technical_report", "https://arxiv.org/abs/1234");
    for (const c of claims) {
      expect(c.provenance).toBeTruthy();
    }
  });
});

// --- extractClaimsFromChunks ---

describe("extractClaimsFromChunks", () => {
  it("extracts claims only from benchmarks_evals chunks", () => {
    const chunks: EvidenceChunk[] = [
      chunk("MMLU: 90%", "benchmarks_evals"),
      chunk("Safety evaluations show no dangerous capabilities.", "safety"),
      chunk("Model overview: a strong general-purpose model.", "overview"),
    ];
    const claims = extractClaimsFromChunks(chunks, "system_card");
    const mmlu = claims.find((c) => c.name === "MMLU");
    expect(mmlu).toBeDefined();
    // Safety and overview chunks should not produce false MMLU claims
    expect(claims.filter((c) => c.name === "MMLU")).toHaveLength(1);
  });

  it("returns empty array when no benchmarks_evals chunks present", () => {
    const chunks: EvidenceChunk[] = [
      chunk("Safety evaluations.", "safety"),
      chunk("Deployment notes.", "overview"),
    ];
    const claims = extractClaimsFromChunks(chunks, "system_card");
    expect(claims).toHaveLength(0);
  });

  it("aggregates claims from multiple benchmarks_evals chunks", () => {
    const chunks: EvidenceChunk[] = [
      chunk("MMLU: 90%, HumanEval: 80%", "benchmarks_evals", "https://example.com/card-1"),
      chunk("GPQA: 55%", "benchmarks_evals", "https://example.com/card-2"),
    ];
    const claims = extractClaimsFromChunks(chunks, "system_card");
    expect(claims.some((c) => c.name === "MMLU")).toBe(true);
    expect(claims.some((c) => c.name === "GPQA")).toBe(true);
  });
});

// --- queryArtificialAnalysis – missing API key ---

describe("queryArtificialAnalysis – missing API key", () => {
  it("returns structured skip when no API key is provided", async () => {
    const fetch = vi.fn();
    const result = await queryArtificialAnalysis(["gpt-5"], ["language"], {
      fetchImpl: fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("skipped");
      expect(result.missingKey).toBe(true);
      expect(result.reason).toBeTruthy();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns error (not skip) when requireArtificialAnalysis=true and key missing", async () => {
    const result = await queryArtificialAnalysis(["gpt-5"], ["language"], {
      requireArtificialAnalysis: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("error");
      expect(result.missingKey).toBe(true);
    }
  });
});

// --- queryArtificialAnalysis – available data ---

describe("queryArtificialAnalysis – available benchmark data", () => {
  it("returns matching rows for language model", async () => {
    const rawData = {
      models: [
        { model_id: "deepseek-v4-pro", benchmark: "MMLU", value: 92.1 },
        { model_id: "deepseek-v4-flash", benchmark: "HumanEval", value: 85.0 },
        { model_id: "gpt-5", benchmark: "MMLU", value: 94.0 },
      ],
    };
    const fetchImpl = makeAAFetch(rawData);

    const result = await queryArtificialAnalysis(
      ["deepseek-v4-pro", "deepseek-v4-flash"],
      ["language"],
      { apiKey: "test-key", fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.length).toBeGreaterThan(0);
      // Should only include DeepSeek rows, not GPT-5
      const gptRows = result.rows.filter((r) => r.modelId === "gpt-5");
      expect(gptRows).toHaveLength(0);
      expect(result.attribution).toBeTruthy();
      expect(result.attribution).toContain("Artificial Analysis");
    }
  });

  it("includes attributionUrl on every returned row", async () => {
    const rawData = [
      { model_id: "mistral-small-4", benchmark: "MMLU", value: 88.5 },
    ];
    const fetchImpl = makeAAFetch(rawData);

    const result = await queryArtificialAnalysis(["mistral-small-4"], ["language"], {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const row of result.rows) {
        expect(row.attributionUrl).toBeTruthy();
        expect(row.attributionUrl).toContain("artificialanalysis.ai");
      }
    }
  });

  it("uses the v2 API shape and flattens evaluation, speed, and latency metrics", async () => {
    const fetchImpl = makeAAFetch({
      data: [
        {
          id: "model-id",
          slug: "deepseek-v4-pro",
          evaluations: { mmlu_pro: 0.82, gpqa: 0.71 },
          median_output_tokens_per_second: 120,
          median_time_to_first_token_seconds: 0.8,
        },
      ],
    });

    const result = await queryArtificialAnalysis(["deepseek-v4-pro"], ["language"], {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://artificialanalysis.ai/api/v2/data/llms/models",
      expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "test-key" }) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ benchmark: "mmlu_pro", value: 0.82 }),
          expect.objectContaining({ benchmark: "Tokens/s", value: 120 }),
          expect.objectContaining({ benchmark: "TTFT", value: 0.8 }),
        ]),
      );
    }
  });

  it("attributes data to Artificial Analysis source URL", async () => {
    const rawData = { data: [{ model_id: "llama-4", benchmark: "GPQA", value: 58.0 }] };
    const fetchImpl = makeAAFetch(rawData);

    const result = await queryArtificialAnalysis(["llama-4"], ["reasoning"], {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attribution).toContain("artificialanalysis.ai");
    }
  });
});

// --- queryArtificialAnalysis – rate limits ---

describe("queryArtificialAnalysis – rate limit handling", () => {
  it("returns rate_limited status on HTTP 429", async () => {
    const fetchImpl = makeAAFetch({}, { status: 429 });

    const result = await queryArtificialAnalysis(["gpt-5"], ["language"], {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("rate_limited");
    }
  });
});

// --- queryArtificialAnalysis – model not found ---

describe("queryArtificialAnalysis – model not found", () => {
  it("returns not_found when no rows match the requested models", async () => {
    const rawData = {
      models: [
        { model_id: "gpt-4o", benchmark: "MMLU", value: 88.0 },
        { model_id: "claude-sonnet-3", benchmark: "HumanEval", value: 82.0 },
      ],
    };
    const fetchImpl = makeAAFetch(rawData);

    const result = await queryArtificialAnalysis(
      ["completely-unknown-model-xyz"],
      ["language"],
      { apiKey: "test-key", fetchImpl },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("not_found");
      expect(result.reason).toContain("completely-unknown-model-xyz");
    }
  });
});

// --- queryArtificialAnalysis – modality mismatch ---

describe("queryArtificialAnalysis – modality mismatch", () => {
  it("returns modality_mismatch when no endpoints are available for the requested modalities", async () => {
    // Inject a custom modality not in the endpoint map
    const result = await queryArtificialAnalysis(
      ["some-model"],
      [] as never,
      { apiKey: "test-key" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["modality_mismatch", "not_found"]).toContain(result.status);
    }
  });
});

// --- queryArtificialAnalysis – API error ---

describe("queryArtificialAnalysis – API error", () => {
  it("returns error status on non-429 non-404 error response", async () => {
    const fetchImpl = makeAAFetch({}, { status: 500 });

    const result = await queryArtificialAnalysis(["gpt-5"], ["language"], {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("error");
    }
  });

  it("returns error status on network timeout", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("The operation was aborted"));

    const result = await queryArtificialAnalysis(["gpt-5"], ["language"], {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("error");
    }
  });
});

// --- resolveClaimStatuses – claim comparison ---

describe("resolveClaimStatuses", () => {
  const aaRows: ArtificialAnalysisRow[] = [
    { modelId: "deepseek-v4-pro", benchmark: "MMLU", value: 92.1, modality: "language", attributionUrl: "https://artificialanalysis.ai/models" },
    { modelId: "deepseek-v4-pro", benchmark: "HumanEval", value: 85.0, modality: "coding", attributionUrl: "https://artificialanalysis.ai/models" },
  ];
  const aaHit = { ok: true as const, rows: aaRows, attribution: "Artificial Analysis" };

  it("marks vendor claim as supported when within tolerance", () => {
    const claims: BenchmarkClaim[] = [
      { name: "MMLU", value: "92.5", source: "vendor_article", sourceUrl: null, provenance: "vendor", status: "missing" },
    ];
    const resolved = resolveClaimStatuses(claims, aaHit);
    expect(resolved[0]?.status).toBe("supported");
  });

  it("marks vendor claim as contradicted when values differ beyond tolerance", () => {
    const claims: BenchmarkClaim[] = [
      { name: "MMLU", value: "78.0", source: "vendor_article", sourceUrl: null, provenance: "vendor", status: "missing" },
    ];
    const resolved = resolveClaimStatuses(claims, aaHit);
    expect(resolved[0]?.status).toBe("contradicted");
  });

  it("marks vendor claim as missing when no AA row exists for that benchmark", () => {
    const claims: BenchmarkClaim[] = [
      { name: "GPQA", value: "55.0", source: "vendor_article", sourceUrl: null, provenance: "vendor", status: "missing" },
    ];
    const resolved = resolveClaimStatuses(claims, aaHit);
    expect(resolved[0]?.status).toBe("missing");
  });

  it("marks vendor claim as not_comparable when value is not numeric", () => {
    const claims: BenchmarkClaim[] = [
      { name: "MMLU", value: "state-of-the-art", source: "vendor_article", sourceUrl: null, provenance: "vendor", status: "missing" },
    ];
    const resolved = resolveClaimStatuses(claims, aaHit);
    expect(resolved[0]?.status).toBe("not_comparable");
  });

  it("all claims remain missing when AA result is a skip", () => {
    const claims: BenchmarkClaim[] = [
      { name: "MMLU", value: "92.1", source: "vendor_article", sourceUrl: null, provenance: "vendor", status: "missing" },
      { name: "HumanEval", value: "85.0", source: "vendor_article", sourceUrl: null, provenance: "vendor", status: "missing" },
    ];
    const aaSkip = { ok: false as const, status: "skipped" as const, reason: "no key", missingKey: true };
    const resolved = resolveClaimStatuses(claims, aaSkip);
    expect(resolved.every((c) => c.status === "missing")).toBe(true);
  });

  it("preserves AA claims untouched (status remains supported)", () => {
    const claims: BenchmarkClaim[] = [
      { name: "MMLU", value: "92.1", source: "artificial_analysis", sourceUrl: "https://artificialanalysis.ai/models", provenance: "AA", status: "supported" },
    ];
    const resolved = resolveClaimStatuses(claims, aaHit);
    expect(resolved[0]?.status).toBe("supported");
  });
});

// --- Vendor-only benchmark claims ---

describe("vendor-only benchmark claims (no AA key)", () => {
  it("vendor claims without AA data all have status missing", async () => {
    const articleText = "Our model achieves MMLU: 92.1% and HumanEval: 87.3%.";
    const evidence = await aggregateBenchmarkEvidence(
      "OpenAI",
      ["gpt-5"],
      articleText,
      "https://openai.com/gpt-5",
      [],
      {}, // no API key
    );

    const vendorClaims = evidence.claims.filter(
      (c) => c.source === "vendor_article",
    );
    expect(vendorClaims.length).toBeGreaterThan(0);
    // Without AA, vendor claims cannot be verified
    expect(vendorClaims.every((c) => c.status === "missing")).toBe(true);
  });

  it("AA result is skipped when no key is provided", async () => {
    const evidence = await aggregateBenchmarkEvidence(
      "Anthropic",
      ["claude-opus-4"],
      "GPQA: 59.8%",
      "https://anthropic.com/claude-opus-4",
      [],
    );

    expect(evidence.artificialAnalysis.ok).toBe(false);
    if (!evidence.artificialAnalysis.ok) {
      expect(evidence.artificialAnalysis.status).toBe("skipped");
    }
  });
});

// --- Contradiction handling ---

describe("contradiction handling", () => {
  it("marks claim as contradicted when vendor value significantly differs from AA", async () => {
    const rawData = { models: [{ model_id: "test-model", benchmark: "MMLU", value: 70.0 }] };
    const fetchImpl = makeAAFetch(rawData);

    const evidence = await aggregateBenchmarkEvidence(
      "OpenAI",
      ["test-model"],
      "MMLU: 92.0%", // vendor claims 92, AA says 70
      "https://example.com/release",
      [],
      { apiKey: "test-key", fetchImpl },
    );

    const mmlu = evidence.claims.find((c) => c.name === "MMLU" && c.source === "vendor_article");
    expect(mmlu?.status).toBe("contradicted");
  });

  it("marks claim as supported when values are within tolerance", async () => {
    const rawData = { models: [{ model_id: "test-model", benchmark: "MMLU", value: 90.5 }] };
    const fetchImpl = makeAAFetch(rawData);

    const evidence = await aggregateBenchmarkEvidence(
      "Mistral",
      ["test-model"],
      "MMLU: 91.0%", // vendor claims 91, AA says 90.5 — within 2% tolerance
      "https://example.com/release",
      [],
      { apiKey: "test-key", fetchImpl },
    );

    const mmlu = evidence.claims.find((c) => c.name === "MMLU" && c.source === "vendor_article");
    expect(mmlu?.status).toBe("supported");
  });
});

// --- aggregateBenchmarkEvidence – integration ---

describe("aggregateBenchmarkEvidence – full integration", () => {
  it("returns correct lab, modelNames, and modality", async () => {
    const evidence = await aggregateBenchmarkEvidence(
      "Deepgram",
      ["nova-3"],
      "WER: 5.2%",
      "https://deepgram.com/release",
      [],
    );

    expect(evidence.lab).toBe("Deepgram");
    expect(evidence.modelNames).toContain("nova-3");
    expect(evidence.modality).toContain("stt");
    expect(evidence.modality).not.toContain("coding");
  });

  it("includes both vendor article claims and chunk claims", async () => {
    const chunks: EvidenceChunk[] = [
      chunk("GPQA Diamond: 58.0%", "benchmarks_evals", "https://example.com/system-card"),
    ];

    const evidence = await aggregateBenchmarkEvidence(
      "Anthropic",
      ["claude-opus-4"],
      "MMLU: 92.0%",
      "https://anthropic.com/claude-opus-4",
      chunks,
    );

    expect(evidence.claims.some((c) => c.name === "MMLU" && c.source === "vendor_article")).toBe(true);
    expect(evidence.claims.some((c) => c.name === "GPQA" && c.source === "system_card")).toBe(true);
  });

  it("adds AA rows as artificial_analysis claims with attribution", async () => {
    const rawData = { models: [{ model_id: "deepseek-v4-pro", benchmark: "MMLU", value: 92.1 }] };
    const fetchImpl = makeAAFetch(rawData);

    const evidence = await aggregateBenchmarkEvidence(
      "DeepSeek",
      ["deepseek-v4-pro"],
      "MMLU: 92.1%",
      "https://api-docs.deepseek.com/news/news260424",
      [],
      { apiKey: "test-key", fetchImpl },
    );

    const aaClaim = evidence.claims.find((c) => c.source === "artificial_analysis");
    expect(aaClaim).toBeDefined();
    expect(aaClaim?.sourceUrl).toContain("artificialanalysis.ai");
    expect(aaClaim?.provenance).toContain("Artificial Analysis");
  });

  it("does not include duplicate claims from the same benchmark/source", async () => {
    const evidence = await aggregateBenchmarkEvidence(
      "OpenAI",
      ["gpt-5"],
      "MMLU: 92%, MMLU score: 92%",
      "https://openai.com/gpt-5",
      [],
    );

    const mmluClaims = evidence.claims.filter((c) => c.name === "MMLU");
    expect(mmluClaims.length).toBeLessThanOrEqual(2); // at most one per source type
  });
});
