import { describe, expect, it } from "vitest";
import {
  buildVerifiedReleaseNote,
  defaultReplayReleaseIds,
  extractEvidenceLinks,
  formatVerifiedReleaseNote,
  selectReleaseReplayCases,
} from "../src/lib/radar/releaseMessages";
import { extractModelNames } from "../src/lib/radar/text";

describe("release replay messages", () => {
  it("includes the requested Sonnet 5 replay plus two selected-lab releases", () => {
    expect(defaultReplayReleaseIds).toEqual([
      "anthropic-claude-sonnet-5",
      "mistral-small-4",
      "elevenlabs-eleven-v3-ga",
    ]);
  });

  it("builds verified notes for all default replay releases", () => {
    const notes = selectReleaseReplayCases().map((releaseCase) => buildVerifiedReleaseNote(releaseCase));

    expect(notes).toHaveLength(3);
    expect(notes.every((note) => note.gate.shouldSend)).toBe(true);
    expect(notes.map((note) => note.provider)).toEqual(["Anthropic", "Mistral", "ElevenLabs"]);
  });

  it("renders concise Telegram-ready release notes with provenance", () => {
    const [releaseCase] = selectReleaseReplayCases(["anthropic-claude-sonnet-5"]);
    const note = buildVerifiedReleaseNote(releaseCase);
    const message = formatVerifiedReleaseNote(note);

    expect(message).toContain("Verified model release: Introducing Claude Sonnet 5");
    expect(message).toContain("Lab: Anthropic");
    expect(message).toContain("Weaknesses/unknowns:");
    expect(message).toContain("Sources:");
    expect(message.length).toBeLessThanOrEqual(4096);
  });

  it("detects linked system and benchmark evidence from article HTML", () => {
    const links = extractEvidenceLinks(
      `<a href="/system-card.pdf">Claude Sonnet 5 System Card</a>
       <a href="https://example.com/benchmarks">Benchmark details</a>`,
      "https://www.anthropic.com/news/claude-sonnet-5",
    );

    expect(links).toEqual([
      {
        kind: "system_card",
        label: "Claude Sonnet 5 System Card",
        url: "https://www.anthropic.com/system-card.pdf",
      },
      {
        kind: "benchmark",
        label: "Benchmark details",
        url: "https://example.com/benchmarks",
      },
    ]);
  });

  it("extracts current lab model names", () => {
    expect(extractModelNames("Introducing Claude Sonnet 5 as claude-sonnet-5")).toContain("Claude Sonnet 5");
    expect(extractModelNames("Introducing Mistral Small 4 and mistral-small-latest")).toContain("Mistral Small 4");
    expect(extractModelNames("Eleven v3 is generally available")).toContain("Eleven v3");
    expect(extractModelNames("Introducing Command A")).toContain("Command A");
  });
});
