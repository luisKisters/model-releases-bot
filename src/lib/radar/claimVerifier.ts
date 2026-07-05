import { evaluateArticleGate } from "./articleGate";
import type { VerifiedReleaseNote } from "./releaseMessages";

export type ClaimFinding = {
  field: string;
  issue: string;
  detail: string;
};

export type ClaimVerifierResult = {
  approved: boolean;
  findings: ClaimFinding[];
};

// Strong comparative benchmark language that requires evidence backing
const STRONG_BENCHMARK_CLAIM =
  /\b(?:beats?|surpass(?:es|ed|ing)?|outperform(?:s|ed|ing)?|state-of-the-art|number[- ]?one|first[- ]?place|top[- ]?ranked)\b|#1(?:[\s,;.()]|$)/i;

// Phrases that assert system-card or safety certification as fact
const INVENTED_SAFETY_CLAIM =
  /(?:system\s*card\s+(?:confirms?|shows?|demonstrates?|proves?|verif)|certified\s+safe|verified\s+safe|no\s+(?:known\s+)?risks?(?:\b|$)|risk[- ]?free)/i;

// Minimum acceptable year for a release date — dates before this are considered stale
const STALE_YEAR_THRESHOLD = 2022;

export function verifyClaims(note: VerifiedReleaseNote): ClaimVerifierResult {
  const findings: ClaimFinding[] = [];

  checkWeaknessesPresent(note, findings);
  checkBenchmarkClaims(note, findings);
  checkSafetyClaims(note, findings);
  checkSourceUrl(note, findings);
  checkReleaseDate(note, findings);

  return { approved: findings.length === 0, findings };
}

function checkWeaknessesPresent(note: VerifiedReleaseNote, findings: ClaimFinding[]): void {
  const hasContent = note.weaknessesUnknowns.some((w) => w.trim().length > 0);
  if (!hasContent) {
    findings.push({
      field: "weaknessesUnknowns",
      issue: "missing_weaknesses",
      detail:
        "At least one weakness or unknown must be stated. Omitting them overstates the release.",
    });
  }
}

function checkBenchmarkClaims(note: VerifiedReleaseNote, findings: ClaimFinding[]): void {
  const hasStrongClaim = note.benchmarkContext.some((text) => STRONG_BENCHMARK_CLAIM.test(text));
  if (!hasStrongClaim) return;

  const hasEvidence = note.evidenceLinks.some(
    (e) => e.kind === "benchmark" || e.kind === "technical_report",
  );
  if (!hasEvidence) {
    findings.push({
      field: "benchmarkContext",
      issue: "unsupported_benchmark_claim",
      detail:
        "Benchmark superiority claim found but no benchmark or technical_report evidence link is present to support it.",
    });
  }
}

function checkSafetyClaims(note: VerifiedReleaseNote, findings: ClaimFinding[]): void {
  const hasInventedClaim = note.safetySystemNotes.some((text) => INVENTED_SAFETY_CLAIM.test(text));
  if (!hasInventedClaim) return;

  const hasEvidence = note.evidenceLinks.some((e) => e.kind === "system_card");
  if (!hasEvidence) {
    findings.push({
      field: "safetySystemNotes",
      issue: "unsupported_safety_claim",
      detail:
        "Safety note asserts system card confirmation or certified-safe status but no system_card evidence link is present.",
    });
  }
}

function checkSourceUrl(note: VerifiedReleaseNote, findings: ClaimFinding[]): void {
  const gate = evaluateArticleGate({
    provider: note.provider,
    title: note.title,
    url: note.sourceUrl,
  });

  if (!gate.shouldSend) {
    findings.push({
      field: "sourceUrl",
      issue: "wrong_source_url",
      detail: `Source URL "${note.sourceUrl}" does not pass the article gate for provider "${note.provider}": ${gate.reason}`,
    });
  }
}

function checkReleaseDate(note: VerifiedReleaseNote, findings: ClaimFinding[]): void {
  const year = extractYear(note.releaseDate);
  if (year !== null && year < STALE_YEAR_THRESHOLD) {
    findings.push({
      field: "releaseDate",
      issue: "stale_release_date",
      detail: `Release date "${note.releaseDate}" is before ${STALE_YEAR_THRESHOLD} and is too old to be a current model release.`,
    });
  }
}

function extractYear(value: string): number | null {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}
