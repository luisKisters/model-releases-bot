import { describe, expect, it } from "vitest";
import { sourceRegistry } from "../src/lib/radar/sources";

describe("sourceRegistry", () => {
  it("contains only selected sendable labs and selected discovery sources", () => {
    const providers = new Set(sourceRegistry.map((source) => source.provider));

    expect(providers).toEqual(
      new Set([
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
      ]),
    );
  });

  it("does not include explicitly excluded v1 sources", () => {
    const serialized = JSON.stringify(sourceRegistry).toLowerCase();

    for (const excluded of [
      "cohere",
      "qwen",
      "kimi",
      "z.ai",
      "minimax",
      "mimo",
      "openrouter",
      "huggingface-global",
      "huggingface.co/deepseek-ai",
      "huggingface.co/xiaomimimo",
      "docs.cohere.com/changelog",
      "artificial-analysis",
    ]) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it("keeps NVIDIA scoped to Nemotron", () => {
    const nvidiaSources = sourceRegistry.filter((source) => source.provider.includes("NVIDIA"));

    expect(nvidiaSources.length).toBeGreaterThan(0);
    expect(nvidiaSources.every((source) => /nemotron/i.test(`${source.provider} ${source.label} ${source.url}`))).toBe(
      true,
    );
  });
});
