import type { ExtractedArticle } from "./types";
import type { SystemCardResult, EvidenceChunk } from "./systemCards";
import type {
  BenchmarkEvidence,
  BenchmarkClaim,
  ModelPlacements,
  IndexPlacement,
  NeighborPlacement,
  AALeaderboardResult,
  AACapabilityIndex,
  PricingDelta,
} from "./benchmarks";
import { computePlacements, AA_CAPABILITY_INDICES } from "./benchmarks";
import type { LlmRouter } from "./llm";
import { completeWithBudget, CostTracker } from "./llm";
import { extractModelNames, filterModelNamesForLab } from "./text";
import { identifyProviderForUrl } from "./articleGate";
import { runReleaseClassifier, type ReleaseClassifierOutput } from "./classifier";

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

// Availability strings extracted by the article summarizer (v2.2 Facts row).
// Never null — unresolved fields fall back to the "[placeholder]" placeholder
// discipline mandated by the writer contract (rule 10).
export type AvailabilityInfo = {
  api: string;
  subscription: string;
};

export const AVAILABILITY_PLACEHOLDER: AvailabilityInfo = {
  api: "[placeholder]",
  subscription: "[placeholder]",
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
  // Artificial Analysis leaderboard placement for this release, or null when
  // no leaderboard was supplied / the model is not on Artificial Analysis.
  placements: ModelPlacements | null;
  // Set only when placements is null because the leaderboard fetch itself
  // failed (rate limited, errored, or was skipped for missing config) — as
  // opposed to a successful fetch that genuinely found no match. Lets the
  // writer distinguish "not yet listed" (a real claim about AA's coverage)
  // from "we couldn't check this run" instead of collapsing both to the same
  // mandatory fallback line.
  placementsUnavailableReason: string | null;
  availability: AvailabilityInfo;
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
  availability: AvailabilityInfo;
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
  verifierFeedback?: VerifierFinding[];
};

// The writer emits two Telegram messages by default (v2.2 §Writer contract
// rule 1): message1 is the alert card, message2 is the reply deep dive.
// message1 must always be able to stand alone if message2 is missing.
export type FinalWriterOutput = {
  message1: string;
  message2: string;
};

// ─── Verifier types ───────────────────────────────────────────────────────────

export type VerifierFinding = {
  claim: string;
  issue: "unsupported_strength" | "unsupported_benchmark" | "wrong_source_url" | "stale_article_url" | "invented_safety_claim" | "other";
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
  const provider = identifyProviderForUrl(url);
  if (provider) return provider;

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

// Lab-color square for the message 1 header (v2.2 §Templates: "lab-color
// square (Anthropic 🟧, OpenAI ⬛, Google 🔵, xAI ⬜, Meta 🔷, …)"). Kept as a
// plain in-code map per the spec's explicit "no per-lab emoji config store
// (simple map in code)" instruction, rather than left to the writer LLM to
// guess per release.
const LAB_EMOJI: Record<string, string> = {
  Anthropic: "🟧",
  OpenAI: "⬛",
  "Google Gemini": "🔵",
  xAI: "⬜",
  "Meta Llama": "🔷",
  Mistral: "🟠",
  DeepSeek: "🟣",
  "NVIDIA Nemotron": "🟢",
  Deepgram: "🟡",
  ElevenLabs: "⚪",
  AssemblyAI: "🟤",
};
const DEFAULT_LAB_EMOJI = "⬛";

export function getLabEmoji(lab: string): string {
  return LAB_EMOJI[lab] ?? DEFAULT_LAB_EMOJI;
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
  const rawModelNames = benchmarkEvidence.modelNames.length > 0
    ? benchmarkEvidence.modelNames
    : extractModelNames(`${article.title ?? ""} ${article.body ?? ""}`);
  const modelNames = filterModelNamesForLab(lab, rawModelNames);

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

const API_AVAILABILITY_LINE = /API_AVAILABILITY:\s*(.+)/i;
const SUBSCRIPTION_AVAILABILITY_LINE = /SUBSCRIPTION_AVAILABILITY:\s*(.+)/i;

// The article-summarizer prompt tells the LLM to write the literal word
// "unknown" when the article doesn't say — normalize that to the same
// "[placeholder]" convention the rest of the pipeline uses for missing
// values (writer contract rule 10), rather than leaking raw "unknown" text.
function normalizeAvailabilityValue(value: string, placeholder: string): string {
  return /^unknown$/i.test(value.trim()) ? placeholder : value;
}

function extractAvailabilityFromSummary(summaryText: string): AvailabilityInfo {
  const apiMatch = summaryText.match(API_AVAILABILITY_LINE);
  const subMatch = summaryText.match(SUBSCRIPTION_AVAILABILITY_LINE);
  return {
    api: apiMatch ? normalizeAvailabilityValue(apiMatch[1]!.trim(), AVAILABILITY_PLACEHOLDER.api) : AVAILABILITY_PLACEHOLDER.api,
    subscription: subMatch
      ? normalizeAvailabilityValue(subMatch[1]!.trim(), AVAILABILITY_PLACEHOLDER.subscription)
      : AVAILABILITY_PLACEHOLDER.subscription,
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
Be factual and cite only what is explicitly stated in the article. Do not invent facts.

After the summary, add two lines, each on its own line, exactly in this form (write "unknown" if the article does not say):
API_AVAILABILITY: <how/when the model is available via API>
SUBSCRIPTION_AVAILABILITY: <which consumer/team subscription plans include it>`;

  const userPrompt = `Article URL: ${articleUrl}
Models: ${modelNames.join(", ") || "unknown"}

Article text:
${articleText.slice(0, 6000)}

Provide a concise, factual summary (3-5 paragraphs) of this model release, followed by the API_AVAILABILITY and SUBSCRIPTION_AVAILABILITY lines.`;

  const completion = await completeWithBudget(router, tracker, "article_summarizer", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  return { summary: completion.text, availability: extractAvailabilityFromSummary(completion.text) };
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
    .slice(0, 12000);

  const systemPrompt = `You are an AI safety analyst. Summarize the safety-relevant content from system/model/safety cards and technical reports for ${lab} models.
Prioritize hunting for interesting or idiosyncratic behaviors, not just a checklist: alignment audit results (misaligned-behavior rate vs prior/flagship models), sycophancy, eval-awareness, reward hacking, and any other notable quirks the card calls out.
Also include: safety evaluations, known limitations, misuse risks, safety mitigations, deployment safeguards (e.g. ASL level, classifiers, monitoring), and key benchmarks.
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

const MESSAGE_2_DELIMITER = "===MESSAGE_2===";

// ─── Final writer: v2.2 two-message templates + 11-rule contract ─────────────
// Verbatim contract from docs/telegram-message-format-v2.md §Writer contract.

const FINAL_WRITER_SYSTEM_PROMPT = `You are writing a two-message Telegram announcement for an AI model release, in the exact v2.2 format below. Output BOTH messages, Message 1 first, then a line containing only the literal delimiter ${MESSAGE_2_DELIMITER}, then Message 2. Output nothing else before Message 1 or after Message 2.

MESSAGE 1 — alert card template:
{lab_emoji} <b>{lab} — {model}</b> <code>{api_id}</code>
<i>Released {date} · <a href="{announce_url}">Announcement</a></i>

<b>Verdict.</b> {verdict_3to5_sentences} (full breakdown in reply ⤵️)

<b>Facts.</b> Context {context} · Pricing {price_in} in / {price_out} out per Mtok · Open weights: {weights} · API: {api_availability} · Subscription: {subscription_availability} · Focus: {focus}

📊 <b>Benchmarks</b> <i>(Artificial Analysis)</i>
{benchmark_rows}

🔗 <i>Sources: {sources}</i>

MESSAGE 2 — reply deep dive template:
↩️ <b>{model} — full breakdown</b>

📝 <b>In-depth summary</b>
<blockquote expandable>{summary_2to4_paragraphs}</blockquote>

🛡 <b>System card — {card_verdict}</b>
<blockquote expandable>{card_deep_dive}</blockquote>

{lab_emoji} in message 1 must be copied verbatim from the "Lab emoji" value given in the user message — never invent or guess a different emoji for the lab.

Writer contract — follow every rule:
1. Two messages by default. Message 1 must read completely on its own if the reply is missing.
2. The verdict is a real conclusion, not a pitch: 3-5 visible sentences stating who beats this model, on which benchmark, at what price; its one genuine edge; one honest system-card plus/caveat (or "no system card published"). Never marketing-neutral, never hedge away the conclusion.
3. Every comparative claim in the verdict must be backed by a Facts figure or a Benchmarks row in message 1; unverified numbers are flagged [placeholder] in both places.
4. The verdict ends with the literal pointer "(full breakdown in reply ⤵️)". The in-depth summary and system-card breakdown live only in message 2.
5. Facts row carries: context, pricing, open weights, API availability (with the <code> model id), subscription availability (which plans), focus. Missing value -> [placeholder].
6. Unified Benchmarks section: every AA capability index (Intelligence, Coding, Math, Agentic — whatever AA provides) plus a DeepSWE row.
7. Rank first: "• {Benchmark}: #{rank} of {n} — {levels}; {placement}".
8. Show all tested reasoning levels, compact ("high 58 (#9) · medium 54 (#13)"); anchor the placement on the best level. Prefix 🥇 and say "highest tested" when it tops a benchmark.
9. DeepSWE fallback is mandatory: if Artificial Analysis has not run it, emit exactly "• DeepSWE: not yet tested by Artificial Analysis for this model."
10. Placeholder discipline: every unverified value is wrapped [placeholder] inline — numbers, ranks, neighbors, prices, availability, URLs.
11. Formatting invariants: Telegram HTML whitelist only (<b> <i> <a> <code> <blockquote expandable>); escape & < > in interpolated text; 4096-char cap per message; labeled sections are never deleted — emit the fallback line instead.

Mandatory fallback lines (never delete a labeled section — emit the fallback line instead):
- Model not yet listed on Artificial Analysis at all: keep the 📊 label, single line "Not yet listed on Artificial Analysis."
- An index not reported: "• {Benchmark}: not yet reported by Artificial Analysis for this model."
- No DeepSWE run: exactly "• DeepSWE: not yet tested by Artificial Analysis for this model."
- No system card found: the verdict must say so ("no system card published"), and message 2's 🛡 section must use exactly "No system/model card published at launch."

Benchmark guardrails:
- Named benchmark scores, ranks, and model-vs-model comparisons in the Benchmarks section must come only from "Artificial Analysis placement data" below.
- Named benchmark scores from "Allowed Benchmark Claims" (vendor/system-card claims) may be cited in the verdict or Message 2 deep dive, attributed to their source; never invent a claim absent from either list.
- If "Allowed Benchmark Claims" is "None" and Artificial Analysis placement data says the model is not yet listed, say that independent benchmark verification is unavailable rather than inventing a comparison.

Only include facts that appear in the evidence packet in the user message below. Never invent capabilities, benchmark scores, prices, or URLs.`;

const MESSAGE_2_ONLY_SYSTEM_PROMPT = `You are writing ONLY message 2 (the reply deep dive) of a two-message Telegram AI-model-release announcement, using this exact template:

↩️ <b>{model} — full breakdown</b>

📝 <b>In-depth summary</b>
<blockquote expandable>{summary_2to4_paragraphs}</blockquote>

🛡 <b>System card — {card_verdict}</b>
<blockquote expandable>{card_deep_dive}</blockquote>

Rules: {summary_2to4_paragraphs} goes positioning -> evidence -> real strengths -> optional "who should pick it / who shouldn't", blank line between paragraphs. {card_verdict} is "published, strong", "published, mixed", "published, concerning", or "not published". {card_deep_dive} uses bold-tagged bullets: <b>Alignment.</b>, <b>Cyber.</b>, <b>Notable behaviors.</b>, <b>Safeguards & deployment.</b>, <b>Unknowns.</b> — emphasize interesting/idiosyncratic behaviors (alignment audit deltas, sycophancy, eval-awareness, reward hacking, quirks). If no system card was found, keep the section but write exactly: "No system/model card published at launch." Telegram HTML whitelist only (<b> <i> <a> <code> <blockquote expandable>); escape & < > in interpolated text; 4096-char cap. Only include facts from the evidence packet in the user message below. Output nothing but message 2 — no delimiter, no message 1, no preamble.`;

function splitWriterOutput(text: string): { message1: string; message2: string | null } {
  const idx = text.indexOf(MESSAGE_2_DELIMITER);
  if (idx === -1) return { message1: text.trim(), message2: null };
  return {
    message1: text.slice(0, idx).trim(),
    message2: text.slice(idx + MESSAGE_2_DELIMITER.length).trim(),
  };
}

function formatNeighbor(neighbor: NeighborPlacement | null): string {
  if (!neighbor) return "the edge of the leaderboard";
  return `${neighbor.name} (${neighbor.effort ?? "default"})`;
}

function formatPlacementLine(label: string, placement: Omit<IndexPlacement, "index">): string {
  const levels = placement.levels
    .map((l) => `${l.effort ?? "default"} ${l.score} (#${l.rank})`)
    .join(" · ");
  const anchor = placement.isTop
    ? `🥇 highest tested, ahead of ${formatNeighbor(placement.lowerNeighbor)}`
    : `best level between ${formatNeighbor(placement.higherNeighbor)} and ${formatNeighbor(placement.lowerNeighbor)}`;
  return `${label}: #${placement.bestRank} of ${placement.n} — ${levels}; ${anchor}`;
}

function formatPlacementsForPrompt(
  placements: ModelPlacements | null,
  unavailableReason: string | null,
): string {
  if (!placements && unavailableReason) {
    return `Artificial Analysis leaderboard could not be checked this run (${unavailableReason}). Do not say the model is "not yet listed" — say independent benchmark placement is unavailable for this run.`;
  }
  if (!placements || !placements.onAA) {
    return "Not yet listed on Artificial Analysis.";
  }

  const lines: string[] = [];
  for (const index of AA_CAPABILITY_INDICES) {
    const label = `${index[0]!.toUpperCase()}${index.slice(1)} Index`;
    const idx = placements.indices.find((i) => i.index === index);
    if (idx) {
      lines.push(formatPlacementLine(label, idx));
    } else {
      lines.push(`${label}: not yet reported by Artificial Analysis for this model.`);
    }
  }

  if (placements.deepswe.status === "tested") {
    lines.push(formatPlacementLine("DeepSWE", placements.deepswe));
  } else {
    lines.push("DeepSWE: not yet tested by Artificial Analysis for this model.");
  }

  const { pricing } = placements;
  if (pricing.model) {
    const parts = [`Pricing: input $${pricing.model.inputPerMtok ?? "[placeholder]"} / output $${pricing.model.outputPerMtok ?? "[placeholder]"} per Mtok`];
    if (pricing.vsHigherNeighbor) {
      const direction = pricing.vsHigherNeighbor.cheaper ? "cheaper" : "more expensive";
      parts.push(`vs ${pricing.vsHigherNeighbor.neighborName} (higher neighbor): ${direction} by $${Math.abs(pricing.vsHigherNeighbor.deltaBlended).toFixed(2)} blended`);
    }
    if (pricing.vsLowerNeighbor) {
      const direction = pricing.vsLowerNeighbor.cheaper ? "cheaper" : "more expensive";
      parts.push(`vs ${pricing.vsLowerNeighbor.neighborName} (lower neighbor): ${direction} by $${Math.abs(pricing.vsLowerNeighbor.deltaBlended).toFixed(2)} blended`);
    }
    if (pricing.vsFlagship) {
      const direction = pricing.vsFlagship.cheaper ? "cheaper" : "more expensive";
      parts.push(`vs ${pricing.vsFlagship.flagshipName} (lab flagship): ${direction} by $${Math.abs(pricing.vsFlagship.deltaBlended).toFixed(2)} blended`);
    }
    lines.push(parts.join("; "));
  }

  return lines.join("\n");
}

function buildFinalWriterUserPrompt(evidencePacket: EvidencePacket, verifierFeedback?: VerifierFinding[]): string {
  const allowedBenchmarkClaims = formatAllowedBenchmarkClaims(evidencePacket.claims);
  const feedback = formatVerifierFeedback(verifierFeedback);
  const placementsText = formatPlacementsForPrompt(
    evidencePacket.placements,
    evidencePacket.placementsUnavailableReason,
  );

  return `Lab: ${evidencePacket.lab}
Lab emoji (use this exact character for {lab_emoji}): ${getLabEmoji(evidencePacket.lab)}
Models: ${evidencePacket.modelNames.join(", ")}
Release Date: ${evidencePacket.releaseDate ?? "Unknown"}
Official Article: ${evidencePacket.articleUrl}
API availability: ${evidencePacket.availability.api}
Subscription availability: ${evidencePacket.availability.subscription}
System card status: ${evidencePacket.systemCardStatus}

Artificial Analysis placement data (use this, and only this, for Benchmarks rows and rank/price claims):
${placementsText}

Allowed Benchmark Claims: (vendor/system-card claims independent of Artificial Analysis)
${allowedBenchmarkClaims}

Article Summary:
${evidencePacket.articleSummary}

System Card Summary:
${evidencePacket.systemCardSummary}

Evidence Synthesis:
${evidencePacket.evidenceSynthesis.slice(0, 4000)}

Additional references:
${evidencePacket.references.slice(0, 6).map((r) => `- ${r.kind}: ${r.url}`).join("\n")}

${feedback}

Write the two-message Telegram announcement now.`;
}

export async function runFinalWriter(
  input: FinalWriterInput,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<FinalWriterOutput> {
  const { evidencePacket } = input;

  // The final writer receives only the sealed evidence packet — no fetch/browser tools
  const userPrompt = buildFinalWriterUserPrompt(evidencePacket, input.verifierFeedback);

  const completion = await completeWithBudget(router, tracker, "final_writer", [
    { role: "system", content: FINAL_WRITER_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  const split = splitWriterOutput(completion.text);
  if (split.message2) {
    return { message1: split.message1, message2: split.message2 };
  }

  // Missing delimiter, or delimiter present with nothing after it: treat the
  // whole output as message 1 and regenerate message 2 once (writer contract
  // rule 1 — two messages by default).
  const message2Completion = await completeWithBudget(router, tracker, "final_writer", [
    { role: "system", content: MESSAGE_2_ONLY_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);
  const message2Split = splitWriterOutput(message2Completion.text);

  return { message1: split.message1, message2: message2Split.message1 };
}

function formatAllowedBenchmarkClaims(claims: BenchmarkClaim[]): string {
  if (claims.length === 0) {
    return "None. The final message must avoid named benchmark claims, scores, rankings, and model-vs-model comparisons.";
  }

  return claims
    .slice(0, 12)
    .map((claim) => {
      const value = claim.value ? `: ${claim.value}` : "";
      const source = claim.sourceUrl ? ` (${claim.source}, ${claim.sourceUrl})` : ` (${claim.source})`;
      return `- ${claim.name}${value}; status=${claim.status}${source}`;
    })
    .join("\n");
}

function formatVerifierFeedback(findings: VerifierFinding[] | undefined): string {
  if (!findings || findings.length === 0) return "";

  const lines = findings
    .filter((finding) => finding.severity === "block")
    .slice(0, 8)
    .map((finding) => `- ${finding.issue}: ${finding.claim} — ${finding.detail}`);

  if (lines.length === 0) return "";

  return `Previous draft was rejected by the verifier. Rewrite from scratch and remove or correct every blocked claim:
${lines.join("\n")}`;
}

function buildVerifierSafeFallbackMessage(evidencePacket: EvidencePacket): FinalWriterOutput {
  const models = evidencePacket.modelNames.slice(0, 6);
  const modelText = models.length > 0 ? models.join(", ") : "new model";
  const sourceUrls = [
    evidencePacket.articleUrl,
    ...evidencePacket.references
      .map((ref) => ref.url)
      .filter((url) => url !== evidencePacket.articleUrl),
  ].slice(0, 6);

  const benchmarkContext = evidencePacket.claims.length > 0
    ? evidencePacket.claims
        .slice(0, 6)
        .map((claim) => {
          const value = claim.value ? ` ${claim.value}` : "";
          return `- ${claim.name}${value} from ${claim.source}; status ${claim.status}`;
        })
        .join("\n")
    : "Structured benchmark evidence was not extracted. Independent benchmark verification is unavailable.";

  const safetyNotes = evidencePacket.systemCardStatus === "found"
    ? "A related system or technical document was found in the evidence packet. Safety conclusions should be checked against the linked source."
    : "No system card, safety card, or technical report was found for this release.";

  const message1 = [
    `${evidencePacket.lab} model release`,
    `Models: ${modelText}`,
    `Release date: ${evidencePacket.releaseDate ?? "Unknown"}`,
    "",
    "Summary:",
    `The official article announces ${modelText}. The extracted evidence describes release details, access paths, and available source links.`,
    "",
    "Where it may be useful:",
    "- API or product access is described by the official source.",
    "- Architecture, deployment, or availability details are present in the extracted evidence.",
    "",
    "Benchmark context:",
    benchmarkContext,
    "",
    "Safety/system notes:",
    safetyNotes,
    "",
    "Known weaknesses and unknowns:",
    "- Independent benchmark verification is unavailable unless listed above.",
    "- Safety evaluations, limitations, pricing, and failure modes may be incomplete in the extracted evidence.",
    "",
    "Sources:",
    ...sourceUrls,
  ].join("\n").slice(0, 3800);

  const message2 = [
    `${modelText} — full breakdown`,
    "",
    "In-depth summary:",
    evidencePacket.evidenceSynthesis || evidencePacket.articleSummary || "No further detail available.",
    "",
    "System card:",
    safetyNotes,
  ].join("\n").slice(0, 3800);

  return { message1, message2 };
}

// ─── Verifier ─────────────────────────────────────────────────────────────────

const SAFETY_INVENTION_PATTERNS = [
  /\b(red.?team|jailbreak|constitutional ai|harmless|helpful|honest)\b/i,
  /\b(rlhf|reinforcement learning from human feedback)\b/i,
  /\b(safety eval|safety score|dangerous capability)\b/i,
];

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

// Wrapped in [brackets] means the writer flagged the value as unverified
// (writer contract rule 10) — exempt from support checks by design.
const PLACEHOLDER_SPAN_PATTERN = /\[[^[\]\n]*\]/g;

function stripPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_SPAN_PATTERN, "");
}

const CAPABILITY_INDEX_BY_LABEL: Record<string, AACapabilityIndex> = {
  intelligence: "intelligence",
  coding: "coding",
  math: "math",
  agentic: "agentic",
};

function findIndexPlacementByLabel(placements: ModelPlacements, label: string): IndexPlacement | undefined {
  const key = label.trim().toLowerCase().replace(/\s+index$/, "");
  const index = CAPABILITY_INDEX_BY_LABEL[key];
  if (!index) return undefined;
  return placements.indices.find((p) => p.index === index);
}

// Matches the writer contract's mandatory row shape:
// "• {Benchmark}: #{rank} of {n} — {levels}; {placement}" (rule 7).
const PLACEMENT_ROW_PATTERN = /(?:^|\n)\s*(?:•|🥇)?\s*([A-Za-z][A-Za-z0-9 ]*?):\s*(?:🥇\s*)?#(\d+)\s+of\s+(\d+)/g;

// A full "• {Benchmark}: ..." row line, used to exclude the Benchmarks section
// (validated separately by checkBenchmarkClaims below) from generic
// superlative-language scanning — its mandated "best level between X and Y"
// anchor phrasing would otherwise false-positive as an unsupported claim.
const PLACEMENT_ROW_LINE_PATTERN = /^[ \t]*(?:•|🥇)[^\n]*$/gm;

// Benchmark/rank claims verify against the computed `placements` struct (name,
// score, rank, neighbors) rather than free-text matching — placements are the
// only source of truth for AA-derived numbers (writer contract rule 6-9).
// [placeholder]-wrapped values are stripped first and therefore never checked.
function checkBenchmarkClaims(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  const findings: VerifierFinding[] = [];
  const stripped = stripPlaceholders(stripMessage2(message));
  const { placements } = evidencePacket;

  let match: RegExpExecArray | null;
  const pattern = new RegExp(PLACEMENT_ROW_PATTERN.source, "g");

  while ((match = pattern.exec(stripped)) !== null) {
    const label = match[1]!.trim();
    const rank = Number(match[2]);
    const n = Number(match[3]);
    const claimText = `${label}: #${rank} of ${n}`;

    if (!placements || !placements.onAA) {
      findings.push({
        claim: claimText,
        issue: "unsupported_benchmark",
        detail: `Benchmark row "${claimText}" asserts a real Artificial Analysis rank, but the evidence packet has no placement data for this model.`,
        severity: "block",
      });
      continue;
    }

    if (/deepswe/i.test(label)) {
      const deepswe = placements.deepswe;
      const matches = deepswe.status === "tested" && deepswe.bestRank === rank && deepswe.n === n;
      if (!matches) {
        findings.push({
          claim: claimText,
          issue: "unsupported_benchmark",
          detail: `DeepSWE row "${claimText}" does not match the computed placements data.`,
          severity: "block",
        });
      }
      continue;
    }

    const indexPlacement = findIndexPlacementByLabel(placements, label);
    if (!indexPlacement || indexPlacement.bestRank !== rank || indexPlacement.n !== n) {
      findings.push({
        claim: claimText,
        issue: "unsupported_benchmark",
        detail: `Benchmark row "${claimText}" does not match the computed placements data for "${label}".`,
        severity: "block",
      });
    }
  }

  return findings;
}

// A "X beats it" claim is only supported if X is actually ranked above the
// release (a higherNeighbor) in some index — a lowerNeighbor is a model the
// release itself beats, so it must not validate the opposite claim.
function collectBeatsNames(placements: ModelPlacements | null): Set<string> {
  const names = new Set<string>();
  if (!placements) return names;

  for (const idx of placements.indices) {
    if (idx.higherNeighbor) names.add(idx.higherNeighbor.name.toLowerCase());
  }
  if (placements.deepswe.status === "tested" && placements.deepswe.higherNeighbor) {
    names.add(placements.deepswe.higherNeighbor.name.toLowerCase());
  }

  return names;
}

// A "X is cheaper" / "cheaper than X" claim is only supported if X is one of
// the pricing comparisons shown to the writer — the lab flagship or either
// rank neighbor (formatPlacementsForPrompt surfaces all three) — and the
// computed delta actually matches the claimed direction: "X is cheaper"
// asserts the *other* model (X) undercuts the release, i.e. the release is
// NOT cheaper than X; "cheaper than X" asserts the release itself undercuts X.
function isCheaperClaimSupported(
  name: string,
  placements: ModelPlacements | null,
  releaseIsCheaperClaim: boolean,
): boolean {
  const pricing = placements?.pricing;
  if (!pricing) return false;
  const nameLower = name.toLowerCase();

  const candidates: (PricingDelta & { subjectName: string })[] = [];
  if (pricing.vsFlagship) candidates.push({ ...pricing.vsFlagship, subjectName: pricing.vsFlagship.flagshipName });
  if (pricing.vsHigherNeighbor) candidates.push({ ...pricing.vsHigherNeighbor, subjectName: pricing.vsHigherNeighbor.neighborName });
  if (pricing.vsLowerNeighbor) candidates.push({ ...pricing.vsLowerNeighbor, subjectName: pricing.vsLowerNeighbor.neighborName });

  const match = candidates.find((c) => c.subjectName.toLowerCase() === nameLower);
  if (!match) return false;
  return releaseIsCheaperClaim ? match.cheaper : !match.cheaper;
}

function extractVerdictText(message: string): string {
  const match = message.match(/<b>Verdict\.<\/b>\s*([\s\S]*?)(?:<b>Facts\.<\/b>|$)/i);
  return match ? match[1]! : message;
}

// Index of the nearest sentence-ending punctuation before `before`, or -1 if
// none. Requires trailing whitespace so a decimal point (e.g. "52.0%") is
// never mistaken for a sentence boundary the way a plain lastIndexOf(".")
// would be.
function lastSentenceBoundary(text: string, before: number): number {
  const boundary = /[.!?](?=\s)/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text)) !== null) {
    if (m.index >= before) break;
    last = m.index;
  }
  return last;
}

const BEATS_PAIRING_PATTERN = /\b([A-Z][A-Za-z0-9.\- ]{1,40}?)\s+beats\s+(?:it|this model)\b/g;

// A bounded model-name token: a word (letters/digits/hyphens, optional decimal
// suffix like "5.2") or a bare number with optional decimal (e.g. "4.8"). Used
// instead of a generic "any capitalized text" run so a trailing sentence period
// is never swallowed into the captured name (only a digit.digit decimal is).
const NAME_TOKEN = "(?:[A-Za-z][A-Za-z0-9\\-]*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
const MODEL_NAME = `[A-Z][A-Za-z0-9\\-]*(?:\\.\\d+)?(?:\\s+${NAME_TOKEN}){0,3}`;
// The "cheaper than X" alternative must be tried before "X is cheaper" can
// claim the same text, so it needs the negative lookahead below: without it,
// a self-referential lead-in like "This release is cheaper than Opus 4.8"
// lets "X is cheaper" match "This release is cheaper" first, consuming the
// text before the "than Opus 4.8" clause is ever reached.
const CHEAPER_PAIRING_PATTERN = new RegExp(
  `\\b(${MODEL_NAME})\\s+is\\s+cheaper(?!\\s+than\\b)\\b|\\bcheaper\\s+than\\s+(${MODEL_NAME})`,
  "g",
);

// Matches the coordinated-clause idiom "X beats it ... and is cheaper ..."
// (used in the spec's own verdict mockup), where the pricing half elides the
// subject rather than repeating it. CHEAPER_PAIRING_PATTERN requires an
// explicit name immediately before "is cheaper", so it never sees this claim
// at all — neither approved nor blocked. The negative lookahead mirrors
// CHEAPER_PAIRING_PATTERN's so an explicitly-named "...and is cheaper than Y"
// clause (handled by the explicit pattern) isn't double-counted here.
const ELIDED_CHEAPER_PATTERN = /\band\s+(?:is|remains)\s+cheaper(?!\s+than\b)\b/gi;

function checkVerdictSupported(
  message: string,
  evidencePacket: EvidencePacket,
): VerifierFinding[] {
  const findings: VerifierFinding[] = [];
  const verdictText = stripPlaceholders(extractVerdictText(message));
  const beatsNames = collectBeatsNames(evidencePacket.placements);

  let match: RegExpExecArray | null;

  const beatsMatches: { name: string; end: number }[] = [];
  const beatsPattern = new RegExp(BEATS_PAIRING_PATTERN.source, "g");
  while ((match = beatsPattern.exec(verdictText)) !== null) {
    const name = match[1]!.trim();
    beatsMatches.push({ name, end: match.index + match[0].length });
    if (!name || beatsNames.has(name.toLowerCase())) continue;
    findings.push({
      claim: `${name} beats it`,
      issue: "unsupported_benchmark",
      detail: `Verdict claims "${name} beats it" but "${name}" is not ranked above the release in the Artificial Analysis placements data.`,
      severity: "block",
    });
  }

  const cheaperPattern = new RegExp(CHEAPER_PAIRING_PATTERN.source, "g");
  while ((match = cheaperPattern.exec(verdictText)) !== null) {
    const name = (match[1] ?? match[2] ?? "").trim();
    const releaseIsCheaperClaim = match[2] !== undefined;
    if (!name || isCheaperClaimSupported(name, evidencePacket.placements, releaseIsCheaperClaim)) continue;
    findings.push({
      claim: `cheaper — ${name}`,
      issue: "unsupported_benchmark",
      detail: `Verdict makes a pricing comparison involving "${name}" but the placements/pricing data does not support that direction of comparison.`,
      severity: "block",
    });
  }

  const elidedPattern = new RegExp(ELIDED_CHEAPER_PATTERN.source, "gi");
  while ((match = elidedPattern.exec(verdictText)) !== null) {
    const sentenceStart = lastSentenceBoundary(verdictText, match.index);
    const subject = [...beatsMatches].reverse().find((b) => b.end <= match!.index && b.end > sentenceStart);
    if (!subject || !subject.name) continue;
    if (isCheaperClaimSupported(subject.name, evidencePacket.placements, false)) continue;
    findings.push({
      claim: `cheaper — ${subject.name}`,
      issue: "unsupported_benchmark",
      detail: `Verdict makes a pricing comparison involving "${subject.name}" but the placements/pricing data does not support that direction of comparison.`,
      severity: "block",
    });
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
  const urlPattern = /https?:\/\/[^\s)"<>]+/g;
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

// checkUnsupportedStrengths (below) unconditionally excludes every •/🥇 row
// line from the generic superlative scan, on the assumption that
// checkBenchmarkClaims already validated it. That's only true for lines that
// actually match a mandated Benchmarks-section shape — the rank-row shape, or
// one of the two literal "not yet reported/tested" fallback lines (rule 9). A
// malformed row (e.g. a hallucinated superlative dressed up as a bullet, with
// no real rank) would otherwise be invisible to both checks: excluded from
// checkBenchmarkClaims by regex mismatch, and excluded from
// checkUnsupportedStrengths by the blanket line-strip. This flags any such
// row directly so it can't bypass verification.
const PLACEMENT_ROW_RANK_SHAPE = /^[ \t]*(?:•|🥇)\s*(?:🥇\s*)?[A-Za-z][A-Za-z0-9 ]*?:\s*(?:🥇\s*)?#\d+\s+of\s+\d+\b/;
const PLACEMENT_ROW_FALLBACK_SHAPE = /^[ \t]*•\s*[A-Za-z][A-Za-z0-9 ]*?:\s*not yet (?:reported|tested) by Artificial Analysis for this model\.\s*$/;

function isWellFormedPlacementRow(line: string): boolean {
  // Rank/n may legitimately be [placeholder]-wrapped (rule 10); substitute a
  // digit so the shape check still passes without re-checking the value —
  // checkBenchmarkClaims/stripPlaceholders already own value verification.
  const withPlaceholdersZeroed = line.replace(PLACEHOLDER_SPAN_PATTERN, "0");
  return PLACEMENT_ROW_RANK_SHAPE.test(withPlaceholdersZeroed) || PLACEMENT_ROW_FALLBACK_SHAPE.test(line);
}

// Message 2's 🛡 system-card deep dive is mandated to use its own bold-tagged
// bullets (e.g. "• <b>Alignment.</b> ..."), which are not placement rows and
// must never be checked against the rank/fallback shape. "↩️" is the literal,
// mandatory opening of message 2 in both writer templates and never appears
// in message 1, so drop everything from that marker onward before scanning
// for placement rows — this excludes message 2's bullets without requiring
// message 1's own section markers (e.g. 📊) to be present, which lets
// existing minimal message-1-only test fixtures keep working unchanged.
const MESSAGE_2_MARKER_PATTERN = /\n?↩️[\s\S]*$/;

function stripMessage2(message: string): string {
  return message.replace(MESSAGE_2_MARKER_PATTERN, "");
}

function checkMalformedPlacementRows(message: string): VerifierFinding[] {
  const findings: VerifierFinding[] = [];
  const message1Only = stripMessage2(message);
  const lines =
    message1Only.match(new RegExp(PLACEMENT_ROW_LINE_PATTERN.source, PLACEMENT_ROW_LINE_PATTERN.flags)) ?? [];

  for (const line of lines) {
    if (!isWellFormedPlacementRow(line)) {
      findings.push({
        claim: line.trim(),
        issue: "unsupported_benchmark",
        detail: `Benchmark row "${line.trim()}" does not match the mandated "Label: #rank of n" shape (or the "not yet reported/tested" fallback) and cannot be verified.`,
        severity: "block",
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
  // Only Message 1's mandated Benchmarks rows should be excluded from this
  // scan (they're validated separately by checkBenchmarkClaims); Message 2's
  // bold-tagged bullets also start with "•" but are free-text prose that must
  // still be scanned for unsupported superlatives, so strip placement rows
  // from message 1 only rather than blanket-stripping every bullet line.
  const message1Only = stripMessage2(message);
  const message2Only = message.slice(message1Only.length);
  const scanned = message1Only.replace(PLACEMENT_ROW_LINE_PATTERN, "") + message2Only;
  const claims = extractClaimsFromMessage(scanned);

  for (const claim of claims) {
    const hasStrongLanguage = /\b(best|state.of.the.art|sota|outperform|surpass|exceed|dominat|beats?|rivals?|trails?)\w*/i.test(claim);
    if (!hasStrongLanguage) continue;

    if (
      evidencePacket.claims.length === 0 &&
      /\b(benchmark|model|open[- ]source|closed[- ]source|rank|leaderboard|sota|state.of.the.art)\b/i.test(claim)
    ) {
      findings.push({
        claim,
        issue: "unsupported_strength",
        detail: `Comparative benchmark or ranking claim "${claim.slice(0, 100)}" requires at least one structured benchmark claim in the evidence packet.`,
        severity: "block",
      });
      continue;
    }

    if (!isSuperlativeClaimSupportedByEvidence(claim, evidencePacket)) {
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

export function runVerifier(input: VerifierInput): VerifierOutput {
  const { message, evidencePacket } = input;

  const findings: VerifierFinding[] = [
    ...checkBenchmarkClaims(message, evidencePacket),
    ...checkMalformedPlacementRows(message),
    ...checkSafetyInvention(message, evidencePacket),
    ...checkSourceUrls(message, evidencePacket),
    ...checkStaleArticleUrl(message, evidencePacket),
    ...checkUnsupportedStrengths(message, evidencePacket),
    ...checkVerdictSupported(message, evidencePacket),
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
  // Pre-fetched Artificial Analysis leaderboard (Task 3's fetchAALeaderboard).
  // When omitted or not ok, placements fall through to the "not yet listed"
  // fallback rather than being fabricated.
  leaderboard?: AALeaderboardResult;
  // Pre-computed release-classifier verdict. Callers that must run the
  // classifier before doing any evidence gathering of their own (e.g. before
  // deciding whether to fetch system cards / benchmark evidence / the AA
  // leaderboard at all) should call runReleaseClassifier themselves and pass
  // the result here so Step 0 below doesn't redo the LLM call. When omitted,
  // Step 0 runs the classifier itself.
  classifierOutput?: ReleaseClassifierOutput;
};

export type OrchestratorResult = {
  evidencePacket: EvidencePacket;
  // Alert-card message (message1), kept for callers of the pre-v2.2 single-message
  // pipeline (e.g. buildReleaseNote). New callers should prefer message1/message2.
  finalMessage: string;
  message1: string;
  message2: string;
  verifierOutput: VerifierOutput;
  approved: boolean;
  rejected: boolean;
  classifierOutput: ReleaseClassifierOutput;
};

function buildRejectedEvidencePacket(
  articleUrl: string,
  article: ExtractedArticle,
  classifierOutput: ReleaseClassifierOutput,
  tracker: CostTracker,
): EvidencePacket {
  const lab = extractLabFromUrl(article.finalUrl);
  return {
    lab,
    modelNames: classifierOutput.model_names,
    articleUrl,
    releaseDate: extractReleaseDateFromArticle(article),
    articleSummary: "",
    systemCardSummary: "",
    benchmarkSummary: "",
    evidenceSynthesis: "",
    claims: [],
    systemCardStatus: "not_found",
    references: [{ url: article.canonicalUrl ?? article.finalUrl, kind: "article", chunkIds: [] }],
    costTracker: tracker,
    placements: null,
    placementsUnavailableReason: null,
    availability: AVAILABILITY_PLACEHOLDER,
  };
}

export async function runAgentOrchestration(
  articleUrl: string,
  article: ExtractedArticle,
  systemCardResult: SystemCardResult,
  benchmarkEvidence: BenchmarkEvidence,
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { router, tracker } = options;

  // Step 0: AI release classifier — runs before any evidence gathering so
  // non-releases (feature launches, partnerships, pricing changes, research
  // posts, availability announcements) never reach the summarizers or writer.
  // Callers that gather their own evidence (system cards, benchmark
  // aggregation, AA leaderboard) before invoking orchestration must run the
  // classifier first and pass the result via options.classifierOutput, or
  // that evidence-gathering work happens unconditionally regardless of the
  // classifier's verdict.
  const classifierOutput = options.classifierOutput ?? await runReleaseClassifier(
    { title: article.title, articleText: article.body ?? "" },
    router,
    tracker,
  );

  if (!classifierOutput.is_new_model_release) {
    const evidencePacket = buildRejectedEvidencePacket(articleUrl, article, classifierOutput, tracker);
    const verifierOutput: VerifierOutput = {
      approved: false,
      findings: [
        {
          claim: classifierOutput.reason,
          issue: "other",
          detail: `Release classifier rejected this candidate: ${classifierOutput.reason}`,
          severity: "block",
        },
      ],
      checkedClaims: 0,
      unsupportedCount: 1,
    };

    return {
      evidencePacket,
      finalMessage: "",
      message1: "",
      message2: "",
      verifierOutput,
      approved: false,
      rejected: true,
      classifierOutput,
    };
  }

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

  // Placements come from the pre-fetched AA leaderboard (Task 3), never
  // fabricated: no leaderboard / not ok / model absent -> null -> writer
  // fallback line "Not yet listed on Artificial Analysis."
  const placements = options.leaderboard?.ok
    ? computePlacements(options.leaderboard.leaderboard, researcherOutput.modelNames)
    : null;
  const placementsUnavailableReason =
    options.leaderboard && !options.leaderboard.ok ? options.leaderboard.reason : null;

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
    placements,
    placementsUnavailableReason,
    availability: articleSummary.availability,
  };

  // Step 6: Evidence synthesizer (DeepSeek)
  const evidenceSynthesis = await runEvidenceSynthesizer(partialPacket, router, tracker);

  const evidencePacket: EvidencePacket = {
    ...partialPacket,
    evidenceSynthesis,
  };

  // Step 7: Final writer (OpenRouter Kimi) — receives sealed evidence packet only.
  let finalWriterOutput = await runFinalWriter({ evidencePacket }, router, tracker);

  // Step 8: Verifier runs independently after final writing, before any send.
  // Message 2 carries the fuller system-card/safety deep dive (the content most
  // likely to contain an invented safety claim), so it must be checked too —
  // not just message 1's alert card.
  const verifierMessage = (output: FinalWriterOutput): string =>
    output.message2 ? `${output.message1}\n${output.message2}` : output.message1;

  let verifierOutput = runVerifier({
    message: verifierMessage(finalWriterOutput),
    evidencePacket,
  });

  if (!verifierOutput.approved) {
    finalWriterOutput = await runFinalWriter(
      { evidencePacket, verifierFeedback: verifierOutput.findings },
      router,
      tracker,
    );
    verifierOutput = runVerifier({
      message: verifierMessage(finalWriterOutput),
      evidencePacket,
    });
  }

  if (!verifierOutput.approved) {
    finalWriterOutput = buildVerifierSafeFallbackMessage(evidencePacket);
    verifierOutput = runVerifier({
      message: verifierMessage(finalWriterOutput),
      evidencePacket,
    });
  }

  return {
    evidencePacket,
    finalMessage: finalWriterOutput.message1,
    message1: finalWriterOutput.message1,
    message2: finalWriterOutput.message2,
    verifierOutput,
    approved: verifierOutput.approved,
    rejected: false,
    classifierOutput,
  };
}
