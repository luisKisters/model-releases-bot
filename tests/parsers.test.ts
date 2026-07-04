import { describe, expect, it } from "vitest";
import { parseSourceContent } from "../src/lib/radar/parsers";
import type { SourceConfig } from "../src/lib/radar/types";

const baseSource: SourceConfig = {
  sourceId: "test",
  provider: "OpenAI",
  label: "Test source",
  url: "https://openai.com/news/rss.xml",
  parser: "rssAtom",
  confidence: "official",
  signalType: "release_note",
  pollEveryMinutes: 5,
  enabled: true,
  notify: true,
};

describe("parseSourceContent", () => {
  it("parses RSS items and extracts model names", () => {
    const signals = parseSourceContent(
      baseSource,
      `<rss><channel><item><title>Released GPT-5.2 to the API</title><link>https://openai.com/index/gpt-5-2/</link><description>New model release.</description></item></channel></rss>`,
    );

    expect(signals).toHaveLength(1);
    expect(signals[0].title).toContain("GPT-5.2");
    expect(signals[0].modelNames).toContain("GPT-5.2");
    expect(signals[0].shouldNotify).toBe(true);
  });

  it("parses Hugging Face model JSON", () => {
    const signals = parseSourceContent(
      { ...baseSource, parser: "huggingfaceOrg", confidence: "official_open_weights", signalType: "open_weights" },
      JSON.stringify([{ id: "meta-llama/Llama-4-Scout", lastModified: "2026-06-01T00:00:00Z" }]),
    );

    expect(signals[0].url).toBe("https://huggingface.co/meta-llama/Llama-4-Scout");
    expect(signals[0].modelNames).toContain("Llama-4-Scout");
  });

  it("parses sitemap entries and filters urls", () => {
    const signals = parseSourceContent(
      { ...baseSource, parser: "sitemap", urlIncludes: ["updates"] },
      `<urlset><url><loc>https://mimo.mi.com/docs/en-US/updates/model</loc><lastmod>2026-06-29</lastmod></url><url><loc>https://mimo.mi.com/boring</loc></url></urlset>`,
    );

    expect(signals).toHaveLength(1);
    expect(signals[0].url).toContain("/updates/model");
  });

  it("parses JSON catalogs with data arrays", () => {
    const signals = parseSourceContent(
      { ...baseSource, parser: "jsonCatalog", confidence: "catalog_confirmation", signalType: "catalog" },
      JSON.stringify({ data: [{ id: "openai/gpt-5.1", name: "GPT-5.1" }] }),
    );

    expect(signals[0].title).toContain("GPT-5.1");
    expect(signals[0].modelNames).toContain("GPT-5.1");
  });
});
