import { evaluateArticleGate, type ArticleGateDecision } from "./articleGate";
import { extractModelNames, normalizeWhitespace, stripTags } from "./text";

export type EvidenceLinkKind = "system_card" | "model_card" | "technical_report" | "benchmark" | "docs";

export type EvidenceLink = {
  kind: EvidenceLinkKind;
  label: string;
  url: string;
};

export type ReleaseReplayCase = {
  id: string;
  provider: string;
  title: string;
  url: string;
  releaseDate: string;
  modelNames: string[];
  whereItShines: string[];
  strengths: string[];
  weaknessesUnknowns: string[];
  benchmarkContext: string[];
  safetySystemNotes: string[];
  evidenceLinks?: EvidenceLink[];
};

export type ArticleMetadata = {
  title?: string;
  releaseDate?: string;
  textSample?: string;
  evidenceLinks: EvidenceLink[];
};

export type VerifiedReleaseNote = {
  caseId: string;
  provider: string;
  title: string;
  sourceUrl: string;
  releaseDate: string;
  modelNames: string[];
  gate: ArticleGateDecision;
  verificationStatus: "verified" | "rejected";
  whereItShines: string[];
  strengths: string[];
  weaknessesUnknowns: string[];
  benchmarkContext: string[];
  safetySystemNotes: string[];
  evidenceLinks: EvidenceLink[];
};

export const defaultReplayReleaseIds = [
  "anthropic-claude-sonnet-5",
  "mistral-small-4",
  "elevenlabs-eleven-v3-ga",
];

export const releaseReplayCases: ReleaseReplayCase[] = [
  {
    id: "anthropic-claude-sonnet-5",
    provider: "Anthropic",
    title: "Introducing Claude Sonnet 5",
    url: "https://www.anthropic.com/news/claude-sonnet-5",
    releaseDate: "Jun 30, 2026",
    modelNames: ["Claude Sonnet 5", "claude-sonnet-5"],
    whereItShines: [
      "agentic coding, tool use, browser/terminal workflows, and professional knowledge work",
      "cost-sensitive Sonnet-tier deployments that need performance near larger Opus-class models",
    ],
    strengths: [
      "Anthropic positions it as a substantial improvement over Sonnet 4.6 on reasoning, tool use, coding, and knowledge work.",
      "It is available across Claude plans, Claude Code, and the Claude API under the claude-sonnet-5 model name.",
    ],
    weaknessesUnknowns: [
      "This replay does not fetch independent benchmark services, so external benchmark corroboration is marked unknown.",
      "Anthropic reports lower undesirable behavior than Sonnet 4.6, but higher misaligned-behavior rates than Opus 4.8 and Mythos Preview on its automated audit.",
    ],
    benchmarkContext: [
      "The official article compares Sonnet 5 with Sonnet 4.6 and Opus 4.8 on agentic search and OSWorld-Verified cost-performance, with broader evaluations in the linked system card.",
    ],
    safetySystemNotes: [
      "The article links a Claude Sonnet 5 System Card and says cyber safeguards are enabled by default.",
      "Anthropic says Sonnet 5 has much lower dangerous cyber capability than current Opus models.",
    ],
  },
  {
    id: "mistral-small-4",
    provider: "Mistral",
    title: "Introducing Mistral Small 4",
    url: "https://mistral.ai/news/mistral-small-4/",
    releaseDate: "March 16, 2026",
    modelNames: ["Mistral Small 4", "mistral-small-latest"],
    whereItShines: [
      "open multimodal chat, coding, agentic tasks, and configurable reasoning in one smaller model family",
      "self-hosted or enterprise deployments that need Apache 2.0 licensing and lower serving cost",
    ],
    strengths: [
      "Mistral says Small 4 unifies Small, Magistral, Pixtral, and Devstral-style capabilities into one model.",
      "The article lists a 256k context window, native text and image input, and MoE architecture with 119B total parameters.",
    ],
    weaknessesUnknowns: [
      "The replay does not verify Mistral's benchmark claims against an independent benchmark provider.",
      "A dedicated public safety/system card was not found by the static replay metadata.",
    ],
    benchmarkContext: [
      "The official article reports internal performance highlights, including lower completion time and higher throughput versus Mistral Small 3.",
      "Mistral also claims competitive reasoning and coding benchmark results with shorter outputs, but this replay treats those as vendor-provided evidence.",
    ],
    safetySystemNotes: [
      "The article points to technical documentation and governance material, but no dedicated safety card is required for the send decision.",
    ],
  },
  {
    id: "elevenlabs-eleven-v3-ga",
    provider: "ElevenLabs",
    title: "Eleven v3 is Now Generally Available",
    url: "https://elevenlabs.io/blog/eleven-v3-is-now-generally-available",
    releaseDate: "Feb 2, 2026",
    modelNames: ["Eleven v3"],
    whereItShines: [
      "general-availability text-to-speech generation with stronger handling of numbers, symbols, and specialized notation",
      "voice apps that need more stable production behavior than the alpha release",
    ],
    strengths: [
      "ElevenLabs says users preferred the new version 72% of the time over the alpha release in testing.",
      "The article reports a reduction in internal benchmark error rate from 15.3% to 4.9% across 27 categories and 8 languages.",
    ],
    weaknessesUnknowns: [
      "The benchmark evidence in this replay is vendor-provided and not independently rechecked.",
      "The official article does not present a dedicated safety or system card for the release.",
    ],
    benchmarkContext: [
      "ElevenLabs reports category-level internal accuracy improvements for chemical formulas, phone numbers, URLs/emails, ISBNs, license plates, mathematical expressions, and coordinates.",
    ],
    safetySystemNotes: [
      "No linked system card or safety card is required by the article gate; safety evidence is therefore reported as unknown rather than inferred.",
    ],
  },
];

export function selectReleaseReplayCases(ids: string[] = defaultReplayReleaseIds): ReleaseReplayCase[] {
  const byId = new Map(releaseReplayCases.map((releaseCase) => [releaseCase.id, releaseCase]));
  const selected: ReleaseReplayCase[] = [];

  for (const id of ids) {
    const releaseCase = byId.get(id);
    if (!releaseCase) {
      throw new Error(`Unknown release replay id: ${id}`);
    }
    selected.push(releaseCase);
  }

  return selected;
}

export function buildVerifiedReleaseNote(
  releaseCase: ReleaseReplayCase,
  options: { html?: string } = {},
): VerifiedReleaseNote {
  const metadata = options.html ? extractArticleMetadata(options.html, releaseCase.url) : undefined;
  const metadataTitle = metadata?.title ? normalizeArticleTitle(metadata.title) : undefined;
  const title = metadataTitle && looksLikeReleaseTitle(metadataTitle) ? metadataTitle : releaseCase.title;
  const releaseDate = readableDate(metadata?.releaseDate) ?? releaseCase.releaseDate;
  const gate = evaluateArticleGate({
    provider: releaseCase.provider,
    title,
    url: releaseCase.url,
  });
  const modelNames = compactModelNames([
    ...releaseCase.modelNames,
    ...extractModelNames(title),
  ]);
  const evidenceLinks = mergeEvidenceLinks(releaseCase.evidenceLinks ?? [], metadata?.evidenceLinks ?? []);

  return {
    caseId: releaseCase.id,
    provider: releaseCase.provider,
    title,
    sourceUrl: releaseCase.url,
    releaseDate,
    modelNames,
    gate,
    verificationStatus: gate.shouldSend ? "verified" : "rejected",
    whereItShines: releaseCase.whereItShines,
    strengths: releaseCase.strengths,
    weaknessesUnknowns: releaseCase.weaknessesUnknowns,
    benchmarkContext: releaseCase.benchmarkContext,
    safetySystemNotes: releaseCase.safetySystemNotes,
    evidenceLinks,
  };
}

export function formatVerifiedReleaseNote(note: VerifiedReleaseNote): string {
  const sourceLines = [`Official article: ${note.sourceUrl}`];
  for (const link of note.evidenceLinks.slice(0, 4)) {
    sourceLines.push(`${titleCase(link.kind)}: ${link.url}`);
  }

  return [
    `Verified model release: ${note.title}`,
    `Lab: ${note.provider}`,
    `Models: ${note.modelNames.join(", ")}`,
    `Date: ${note.releaseDate}`,
    `Verification: ${note.verificationStatus} (${note.gate.reason})`,
    "",
    `- Where it shines: ${note.whereItShines.join("; ")}`,
    `- Strengths: ${note.strengths.join(" ")}`,
    `- Weaknesses/unknowns: ${note.weaknessesUnknowns.join(" ")}`,
    `- Benchmark context: ${note.benchmarkContext.join(" ")}`,
    `- Safety/system notes: ${note.safetySystemNotes.join(" ")}`,
    `- Sources: ${sourceLines.join(" | ")}`,
  ].join("\n").slice(0, 4096);
}

export function extractArticleMetadata(html: string, baseUrl: string): ArticleMetadata {
  const textSample = stripTags(html).slice(0, 5000);

  return {
    title: firstMatch(html, [
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]),
    releaseDate: firstMatch(html, [
      /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
      /Published\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i,
      /([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/,
      /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/,
    ]),
    textSample,
    evidenceLinks: extractEvidenceLinks(html, baseUrl),
  };
}

export function extractEvidenceLinks(html: string, baseUrl: string): EvidenceLink[] {
  const links: EvidenceLink[] = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1];
    const label = normalizeWhitespace(stripTags(match[2] ?? ""));
    const searchable = `${label} ${href}`;
    const kind = evidenceKind(searchable);

    if (!kind || !href || href.startsWith("#") || href.startsWith("mailto:")) {
      continue;
    }

    const url = resolveUrl(href, baseUrl);
    if (url) {
      links.push({ kind, label: label || titleCase(kind), url });
    }
  }

  return mergeEvidenceLinks(links);
}

function evidenceKind(value: string): EvidenceLinkKind | null {
  if (/system\s*card|safety\s*card/i.test(value)) {
    return "system_card";
  }
  if (/model\s*card|huggingface\.co/i.test(value)) {
    return "model_card";
  }
  if (/technical\s*report|paper|arxiv|\.pdf/i.test(value)) {
    return "technical_report";
  }
  if (/\b(?:benchmark|evals?|leaderboard|artificialanalysis)\b/i.test(value)) {
    return "benchmark";
  }
  if (/docs|documentation|api|governance/i.test(value)) {
    return "docs";
  }
  return null;
}

function firstMatch(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const extracted = match?.[1] ? normalizeWhitespace(stripTags(match[1])) : "";
    if (extracted) {
      return extracted;
    }
  }
  return undefined;
}

function looksLikeReleaseTitle(value: string): boolean {
  return /introduc|launch|release|available|claude|mistral|eleven/i.test(value);
}

function normalizeArticleTitle(value: string): string {
  return normalizeWhitespace(value).replace(/\s+\|\s+(?:Anthropic|Mistral AI|ElevenLabs).*$/i, "");
}

function readableDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    }
  }

  return value;
}

function mergeEvidenceLinks(...groups: EvidenceLink[][]): EvidenceLink[] {
  const byUrl = new Map<string, EvidenceLink>();

  for (const link of groups.flat()) {
    if (!byUrl.has(link.url)) {
      byUrl.set(link.url, link);
    }
  }

  return [...byUrl.values()]
    .sort((left, right) => evidencePriority(left.kind) - evidencePriority(right.kind))
    .slice(0, 8);
}

function evidencePriority(kind: EvidenceLinkKind): number {
  const priorities: Record<EvidenceLinkKind, number> = {
    system_card: 0,
    model_card: 1,
    technical_report: 2,
    benchmark: 3,
    docs: 4,
  };

  return priorities[kind];
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compactModelNames(values: string[]): string[] {
  const names = uniqueStrings(values);

  return names.filter((name) => {
    const comparableName = comparableModelName(name);
    if (comparableName.length <= 6) {
      return !names.some((other) => {
        const comparableOther = comparableModelName(other);
        return comparableOther !== comparableName && comparableOther.includes(comparableName);
      });
    }

    return !names.some((other) => {
      const comparableOther = comparableModelName(other);
      return comparableOther !== comparableName && comparableOther.includes(comparableName) && !other.includes("-");
    });
  });
}

function comparableModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
