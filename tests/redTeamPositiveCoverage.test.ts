import { describe, expect, it } from "vitest";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { buildVerifiedReleaseNote, releaseReplayCases } from "../src/lib/radar/releaseMessages";
import { sourceRegistry } from "../src/lib/radar/sources";
import { parseSourceContent } from "../src/lib/radar/parsers";
import type { SourceConfig } from "../src/lib/radar/types";

// Every selected lab must have at least two replay cases.
const SELECTED_LABS = [
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "Mistral",
  "DeepSeek",
  "Meta Llama",
  "xAI",
  "NVIDIA Nemotron",
  "Deepgram",
  "ElevenLabs",
  "AssemblyAI",
];

describe("red-team positive coverage", () => {
  describe("every selected lab has at least two positive replay fixtures", () => {
    for (const lab of SELECTED_LABS) {
      it(`${lab} has >= 2 replay cases`, () => {
        const labCases = releaseReplayCases.filter((c) => c.provider === lab);
        expect(
          labCases.length,
          `Lab "${lab}" must have at least 2 relay cases; found ${labCases.length}`,
        ).toBeGreaterThanOrEqual(2);
      });
    }
  });

  describe("every positive fixture passes the article gate", () => {
    for (const releaseCase of releaseReplayCases) {
      it(`${releaseCase.id} passes the article gate`, () => {
        const decision = evaluateArticleGate({
          provider: releaseCase.provider,
          title: releaseCase.title,
          url: releaseCase.url,
        });
        expect(
          decision.shouldSend,
          `Case "${releaseCase.id}" failed gate with reason: ${decision.reason}`,
        ).toBe(true);
        expect(decision.reason).toBe("official_dedicated_model_release_article");
      });
    }
  });

  describe("every positive fixture produces a VerifiedReleaseNote with all required fields", () => {
    for (const releaseCase of releaseReplayCases) {
      it(`${releaseCase.id} has all required fields`, () => {
        const note = buildVerifiedReleaseNote(releaseCase);

        // canonical URL
        expect(note.sourceUrl).toBeTruthy();
        expect(() => new URL(note.sourceUrl)).not.toThrow();

        // release date
        expect(note.releaseDate).toBeTruthy();
        expect(note.releaseDate.length).toBeGreaterThan(0);

        // model names
        expect(note.modelNames.length).toBeGreaterThan(0);

        // verifier status
        expect(note.gate.shouldSend).toBe(true);
        expect(note.verificationStatus).toBe("verified");
        expect(note.gate.reason).toBe("official_dedicated_model_release_article");

        // evidence status (field present, may be empty for offline cases)
        expect(Array.isArray(note.evidenceLinks)).toBe(true);

        // benchmark status (field present and non-empty)
        expect(Array.isArray(note.benchmarkContext)).toBe(true);
        expect(note.benchmarkContext.length).toBeGreaterThan(0);

        // weaknesses/unknowns (required by verifier spec)
        expect(Array.isArray(note.weaknessesUnknowns)).toBe(true);
        expect(note.weaknessesUnknowns.length).toBeGreaterThan(0);

        // cost status (offline replay = $0)
        expect(note.costSummary).toBeDefined();
        expect(note.costSummary.mode).toBe("offline");
        expect(note.costSummary.totalCostUsd).toBe(0);
        expect(Array.isArray(note.costSummary.stages)).toBe(true);
      });
    }
  });

  it("all positive fixtures across all labs produce verified notes when batch-built", () => {
    const notes = releaseReplayCases.map((c) => buildVerifiedReleaseNote(c));
    expect(notes.every((n) => n.verificationStatus === "verified")).toBe(true);
    expect(notes.every((n) => n.gate.shouldSend)).toBe(true);
    expect(notes.every((n) => n.costSummary.mode === "offline")).toBe(true);
  });

  it("covers all selected labs in the positive fixture set", () => {
    const coveredLabs = new Set(releaseReplayCases.map((c) => c.provider));
    for (const lab of SELECTED_LABS) {
      expect(coveredLabs.has(lab), `No positive fixtures for lab "${lab}"`).toBe(true);
    }
  });

  describe("discovery-only sources cannot directly send but their URLs pass the article gate", () => {
    it("all discovery-only sources (notify=false) produce signals with shouldNotify=false", () => {
      const discoveryOnlySources = sourceRegistry.filter((s) => !s.notify);
      expect(discoveryOnlySources.length).toBeGreaterThan(0);

      const minimalHtml = "<h1>Model released</h1>";
      for (const source of discoveryOnlySources) {
        const signals = parseSourceContent(source, minimalHtml);
        for (const signal of signals) {
          expect(
            signal.shouldNotify,
            `Discovery-only source "${source.sourceId}" must produce shouldNotify=false`,
          ).toBe(false);
        }
      }
    });

    it("a Deepgram blog article URL passes the article gate when evaluated directly", () => {
      // Deepgram has no notify=true sources — all are discovery-only.
      // Operators can still use a discovered URL in a direct smoke run.
      const deepgramBlogSource = sourceRegistry.find((s) => s.sourceId === "deepgram-blog");
      expect(deepgramBlogSource).toBeDefined();
      expect(deepgramBlogSource!.notify).toBe(false);

      // URL discovered from the blog can still pass the gate directly
      const decision = evaluateArticleGate({
        provider: "Deepgram",
        title: "Introducing Nova-3: Deepgram's most accurate model",
        url: "https://deepgram.com/learn/nova-3-model",
      });
      expect(decision.shouldSend).toBe(true);
      expect(decision.reason).toBe("official_dedicated_model_release_article");
    });

    it("an ElevenLabs blog article URL passes the article gate when evaluated directly", () => {
      const elevenBlogSource = sourceRegistry.find((s) => s.sourceId === "elevenlabs-blog");
      expect(elevenBlogSource).toBeDefined();
      expect(elevenBlogSource!.notify).toBe(false);

      const decision = evaluateArticleGate({
        provider: "ElevenLabs",
        title: "Introducing Turbo v2.5: our fastest multilingual model",
        url: "https://elevenlabs.io/blog/turbo-v2-5",
      });
      expect(decision.shouldSend).toBe(true);
      expect(decision.reason).toBe("official_dedicated_model_release_article");
    });

    it("an AssemblyAI blog article URL passes the article gate when evaluated directly", () => {
      const assemblyBlogSource = sourceRegistry.find((s) => s.sourceId === "assemblyai-blog");
      expect(assemblyBlogSource).toBeDefined();
      expect(assemblyBlogSource!.notify).toBe(false);

      const decision = evaluateArticleGate({
        provider: "AssemblyAI",
        title: "Introducing Universal-2: the most accurate speech model ever made",
        url: "https://www.assemblyai.com/blog/universal-2/",
      });
      expect(decision.shouldSend).toBe(true);
      expect(decision.reason).toBe("official_dedicated_model_release_article");
    });

    it("a discovery-only source signal for a valid article has shouldNotify=false (gate suppressed by source)", () => {
      // Even when the article gate would approve, source.notify=false overrides it
      const deepgramBlog: SourceConfig = {
        sourceId: "deepgram-blog",
        provider: "Deepgram",
        label: "Deepgram blog",
        url: "https://deepgram.com/learn",
        parser: "html",
        confidence: "official",
        signalType: "release_note",
        pollEveryMinutes: 15,
        enabled: true,
        notify: false,
      };

      const html = `<h1>Introducing Nova-3: Deepgram's most accurate model</h1>`;
      const signals = parseSourceContent(deepgramBlog, html);
      expect(signals.length).toBeGreaterThan(0);

      for (const signal of signals) {
        // source.notify=false means shouldNotify must be false even if gate approves
        expect(signal.shouldNotify).toBe(false);
      }
    });
  });

  describe("fixture URL integrity — every positive fixture URL is on its lab's official domain", () => {
    for (const releaseCase of releaseReplayCases) {
      it(`${releaseCase.id} URL is on the official domain for ${releaseCase.provider}`, () => {
        const decision = evaluateArticleGate({
          provider: releaseCase.provider,
          title: releaseCase.title,
          url: releaseCase.url,
        });
        // Must not fail due to domain mismatch
        expect(decision.reason).not.toBe("not_official_domain");
        expect(decision.reason).not.toBe("unsupported_source_host");
        expect(decision.shouldSend).toBe(true);
      });
    }
  });
});
