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
  sourceRole: "sendable",
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

  it("uses sitemap URL slugs in signal titles for model extraction", () => {
    const signals = parseSourceContent(
      { ...baseSource, provider: "Z.ai", parser: "sitemap", urlIncludes: ["/guides/llm/glm"] },
      `<urlset><url><loc>https://docs.z.ai/guides/llm/glm-5.2</loc><lastmod>2026-06-30</lastmod></url></urlset>`,
    );

    expect(signals[0].title).toContain("glm-5.2");
    expect(signals[0].modelNames).toContain("glm-5.2");
  });

  it("parses JSON catalogs with data arrays", () => {
    const signals = parseSourceContent(
      { ...baseSource, parser: "jsonCatalog", confidence: "catalog_confirmation", signalType: "catalog" },
      JSON.stringify({ data: [{ id: "openai/gpt-5.1", name: "GPT-5.1" }] }),
    );

    expect(signals[0].title).toContain("GPT-5.1");
    expect(signals[0].modelNames).toContain("GPT-5.1");
  });

  it("skips utility navigation links while extracting Kimi resource model articles", () => {
    const source: SourceConfig = {
      ...baseSource,
      sourceId: "kimi-resources",
      provider: "Kimi",
      label: "Kimi resources",
      url: "https://www.kimi.com/resources",
      parser: "html",
      notify: false,
      sourceRole: "discovery",
    };
    const html = `<html><body>
      <a href="/products/kimi-work">Kimi Work AI desktop agent for knowledge workers</a>
      <a href="/features/webbridge">Kimi WebBridge A browser extension for AI agents</a>
      <a href="/resources/kimi-claw-introduction">Kimi Claw Deploy 24/7 AI agents in one click</a>
      <a href="/blog/kimi-k2-6">Kimi K2.6 Advancing Open-Source Coding</a>
      <a href="/resources/kimi-k2-7-code">Kimi K2.7 Code</a>
    </body></html>`;

    const signals = parseSourceContent(source, html);

    expect(signals.some((signal) => signal.url === "https://www.kimi.com/resources/kimi-k2-7-code")).toBe(true);
    expect(signals.some((signal) => signal.url?.includes("/products/"))).toBe(false);
  });
});
