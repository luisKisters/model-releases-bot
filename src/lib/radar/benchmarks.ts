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
  { modality: "language", path: "/api/v2/data/llms/models", label: "language" },
  { modality: "coding", path: "/api/v2/data/llms/models", label: "language" },
  { modality: "reasoning", path: "/api/v2/data/llms/models", label: "language" },
  { modality: "multimodal", path: "/api/v2/data/llms/models", label: "language" },
  { modality: "tts", path: "/api/text-to-speech", label: "text-to-speech" },
  { modality: "stt", path: "/api/speech-to-text", label: "speech-to-text" },
  { modality: "s2s", path: "/api/speech-to-speech", label: "speech-to-speech" },
  { modality: "latency", path: "/api/v2/data/llms/models", label: "language" },
  { modality: "throughput", path: "/api/v2/data/llms/models", label: "language" },
  { modality: "price_performance", path: "/api/v2/data/llms/models", label: "language" },
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

function normalizeAARows(
  raw: Record<string, unknown>,
  modality: BenchmarkModality,
  path: string,
): ArtificialAnalysisRow[] {
  const modelId =
    typeof raw["model_id"] === "string"
      ? raw["model_id"]
      : typeof raw["slug"] === "string"
        ? raw["slug"]
        : typeof raw["id"] === "string"
          ? raw["id"]
          : null;

  if (!modelId) return [];

  const attributionUrl = `${AA_BASE_URL}${path}`;
  const makeRow = (benchmark: string, rawValue: unknown): ArtificialAnalysisRow | null => {
    if (typeof rawValue !== "number" && typeof rawValue !== "string") return null;
    const value = rawValue;
    return { modelId, benchmark, value, modality, attributionUrl };
  };

  // The current v2 API returns one model per item with metric groups rather
  // than the legacy one-row-per-benchmark shape. Flatten it so claim matching
  // remains independent of the upstream transport format.
  const evaluations = raw["evaluations"];
  if (evaluations && typeof evaluations === "object" && !Array.isArray(evaluations)) {
    // Composite index fields (artificial_analysis_*_index) feed the
    // leaderboard/placements pipeline via normalizeAALeaderboardEntry —
    // treating them as named benchmark claims here would fabricate a
    // bogus "supported" claim for a score that isn't a real benchmark.
    const compositeIndexFields = new Set(Object.values(AA_INDEX_EVAL_FIELDS));
    const rows = Object.entries(evaluations)
      .filter(([benchmark]) => !compositeIndexFields.has(benchmark))
      .map(([benchmark, value]) => makeRow(benchmark, value))
      .filter((row): row is ArtificialAnalysisRow => row !== null);

    const tokensPerSecond = makeRow("Tokens/s", raw["median_output_tokens_per_second"]);
    const timeToFirstToken = makeRow("TTFT", raw["median_time_to_first_token_seconds"]);
    return [
      ...rows,
      ...(tokensPerSecond ? [tokensPerSecond] : []),
      ...(timeToFirstToken ? [timeToFirstToken] : []),
    ];
  }

  const benchmark =
    typeof raw["benchmark"] === "string"
      ? raw["benchmark"]
      : typeof raw["metric"] === "string"
        ? raw["metric"]
        : null;

  // The real /api/v2/data/llms/models response (confirmed live shape, see
  // docs/plans/format-v2-2-notes.md) has no per-named-benchmark fields —
  // only composite evaluations/pricing, which fetchAALeaderboard/
  // normalizeAALeaderboardEntry parse correctly for the placements section.
  // Skip rows we can't attribute to a real named benchmark+value rather than
  // fabricating a placeholder "unknown"/null claim that would surface as a
  // bogus "supported" Artificial Analysis claim in the writer prompt.
  if (!benchmark) return [];

  const row = makeRow(benchmark, raw["value"] ?? raw["score"] ?? raw["result"] ?? null);
  return row ? [row] : [];
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
          "x-api-key": apiKey,
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
        for (const row of normalizeAARows(raw, endpointModality, ep.path)) {
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

// --- AA leaderboard and placements (Task 3) ---

export type AACapabilityIndex = "intelligence" | "coding" | "math" | "agentic";

export const AA_CAPABILITY_INDICES: AACapabilityIndex[] = ["intelligence", "coding", "math", "agentic"];

const AA_INDEX_EVAL_FIELDS: Record<AACapabilityIndex, string> = {
  intelligence: "artificial_analysis_intelligence_index",
  coding: "artificial_analysis_coding_index",
  math: "artificial_analysis_math_index",
  agentic: "artificial_analysis_agentic_index",
};

const AA_LEADERBOARD_PATH = "/api/v2/data/llms/models";

export type AALeaderboardPricing = {
  inputPerMtok: number | null;
  outputPerMtok: number | null;
  blendedPerMtok: number | null;
};

export type AALeaderboardEntry = {
  id: string;
  name: string;
  slug: string;
  baseName: string;
  effort: string | null;
  labName: string;
  labSlug: string;
  scores: Partial<Record<AACapabilityIndex, number>>;
  // DeepSWE is not a documented Artificial Analysis field (confirmed absent during
  // Task 1's probe — see docs/plans/format-v2-2-notes.md). Never read a guessed
  // field name here; this always stays null so downstream placements fall
  // through to the spec's mandatory "not yet tested" line.
  deepswe: number | null;
  pricing: AALeaderboardPricing;
};

export type AALeaderboard = {
  entries: AALeaderboardEntry[];
};

export type AALeaderboardResult =
  | { ok: true; leaderboard: AALeaderboard }
  | {
      ok: false;
      status: "skipped" | "rate_limited" | "error";
      reason: string;
      missingKey?: boolean;
    };

const EFFORT_SUFFIX_PATTERN = /^(.*?)\s*\((high|medium|low)\)\s*$/i;

function splitNameAndEffort(name: string): { baseName: string; effort: string | null } {
  const match = name.match(EFFORT_SUFFIX_PATTERN);
  if (!match) return { baseName: name.trim(), effort: null };
  return { baseName: match[1].trim(), effort: match[2].toLowerCase() };
}

function normalizeAALeaderboardEntry(raw: Record<string, unknown>): AALeaderboardEntry | null {
  const name = typeof raw["name"] === "string" ? raw["name"] : null;
  const slug = typeof raw["slug"] === "string" ? raw["slug"] : null;
  if (!name || !slug) return null;

  const { baseName, effort } = splitNameAndEffort(name);

  const creator = raw["model_creator"] as Record<string, unknown> | undefined;
  const labName = creator && typeof creator["name"] === "string" ? creator["name"] : "Unknown";
  const labSlug = creator && typeof creator["slug"] === "string" ? creator["slug"] : "unknown";

  const evaluations = (raw["evaluations"] as Record<string, unknown>) ?? {};
  const scores: Partial<Record<AACapabilityIndex, number>> = {};
  for (const index of AA_CAPABILITY_INDICES) {
    const value = evaluations[AA_INDEX_EVAL_FIELDS[index]];
    if (typeof value === "number") scores[index] = value;
  }

  const pricing = (raw["pricing"] as Record<string, unknown>) ?? {};
  const inputPerMtok = typeof pricing["price_1m_input_tokens"] === "number" ? pricing["price_1m_input_tokens"] : null;
  const outputPerMtok =
    typeof pricing["price_1m_output_tokens"] === "number" ? pricing["price_1m_output_tokens"] : null;
  const blendedPerMtok =
    typeof pricing["price_1m_blended_3_to_1"] === "number" ? pricing["price_1m_blended_3_to_1"] : null;

  return {
    id: typeof raw["id"] === "string" ? raw["id"] : slug,
    name,
    slug,
    baseName,
    effort,
    labName,
    labSlug,
    scores,
    deepswe: null,
    pricing: { inputPerMtok, outputPerMtok, blendedPerMtok },
  };
}

export async function fetchAALeaderboard(options: BenchmarkOptions = {}): Promise<AALeaderboardResult> {
  const { apiKey, fetchImpl = fetch, timeoutMs = 15_000 } = options;

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      reason: "ARTIFICIAL_ANALYSIS_API_KEY not configured — skipping Artificial Analysis leaderboard fetch",
      missingKey: true,
    };
  }

  const url = `${AA_BASE_URL}${AA_LEADERBOARD_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        "User-Agent": "model-release-radar/0.1",
      },
    });
    clearTimeout(timer);

    if (response.status === 429) {
      return { ok: false, status: "rate_limited", reason: "Artificial Analysis leaderboard API rate limited" };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: "error",
        reason: `Artificial Analysis leaderboard API returned ${response.status}`,
      };
    }

    const data = (await response.json()) as unknown;
    const rawRows: Record<string, unknown>[] =
      data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)["data"])
        ? ((data as Record<string, unknown>)["data"] as Record<string, unknown>[])
        : [];

    const entries: AALeaderboardEntry[] = [];
    for (const raw of rawRows) {
      const entry = normalizeAALeaderboardEntry(raw);
      if (entry) entries.push(entry);
    }

    return { ok: true, leaderboard: { entries } };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return { ok: false, status: "error", reason: "Artificial Analysis leaderboard API timed out" };
    }
    return { ok: false, status: "error", reason: `Artificial Analysis leaderboard API fetch failed: ${msg}` };
  }
}

// --- computePlacements ---

export type PlacementLevel = {
  effort: string | null;
  score: number;
  rank: number;
};

export type NeighborPlacement = {
  name: string;
  effort: string | null;
  score: number;
  rank: number;
};

export type IndexPlacement = {
  index: AACapabilityIndex;
  levels: PlacementLevel[];
  n: number;
  bestRank: number;
  higherNeighbor: NeighborPlacement | null;
  lowerNeighbor: NeighborPlacement | null;
  isTop: boolean;
};

export type DeepswePlacement = ({ status: "tested" } & Omit<IndexPlacement, "index">) | { status: "not_tested" };

export type PricingDelta = { cheaper: boolean; deltaBlended: number };

export type PricingComparison = {
  model: AALeaderboardPricing | null;
  vsHigherNeighbor: (PricingDelta & { neighborName: string }) | null;
  vsLowerNeighbor: (PricingDelta & { neighborName: string }) | null;
  vsFlagship: (PricingDelta & { flagshipName: string }) | null;
};

export type ModelPlacements = {
  modelNames: string[];
  onAA: boolean;
  indices: IndexPlacement[];
  deepswe: DeepswePlacement;
  pricing: PricingComparison;
};

// Article-text model-name extraction (extractModelNames in text.ts) uses a
// space-free regex, so a genuinely multi-word AA name like "GPT-5.2 mini" is
// truncated to "GPT-5.2" before it ever reaches this matcher. Recognizing a
// known, non-distinguishing variant qualifier as a suffix recovers that case
// without reopening the cross-attribution bug this was previously hardened
// against (an extracted "GPT-5" wrongly matching a sibling "GPT-5 Mini"
// entry) — the fallback is disabled whenever the bare (untruncated) name is
// itself a distinct model on the leaderboard, so a real sibling still wins.
const VARIANT_QUALIFIERS = new Set([
  "mini", "nano", "micro", "flash", "air", "lite", "turbo", "pro",
  "plus", "max", "ultra", "small", "medium", "large", "instant", "preview",
]);

function entryMatchesModelNames(
  entry: AALeaderboardEntry,
  modelNames: string[],
  allBaseNames: ReadonlySet<string>,
): boolean {
  const baseLower = entry.baseName.toLowerCase().trim();
  return modelNames.some((name) => {
    const nameLower = name.toLowerCase().trim();
    if (!nameLower) return false;
    if (baseLower === nameLower) return true;
    if (allBaseNames.has(nameLower)) return false;
    if (!baseLower.startsWith(`${nameLower} `)) return false;
    return VARIANT_QUALIFIERS.has(baseLower.slice(nameLower.length + 1));
  });
}

type ScoredPlacement = Omit<IndexPlacement, "index"> | null;

function computeScoredPlacement(
  entries: AALeaderboardEntry[],
  modelNames: string[],
  allBaseNames: ReadonlySet<string>,
  getScore: (entry: AALeaderboardEntry) => number | null,
): ScoredPlacement {
  const scored = entries
    .map((entry) => ({ entry, score: getScore(entry) }))
    .filter((s): s is { entry: AALeaderboardEntry; score: number } => typeof s.score === "number");

  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.map((s, i) => ({ ...s, rank: i + 1 }));

  const ownRanked = ranked.filter((r) => entryMatchesModelNames(r.entry, modelNames, allBaseNames));
  if (ownRanked.length === 0) return null;

  const levels: PlacementLevel[] = ownRanked.map((r) => ({
    effort: r.entry.effort,
    score: r.score,
    rank: r.rank,
  }));
  const bestRank = Math.min(...levels.map((l) => l.rank));
  const bestIndex = ranked.findIndex((r) => r.rank === bestRank);

  let higherNeighbor: NeighborPlacement | null = null;
  for (let i = bestIndex - 1; i >= 0; i--) {
    if (!entryMatchesModelNames(ranked[i].entry, modelNames, allBaseNames)) {
      higherNeighbor = {
        name: ranked[i].entry.baseName,
        effort: ranked[i].entry.effort,
        score: ranked[i].score,
        rank: ranked[i].rank,
      };
      break;
    }
  }

  let lowerNeighbor: NeighborPlacement | null = null;
  for (let i = bestIndex + 1; i < ranked.length; i++) {
    if (!entryMatchesModelNames(ranked[i].entry, modelNames, allBaseNames)) {
      lowerNeighbor = {
        name: ranked[i].entry.baseName,
        effort: ranked[i].entry.effort,
        score: ranked[i].score,
        rank: ranked[i].rank,
      };
      break;
    }
  }

  return { levels, n: ranked.length, bestRank, higherNeighbor, lowerNeighbor, isTop: bestRank === 1 };
}

function comparePricing(model: AALeaderboardPricing, other: AALeaderboardPricing | null): PricingDelta | null {
  if (!other || model.blendedPerMtok === null || other.blendedPerMtok === null) return null;
  const deltaBlended = other.blendedPerMtok - model.blendedPerMtok;
  return { cheaper: deltaBlended > 0, deltaBlended };
}

function findLabFlagship(
  entries: AALeaderboardEntry[],
  ownEntry: AALeaderboardEntry,
  modelNames: string[],
  allBaseNames: ReadonlySet<string>,
): AALeaderboardEntry | null {
  // "unknown" is a fallback for entries with no model_creator, not a real
  // lab — grouping by it would attribute an unrelated lab's model as this
  // model's "flagship" whenever both happen to be missing creator metadata.
  if (ownEntry.labSlug === "unknown") return null;

  const labPeers = entries.filter(
    (e) => e.labSlug === ownEntry.labSlug && !entryMatchesModelNames(e, modelNames, allBaseNames),
  );
  if (labPeers.length === 0) return null;
  return labPeers.reduce((best, e) => {
    const bestScore = best.scores.intelligence ?? -Infinity;
    const score = e.scores.intelligence ?? -Infinity;
    return score > bestScore ? e : best;
  }, labPeers[0]);
}

function computePricingComparison(
  entries: AALeaderboardEntry[],
  modelNames: string[],
  indices: IndexPlacement[],
  allBaseNames: ReadonlySet<string>,
): PricingComparison {
  const ownEntries = entries.filter((e) => entryMatchesModelNames(e, modelNames, allBaseNames));
  if (ownEntries.length === 0) {
    return { model: null, vsHigherNeighbor: null, vsLowerNeighbor: null, vsFlagship: null };
  }

  const primaryIndex = indices.find((p) => p.index === "intelligence") ?? indices[0];
  let primaryEntry: AALeaderboardEntry = ownEntries[0];
  if (primaryIndex) {
    const bestLevel = primaryIndex.levels.find((l) => l.rank === primaryIndex.bestRank);
    const match = ownEntries.find((e) => e.effort === (bestLevel?.effort ?? null));
    if (match) primaryEntry = match;
  }

  const model = primaryEntry.pricing;

  const higherNeighborEntry = primaryIndex?.higherNeighbor
    ? entries.find(
        (e) => e.baseName === primaryIndex.higherNeighbor!.name && e.effort === primaryIndex.higherNeighbor!.effort,
      )
    : undefined;
  const lowerNeighborEntry = primaryIndex?.lowerNeighbor
    ? entries.find(
        (e) => e.baseName === primaryIndex.lowerNeighbor!.name && e.effort === primaryIndex.lowerNeighbor!.effort,
      )
    : undefined;

  const flagshipEntry = findLabFlagship(entries, primaryEntry, modelNames, allBaseNames);
  const flagshipDelta = flagshipEntry ? comparePricing(model, flagshipEntry.pricing) : null;

  const higherNeighborDelta = higherNeighborEntry ? comparePricing(model, higherNeighborEntry.pricing) : null;
  const lowerNeighborDelta = lowerNeighborEntry ? comparePricing(model, lowerNeighborEntry.pricing) : null;

  return {
    model,
    vsHigherNeighbor: higherNeighborEntry && higherNeighborDelta
      ? { ...higherNeighborDelta, neighborName: higherNeighborEntry.baseName }
      : null,
    vsLowerNeighbor: lowerNeighborEntry && lowerNeighborDelta
      ? { ...lowerNeighborDelta, neighborName: lowerNeighborEntry.baseName }
      : null,
    vsFlagship: flagshipEntry && flagshipDelta ? { ...flagshipDelta, flagshipName: flagshipEntry.baseName } : null,
  };
}

export function computePlacements(leaderboard: AALeaderboard, modelNames: string[]): ModelPlacements {
  const entries = leaderboard.entries;
  const allBaseNames = new Set(entries.map((e) => e.baseName.toLowerCase().trim()));

  const indices: IndexPlacement[] = [];
  for (const index of AA_CAPABILITY_INDICES) {
    const placement = computeScoredPlacement(entries, modelNames, allBaseNames, (e) => e.scores[index] ?? null);
    if (placement) indices.push({ index, ...placement });
  }

  const deepswePlacement = computeScoredPlacement(entries, modelNames, allBaseNames, (e) => e.deepswe);
  const deepswe: DeepswePlacement = deepswePlacement
    ? { status: "tested", ...deepswePlacement }
    : { status: "not_tested" };

  const onAA = entries.some((e) => entryMatchesModelNames(e, modelNames, allBaseNames));
  const pricing = computePricingComparison(entries, modelNames, indices, allBaseNames);

  return { modelNames, onAA, indices, deepswe, pricing };
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
