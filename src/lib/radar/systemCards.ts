import type { FetchOptions } from "./types";
import type { FetchImpl } from "./fetching";
import { fetchUrl, extractCanonicalUrl } from "./fetching";
import { stripTags, normalizeWhitespace } from "./text";

export type EvidenceDocumentKind =
  | "system_card"
  | "model_card"
  | "safety_card"
  | "technical_report"
  | "pdf"
  | "model_repo"
  | "model_docs";

export type EvidenceTopic =
  | "overview"
  | "capabilities"
  | "benchmarks_evals"
  | "safety"
  | "misuse_limitations"
  | "deployment"
  | "data_training"
  | "pricing_api"
  | "unknown_other";

export type EvidenceChunk = {
  chunkId: string;
  sourceUrl: string;
  topic: EvidenceTopic;
  pageNumber: number | null;
  text: string;
};

export type EvidenceDocument = {
  url: string;
  canonicalUrl: string | null;
  kind: EvidenceDocumentKind;
  title: string | null;
  chunks: EvidenceChunk[];
  fetchStatus: "ok" | "failed" | "skipped";
  fetchError?: string;
};

export type EvidenceLinkDetection = {
  url: string;
  anchorText: string | null;
  kind: EvidenceDocumentKind;
  confidence: "high" | "medium" | "low";
};

export type SystemCardResult = {
  system_card_status: "found" | "not_found";
  detected: EvidenceLinkDetection[];
  documents: EvidenceDocument[];
};

export type SystemCardOptions = FetchOptions & {
  fetchImpl?: FetchImpl;
  maxDocuments?: number;
  maxChunkLength?: number;
};

const MAX_CHUNK_LENGTH_DEFAULT = 3000;
const MAX_DOCUMENTS_DEFAULT = 6;

// --- Internal helpers ---

function extractLinksWithAnchorText(
  html: string,
  baseUrl: string,
): Array<{ url: string; anchorText: string | null }> {
  const matches = [...html.matchAll(/<a[^>]+href=["']([^"'#][^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set<string>();
  const links: Array<{ url: string; anchorText: string | null }> = [];

  for (const match of matches) {
    try {
      const resolved = new URL(match[1]!, baseUrl).href;
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const anchorText = stripTags(match[2] ?? "").trim() || null;
      links.push({ url: resolved, anchorText });
    } catch {
      // skip invalid URLs
    }
  }

  return links;
}

function classifyLink(
  url: string,
  anchorText: string | null,
): { kind: EvidenceDocumentKind; confidence: "high" | "medium" | "low" } | null {
  const urlLower = url.toLowerCase();
  const anchor = (anchorText ?? "").toLowerCase();

  // PDF by extension (always detected)
  if (/\.pdf(\?[^"']*)?$/i.test(url)) {
    return { kind: "pdf", confidence: "high" };
  }

  // System card: URL pattern takes priority
  if (/system[-_]card/.test(urlLower) || /usage[-_]polic/.test(urlLower)) {
    return { kind: "system_card", confidence: "high" };
  }
  // Model card URL pattern
  if (/model[-_]card/.test(urlLower)) {
    return { kind: "model_card", confidence: "high" };
  }
  // System/model card by anchor text
  if (/system card/.test(anchor) || /usage policy/.test(anchor)) {
    return { kind: "system_card", confidence: "medium" };
  }
  if (/model card/.test(anchor)) {
    return { kind: "model_card", confidence: "medium" };
  }

  // Safety card: URL pattern
  if (/safety[-_]card/.test(urlLower) || /safety[-_]report/.test(urlLower) || /safety[-_]eval/.test(urlLower)) {
    return { kind: "safety_card", confidence: "high" };
  }
  // Safety card by anchor text
  if (/safety card/.test(anchor) || /safety report/.test(anchor) || /safety eval/.test(anchor) || /safety assess/.test(anchor)) {
    return { kind: "safety_card", confidence: "medium" };
  }

  // Technical report: arxiv is unambiguous
  if (/arxiv\.org\/abs\//.test(url)) {
    return { kind: "technical_report", confidence: "high" };
  }
  // Technical report: URL keywords
  if (/technical[-_]report/.test(urlLower) || /tech[-_]report/.test(urlLower)) {
    return { kind: "technical_report", confidence: "high" };
  }
  // Technical report: anchor keywords
  if (
    /technical report/.test(anchor) ||
    /tech report/.test(anchor) ||
    /preprint/.test(anchor) ||
    (/\bpaper\b/.test(anchor) && !/wallpaper|newspaper/.test(anchor))
  ) {
    return { kind: "technical_report", confidence: "medium" };
  }

  // HuggingFace model pages
  const hfMatch = url.match(/huggingface\.co\/([^/?#]+)\/([^/?#]+)/);
  if (hfMatch) {
    if (!url.includes("/spaces/") && !url.includes("/datasets/") && !url.includes("/models?")) {
      // If anchor mentions weights/repo it's model_repo, otherwise model_card
      if (/weights|open.weights|model.repo/.test(anchor)) {
        return { kind: "model_repo", confidence: "high" };
      }
      return { kind: "model_card", confidence: "medium" };
    }
    return null;
  }

  // GitHub model repos (only when anchor explicitly mentions model-related terms)
  const ghMatch = url.match(/github\.com\/([^/?#]+)\/([^/?#]+)/);
  if (ghMatch && /weights|repo|code|source|model/.test(anchor)) {
    return { kind: "model_repo", confidence: "medium" };
  }

  // Model docs (only when clearly related to a model)
  if (/^https?:\/\/docs\./i.test(url) || /\/docs\//i.test(url)) {
    if (/model|api|reference/.test(anchor) || /model|api|reference/.test(urlLower)) {
      return { kind: "model_docs", confidence: "low" };
    }
  }

  return null;
}

// --- Exported detection ---

export function detectEvidenceLinks(html: string, baseUrl: string): EvidenceLinkDetection[] {
  const links = extractLinksWithAnchorText(html, baseUrl);
  const seen = new Set<string>();
  const detections: EvidenceLinkDetection[] = [];

  for (const { url, anchorText } of links) {
    if (seen.has(url)) continue;
    const result = classifyLink(url, anchorText);
    if (result) {
      seen.add(url);
      detections.push({ url, anchorText, ...result });
    }
  }

  return detections;
}

// --- Topic classification ---

export function classifyTopic(heading: string): EvidenceTopic {
  const h = heading.toLowerCase();

  // Safety takes priority (even if "eval" also appears)
  if (
    h.includes("safety") ||
    h.includes("red team") ||
    h.includes("jailbreak") ||
    h.includes("responsible ai") ||
    h.includes("alignment") ||
    h.includes("guardrail") ||
    h.includes("dangerous capability") ||
    h.includes("audit") ||
    h.includes("misuse prevention") ||
    h.includes("harm")
  ) {
    return "safety";
  }

  if (
    h.includes("benchmark") ||
    h.includes("eval") ||
    h.includes("mmlu") ||
    h.includes("humaneval") ||
    h.includes("gpqa") ||
    h.includes("gsm8k") ||
    h.includes("hellaswag") ||
    h.includes("swebench") ||
    h.includes("score") ||
    h.includes("accuracy") ||
    h.includes("metric") ||
    h.includes("result")
  ) {
    return "benchmarks_evals";
  }

  if (
    h.includes("limitation") ||
    h.includes("constraint") ||
    h.includes("caveat") ||
    h.includes("known issue") ||
    h.includes("failure mode") ||
    h.includes("weakness") ||
    h.includes("not suitable")
  ) {
    return "misuse_limitations";
  }

  if (
    h.includes("pricing") ||
    h.includes("price") ||
    h.includes("cost") ||
    h.includes("billing") ||
    h.includes("tier") ||
    h.includes("subscription")
  ) {
    return "pricing_api";
  }

  if (
    h.includes("deployment") ||
    h.includes("availability") ||
    h.includes("available") ||
    h.includes("api") ||
    h.includes("model id") ||
    h.includes("rate limit") ||
    h.includes("context window") ||
    h.includes("endpoint") ||
    h.includes("integration") ||
    h.includes("release")
  ) {
    return "deployment";
  }

  if (
    h.includes("training") ||
    h.includes("dataset") ||
    h.includes("pre-train") ||
    h.includes("fine-tun") ||
    h.includes("rlhf") ||
    h.includes("corpus") ||
    h.includes("data")
  ) {
    return "data_training";
  }

  if (
    h.includes("capabilit") ||
    h.includes("feature") ||
    h.includes("use case") ||
    h.includes("function") ||
    h.includes("skill") ||
    h.includes("task")
  ) {
    return "capabilities";
  }

  if (
    h.includes("overview") ||
    h.includes("introduction") ||
    h.includes("summary") ||
    h.includes("about") ||
    h.includes("background")
  ) {
    return "overview";
  }

  return "unknown_other";
}

// --- Chunking ---

function makeUrlSlug(url: string): string {
  try {
    const parsed = new URL(url);
    return (parsed.hostname + parsed.pathname)
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
  } catch {
    return url.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 60);
  }
}

export function chunkDocument(
  html: string,
  sourceUrl: string,
  maxChunkLength: number = MAX_CHUNK_LENGTH_DEFAULT,
): EvidenceChunk[] {
  const urlSlug = makeUrlSlug(sourceUrl);
  const chunks: EvidenceChunk[] = [];
  let chunkIndex = 0;

  const headingRe = /<h([1-4])[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  const allMatches = [...html.matchAll(headingRe)];

  if (allMatches.length === 0) {
    const text = normalizeWhitespace(stripTags(html)).slice(0, maxChunkLength);
    if (text) {
      chunks.push({
        chunkId: `${urlSlug}_overview_${chunkIndex++}`,
        sourceUrl,
        topic: "overview",
        pageNumber: null,
        text,
      });
    }
    return chunks;
  }

  // Content before first heading
  const firstIdx = allMatches[0]!.index!;
  if (firstIdx > 0) {
    const preText = normalizeWhitespace(stripTags(html.slice(0, firstIdx))).slice(0, maxChunkLength);
    if (preText.length > 20) {
      chunks.push({
        chunkId: `${urlSlug}_overview_${chunkIndex++}`,
        sourceUrl,
        topic: "overview",
        pageNumber: null,
        text: preText,
      });
    }
  }

  for (let i = 0; i < allMatches.length; i++) {
    const match = allMatches[i]!;
    const headingText = stripTags(match[2] ?? "").trim();
    const topic = classifyTopic(headingText);

    const headingEnd = match.index! + match[0].length;
    const nextStart = i + 1 < allMatches.length ? allMatches[i + 1]!.index! : html.length;
    const sectionHtml = html.slice(headingEnd, nextStart);
    const sectionText = normalizeWhitespace(stripTags(sectionHtml));

    if (!headingText && !sectionText) continue;

    const headingPrefix = headingText ? `${headingText}\n\n` : "";
    const available = maxChunkLength - headingPrefix.length;

    if (sectionText.length <= Math.max(available, 0)) {
      const text = (headingPrefix + sectionText).trim();
      if (text) {
        chunks.push({
          chunkId: `${urlSlug}_${topic}_${chunkIndex++}`,
          sourceUrl,
          topic,
          pageNumber: null,
          text,
        });
      }
    } else {
      // First chunk includes heading prefix
      const first = (headingPrefix + sectionText.slice(0, Math.max(available, 100))).trim();
      chunks.push({
        chunkId: `${urlSlug}_${topic}_${chunkIndex++}`,
        sourceUrl,
        topic,
        pageNumber: null,
        text: first,
      });
      // Continuation chunks
      let offset = Math.max(available, 100);
      while (offset < sectionText.length) {
        const piece = sectionText.slice(offset, offset + maxChunkLength);
        chunks.push({
          chunkId: `${urlSlug}_${topic}_${chunkIndex++}`,
          sourceUrl,
          topic,
          pageNumber: null,
          text: piece,
        });
        offset += maxChunkLength;
      }
    }
  }

  return chunks;
}

// --- Document fetching ---

export async function fetchEvidenceDocument(
  detection: EvidenceLinkDetection,
  options: SystemCardOptions = {},
): Promise<EvidenceDocument> {
  const { fetchImpl, maxChunkLength = MAX_CHUNK_LENGTH_DEFAULT, ...fetchOptions } = options;

  try {
    const fetched = await fetchUrl(detection.url, { ...fetchOptions, fetchImpl });

    const contentTypeLower = fetched.contentType.toLowerCase();
    const isPdf =
      contentTypeLower.includes("application/pdf") ||
      /\.pdf(\?[^"']*)?$/i.test(detection.url);

    if (isPdf) {
      const raw = fetched.body.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
      const text =
        raw.length > 50
          ? raw.slice(0, maxChunkLength)
          : "PDF binary content — server-side extraction required for full text.";

      const urlSlug = makeUrlSlug(detection.url);
      return {
        url: detection.url,
        canonicalUrl: null,
        kind: detection.kind,
        title: null,
        chunks: [
          {
            chunkId: `${urlSlug}_unknown_other_0`,
            sourceUrl: detection.url,
            topic: "unknown_other",
            pageNumber: null,
            text,
          },
        ],
        fetchStatus: "ok",
      };
    }

    const canonicalUrl = extractCanonicalUrl(fetched.body, fetched.finalUrl);
    const ogTitle =
      fetched.body.match(
        /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      )?.[1] ??
      fetched.body.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i,
      )?.[1];
    const titleTagMatch = fetched.body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const rawTitle = ogTitle ?? titleTagMatch ?? null;
    const title = rawTitle ? stripTags(rawTitle).trim() : null;

    const chunks = chunkDocument(fetched.body, detection.url, maxChunkLength);

    return {
      url: detection.url,
      canonicalUrl,
      kind: detection.kind,
      title,
      chunks,
      fetchStatus: "ok",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url: detection.url,
      canonicalUrl: null,
      kind: detection.kind,
      title: null,
      chunks: [],
      fetchStatus: "failed",
      fetchError: message,
    };
  }
}

// --- Main entry point ---

const KIND_PRIORITY: Record<EvidenceDocumentKind, number> = {
  system_card: 0,
  safety_card: 1,
  technical_report: 2,
  model_card: 3,
  pdf: 4,
  model_repo: 5,
  model_docs: 6,
};

const CONFIDENCE_PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function extractSystemCards(
  articleHtml: string,
  baseUrl: string,
  options: SystemCardOptions = {},
): Promise<SystemCardResult> {
  const maxDocuments = options.maxDocuments ?? MAX_DOCUMENTS_DEFAULT;
  const detected = detectEvidenceLinks(articleHtml, baseUrl);

  if (detected.length === 0) {
    return { system_card_status: "not_found", detected: [], documents: [] };
  }

  const prioritized = [...detected].sort((a, b) => {
    const p = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (p !== 0) return p;
    return (CONFIDENCE_PRIORITY[a.confidence] ?? 2) - (CONFIDENCE_PRIORITY[b.confidence] ?? 2);
  });

  const toFetch = prioritized.slice(0, maxDocuments);
  const documents = await Promise.all(toFetch.map((det) => fetchEvidenceDocument(det, options)));

  const hasEvidence = documents.some(
    (d) =>
      d.fetchStatus === "ok" &&
      (d.kind === "system_card" ||
        d.kind === "safety_card" ||
        d.kind === "technical_report" ||
        d.kind === "model_card"),
  );

  return {
    system_card_status: hasEvidence ? "found" : "not_found",
    detected,
    documents,
  };
}
