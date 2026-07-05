import type { ExtractedArticle } from "./types";
import type { SystemCardResult, EvidenceChunk } from "./systemCards";
import type { BenchmarkEvidence, BenchmarkClaim } from "./benchmarks";
import type { LlmRouter } from "./llm";
import { completeWithBudget, CostTracker } from "./llm";
import { extractModelNames } from "./text";

// ─── Evidence packet ─────────────────────────────────────────────────────────
// A sealed, read-only bundle of already-fetched/extracted material that the
// final writer receives. It contains no raw network handles or fetch functions
// so the final writer cannot make additional calls.

export type EvidenceReference = {
  url: string;
  kind:
    | "article"
    | "system_card"
    | "model_card"
    | "safety_card"
    | "technical_report"
    | "pdf"
    | "model_repo"
    | "model_docs"
    | "benchmark";
  chunkIds: string[];
};

export type EvidencePacket = {
  lab: string;
  modelNames: string[];
  articleUrl: string;
  releaseDate: string | null;
  articleSummary: string;
  systemCardSummary: string;
  benchmarkSummary: string;
  evidenceSynthesis: string;
  claims: BenchmarkClaim[];
  systemCardStatus: "found" | "not_found";
  references: EvidenceReference[];
  costTracker: CostTracker;
};

// ─── Role input/output schemas ────────────────────────────────────────────────

export type ResearcherInput = {
  articleUrl: string;
  article: ExtractedArticle;
  systemCardResult: SystemCardResult;
  benchmarkEvidence: BenchmarkEvidence;
};

export type ResearcherOutput = {
  lab: string;
  modelNames: string[];
  releaseDate: string | null;
  articleChunks: EvidenceChunk[];
  allChunks: EvidenceChunk[];
  references: EvidenceReference[];
};

export type ArticleSummarizerInput = {
  lab: string;
  modelNames: string[];
  articleText: string;
  articleUrl: string;
};

export type ArticleSummarizerOutput = {
  summary: string;
};

export type SystemCardSummarizerInput = {
  lab: string;
  modelNames: string[];
  systemCardResult: SystemCardResult;
};

export type SystemCardSummarizerOutput = {
  summary: string;
  status: "found" | "not_found";
};

export type BenchmarkAggregatorInput = {
  lab: string;
  modelNames: string[];
  benchmarkEvidence: BenchmarkEvidence;
};

export type BenchmarkAggregatorOutput = {
  summary: string;
  claims: BenchmarkClaim[];
};

export type FinalWriterInput = {
  evidencePacket: EvidencePacket;
};

export type FinalWriterOutput = {
  message: string;
};

// ─── Verifier types ───────────────────────────────────────────────────────────

export type VerifierFinding = {
  claim: string;
  issue: "unsupported_strength" | "unsupported_benchmark" | "missing_weakness" | "wrong_source_url" | "stale_article_url" | "invented_safety_claim" | "other";
  detail: string;
  severity: "block" | "warn";
};

export type VerifierInput = {
  message: string;
  evidencePacket: EvidencePacket;
};

export type VerifierOutput = {
  approved: boolean;
  findings: VerifierFinding[];
  checkedClaims: number;
  unsupportedCount: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildArticleChunks(article: ExtractedArticle): EvidenceChunk[] {
  if (!article.body) return [];
  const text = article.body.slice(0, 8000);
  return [
    {
      chunkId: "article_overview_0",
      sourceUrl: article.finalUrl,
      topic: "overview",
      pageNumber: null,
      text,
    },
  ];
}

export function extractLabFromUrl(url: string): string {
  if (/anthropic\.com/i.test(url)) return "Anthropic";
  if (/openai\.com/i.test(url)) return "OpenAI";
  if (/blog\.google|deepmind\.google|googleblog\.com/i.test(url)) return "Google Gemini";
  if (/mistral\.ai/i.test(url)) return "Mistral";
  if (/deepseek\.com/i.test(url)) return "DeepSeek";
  if (/ai\.meta\.com/i.test(url)) return "Meta Llama";
  if (/x\.ai/i.test(url)) return "xAI";
  if (/nvidia\.com/i.test(url)) return "NVIDIA Nemotron";
  if (/deepgram\.com/i.test(url)) return "Deepgram";
  if (/elevenlabs\.io/i.test(url)) return "ElevenLabs";
  if (/assemblyai\.com/i.test(url)) return "AssemblyAI";
  return "Unknown";
}

function extractReleaseDateFromArticle(article: ExtractedArticle): string | null {
  return article.publishedAt ?? article.updatedAt ?? null;
}

function buildReferences(
  article: ExtractedArticle,
  systemCardResult: SystemCardResult,
  benchmarkEvidence: BenchmarkEvidence,
): EvidenceReference[] {
  const refs: EvidenceReference[] = [];

  // Article itself
  refs.push({
    url: article.canonicalUrl ?? article.finalUrl,
    kind: "article",
    chunkIds: ["article_overview_0"],
  });

  // System card documents
  for (const doc of systemCardResult.documents) {
    if (doc.fetchStatus !== "ok") continue;
    refs.push({
      url: doc.url,
      kind: doc.kind as EvidenceReference["kind"],
      chunkIds: doc.chunks.map((c) => c.chunkId),
    });
  }

  // Benchmark sources
  const benchmarkUrls = new Set<string>();
  for (const claim of benchmarkEvidence.claims) {
    if (claim.sourceUrl && !benchmarkUrls.has(claim.sourceUrl)) {
      benchmarkUrls.add(claim.sourceUrl);
      refs.push({ url: claim.sourceUrl, kind: "benchmark", chunkIds: [] });
    }
  }

  return refs;
}

// ─── Agent role implementations ───────────────────────────────────────────────

export async function runResearcher(input: ResearcherInput): Promise<ResearcherOutput> {
  const { article, systemCardResult, benchmarkEvidence } = input;

  const lab = extractLabFromUrl(article.finalUrl);
  const releaseDate = extractReleaseDateFromArticle(article);

  // Collect model names from benchmark evidence (most reliable), fall back to
  // pattern extraction from the article text when the benchmark stage found none.
  const modelNames = benchmarkEvidence.modelNames.length > 0
    ? benchmarkEvidence.modelNames
    : extractModelNames(`${article.title ?? ""} ${article.body ?? ""}`);

  const articleChunks = buildArticleChunks(article);

  const systemCardChunks: EvidenceChunk[] = [];
  for (const doc of systemCardResult.documents) {
    if (doc.fetchStatus === "ok") {
      systemCardChunks.push(...doc.chunks);
    }
  }

  const allChunks = [...articleChunks, ...systemCardChunks];
  const references = buildReferences(article, systemCardResult, benchmarkEvidence);

  return {
    lab,
    modelNames,
    releaseDate,
    articleChunks,
    allChunks,
    references,
  };
}

export async function runArticleSummarizer(
  input: ArticleSummarizerInput,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<ArticleSummarizerOutput> {
  const { lab, modelNames, articleText, articleUrl } = input;

  const systemPrompt = `You are an expert AI model release analyst. Summarize the following article about an AI model release from ${lab}.
Focus on: model names, key capabilities, benchmarks, pricing/availability, and what makes this release notable.
Be factual and cite only what is explicitly stated in the article. Do not invent facts.`;

  const userPrompt = `Article URL: ${articleUrl}
Models: ${modelNames.join(", ") || "unknown"}

Article text:
${articleText.slice(0, 6000)}

Provide a concise, factual summary (3-5 paragraphs) of this model release.`;

  const completion = await completeWithBudget(router, tracker, "article_summarizer", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return { summary: completion.text };
}

export async function runSystemCardSummarizer(
  input: SystemCardSummarizerInput,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<SystemCardSummarizerOutput> {
  const { lab, modelNames, systemCardResult } = input;

  if (systemCardResult.system_card_status === "not_found" || systemCardResult.documents.length === 0) {
    return { summary: "No system card, safety card, or technical report was found for this release.", status: "not_found" };
  }

  const allChunks: EvidenceChunk[] = [];
  for (const doc of systemCardResult.documents) {
    if (doc.fetchStatus === "ok") {
      allChunks.push(...doc.chunks.filter((c) => c.topic === "safety" || c.topic === "misuse_limitations" || c.topic === "benchmarks_evals" || c.topic === "overview"));
    }
  }

  if (allChunks.length === 0) {
    return { summary: "System card documents were found but could not be read (fetch failed or empty).", status: "not_found" };
  }

  const chunksText = allChunks
    .map((c) => `[${c.chunkId} / ${c.topic}]\n${c.text}`)
    .join("\n\n---\n\n")
    .slice(0, 6000);

  const systemPrompt = `You are an AI safety analyst. Summarize the safety-relevant content from system/model/safety cards and technical reports for ${lab} models.
Include: safety evaluations, known limitations, misuse risks, safety mitigations, and key benchmarks.
Only summarize what is explicitly stated. Mark anything absent as "not found in source material."`;

  const userPrompt = `Models: ${modelNames.join(", ") || "unknown"}
Source documents: ${systemCardResult.documents.map((d) => d.url).join(", ")}

Relevant document chunks:
${chunksText}

Provide a concise safety/system-card summary.`;

  const completion = await completeWithBudget(router, tracker, "system_card_summarizer", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return { summary: completion.text, status: "found" };
}

export async function runBenchmarkAggregator(
  input: BenchmarkAggregatorInput,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<BenchmarkAggregatorOutput> {
  const { lab, modelNames, benchmarkEvidence } = input;

  const claimLines = benchmarkEvidence.claims
    .map(
      (c) =>
        `${c.name}: ${c.value ?? "N/A"} (source: ${c.source}, status: ${c.status}, url: ${c.sourceUrl ?? "N/A"})`,
    )
    .join("\n");

  const aaStatus = benchmarkEvidence.artificialAnalysis.ok
    ? `Artificial Analysis data available (${benchmarkEvidence.artificialAnalysis.rows.length} rows).`
    : `Artificial Analysis: ${benchmarkEvidence.artificialAnalysis.reason}`;

  const systemPrompt = `You are a benchmark analyst. Summarize the benchmark evidence for an AI model release.
For each benchmark claim, indicate whether it is supported, contradicted, missing, or not_comparable based on independent data.
Attribute vendor-provided claims vs independently verified claims.`;

  const userPrompt = `Lab: ${lab}
Models: ${modelNames.join(", ") || "unknown"}
Modalities: ${benchmarkEvidence.modality.join(", ")}

${aaStatus}

Benchmark claims:
${claimLines || "No benchmark claims found."}

Provide a concise benchmark summary with provenance for each claim.`;

  const completion = await completeWithBudget(router, tracker, "benchmark_aggregator", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return { summary: completion.text, claims: benchmarkEvidence.claims };
}

export async function runEvidenceSynthesizer(
  evidencePacket: Omit<EvidencePacket, "evidenceSynthesis">,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<string> {
  const systemPrompt = `You are an evidence synthesizer for AI model releases.
Combine article summary, system card information, and benchmark evidence into a coherent evidence synthesis.
Every claim must trace back to a source URL. Mark explicit unknowns rather than speculating.`;

  const userPrompt = `Lab: ${evidencePacket.lab}
Models: ${evidencePacket.modelNames.join(", ")}
Article URL: ${evidencePacket.articleUrl}

Article Summary:
${evidencePacket.articleSummary}

System Card Summary (status: ${evidencePacket.systemCardStatus}):
${evidencePacket.systemCardSummary}

Benchmark Summary:
${evidencePacket.benchmarkSummary}

References:
${evidencePacket.references.map((r) => `- ${r.kind}: ${r.url}`).join("\n")}

Synthesize all evidence into a structured report with strengths, weaknesses/unknowns, benchmark context, and safety notes.`;

  const completion = await completeWithBudget(router, tracker, "evidence_synthesizer", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return completion.text;
}

export async function runFinalWriter(
  input: FinalWriterInput,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<FinalWriterOutput> {
  const { evidencePacket } = input;

  // The final writer receives only the sealed evidence packet — no fetch/browser tools
  const systemPrompt = `You are writing a Telegram message announcing an AI model release.
Write a concise, clear message under 3800 characters that includes:
- Lab name, model name(s), release date
- 2-3 bullet points for where it shines
- Key strengths (cited from evidence)
- Known weaknesses or unknowns
- Benchmark context with provenance
- Safety/system card notes (state explicitly if absent)
- Source links

Only include facts that appear in the evidence synthesis. State "Unknown" for missing information.
Use plain text suitable for Telegram (no markdown). Do not invent capabilities or benchmark scores.`;

  const userPrompt = `Lab: ${evidencePacket.lab}
Models: ${evidencePacket.modelNames.join(", ")}
Release Date: ${evidencePacket.releaseDate ?? "Unknown"}
Official Article: ${evidencePacket.articleUrl}

Evidence Synthesis:
${evidencePacket.evidenceSynthesis.slice(0, 4000)}

Additional references:
${evidencePacket.references.slice(0, 6).map((r) => `- ${r.kind}: ${r.url}`).join("\n")}

Write the Telegram announcement message.`;

  const completion = await completeWithBudget(router, tracker, "final_writer", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return { message: completion.text };
}

// ─── Verifier ─────────────────────────────────────────────────────────────────

const SAFETY_INVENTION_PATTERNS = [
  /\b(red.?team|jailbreak|constitutional ai|harmless|helpful|honest)\b/i,
  /\b(rlhf|reinforcement learning from human feedback)\b/i,
  /\b(safety eval|safety score|dangerous capability)\b/i,
];

const BENCHMARK_CLAIM_PATTERN =
  /(\d+(?:\.\d+)?%?)\s+(?:on|in|for|at)\s+([A-Z][A-Za-z0-9\-]+)|([A-Z][A-Za-z0-9\-]+(?:\s+\w+)?)\s*[:–\-]\s*(\d+(?:\.\d+)?%?)/g;

function extractClaimsFromMessage(message: string): string[] {
  const claims: string[] = [];
  const sentences = message.split(/[.!?]/);
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    // Sentences containing numbers or capability claims
    if (/\d/.test(s) || /\b(outperform|best|state.of.the.art|sota|achiev|exceed|surpass)\b/i.test(s)) {
      claims.push(s);
    }
  }
  return claims;
}

function isSuperlativeClaimSupportedByEvidence(claim: string, evidencePacket: EvidencePacket): boolean {
  const allText = [
    evidencePacket.articleSummary,
    evidencePacket.systemCardSummary,
    evidencePacket.benchmarkSummary,
    evidencePacket.evidenceSynthesis,
  ]
    .join(" ")
    .toLowerCase();

  // Extract the superlative/comparison words from the claim and check if they appear in evidence
  const superlativeWords = claim
    .toLowerCase()
    .match(/\b(outperform|surpass|exceed|dominat|best|state.of.the.art|sota)\w*/g) ?? [];

  if (superlativeWords.length === 0) return true;

  // All superlative words must appear in evidence
  return superlativeWords.every((w) => allText.includes(w));
}

// Common message metadata labels that match the benchmark pattern but are not benchmark claims.
// e.g. "Release Date: 2026-07-05" → "Release Date" matches the regex but is not a benchmark.
const NON_BENCHMARK_LABELS = new Set([
  "release date",
  "date",
  "lab",
  "models",
  "source",
  "cost",
  "status",
  "official article",
  "context window",
  "parameters",
  "pricing",
  "price",
  "tokens",
  "layers",
  "heads",
]);

function checkBenchmarkClaims(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  const findings: VerifierFinding[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(BENCHMARK_CLAIM_PATTERN.source, "g");

  while ((match = pattern.exec(message)) !== null) {
    const value = match[1] ?? match[4] ?? "";
    const benchmarkName = match[2] ?? match[3] ?? "";

    if (!benchmarkName || !value) continue;

    if (NON_BENCHMARK_LABELS.has(benchmarkName.toLowerCase())) continue;

    // A benchmark claim is only "in evidence" if it appears in the structured claims list.
    // Text matches can include negations like "No HumanEval data" so we avoid text search.
    const claimText = `${benchmarkName} ${value}`;
    const inClaims = evidencePacket.claims.some(
      (c) => c.name.toLowerCase().includes(benchmarkName.toLowerCase()),
    );

    if (!inClaims) {
      findings.push({
        claim: claimText,
        issue: "unsupported_benchmark",
        detail: `Benchmark claim "${claimText}" not found in evidence claims. Benchmark "${benchmarkName}" does not appear in the structured claims list from any evidence document.`,
        severity: "block",
      });
    }
  }

  return findings;
}

function checkSafetyInvention(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  if (evidencePacket.systemCardStatus === "found") return [];

  const findings: VerifierFinding[] = [];
  for (const pattern of SAFETY_INVENTION_PATTERNS) {
    if (pattern.test(message)) {
      // Verify it appears in evidence
      const allEvidence = [
        evidencePacket.articleSummary,
        evidencePacket.systemCardSummary,
        evidencePacket.benchmarkSummary,
        evidencePacket.evidenceSynthesis,
      ].join(" ");

      if (!pattern.test(allEvidence)) {
        findings.push({
          claim: message.match(pattern)?.[0] ?? "safety claim",
          issue: "invented_safety_claim",
          detail: `Safety-related claim detected in final message but no system card was found and claim not traceable to evidence. Pattern: ${pattern.source}`,
          severity: "block",
        });
      }
    }
  }

  return findings;
}

function checkSourceUrls(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  const findings: VerifierFinding[] = [];
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const messageUrls = [...message.matchAll(urlPattern)].map((m) => m[0]);

  const knownUrls = new Set([
    evidencePacket.articleUrl,
    ...evidencePacket.references.map((r) => r.url),
  ]);

  for (const url of messageUrls) {
    const clean = url.replace(/[.,;)]+$/, "");
    if (!knownUrls.has(clean)) {
      // Check if it's a close match (same domain as a known URL)
      const urlHost = (() => { try { return new URL(clean).hostname; } catch { return ""; } })();
      const knownHosts = new Set([...knownUrls].map((u) => { try { return new URL(u).hostname; } catch { return ""; } }));

      if (!knownHosts.has(urlHost)) {
        findings.push({
          claim: clean,
          issue: "wrong_source_url",
          detail: `URL "${clean}" in final message is not present in the evidence packet references. This URL was not fetched or verified.`,
          severity: "block",
        });
      }
    }
  }

  return findings;
}

function checkStaleArticleUrl(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  const findings: VerifierFinding[] = [];

  if (!message.includes(evidencePacket.articleUrl)) {
    // Check if any reference URL is present
    const hasAnyReference = evidencePacket.references.some((r) => message.includes(r.url));
    if (!hasAnyReference) {
      findings.push({
        claim: evidencePacket.articleUrl,
        issue: "stale_article_url",
        detail: `The official article URL "${evidencePacket.articleUrl}" does not appear in the final message. The message must include the source article link.`,
        severity: "warn",
      });
    }
  }

  return findings;
}

function checkUnsupportedStrengths(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  const findings: VerifierFinding[] = [];
  const claims = extractClaimsFromMessage(message);

  for (const claim of claims) {
    if (
      /\b(best|state.of.the.art|sota|outperform|surpass|exceed|dominat)\w*/i.test(claim) &&
      !isSuperlativeClaimSupportedByEvidence(claim, evidencePacket)
    ) {
      findings.push({
        claim,
        issue: "unsupported_strength",
        detail: `Superlative strength claim "${claim.slice(0, 100)}" cannot be traced to evidence sources.`,
        severity: "block",
      });
    }
  }

  return findings;
}

function checkMissingWeaknesses(message: string): VerifierFinding[] {
  const hasWeaknessSection =
    /unknown|limitation|weakness|caveat|not support|does not|cannot|missing/i.test(message);

  if (!hasWeaknessSection) {
    return [
      {
        claim: "weaknesses/unknowns section",
        issue: "missing_weakness",
        detail: "Final message does not include any weaknesses, unknowns, or limitations. Every release note must include explicit unknowns.",
        severity: "block",
      },
    ];
  }

  return [];
}

export function runVerifier(input: VerifierInput): VerifierOutput {
  const { message, evidencePacket } = input;

  const findings: VerifierFinding[] = [
    ...checkBenchmarkClaims(message, evidencePacket),
    ...checkSafetyInvention(message, evidencePacket),
    ...checkSourceUrls(message, evidencePacket),
    ...checkStaleArticleUrl(message, evidencePacket),
    ...checkUnsupportedStrengths(message, evidencePacket),
    ...checkMissingWeaknesses(message),
  ];

  const blockingFindings = findings.filter((f) => f.severity === "block");
  const approved = blockingFindings.length === 0;
  const checkedClaims = extractClaimsFromMessage(message).length;

  return {
    approved,
    findings,
    checkedClaims,
    unsupportedCount: blockingFindings.length,
  };
}

// ─── High-level orchestration ─────────────────────────────────────────────────

export type OrchestratorOptions = {
  router: LlmRouter;
  tracker: CostTracker;
};

export type OrchestratorResult = {
  evidencePacket: EvidencePacket;
  finalMessage: string;
  verifierOutput: VerifierOutput;
  approved: boolean;
};

export async function runAgentOrchestration(
  articleUrl: string,
  article: ExtractedArticle,
  systemCardResult: SystemCardResult,
  benchmarkEvidence: BenchmarkEvidence,
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { router, tracker } = options;

  // Step 1: Researcher collects and structures raw inputs
  const researcherOutput = await runResearcher({
    articleUrl,
    article,
    systemCardResult,
    benchmarkEvidence,
  });

  // Step 2: Article summarizer (DeepSeek)
  const articleSummary = await runArticleSummarizer(
    {
      lab: researcherOutput.lab,
      modelNames: researcherOutput.modelNames,
      articleText: article.body ?? "",
      articleUrl,
    },
    router,
    tracker,
  );

  // Step 3: System card summarizer (DeepSeek)
  const systemCardSummary = await runSystemCardSummarizer(
    {
      lab: researcherOutput.lab,
      modelNames: researcherOutput.modelNames,
      systemCardResult,
    },
    router,
    tracker,
  );

  // Step 4: Benchmark aggregator (DeepSeek)
  const benchmarkSummary = await runBenchmarkAggregator(
    {
      lab: researcherOutput.lab,
      modelNames: researcherOutput.modelNames,
      benchmarkEvidence,
    },
    router,
    tracker,
  );

  // Step 5: Build partial evidence packet (without synthesis yet)
  const partialPacket: Omit<EvidencePacket, "evidenceSynthesis"> = {
    lab: researcherOutput.lab,
    modelNames: researcherOutput.modelNames,
    articleUrl,
    releaseDate: researcherOutput.releaseDate,
    articleSummary: articleSummary.summary,
    systemCardSummary: systemCardSummary.summary,
    benchmarkSummary: benchmarkSummary.summary,
    claims: benchmarkSummary.claims,
    systemCardStatus: systemCardSummary.status,
    references: researcherOutput.references,
    costTracker: tracker,
  };

  // Step 6: Evidence synthesizer (DeepSeek)
  const evidenceSynthesis = await runEvidenceSynthesizer(partialPacket, router, tracker);

  const evidencePacket: EvidencePacket = {
    ...partialPacket,
    evidenceSynthesis,
  };

  // Step 7: Final writer (OpenRouter Kimi) — receives sealed evidence packet only
  const finalWriterOutput = await runFinalWriter({ evidencePacket }, router, tracker);

  // Step 8: Verifier runs independently after final writing, before any send
  const verifierOutput = runVerifier({
    message: finalWriterOutput.message,
    evidencePacket,
  });

  return {
    evidencePacket,
    finalMessage: finalWriterOutput.message,
    verifierOutput,
    approved: verifierOutput.approved,
  };
}
