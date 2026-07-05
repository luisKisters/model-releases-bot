import { describe, expect, it } from "vitest";
import { evaluateArticleGate, identifyProviderForUrl } from "../src/lib/radar/articleGate";
import {
  buildVerifiedReleaseNote,
  formatVerifiedReleaseNote,
  releaseReplayCases,
  selectReleaseReplayCases,
} from "../src/lib/radar/releaseMessages";

const DEEPSEEK_V4_URL = "https://api-docs.deepseek.com/news/news260424";
const DEEPSEEK_V4_HF_URL = "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark";
const DEEPSEEK_V4_ARXIV_URL = "https://arxiv.org/abs/2505.09966";

function getDeepSeekV4Case() {
  const found = releaseReplayCases.find((c) => c.id === "deepseek-v4");
  if (!found) {
    throw new Error("deepseek-v4 fixture not found in releaseReplayCases");
  }
  return found;
}

describe("DeepSeek V4 end-to-end acceptance", () => {
  // Checkpoint 1: gate result for the official article URL
  describe("article gate", () => {
    it("gate passes for the official DeepSeek V4 article URL", () => {
      const releaseCase = getDeepSeekV4Case();
      const gate = evaluateArticleGate({
        provider: releaseCase.provider,
        title: releaseCase.title,
        url: releaseCase.url,
      });
      expect(gate.shouldSend).toBe(true);
      expect(gate.lab).toBe("DeepSeek");
      expect(gate.reason).toBe("official_dedicated_model_release_article");
    });

    it("identifyProviderForUrl returns DeepSeek for the official article URL", () => {
      const provider = identifyProviderForUrl(DEEPSEEK_V4_URL);
      expect(provider).toBe("DeepSeek");
    });

    it("gate can be evaluated from URL alone (no fixture needed)", () => {
      // Smoke script evaluates gate from provider + title + url without a fixture
      const provider = identifyProviderForUrl(DEEPSEEK_V4_URL) ?? "";
      const gate = evaluateArticleGate({
        provider,
        title: "",
        url: DEEPSEEK_V4_URL,
      });
      // Domain is api-docs.deepseek.com and URL contains "deepseek" → gate passes
      expect(gate.shouldSend).toBe(true);
      expect(gate.lab).toBe("DeepSeek");
      expect(gate.reason).toBe("official_dedicated_model_release_article");
    });
  });

  // Checkpoint 2: extracted model names
  describe("model name extraction", () => {
    it("note includes DeepSeek-V4-Pro in model names", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      expect(note.modelNames).toContain("DeepSeek-V4-Pro");
    });

    it("note includes DeepSeek-V4-Flash in model names", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      expect(note.modelNames).toContain("DeepSeek-V4-Flash");
    });

    it("model names list is non-empty and has at least two models", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      expect(note.modelNames.length).toBeGreaterThanOrEqual(2);
    });
  });

  // Checkpoints 3 and 4: evidence links include tech report and open weights as evidence only
  describe("evidence links", () => {
    it("evidence links include the arxiv technical report", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const techReport = note.evidenceLinks.find((e) => e.kind === "technical_report");
      expect(techReport).toBeDefined();
      expect(techReport!.url).toContain("arxiv.org");
      expect(techReport!.url).toBe(DEEPSEEK_V4_ARXIV_URL);
    });

    it("evidence links include the Hugging Face open-weights model card", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const modelCard = note.evidenceLinks.find((e) => e.url.includes("huggingface.co"));
      expect(modelCard).toBeDefined();
      expect(modelCard!.kind).toBe("model_card");
    });

    it("Hugging Face link is classified as evidence (model_card), not as a sendable source", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);

      // HF is in evidenceLinks
      const hfInEvidence = note.evidenceLinks.some((e) => e.url.includes("huggingface.co"));
      expect(hfInEvidence).toBe(true);

      // HF is NOT the sourceUrl (the sendable article)
      expect(note.sourceUrl).not.toContain("huggingface.co");
    });
  });

  // Checkpoint 5: Hugging Face links never treated as the sendable article
  describe("HuggingFace rejection", () => {
    it("sourceUrl is the official DeepSeek article, not HuggingFace", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      expect(note.sourceUrl).toBe(DEEPSEEK_V4_URL);
    });

    it("HuggingFace DeepSeek V4 page fails the article gate (not official domain)", () => {
      const decision = evaluateArticleGate({
        provider: "DeepSeek",
        title: "DeepSeek-V4-Pro-DSpark on Hugging Face",
        url: DEEPSEEK_V4_HF_URL,
      });
      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toBe("not_official_domain");
      expect(decision.lab).toBe("DeepSeek");
    });

    it("identifyProviderForUrl returns null for the HuggingFace model page", () => {
      // HF is not a known lab domain, so provider identification fails
      const provider = identifyProviderForUrl(DEEPSEEK_V4_HF_URL);
      expect(provider).toBeNull();
    });
  });

  // Checkpoint 9: formatted message includes all required sections
  describe("formatted release message", () => {
    it("message contains verified release header", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("Verified model release:");
      expect(message).toContain("Lab: DeepSeek");
    });

    it("message contains strengths section", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("- Strengths:");
    });

    it("message contains weaknesses/unknowns section", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("- Weaknesses/unknowns:");
    });

    it("message contains benchmark context section", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("- Benchmark context:");
    });

    it("message contains safety/system notes section", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("- Safety/system notes:");
    });

    it("message contains sources section with the official article URL", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("- Sources:");
      expect(message).toContain(DEEPSEEK_V4_URL);
    });

    it("message stays within the 4096-character Telegram limit", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message.length).toBeLessThanOrEqual(4096);
    });

    it("message includes verification status as verified", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toContain("Verification: verified");
    });
  });

  // Cost summary (offline replay = $0 — live LLM call verification requires API keys)
  describe("cost summary", () => {
    it("offline replay reports mode=offline and totalCostUsd=0", () => {
      const releaseCase = getDeepSeekV4Case();
      const note = buildVerifiedReleaseNote(releaseCase);
      expect(note.costSummary.mode).toBe("offline");
      expect(note.costSummary.totalCostUsd).toBe(0);
      expect(Array.isArray(note.costSummary.stages)).toBe(true);
    });

    it("CostSummary type supports live mode and per-stage records", () => {
      // Verify the type structure exists for live LLM routing
      const releaseCase = getDeepSeekV4Case();
      const liveNote = buildVerifiedReleaseNote(releaseCase, {
        costSummary: {
          mode: "live",
          totalCostUsd: 0.12,
          stages: [
            { stage: "summarize_article", model: "deepseek-chat", costUsd: 0.08 },
            { stage: "write_message", model: "openrouter/moonshotai/kimi-k2-6", costUsd: 0.04 },
          ],
        },
      });
      expect(liveNote.costSummary.mode).toBe("live");
      expect(liveNote.costSummary.totalCostUsd).toBe(0.12);
      expect(liveNote.costSummary.stages).toHaveLength(2);
      expect(liveNote.costSummary.stages[0].stage).toBe("summarize_article");
      expect(liveNote.costSummary.stages[1].stage).toBe("write_message");
    });
  });

  // DeepSeek V4 fixture selection from registry
  describe("fixture registry", () => {
    it("deepseek-v4 case is selectable by ID", () => {
      const cases = selectReleaseReplayCases(["deepseek-v4"]);
      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe("deepseek-v4");
      expect(cases[0].provider).toBe("DeepSeek");
      expect(cases[0].url).toBe(DEEPSEEK_V4_URL);
    });

    it("deepseek-v4 fixture has both model names pre-populated", () => {
      const releaseCase = getDeepSeekV4Case();
      expect(releaseCase.modelNames).toContain("DeepSeek-V4-Pro");
      expect(releaseCase.modelNames).toContain("DeepSeek-V4-Flash");
    });

    it("deepseek-v4 fixture has evidence links pre-populated with tech report and model card", () => {
      const releaseCase = getDeepSeekV4Case();
      expect(releaseCase.evidenceLinks).toBeDefined();
      expect(releaseCase.evidenceLinks!.length).toBeGreaterThanOrEqual(2);

      const techReport = releaseCase.evidenceLinks!.find((e) => e.kind === "technical_report");
      const modelCard = releaseCase.evidenceLinks!.find((e) => e.kind === "model_card");

      expect(techReport).toBeDefined();
      expect(modelCard).toBeDefined();
    });
  });
});
