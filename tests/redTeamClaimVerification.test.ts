import { describe, expect, it } from "vitest";
import { verifyClaims } from "../src/lib/radar/claimVerifier";
import type { ClaimVerifierResult } from "../src/lib/radar/claimVerifier";
import { buildVerifiedReleaseNote, releaseReplayCases } from "../src/lib/radar/releaseMessages";
import type { VerifiedReleaseNote } from "../src/lib/radar/releaseMessages";

function getBaseNote(id: string): VerifiedReleaseNote {
  const releaseCase = releaseReplayCases.find((c) => c.id === id);
  if (!releaseCase) throw new Error(`Case not found: ${id}`);
  return buildVerifiedReleaseNote(releaseCase);
}

function findingByIssue(result: ClaimVerifierResult, issue: string) {
  return result.findings.find((f) => f.issue === issue);
}

// ---------------------------------------------------------------------------
// 1. Unsupported benchmark claims
// ---------------------------------------------------------------------------
describe("red-team claim verification: unsupported benchmark claims", () => {
  it("blocks send when benchmarkContext has superiority claim but no evidence links", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const injected: VerifiedReleaseNote = {
      ...note,
      benchmarkContext: [
        "Claude Sonnet 5 beats every other model on every benchmark and ranks #1 globally.",
      ],
      evidenceLinks: [],
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "unsupported_benchmark_claim");
    expect(finding).toBeDefined();
    expect(finding!.field).toBe("benchmarkContext");
  });

  it("blocks send when benchmarkContext claims state-of-the-art but no benchmark evidence present", () => {
    const note = getBaseNote("openai-o3-o4-mini");
    const injected: VerifiedReleaseNote = {
      ...note,
      benchmarkContext: [
        "o3 is state-of-the-art on reasoning, outperforming all prior models.",
      ],
      evidenceLinks: note.evidenceLinks.filter(
        (e) => e.kind !== "benchmark" && e.kind !== "technical_report",
      ),
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "unsupported_benchmark_claim");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("benchmark");
    expect(finding!.detail).toContain("technical_report");
  });

  it("passes when benchmark claim is present and technical_report evidence backs it", () => {
    // deepseek-v4 has a technical_report evidence link pre-populated
    const note = getBaseNote("deepseek-v4");
    const withClaim: VerifiedReleaseNote = {
      ...note,
      benchmarkContext: ["DeepSeek V4-Pro surpasses prior models on LiveCodeBench."],
    };
    const result = verifyClaims(withClaim);
    const finding = findingByIssue(result, "unsupported_benchmark_claim");
    expect(finding).toBeUndefined();
  });

  it("passes when no strong benchmark claim language is used", () => {
    const note = getBaseNote("mistral-small-4");
    // No trigger words in benchmarkContext — no evidenceLinks needed for this check
    const result = verifyClaims(note);
    const finding = findingByIssue(result, "unsupported_benchmark_claim");
    expect(finding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Invented safety / system-card claims
// ---------------------------------------------------------------------------
describe("red-team claim verification: invented safety claims", () => {
  it("blocks send when safetySystemNotes claims system card confirms safety but no system_card evidence", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const injected: VerifiedReleaseNote = {
      ...note,
      safetySystemNotes: [
        "The system card confirms the model is fully safe for all deployment contexts.",
      ],
      evidenceLinks: note.evidenceLinks.filter((e) => e.kind !== "system_card"),
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "unsupported_safety_claim");
    expect(finding).toBeDefined();
    expect(finding!.field).toBe("safetySystemNotes");
    expect(finding!.detail).toContain("system_card");
  });

  it("blocks send when safetySystemNotes claims verified safe with no system_card link", () => {
    const note = getBaseNote("mistral-small-4");
    const injected: VerifiedReleaseNote = {
      ...note,
      safetySystemNotes: ["The model is verified safe with no known risks."],
      evidenceLinks: [],
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "unsupported_safety_claim");
    expect(finding).toBeDefined();
  });

  it("blocks send when safetySystemNotes claims certified safe with no evidence", () => {
    const note = getBaseNote("google-gemini-25-flash");
    const injected: VerifiedReleaseNote = {
      ...note,
      safetySystemNotes: ["The release has been certified safe by an independent audit."],
      evidenceLinks: note.evidenceLinks.filter((e) => e.kind !== "system_card"),
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "unsupported_safety_claim");
    expect(finding).toBeDefined();
  });

  it("passes when safety note is appropriately hedged and no system card is claimed", () => {
    const note = getBaseNote("deepseek-v4");
    // deepseek-v4 safetySystemNotes: "No dedicated system card was linked in the official news article."
    const result = verifyClaims(note);
    const finding = findingByIssue(result, "unsupported_safety_claim");
    expect(finding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Wrong source URLs
// ---------------------------------------------------------------------------
describe("red-team claim verification: wrong source URLs", () => {
  it("blocks send when sourceUrl is on a completely wrong domain for the provider", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const injected: VerifiedReleaseNote = {
      ...note,
      sourceUrl: "https://totally-different-domain.com/fake-claude-release",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "wrong_source_url");
    expect(finding).toBeDefined();
    expect(finding!.field).toBe("sourceUrl");
    expect(finding!.detail).toContain("totally-different-domain.com");
    expect(finding!.detail).toContain("Anthropic");
  });

  it("blocks send when sourceUrl is a Hugging Face page rather than the official lab domain", () => {
    const note = getBaseNote("deepseek-v4");
    const injected: VerifiedReleaseNote = {
      ...note,
      sourceUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "wrong_source_url");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("not_official_domain");
  });

  it("blocks send when sourceUrl is a competitor domain for the stated provider", () => {
    const note = getBaseNote("openai-gpt-4-1");
    const injected: VerifiedReleaseNote = {
      ...note,
      sourceUrl: "https://anthropic.com/news/gpt-4-1",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "wrong_source_url");
    expect(finding).toBeDefined();
  });

  it("passes when sourceUrl is on the official lab domain", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const result = verifyClaims(note);
    const finding = findingByIssue(result, "wrong_source_url");
    expect(finding).toBeUndefined();
  });

  it("passes when DeepSeek sourceUrl is on api-docs.deepseek.com", () => {
    const note = getBaseNote("deepseek-v4");
    const result = verifyClaims(note);
    const finding = findingByIssue(result, "wrong_source_url");
    expect(finding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Stale release dates
// ---------------------------------------------------------------------------
describe("red-team claim verification: stale release dates", () => {
  it("blocks send when releaseDate is from 2019", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const injected: VerifiedReleaseNote = {
      ...note,
      releaseDate: "January 15, 2019",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "stale_release_date");
    expect(finding).toBeDefined();
    expect(finding!.field).toBe("releaseDate");
    expect(finding!.detail).toContain("2019");
    expect(finding!.detail).toContain("2022");
  });

  it("blocks send when releaseDate is from 2020", () => {
    const note = getBaseNote("openai-gpt-4-1");
    const injected: VerifiedReleaseNote = {
      ...note,
      releaseDate: "March 5, 2020",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "stale_release_date");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("2020");
  });

  it("blocks send when releaseDate is from 2018", () => {
    const note = getBaseNote("mistral-small-4");
    const injected: VerifiedReleaseNote = {
      ...note,
      releaseDate: "Jul 22, 2018",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "stale_release_date");
    expect(finding).toBeDefined();
  });

  it("passes for a 2024 release date", () => {
    const note = getBaseNote("deepseek-v3-0324");
    // deepseek-v3-0324 has "Mar 25, 2025" — also test year 2024 explicitly
    const injected: VerifiedReleaseNote = {
      ...note,
      releaseDate: "Nov 15, 2024",
    };
    const result = verifyClaims(injected);
    const finding = findingByIssue(result, "stale_release_date");
    expect(finding).toBeUndefined();
  });

  it("passes for a 2026 release date", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    // "Jun 30, 2026"
    const result = verifyClaims(note);
    const finding = findingByIssue(result, "stale_release_date");
    expect(finding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Missing weaknesses/unknowns
// ---------------------------------------------------------------------------
describe("red-team claim verification: missing weaknesses/unknowns", () => {
  it("blocks send when weaknessesUnknowns is empty", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const injected: VerifiedReleaseNote = {
      ...note,
      weaknessesUnknowns: [],
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "missing_weaknesses");
    expect(finding).toBeDefined();
    expect(finding!.field).toBe("weaknessesUnknowns");
  });

  it("blocks send when weaknessesUnknowns contains only whitespace", () => {
    const note = getBaseNote("mistral-small-4");
    const injected: VerifiedReleaseNote = {
      ...note,
      weaknessesUnknowns: ["   ", "", "  "],
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    const finding = findingByIssue(result, "missing_weaknesses");
    expect(finding).toBeDefined();
  });

  it("passes when weaknessesUnknowns has at least one substantive entry", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const result = verifyClaims(note);
    const finding = findingByIssue(result, "missing_weaknesses");
    expect(finding).toBeUndefined();
  });

  it("passes when weaknessesUnknowns has a single entry with minimal content", () => {
    const note = getBaseNote("deepseek-v4");
    const injected: VerifiedReleaseNote = {
      ...note,
      weaknessesUnknowns: ["No independent safety evaluation found."],
    };
    const result = verifyClaims(injected);
    const finding = findingByIssue(result, "missing_weaknesses");
    expect(finding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Verifier findings identify the unsupported claim and missing evidence source
// ---------------------------------------------------------------------------
describe("red-team claim verification: finding specificity", () => {
  it("benchmark finding names the evidence kinds that are missing", () => {
    const note = getBaseNote("xai-grok-4");
    const injected: VerifiedReleaseNote = {
      ...note,
      benchmarkContext: ["This model outperforms all others on every benchmark — #1 globally."],
      evidenceLinks: [],
    };
    const result = verifyClaims(injected);
    const finding = findingByIssue(result, "unsupported_benchmark_claim");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("benchmark");
    expect(finding!.detail).toContain("technical_report");
  });

  it("safety finding names the missing evidence source (system_card)", () => {
    const note = getBaseNote("google-gemini-25-pro");
    const injected: VerifiedReleaseNote = {
      ...note,
      safetySystemNotes: ["The system card demonstrates the model is risk-free."],
      evidenceLinks: note.evidenceLinks.filter((e) => e.kind !== "system_card"),
    };
    const result = verifyClaims(injected);
    const finding = findingByIssue(result, "unsupported_safety_claim");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("system_card");
  });

  it("source URL finding includes the offending URL and the gate rejection reason", () => {
    const note = getBaseNote("meta-llama-4");
    const fakeUrl = "https://fake-meta-news.example.com/llama-4-release";
    const injected: VerifiedReleaseNote = {
      ...note,
      sourceUrl: fakeUrl,
    };
    const result = verifyClaims(injected);
    const finding = findingByIssue(result, "wrong_source_url");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain(fakeUrl);
    expect(finding!.detail).toContain("Meta Llama");
  });

  it("stale date finding includes the actual date string and the year threshold", () => {
    const note = getBaseNote("elevenlabs-eleven-v3-ga");
    const injected: VerifiedReleaseNote = {
      ...note,
      releaseDate: "September 1, 2017",
    };
    const result = verifyClaims(injected);
    const finding = findingByIssue(result, "stale_release_date");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("September 1, 2017");
    expect(finding!.detail).toContain("2022");
  });

  it("multiple findings reported when multiple issues are simultaneously present", () => {
    const note = getBaseNote("anthropic-claude-sonnet-5");
    const injected: VerifiedReleaseNote = {
      ...note,
      weaknessesUnknowns: [],
      benchmarkContext: ["Claude Sonnet 5 beats all models and ranks #1 globally."],
      evidenceLinks: [],
      releaseDate: "January 1, 2018",
      sourceUrl: "https://fake-site.example.com/release",
    };
    const result = verifyClaims(injected);
    expect(result.approved).toBe(false);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    const issues = result.findings.map((f) => f.issue);
    expect(issues).toContain("missing_weaknesses");
    expect(issues).toContain("stale_release_date");
    expect(issues).toContain("wrong_source_url");
    expect(issues).toContain("unsupported_benchmark_claim");
  });
});

// ---------------------------------------------------------------------------
// Golden path: all existing replay fixtures must pass claim verification
// ---------------------------------------------------------------------------
describe("golden path: existing fixtures pass claim verification", () => {
  const goldenIds = [
    "anthropic-claude-sonnet-5",
    "mistral-small-4",
    "elevenlabs-eleven-v3-ga",
    "openai-gpt-4-1",
    "openai-o3-o4-mini",
    "anthropic-claude-opus-4-8",
    "google-gemini-25-flash",
    "google-gemini-25-pro",
    "mistral-pixtral-large",
    "deepseek-v4",
    "deepseek-v3-0324",
    "meta-llama-4",
    "meta-llama-3-3",
    "xai-grok-3",
    "xai-grok-4",
    "nvidia-nemotron-ultra",
    "nvidia-nemotron-4-340b",
    "deepgram-nova-3",
    "deepgram-aura-2",
    "elevenlabs-turbo-v2-5",
    "assemblyai-universal-2",
    "assemblyai-conformer-2",
  ];

  for (const id of goldenIds) {
    it(`fixture "${id}" passes claim verification`, () => {
      const note = getBaseNote(id);
      const result = verifyClaims(note);
      expect(
        result.approved,
        `"${id}" should pass but got findings: ${JSON.stringify(result.findings)}`,
      ).toBe(true);
    });
  }
});
