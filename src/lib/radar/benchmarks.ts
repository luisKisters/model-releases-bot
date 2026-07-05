import type { FetchImpl } from "./fetching";
import type { EvidenceChunk } from "./systemCards";
import { filterModelNamesForLab } from "./text";

export type BenchmarkStatus =
  | "supported"
  | "contradicted"
  | "missing"
  | "not_comparable";

export type BenchmarkModality =
  | "language"
  | "coding"
  | "reasoning"
  | "multimodal"
  | "stt"
  | "tts"
  | "s2s"
  | "latency"
  | "throughput"
  | "price_performance";

export type BenchmarkSource =
  | "vendor_article"
  | "system_card"
  | "technical_report"
  | "artificial_analysis"
  | "official_benchmark"
  | "other";

export type BenchmarkClaim = {
  name: string;
  value: string | null;
  source: BenchmarkSource;
  sourceUrl: string | null;
  provenance: string;
  status: BenchmarkStatus;
};

export type ArtificialAnalysisRow = {
  modelId: string;
  benchmark: string;
  value: string | number | null;
  modality: BenchmarkModality;
  attributionUrl: string;
};

export type ArtificialAnalysisHit = {
  ok: true;
  rows: ArtificialAnalysisRow[];
  attribution: string;
};

export type ArtificialAnalysisSkip = {
  ok: false;
  status: "skipped" | "rate_limited" | "not_found" | "error" | "modality_mismatch";
  reason: string;
  missingKey?: boolean;
};

export type ArtificialAnalysisResult = ArtificialAnalysisHit | ArtificialAnalysisSkip;

export type BenchmarkEvidence = {
  lab: string;
  modelNames: string[];
  modality: BenchmarkModality[];
  claims: BenchmarkClaim[];
  artificialAnalysis: ArtificialAnalysisResult;
};

export type BenchmarkOptions = {
  apiKey?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  requireArtificialAnalysis?: boolean;
};

// --- Lab modality mapping ---

const LAB_MODALITY_MAP: Record<string, BenchmarkModality[]> = {
  OpenAI: ["language", "coding", "reasoning", "multimodal"],
  Anthropic: ["language", "coding", "reasoning", "multimodal"],
  "Google Gemini": ["language", "coding", "reasoning", "multimodal"],
  Mistral: ["language", "coding", "reasoning"],
  DeepSeek: ["language", "coding", "reasoning"],
  "Meta Llama": ["language", "coding", "reasoning", "multimodal"],
  xAI: ["language", "coding", "reasoning", "multimodal"],
  "NVIDIA Nemotron": ["language", "coding", "reasoning"],
  Deepgram: ["stt", "latency", "throughput"],
  ElevenLabs: ["tts", "latency"],
  AssemblyAI: ["stt", "latency"],
};

export function getLabModalities(lab: string): BenchmarkModality[] {
  return LAB_MODALITY_MAP[lab] ?? ["language"];
}

// --- Known benchmark definitions by modality ---

type BenchmarkDef = { name: string; aliases: string[]; modality: BenchmarkModality };

const BENCHMARK_DEFS: BenchmarkDef[] = [
  // Language
  { name: "MMLU", aliases: ["mmlu"], modality: "language" },
  { name: "HellaSwag", aliases: ["hellaswag"], modality: "language" },
  { name: "ARC", aliases: ["arc-challenge", "arc_challenge"], modality: "language" },
  { name: "WinoGrande", aliases: ["winogrande"], modality: "language" },
  { name: "TruthfulQA", aliases: ["truthfulqa", "truthful_qa"], modality: "language" },
  { name: "BoolQ", aliases: ["boolq"], modality: "language" },
  // Coding
  { name: "HumanEval", aliases: ["humaneval", "human_eval"], modality: "coding" },
  { name: "MBPP", aliases: ["mbpp"], modality: "coding" },
  { name: "SWE-bench", aliases: ["swebench", "swe_bench", "SWE-bench Verified"], modality: "coding" },
  { name: "LiveCodeBench", aliases: ["livecodebench"], modality: "coding" },
  // Reasoning
  { name: "GPQA", aliases: ["gpqa", "gpqa_diamond"], modality: "reasoning" },
  { name: "MATH", aliases: ["math-500", "math500"], modality: "reasoning" },
  { name: "GSM8K", aliases: ["gsm8k"], modality: "reasoning" },
  { name: "BBH", aliases: ["bigbenchhard", "big_bench_hard"], modality: "reasoning" },
  { name: "AIME", aliases: ["aime"], modality: "reasoning" },
  // Multimodal
  { name: "MMMU", aliases: ["mmmu"], modality: "multimodal" },
  { name: "VQAv2", aliases: ["vqa", "vqav2"], modality: "multimodal" },
  { name: "ChartQA", aliases: ["chartqa"], modality: "multimodal" },
  { name: "DocVQA", aliases: ["docvqa"], modality: "multimodal" },
  { name: "OSWorld", aliases: ["osworld"], modality: "multimodal" },
  // STT
  { name: "WER", aliases: ["word error rate", "word_error_rate"], modality: "stt" },
  { name: "CER", aliases: ["char error rate", "character_error_rate"], modality: "stt" },
  // TTS
  { name: "MOS", aliases: ["mean opinion score", "mean_opinion_score"], modality: "tts" },
  // Latency/Throughput
  { name: "TTFT", aliases: ["time to first token", "time_to_first_token"], modality: "latency" },
  { name: "Tokens/s", aliases: ["tokens per second", "tokens_per_second", "tps"], modality: "throughput" },
];

// --- AA API endpoint routing by modality ---

type AAEndpointDef = {
  modality: BenchmarkModality;
  path: string;
  label: string;
};

const AA_ENDPOINTS: AAEndpointDef[] = [
  { modality: "language", path: "/api/models", label: "language" },
  { modality: "coding", path: "/api/models", label: "language" },
  { modality: "reasoning", path: "/api/models", label: "language" },
  { modality: "multimodal", path: "/api/models", label: "language" },
  { modality: "tts", path: "/api/text-to-speech", label: "text-to-speech" },
  { modality: "stt", path: "/api/speech-to-text", label: "speech-to-text" },
  { modality: "s2s", path: "/api/speech-to-speech", label: "speech-to-speech" },
  { modality: "latency", path: "/api/models", label: "language" },
  { modality: "throughput", path: "/api/models", label: "language" },
  { modality: "price_performance", path: "/api/models", label: "language" },
];

const AA_BASE_URL = "https://artificialanalysis.ai";

// --- Benchmark claim extraction from text ---

const VALUE_PATTERN =
  /(?:(?:scored?|achieved?|reached?|attained?|reports?|shows?|with|at|of)\s+)?([\d]+(?:\.\d+)?%?(?:\s*(?:pass@1|pass@k))?)/i;

function buildBenchmarkPattern(def: BenchmarkDef): RegExp {
  const names = [def.name, ...def.aliases].map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const nameGroup = names.join("|");
  // Allow an optional qualifier word (e.g. "Diamond", "Verified") between the benchmark
  // name and the optional label/colon, so "GPQA Diamond score: 59.8%" is matched.
  return new RegExp(
    `(?:(${nameGroup})(?:\\s+\\w+)?\\s*(?:score|accuracy|result|performance|pass@\\w+)?\\s*[:\\-–]?\\s*${VALUE_PATTERN.source})|(?:${VALUE_PATTERN.source}\\s+(?:on|in|for|at)\\s+(${nameGroup}))`,
    "gi",
  );
}

export function extractBenchmarkClaims(
  text: string,
  source: BenchmarkSource,
  sourceUrl: string | null,
): BenchmarkClaim[] {
  const seen = new Set<string>();
  const claims: BenchmarkClaim[] = [];

  for (const def of BENCHMARK_DEFS) {
    const pattern = buildBenchmarkPattern(def);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      // Group 1: name before value. Group 2: value after name. Group 3: value before name. Group 4: name after value.
      const value = (match[2] ?? match[3] ?? "").trim() || null;
      const key = `${def.name}:${value ?? ""}:${sourceUrl ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      claims.push({
        name: def.name,
        value,
        source,
        sourceUrl,
        provenance: `${source} — pattern matched in text`,
        status: "missing", // resolved later during comparison
      });
      break; // one claim per benchmark per source per URL
    }
  }

  return claims;
}

export function extractClaimsFromChunks(
  chunks: EvidenceChunk[],
  source: BenchmarkSource,
): BenchmarkClaim[] {
  const all: BenchmarkClaim[] = [];
  for (const chunk of chunks) {
    if (chunk.topic !== "benchmarks_evals") continue;
    const claims = extractBenchmarkClaims(chunk.text, source, chunk.sourceUrl);
    all.push(...claims);
  }
  return all;
}

// --- Artificial Analysis client ---

function modalityToAAEndpoint(modality: BenchmarkModality): AAEndpointDef | null {
  return AA_ENDPOINTS.find((e) => e.modality === modality) ?? null;
}

function normalizeAARow(
  raw: Record<string, unknown>,
  modality: BenchmarkModality,
  path: string,
): ArtificialAnalysisRow | null {
  const modelId =
    typeof raw["model_id"] === "string"
      ? raw["model_id"]
      : typeof raw["slug"] === "string"
        ? raw["slug"]
        : null;

  if (!modelId) return null;

  const benchmark =
    typeof raw["benchmark"] === "string"
      ? raw["benchmark"]
      : typeof raw["metric"] === "string"
        ? raw["metric"]
        : "unknown";

  const rawValue = raw["value"] ?? raw["score"] ?? raw["result"] ?? null;
  const value =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string"
        ? rawValue
        : null;

  return {
    modelId,
    benchmark,
    value,
    modality,
    attributionUrl: `${AA_BASE_URL}${path}`,
  };
}

export async function queryArtificialAnalysis(
  modelNames: string[],
  modalities: BenchmarkModality[],
  options: BenchmarkOptions = {},
): Promise<ArtificialAnalysisResult> {
  const { apiKey, fetchImpl = fetch, timeoutMs = 15_000, requireArtificialAnalysis = false } = options;

  if (!apiKey) {
    if (requireArtificialAnalysis) {
      return {
        ok: false,
        status: "error",
        reason: "ARTIFICIAL_ANALYSIS_API_KEY is required but not set",
        missingKey: true,
      };
    }
    return {
      ok: false,
      status: "skipped",
      reason: "ARTIFICIAL_ANALYSIS_API_KEY not configured — skipping Artificial Analysis lookup",
      missingKey: true,
    };
  }

  // Pick unique AA endpoints for the requested modalities
  const endpointsSeen = new Set<string>();
  const endpoints: AAEndpointDef[] = [];
  for (const modality of modalities) {
    const ep = modalityToAAEndpoint(modality);
    if (ep && !endpointsSeen.has(ep.path)) {
      endpointsSeen.add(ep.path);
      endpoints.push(ep);
    }
  }

  if (endpoints.length === 0) {
    return {
      ok: false,
      status: "modality_mismatch",
      reason: `No Artificial Analysis endpoints configured for modalities: ${modalities.join(", ")}`,
    };
  }

  const rows: ArtificialAnalysisRow[] = [];

  for (const ep of endpoints) {
    const url = `${AA_BASE_URL}${ep.path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "model-release-radar/0.1",
        },
      });
      clearTimeout(timer);

      if (response.status === 429) {
        return {
          ok: false,
          status: "rate_limited",
          reason: `Artificial Analysis API rate limited on ${ep.label} endpoint`,
        };
      }

      if (response.status === 404) {
        // No data for this endpoint — not an error, just no rows
        continue;
      }

      if (!response.ok) {
        return {
          ok: false,
          status: "error",
          reason: `Artificial Analysis API returned ${response.status} on ${ep.label} endpoint`,
        };
      }

      const data = (await response.json()) as unknown;
      if (!data || typeof data !== "object") continue;

      const rawRows: Record<string, unknown>[] = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : Array.isArray((data as Record<string, unknown>)["data"])
          ? ((data as Record<string, unknown>)["data"] as Record<string, unknown>[])
          : Array.isArray((data as Record<string, unknown>)["models"])
            ? ((data as Record<string, unknown>)["models"] as Record<string, unknown>[])
            : [];

      const endpointModality = ep.modality;
      for (const raw of rawRows) {
        const row = normalizeAARow(raw, endpointModality, ep.path);
        if (!row) continue;

        // Filter to requested model names (case-insensitive substring match)
        const modelLower = row.modelId.toLowerCase();
        const matchesModel = modelNames.some(
          (name) =>
            modelLower.includes(name.toLowerCase()) ||
            name.toLowerCase().includes(modelLower),
        );
        if (matchesModel) {
          rows.push(row);
        }
      }
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort") || msg.includes("timeout")) {
        return {
          ok: false,
          status: "error",
          reason: `Artificial Analysis API timed out on ${ep.label} endpoint`,
        };
      }
      return {
        ok: false,
        status: "error",
        reason: `Artificial Analysis API fetch failed on ${ep.label} endpoint: ${msg}`,
      };
    }
  }

  if (rows.length === 0) {
    return {
      ok: false,
      status: "not_found",
      reason: `No Artificial Analysis data found for models: ${modelNames.join(", ")}`,
    };
  }

  return {
    ok: true,
    rows,
    attribution: `Data from Artificial Analysis (${AA_BASE_URL}) — retrieved via API`,
  };
}

// --- Claim comparison ---

const NUMERIC_TOLERANCE_PERCENT = 2; // 2 percentage points tolerance

function parseNumericValue(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).replace(/%$/, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function compareClaims(
  vendorClaim: BenchmarkClaim,
  aaRows: ArtificialAnalysisRow[],
): BenchmarkStatus {
  const matchingRows = aaRows.filter(
    (row) =>
      row.benchmark.toLowerCase().includes(vendorClaim.name.toLowerCase()) ||
      vendorClaim.name.toLowerCase().includes(row.benchmark.toLowerCase()),
  );

  if (matchingRows.length === 0) return "missing";

  const vendorNum = parseNumericValue(vendorClaim.value);
  if (vendorNum === null) return "not_comparable";

  let anyContradicted = false;
  let anyNotComparable = false;
  for (const row of matchingRows) {
    const aaNum = parseNumericValue(row.value);
    if (aaNum === null) {
      anyNotComparable = true;
      continue;
    }

    const diff = Math.abs(vendorNum - aaNum);
    if (diff <= NUMERIC_TOLERANCE_PERCENT) return "supported";
    anyContradicted = true;
  }

  if (anyContradicted) return "contradicted";
  if (anyNotComparable) return "not_comparable";
  return "missing";
}

export function resolveClaimStatuses(
  claims: BenchmarkClaim[],
  aaResult: ArtificialAnalysisResult,
): BenchmarkClaim[] {
  if (!aaResult.ok) {
    // No independent data — all vendor claims remain "missing"
    return claims;
  }

  return claims.map((claim) => {
    if (claim.source === "artificial_analysis") return claim;
    const status = compareClaims(claim, aaResult.rows);
    return { ...claim, status };
  });
}

// --- Main aggregation entry point ---

export async function aggregateBenchmarkEvidence(
  lab: string,
  modelNames: string[],
  articleText: string,
  articleUrl: string | null,
  evidenceChunks: EvidenceChunk[],
  options: BenchmarkOptions = {},
): Promise<BenchmarkEvidence> {
  const modality = getLabModalities(lab);
  const scopedModelNames = filterModelNamesForLab(lab, modelNames);

  // Extract vendor claims from article text
  const articleClaims = extractBenchmarkClaims(articleText, "vendor_article", articleUrl);

  // Extract claims from system card / technical report chunks (benchmarks_evals sections only)
  const chunkClaims = extractClaimsFromChunks(evidenceChunks, "system_card");

  // Merge — deduplicate by name+sourceUrl
  const allVendorClaims = deduplicateClaims([...articleClaims, ...chunkClaims]);

  // Query Artificial Analysis
  const aaResult = await queryArtificialAnalysis(scopedModelNames, modality, options);

  // Add AA rows as claims
  const aaClaims: BenchmarkClaim[] =
    aaResult.ok
      ? aaResult.rows.map((row) => ({
          name: row.benchmark,
          value: row.value !== null ? String(row.value) : null,
          source: "artificial_analysis" as const,
          sourceUrl: row.attributionUrl,
          provenance: aaResult.attribution,
          status: "supported" as const,
        }))
      : [];

  // Resolve vendor claim statuses against AA data
  const resolvedVendorClaims = resolveClaimStatuses(allVendorClaims, aaResult);

  return {
    lab,
    modelNames: scopedModelNames,
    modality,
    claims: [...resolvedVendorClaims, ...aaClaims],
    artificialAnalysis: aaResult,
  };
}

// --- Helpers ---

function deduplicateClaims(claims: BenchmarkClaim[]): BenchmarkClaim[] {
  const seen = new Set<string>();
  return claims.filter((c) => {
    const key = `${c.name}:${c.sourceUrl ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
