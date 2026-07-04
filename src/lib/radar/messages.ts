import type { VerifierFinding, VerifierOutput, EvidencePacket } from "./agents";
import type { LlmUsage } from "./llm";

// ─── Sub-types ────────────────────────────────────────────────────────────────

export type ReleaseNoteEvidenceLink = {
  kind: "system_card" | "model_card" | "safety_card" | "technical_report" | "pdf" | "benchmark" | "docs" | "model_repo" | "model_docs";
  label: string;
  url: string;
};

export type ReleaseNoteImageAsset = {
  src: string;
  altText: string | null;
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
};

export type ReleaseNoteDownloadableAsset = {
  url: string;
  contentType: string | null;
  byteSize: number | null;
  filename: string | null;
};

export type ReleaseNoteCostSummary = {
  totalCostUsd: number;
  maxCostUsd: number;
  stages: Array<{
    stage: string;
    modelId: string;
    estimatedCostUsd: number;
  }>;
};

// ─── Core release note schema ─────────────────────────────────────────────────

export type ReleaseNoteStatus = "verified" | "rejected" | "unverified";

export type ReleaseNote = {
  // Identity
  lab: string;
  modelNames: string[];
  title: string;
  releaseDate: string | null;
  canonicalSourceUrl: string;

  // Content
  summary: string;
  whereItShines: string[];
  strengths: string[];
  weaknessesUnknowns: string[];
  benchmarkContext: string[];
  safetySystemNotes: string[];

  // Evidence
  evidenceLinks: ReleaseNoteEvidenceLink[];
  imageAssets: ReleaseNoteImageAsset[];
  downloadableAssets: ReleaseNoteDownloadableAsset[];

  // Verification
  verifierStatus: ReleaseNoteStatus;
  verifierFindings: VerifierFinding[];
  checkedClaims: number;

  // Cost
  costSummary: ReleaseNoteCostSummary;
};

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildReleaseNote(options: {
  evidencePacket: EvidencePacket;
  finalMessage: string;
  verifierOutput: VerifierOutput;
  imageAssets?: ReleaseNoteImageAsset[];
  downloadableAssets?: ReleaseNoteDownloadableAsset[];
}): ReleaseNote {
  const { evidencePacket, verifierOutput } = options;

  const evidenceLinks: ReleaseNoteEvidenceLink[] = evidencePacket.references.map((ref) => ({
    kind: ref.kind as ReleaseNoteEvidenceLink["kind"],
    label: titleCase(ref.kind),
    url: ref.url,
  }));

  const costSummary = buildCostSummary(evidencePacket.costTracker);

  const status: ReleaseNoteStatus = verifierOutput.approved ? "verified" : "rejected";

  // Parse structured fields from the evidence synthesis if available
  const summary = evidencePacket.evidenceSynthesis || evidencePacket.articleSummary;

  return {
    lab: evidencePacket.lab,
    modelNames: evidencePacket.modelNames,
    title: buildTitle(evidencePacket),
    releaseDate: evidencePacket.releaseDate,
    canonicalSourceUrl: evidencePacket.articleUrl,
    summary,
    whereItShines: [],
    strengths: [],
    weaknessesUnknowns: [],
    benchmarkContext: [evidencePacket.benchmarkSummary].filter(Boolean),
    safetySystemNotes: buildSafetyNotes(evidencePacket),
    evidenceLinks,
    imageAssets: options.imageAssets ?? [],
    downloadableAssets: options.downloadableAssets ?? [],
    verifierStatus: status,
    verifierFindings: verifierOutput.findings,
    checkedClaims: verifierOutput.checkedClaims,
    costSummary,
  };
}

function buildTitle(packet: EvidencePacket): string {
  if (packet.modelNames.length > 0) {
    return `${packet.lab}: ${packet.modelNames.slice(0, 2).join(" / ")}`;
  }
  return `${packet.lab}: New Model Release`;
}

function buildSafetyNotes(packet: EvidencePacket): string[] {
  if (packet.systemCardStatus === "not_found") {
    return ["No system card, safety card, or technical report was found for this release."];
  }
  return [packet.systemCardSummary].filter(Boolean);
}

function buildCostSummary(tracker: import("./llm").CostTracker): ReleaseNoteCostSummary {
  const report = tracker.report();
  return {
    totalCostUsd: report.totalCostUsd,
    maxCostUsd: report.maxCostUsd,
    stages: report.stages.map((u: LlmUsage) => ({
      stage: u.stage,
      modelId: u.modelId,
      estimatedCostUsd: u.estimatedCostUsd,
    })),
  };
}

// ─── Eligibility guard ────────────────────────────────────────────────────────

export function canSendReleaseNote(note: ReleaseNote): boolean {
  return note.verifierStatus === "verified";
}

// ─── Plain text renderer ──────────────────────────────────────────────────────

export function renderReleaseNoteAsPlainText(note: ReleaseNote): string {
  const lines: string[] = [];

  lines.push(`New Model Release: ${note.title}`);
  lines.push(`Lab: ${note.lab}`);
  if (note.modelNames.length > 0) {
    lines.push(`Models: ${note.modelNames.join(", ")}`);
  }
  if (note.releaseDate) {
    lines.push(`Date: ${note.releaseDate}`);
  }
  lines.push(`Status: ${note.verifierStatus}`);
  lines.push("");

  if (note.summary) {
    lines.push("Summary:");
    lines.push(note.summary);
    lines.push("");
  }

  if (note.whereItShines.length > 0) {
    lines.push("Where it shines:");
    for (const item of note.whereItShines) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (note.strengths.length > 0) {
    lines.push("Strengths:");
    for (const item of note.strengths) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  const unknowns = note.weaknessesUnknowns.length > 0
    ? note.weaknessesUnknowns
    : ["No weaknesses or unknowns reported."];
  lines.push("Weaknesses/unknowns:");
  for (const item of unknowns) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  if (note.benchmarkContext.length > 0) {
    lines.push("Benchmark context:");
    for (const item of note.benchmarkContext) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (note.safetySystemNotes.length > 0) {
    lines.push("Safety/system notes:");
    for (const item of note.safetySystemNotes) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push(`Official article: ${note.canonicalSourceUrl}`);
  for (const link of note.evidenceLinks.slice(0, 5)) {
    lines.push(`${titleCase(link.kind)}: ${link.url}`);
  }

  if (note.verifierStatus !== "verified" && note.verifierFindings.length > 0) {
    lines.push("");
    lines.push(`Verification failed (${note.verifierFindings.length} finding(s)):`);
    for (const f of note.verifierFindings.slice(0, 3)) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.issue}: ${f.detail.slice(0, 120)}`);
    }
  }

  if (note.costSummary.totalCostUsd > 0) {
    lines.push("");
    lines.push(`Estimated cost: $${note.costSummary.totalCostUsd.toFixed(6)}`);
  }

  return lines.join("\n");
}

// ─── Telegram renderer ────────────────────────────────────────────────────────

const TELEGRAM_MAX_LENGTH = 4096;
const TELEGRAM_BODY_LIMIT = 3800; // Reserve room for sources + verification footer

export function renderReleaseNoteForTelegram(note: ReleaseNote): string {
  // Verification guard — include a visible warning but still render
  const verificationHeader =
    note.verifierStatus !== "verified"
      ? `[VERIFICATION FAILED — do not treat as authoritative]\n\n`
      : "";

  const header = [
    `New Model Release: ${note.title}`,
    `Lab: ${note.lab}`,
    note.modelNames.length > 0 ? `Models: ${note.modelNames.join(", ")}` : null,
    note.releaseDate ? `Date: ${note.releaseDate}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts: string[] = [];

  if (note.whereItShines.length > 0) {
    bodyParts.push("Where it shines:\n" + note.whereItShines.map((s) => `- ${s}`).join("\n"));
  }

  if (note.strengths.length > 0) {
    bodyParts.push("Strengths:\n" + note.strengths.map((s) => `- ${s}`).join("\n"));
  }

  const unknowns = note.weaknessesUnknowns.length > 0
    ? note.weaknessesUnknowns
    : ["No weaknesses or unknowns reported."];
  bodyParts.push("Weaknesses/unknowns:\n" + unknowns.map((s) => `- ${s}`).join("\n"));

  if (note.benchmarkContext.length > 0) {
    bodyParts.push(
      "Benchmark context:\n" + note.benchmarkContext.map((s) => `- ${s}`).join("\n"),
    );
  }

  if (note.safetySystemNotes.length > 0) {
    bodyParts.push(
      "Safety/system notes:\n" + note.safetySystemNotes.map((s) => `- ${s}`).join("\n"),
    );
  }

  const sourceLines = [
    `Official article: ${note.canonicalSourceUrl}`,
    ...note.evidenceLinks.slice(0, 4).map((l) => `${titleCase(l.kind)}: ${l.url}`),
  ];

  const verificationFooter =
    note.verifierStatus !== "verified" && note.verifierFindings.length > 0
      ? `\n\nVerification failures:\n` +
        note.verifierFindings
          .slice(0, 2)
          .map((f) => `- [${f.severity.toUpperCase()}] ${f.issue}: ${f.detail.slice(0, 80)}`)
          .join("\n")
      : "";

  const body = truncateToLimit(bodyParts.join("\n\n"), TELEGRAM_BODY_LIMIT);
  const sources = sourceLines.join("\n");
  const costLine =
    note.costSummary.totalCostUsd > 0
      ? `\nCost: $${note.costSummary.totalCostUsd.toFixed(6)}`
      : "";

  const full = [
    verificationHeader + header,
    body,
    sources + verificationFooter + costLine,
  ]
    .filter(Boolean)
    .join("\n\n");

  return full.slice(0, TELEGRAM_MAX_LENGTH);
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 3);
  const lastNewline = cut.lastIndexOf("\n");
  return (lastNewline > limit * 0.5 ? cut.slice(0, lastNewline) : cut) + "...";
}

// ─── Source failure alert ─────────────────────────────────────────────────────

export type SourceFailureAlert = {
  sourceId: string;
  sourceLabel: string;
  error: string;
  timestamp: string;
};

export function renderSourceFailureAlert(alert: SourceFailureAlert): string {
  return [
    `[Source Failure] ${alert.sourceId}`,
    `Source: ${alert.sourceLabel}`,
    `Error: ${alert.error.slice(0, 200)}`,
    `Time: ${alert.timestamp}`,
    "(Operational alert — not a model release)",
  ].join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
