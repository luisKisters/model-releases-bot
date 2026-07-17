import { describe, expect, it } from "vitest";
import {
  buildReleaseNote,
  canSendReleaseNote,
  renderReleaseNoteAsPlainText,
  renderReleaseNoteForTelegram,
  renderSourceFailureAlert,
  type ReleaseNote,
  type SourceFailureAlert,
} from "../src/lib/radar/messages";
import { CostTracker } from "../src/lib/radar/llm";
import type { EvidencePacket } from "../src/lib/radar/agents";
import type { VerifierOutput } from "../src/lib/radar/agents";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTracker(maxCost = 1): CostTracker {
  const tracker = new CostTracker(maxCost);
  tracker.record({
    stage: "article_summarizer",
    modelId: "deepseek-chat",
    promptTokens: 500,
    completionTokens: 100,
    cacheHitTokens: 0,
    providerResponseId: "resp-123",
    estimatedCostUsd: 0.000185,
  });
  tracker.record({
    stage: "final_writer",
    modelId: "moonshotai/kimi-k2",
    promptTokens: 1024,
    completionTokens: 256,
    cacheHitTokens: 0,
    providerResponseId: "resp-456",
    estimatedCostUsd: 0.001792,
  });
  return tracker;
}

function makePacket(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    lab: "DeepSeek",
    modelNames: ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
    articleUrl: "https://api-docs.deepseek.com/news/news260424",
    releaseDate: "2026-04-24",
    articleSummary: "DeepSeek released V4-Pro and V4-Flash with improved reasoning and coding capabilities.",
    systemCardSummary: "No system card was found.",
    benchmarkSummary: "DeepSeek claims SOTA on math, coding, and reasoning benchmarks (vendor-provided).",
    evidenceSynthesis: "DeepSeek V4-Pro is a powerful MoE model. DeepSeek V4-Flash is a distilled variant for speed.",
    claims: [],
    systemCardStatus: "not_found",
    references: [
      { url: "https://api-docs.deepseek.com/news/news260424", kind: "article", chunkIds: [] },
      { url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro", kind: "model_repo", chunkIds: [] },
    ],
    costTracker: makeTracker(),
    placements: null,
    availability: { api: "[placeholder]", subscription: "[placeholder]" },
    ...overrides,
  };
}

function makeVerifierOutput(overrides: Partial<VerifierOutput> = {}): VerifierOutput {
  return {
    approved: true,
    findings: [],
    checkedClaims: 5,
    unsupportedCount: 0,
    ...overrides,
  };
}

function makeVerifiedNote(overrides: Partial<ReleaseNote> = {}): ReleaseNote {
  const base: ReleaseNote = {
    lab: "Anthropic",
    modelNames: ["Claude Sonnet 5"],
    title: "Anthropic: Claude Sonnet 5",
    releaseDate: "Jun 30, 2026",
    canonicalSourceUrl: "https://www.anthropic.com/news/claude-sonnet-5",
    summary: "Claude Sonnet 5 is a major upgrade in agentic capabilities.",
    whereItShines: ["Agentic coding and tool use", "Professional knowledge work"],
    strengths: ["Strong reasoning and coding performance", "Available on Claude API"],
    weaknessesUnknowns: ["Higher misaligned-behavior rate than Opus 4.8", "External benchmark data not independently verified"],
    benchmarkContext: ["Claims improvements over Sonnet 4.6 on agentic search (vendor-provided)"],
    safetySystemNotes: ["System card linked; cyber safeguards enabled by default"],
    evidenceLinks: [
      { kind: "system_card", label: "System Card", url: "https://www.anthropic.com/claude-sonnet-5-system-card" },
    ],
    imageAssets: [],
    downloadableAssets: [],
    verifierStatus: "verified",
    verifierFindings: [],
    checkedClaims: 6,
    costSummary: { totalCostUsd: 0.00197, maxCostUsd: 1, stages: [] },
  };
  return { ...base, ...overrides };
}

// ─── buildReleaseNote ─────────────────────────────────────────────────────────

describe("buildReleaseNote", () => {
  it("builds a release note from orchestrator output", () => {
    const packet = makePacket();
    const verifier = makeVerifierOutput();
    const note = buildReleaseNote({ evidencePacket: packet, finalMessage: "...", verifierOutput: verifier });

    expect(note.lab).toBe("DeepSeek");
    expect(note.modelNames).toEqual(["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"]);
    expect(note.canonicalSourceUrl).toBe("https://api-docs.deepseek.com/news/news260424");
    expect(note.verifierStatus).toBe("verified");
    expect(note.evidenceLinks).toHaveLength(1); // article ref filtered; URL is in canonicalSourceUrl
    expect(note.costSummary.stages).toHaveLength(2);
    expect(note.costSummary.totalCostUsd).toBeGreaterThan(0);
  });

  it("sets status to rejected when verifier does not approve", () => {
    const packet = makePacket();
    const verifier = makeVerifierOutput({ approved: false, unsupportedCount: 1 });
    const note = buildReleaseNote({ evidencePacket: packet, finalMessage: "...", verifierOutput: verifier });
    expect(note.verifierStatus).toBe("rejected");
  });

  it("records not_found system card status in safety notes", () => {
    const packet = makePacket({ systemCardStatus: "not_found" });
    const verifier = makeVerifierOutput();
    const note = buildReleaseNote({ evidencePacket: packet, finalMessage: "...", verifierOutput: verifier });
    expect(note.safetySystemNotes.some((n) => n.includes("No system card"))).toBe(true);
  });

  it("passes through image and downloadable assets", () => {
    const packet = makePacket();
    const verifier = makeVerifierOutput();
    const images = [{ src: "https://example.com/img.png", altText: "diagram", contentType: "image/png", byteSize: 50000, width: 800, height: 600 }];
    const note = buildReleaseNote({ evidencePacket: packet, finalMessage: "...", verifierOutput: verifier, imageAssets: images });
    expect(note.imageAssets).toHaveLength(1);
    expect(note.imageAssets[0].src).toBe("https://example.com/img.png");
  });

  it("builds title from lab and model names", () => {
    const packet = makePacket();
    const note = buildReleaseNote({ evidencePacket: packet, finalMessage: "", verifierOutput: makeVerifierOutput() });
    expect(note.title).toContain("DeepSeek");
    expect(note.title).toContain("DeepSeek-V4-Pro");
  });
});

// ─── canSendReleaseNote ───────────────────────────────────────────────────────

describe("canSendReleaseNote", () => {
  it("returns true for verified notes", () => {
    const note = makeVerifiedNote({ verifierStatus: "verified" });
    expect(canSendReleaseNote(note)).toBe(true);
  });

  it("returns false for rejected notes", () => {
    const note = makeVerifiedNote({ verifierStatus: "rejected" });
    expect(canSendReleaseNote(note)).toBe(false);
  });

  it("returns false for unverified notes", () => {
    const note = makeVerifiedNote({ verifierStatus: "unverified" });
    expect(canSendReleaseNote(note)).toBe(false);
  });
});

// ─── renderReleaseNoteAsPlainText ─────────────────────────────────────────────

describe("renderReleaseNoteAsPlainText", () => {
  it("includes lab, models, date, and source URL", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteAsPlainText(note);

    expect(text).toContain("Anthropic");
    expect(text).toContain("Claude Sonnet 5");
    expect(text).toContain("Jun 30, 2026");
    expect(text).toContain("https://www.anthropic.com/news/claude-sonnet-5");
  });

  it("includes strengths and weaknesses", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteAsPlainText(note);

    expect(text).toContain("Strengths:");
    expect(text).toContain("Strong reasoning");
    expect(text).toContain("Weaknesses/unknowns:");
    expect(text).toContain("Higher misaligned-behavior rate");
  });

  it("includes benchmark context and safety notes", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteAsPlainText(note);

    expect(text).toContain("Benchmark context:");
    expect(text).toContain("vendor-provided");
    expect(text).toContain("Safety/system notes:");
    expect(text).toContain("System card linked");
  });

  it("shows verification failure details for rejected notes", () => {
    const note = makeVerifiedNote({
      verifierStatus: "rejected",
      verifierFindings: [
        { claim: "best model", issue: "unsupported_strength", detail: "No evidence for superlative claim", severity: "block" },
      ],
    });
    const text = renderReleaseNoteAsPlainText(note);
    expect(text).toContain("Verification failed");
    expect(text).toContain("unsupported_strength");
  });

  it("handles Unicode model names correctly", () => {
    const note = makeVerifiedNote({ modelNames: ["Qwen-3-235B-A22B", "深度求索-V4", "Gemini 2.5 Ultra"] });
    const text = renderReleaseNoteAsPlainText(note);
    expect(text).toContain("深度求索-V4");
    expect(text).toContain("Gemini 2.5 Ultra");
  });

  it("includes cost when non-zero", () => {
    const note = makeVerifiedNote({ costSummary: { totalCostUsd: 0.012345, maxCostUsd: 1, stages: [] } });
    const text = renderReleaseNoteAsPlainText(note);
    expect(text).toContain("0.012345");
  });

  it("omits cost line when cost is zero", () => {
    const note = makeVerifiedNote({ costSummary: { totalCostUsd: 0, maxCostUsd: 1, stages: [] } });
    const text = renderReleaseNoteAsPlainText(note);
    expect(text).not.toContain("Estimated cost:");
  });

  it("falls back to explicit unknown when no weaknesses provided", () => {
    const note = makeVerifiedNote({ weaknessesUnknowns: [] });
    const text = renderReleaseNoteAsPlainText(note);
    expect(text).toContain("Weaknesses/unknowns:");
    expect(text).toContain("No weaknesses or unknowns reported.");
  });

  it("handles special characters without escaping errors", () => {
    const note = makeVerifiedNote({
      strengths: ["Cost: $0.27/M tokens", "Speed: 100 tok/s", "Score: 95%"],
      weaknessesUnknowns: ["Limitation: <100k context window", "API: experimental (beta) only"],
    });
    const text = renderReleaseNoteAsPlainText(note);
    expect(text).toContain("$0.27/M tokens");
    expect(text).toContain("<100k context window");
    expect(text).toContain("(beta)");
  });
});

// ─── renderReleaseNoteForTelegram ─────────────────────────────────────────────

describe("renderReleaseNoteForTelegram", () => {
  it("is under the Telegram 4096-character limit", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteForTelegram(note);
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it("truncates very long messages to stay within Telegram limits", () => {
    const longLine = "A ".repeat(500);
    const note = makeVerifiedNote({
      strengths: Array.from({ length: 20 }, () => longLine),
      weaknessesUnknowns: Array.from({ length: 20 }, () => longLine),
      benchmarkContext: Array.from({ length: 10 }, () => longLine),
    });
    const text = renderReleaseNoteForTelegram(note);
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it("always includes the official article URL", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteForTelegram(note);
    expect(text).toContain("https://www.anthropic.com/news/claude-sonnet-5");
  });

  it("includes source links", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteForTelegram(note);
    expect(text).toContain("https://www.anthropic.com/claude-sonnet-5-system-card");
  });

  it("shows verification failure warning when note is rejected", () => {
    const note = makeVerifiedNote({
      verifierStatus: "rejected",
      verifierFindings: [
        { claim: "best model ever", issue: "unsupported_strength", detail: "Superlative not in evidence", severity: "block" },
      ],
    });
    const text = renderReleaseNoteForTelegram(note);
    expect(text).toContain("VERIFICATION FAILED");
    expect(text).toContain("unsupported_strength");
  });

  it("does not show verification failure section for verified notes", () => {
    const note = makeVerifiedNote({ verifierStatus: "verified", verifierFindings: [] });
    const text = renderReleaseNoteForTelegram(note);
    expect(text).not.toContain("VERIFICATION FAILED");
    expect(text).not.toContain("Verification failures:");
  });

  it("handles Unicode model names in Telegram output", () => {
    const note = makeVerifiedNote({ modelNames: ["Claude 3.7 Sonnet (claude-sonnet-3-7)", "深度求索-V4"] });
    const text = renderReleaseNoteForTelegram(note);
    expect(text).toContain("深度求索-V4");
  });

  it("uses plain text format with no Markdown syntax", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteForTelegram(note);
    // Plain text should not have markdown bold/italic/code markers
    expect(text).not.toMatch(/\*\*[^*]+\*\*/);
    expect(text).not.toMatch(/`[^`]+`/);
    expect(text).not.toMatch(/_{2}[^_]+_{2}/);
  });

  it("includes lab and model names in header", () => {
    const note = makeVerifiedNote();
    const text = renderReleaseNoteForTelegram(note);
    expect(text).toContain("Anthropic");
    expect(text).toContain("Claude Sonnet 5");
  });
});

// ─── No send on unverified ────────────────────────────────────────────────────

describe("no send on unverified note", () => {
  it("canSendReleaseNote blocks rejected notes from being sent", () => {
    const note = makeVerifiedNote({
      verifierStatus: "rejected",
      verifierFindings: [
        { claim: "invented claim", issue: "invented_safety_claim", detail: "Safety detail not in evidence", severity: "block" },
      ],
    });
    expect(canSendReleaseNote(note)).toBe(false);
  });

  it("canSendReleaseNote blocks unverified notes from being sent", () => {
    const note = makeVerifiedNote({ verifierStatus: "unverified" });
    expect(canSendReleaseNote(note)).toBe(false);
  });

  it("canSendReleaseNote allows verified notes", () => {
    const note = makeVerifiedNote({ verifierStatus: "verified", verifierFindings: [] });
    expect(canSendReleaseNote(note)).toBe(true);
  });

  it("rendering still works for rejected notes but shows verification warning", () => {
    const note = makeVerifiedNote({
      verifierStatus: "rejected",
      verifierFindings: [
        { claim: "wrong url", issue: "wrong_source_url", detail: "URL not in evidence", severity: "block" },
      ],
    });
    // Rendering itself should not throw — the guard is in canSendReleaseNote
    const text = renderReleaseNoteForTelegram(note);
    expect(text).toContain("VERIFICATION FAILED");
    expect(text.length).toBeLessThanOrEqual(4096);
  });
});

// ─── renderSourceFailureAlert ─────────────────────────────────────────────────

describe("renderSourceFailureAlert", () => {
  it("produces an operational alert clearly distinct from a model release", () => {
    const alert: SourceFailureAlert = {
      sourceId: "openai-rss",
      sourceLabel: "OpenAI Official RSS",
      error: "503 Service Unavailable",
      timestamp: "2026-07-04T12:00:00Z",
    };
    const text = renderSourceFailureAlert(alert);

    expect(text).toContain("[Source Failure]");
    expect(text).toContain("openai-rss");
    expect(text).toContain("OpenAI Official RSS");
    expect(text).toContain("503 Service Unavailable");
    expect(text).toContain("Operational alert");
    expect(text).not.toContain("New Model Release");
  });

  it("truncates very long error messages", () => {
    const alert: SourceFailureAlert = {
      sourceId: "test-source",
      sourceLabel: "Test Source",
      error: "E".repeat(500),
      timestamp: "2026-07-04T00:00:00Z",
    };
    const text = renderSourceFailureAlert(alert);
    // Should not include more than the truncated error
    expect(text.length).toBeLessThan(600);
  });

  it("is clearly labeled as not a model release", () => {
    const alert: SourceFailureAlert = {
      sourceId: "anthropic-news",
      sourceLabel: "Anthropic News",
      error: "Connection timeout",
      timestamp: "2026-07-04T09:00:00Z",
    };
    const text = renderSourceFailureAlert(alert);
    expect(text).toContain("not a model release");
  });
});

// ─── Source link formatting ───────────────────────────────────────────────────

describe("source link formatting", () => {
  it("renders all evidence link kinds in plain text output", () => {
    const note = makeVerifiedNote({
      evidenceLinks: [
        { kind: "system_card", label: "System Card", url: "https://example.com/system-card" },
        { kind: "technical_report", label: "Technical Report", url: "https://arxiv.org/abs/2506.12345" },
        { kind: "benchmark", label: "Benchmark", url: "https://artificialanalysis.ai/model/claude-5" },
        { kind: "model_repo", label: "Model Repo", url: "https://huggingface.co/anthropic/claude-5" },
        { kind: "docs", label: "Docs", url: "https://docs.anthropic.com/claude-5" },
      ],
    });
    const text = renderReleaseNoteAsPlainText(note);

    expect(text).toContain("https://example.com/system-card");
    expect(text).toContain("https://arxiv.org/abs/2506.12345");
  });

  it("limits Telegram evidence links to 4 entries to save space", () => {
    const note = makeVerifiedNote({
      evidenceLinks: Array.from({ length: 10 }, (_, i) => ({
        kind: "benchmark" as const,
        label: `Benchmark ${i}`,
        url: `https://example.com/benchmark-${i}`,
      })),
    });
    const text = renderReleaseNoteForTelegram(note);
    // At most 4 evidence links + the official article = 5 total source lines
    const linkMatches = text.match(/https:\/\/example\.com\/benchmark-/g);
    expect((linkMatches?.length ?? 0)).toBeLessThanOrEqual(4);
  });
});
