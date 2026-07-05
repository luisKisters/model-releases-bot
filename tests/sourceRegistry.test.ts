import { describe, expect, it } from "vitest";
import { sourceRegistry } from "../src/lib/radar/sources";
import { normalizeToDiscoveryCandidates } from "../src/lib/radar/sourceAdapters";
import { findStaleSourcesToDisable } from "../src/lib/radar/staleSourceSync";

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

const EXCLUDED_PROVIDERS = [
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
];

describe("sourceRegistry — lab coverage", () => {
  it("contains only selected labs and no others", () => {
    const providers = new Set(sourceRegistry.map((s) => s.provider));
    expect(providers).toEqual(new Set(SELECTED_LABS));
  });

  it("has at least one source per selected lab", () => {
    for (const lab of SELECTED_LABS) {
      const labSources = sourceRegistry.filter((s) => s.provider === lab);
      expect(labSources.length, `${lab} must have at least one source`).toBeGreaterThan(0);
    }
  });

  it("keeps NVIDIA scoped to Nemotron only", () => {
    const nvidiaSources = sourceRegistry.filter((s) => s.provider.includes("NVIDIA"));
    expect(nvidiaSources.length).toBeGreaterThan(0);
    expect(
      nvidiaSources.every((s) => /nemotron/i.test(`${s.provider} ${s.label} ${s.url}`)),
    ).toBe(true);
  });
});

describe("sourceRegistry — sendable vs discovery roles", () => {
  it("every source has a sourceRole of sendable or discovery", () => {
    for (const s of sourceRegistry) {
      expect(["sendable", "discovery"], `${s.sourceId} must have a valid sourceRole`).toContain(s.sourceRole);
    }
  });

  it("sendable sources have notify=true", () => {
    const sendable = sourceRegistry.filter((s) => s.sourceRole === "sendable");
    expect(sendable.length).toBeGreaterThan(0);
    for (const s of sendable) {
      expect(s.notify, `sendable source ${s.sourceId} must have notify=true`).toBe(true);
    }
  });

  it("discovery sources have notify=false", () => {
    const discovery = sourceRegistry.filter((s) => s.sourceRole === "discovery");
    expect(discovery.length).toBeGreaterThan(0);
    for (const s of discovery) {
      expect(s.notify, `discovery source ${s.sourceId} must have notify=false`).toBe(false);
    }
  });

  it("changelog and release-collection sources are discovery-only", () => {
    const changelogOrCollection = sourceRegistry.filter((s) =>
      /changelog|releases/.test(s.url),
    );
    for (const s of changelogOrCollection) {
      expect(s.sourceRole, `${s.sourceId} (changelog/collection) must be discovery`).toBe("discovery");
    }
  });

  it("html index pages are discovery-only", () => {
    const htmlIndexes = sourceRegistry.filter((s) => s.parser === "html");
    for (const s of htmlIndexes) {
      expect(s.sourceRole, `html source ${s.sourceId} must be discovery`).toBe("discovery");
    }
  });

  it("OpenAI has a sendable RSS source", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "openai-news-rss");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("sendable");
    expect(s!.parser).toBe("rssAtom");
  });

  it("Anthropic news is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "anthropic-news");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });

  it("Google Gemini has three sendable RSS sources", () => {
    const sendable = sourceRegistry.filter(
      (s) => s.provider === "Google Gemini" && s.sourceRole === "sendable",
    );
    expect(sendable.length).toBe(3);
  });

  it("Mistral has a sendable RSS source", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "mistral-rss");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("sendable");
  });

  it("DeepSeek news is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "deepseek-news");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });

  it("Meta Llama blog is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "meta-ai-blog");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });

  it("xAI news is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "xai-news");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });

  it("NVIDIA Nemotron has one sendable feed and one discovery blog", () => {
    const sendable = sourceRegistry.filter(
      (s) => s.provider === "NVIDIA Nemotron" && s.sourceRole === "sendable",
    );
    const discovery = sourceRegistry.filter(
      (s) => s.provider === "NVIDIA Nemotron" && s.sourceRole === "discovery",
    );
    expect(sendable.length).toBe(1);
    expect(discovery.length).toBe(1);
  });

  it("Deepgram changelog is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "deepgram-changelog-rss");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });

  it("ElevenLabs changelog is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "elevenlabs-changelog-rss");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });

  it("AssemblyAI release collection is discovery-only", () => {
    const s = sourceRegistry.find((s) => s.sourceId === "assemblyai-releases");
    expect(s).toBeDefined();
    expect(s!.sourceRole).toBe("discovery");
  });
});

describe("sourceRegistry — excluded providers", () => {
  it("does not include explicitly excluded provider strings in any source", () => {
    const serialized = JSON.stringify(sourceRegistry).toLowerCase();
    for (const excluded of EXCLUDED_PROVIDERS) {
      expect(serialized, `excluded provider "${excluded}" must not appear`).not.toContain(excluded);
    }
  });

  it("sendable sources contain no excluded provider strings", () => {
    const sendable = sourceRegistry.filter((s) => s.sourceRole === "sendable");
    const serialized = JSON.stringify(sendable).toLowerCase();
    for (const excluded of EXCLUDED_PROVIDERS) {
      expect(serialized, `excluded provider "${excluded}" must not appear in sendable sources`).not.toContain(excluded);
    }
  });
});

describe("findStaleSourcesToDisable — stale source cleanup", () => {
  const currentRegistryIds = new Set(sourceRegistry.map((s) => s.sourceId));

  it("identifies old deepseek-ai Hugging Face source as stale", () => {
    const existing = [
      { sourceId: "deepseek-ai-huggingface-org", enabled: true },
      { sourceId: "openai-news-rss", enabled: true },
    ];
    const stale = findStaleSourcesToDisable(currentRegistryIds, existing);
    expect(stale).toContain("deepseek-ai-huggingface-org");
    expect(stale).not.toContain("openai-news-rss");
  });

  it("identifies XiaomiMiMo Hugging Face source as stale", () => {
    const existing = [
      { sourceId: "xiaomimimo-huggingface-org", enabled: true },
      { sourceId: "mistral-rss", enabled: true },
    ];
    const stale = findStaleSourcesToDisable(currentRegistryIds, existing);
    expect(stale).toContain("xiaomimimo-huggingface-org");
    expect(stale).not.toContain("mistral-rss");
  });

  it("identifies Cohere changelog source as stale", () => {
    const existing = [
      { sourceId: "cohere-changelog-rss", enabled: true },
      { sourceId: "deepmind-rss", enabled: true },
    ];
    const stale = findStaleSourcesToDisable(currentRegistryIds, existing);
    expect(stale).toContain("cohere-changelog-rss");
    expect(stale).not.toContain("deepmind-rss");
  });

  it("does not disable already-disabled stale rows", () => {
    const existing = [
      { sourceId: "old-source-already-disabled", enabled: false },
    ];
    const stale = findStaleSourcesToDisable(currentRegistryIds, existing);
    expect(stale).toHaveLength(0);
  });

  it("returns empty list when all existing sources are in the registry", () => {
    const existing = sourceRegistry.map((s) => ({ sourceId: s.sourceId, enabled: true }));
    const stale = findStaleSourcesToDisable(currentRegistryIds, existing);
    expect(stale).toHaveLength(0);
  });

  it("disables all removed old sources in a mixed batch", () => {
    const existing = [
      { sourceId: "openai-news-rss", enabled: true },
      { sourceId: "deepseek-ai-huggingface-org", enabled: true },
      { sourceId: "cohere-docs-changelog", enabled: true },
      { sourceId: "anthropic-news", enabled: true },
    ];
    const stale = findStaleSourcesToDisable(currentRegistryIds, existing);
    expect(stale).toContain("deepseek-ai-huggingface-org");
    expect(stale).toContain("cohere-docs-changelog");
    expect(stale).not.toContain("openai-news-rss");
    expect(stale).not.toContain("anthropic-news");
  });
});

describe("normalizeToDiscoveryCandidates — source adapters", () => {
  const rssSource = sourceRegistry.find((s) => s.sourceId === "openai-news-rss")!;
  const htmlSource = sourceRegistry.find((s) => s.sourceId === "anthropic-news")!;
  const changelogSource = sourceRegistry.find((s) => s.sourceId === "deepgram-changelog-rss")!;

  it("normalizes RSS items into DiscoveryCandidate objects", () => {
    const raw = `<rss><channel>
      <item>
        <title>Introducing GPT-5</title>
        <link>https://openai.com/index/gpt-5/</link>
        <description>A new frontier model.</description>
        <pubDate>Thu, 01 May 2026 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;

    const candidates = normalizeToDiscoveryCandidates(rssSource, raw);
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.lab).toBe("OpenAI");
    expect(c.provider).toBe("OpenAI");
    expect(c.sourceId).toBe("openai-news-rss");
    expect(c.sourceType).toBe("sendable");
    expect(c.sourceUrl).toBe("https://openai.com/news/rss.xml");
    expect(c.candidateUrl).toBe("https://openai.com/index/gpt-5/");
    expect(c.canonicalUrl).toBeNull();
    expect(c.title).toContain("GPT-5");
    expect(c.summary).toContain("frontier model");
    expect(c.publishedAt).toContain("2026");
    expect(c.discoveredVia).toBe("rssAtom");
  });

  it("normalizes HTML index page into DiscoveryCandidate objects with sourceType=discovery", () => {
    const raw = `<html><body>
      <h2><a href="/news/claude-4">Introducing Claude 4</a></h2>
      <h2><a href="/news/claude-research">Claude research update</a></h2>
    </body></html>`;

    const candidates = normalizeToDiscoveryCandidates(htmlSource, raw);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].sourceType).toBe("discovery");
    expect(candidates[0].discoveredVia).toBe("html");
    expect(candidates[0].canonicalUrl).toBeNull();
    // Article links must be extracted from hrefs, not the listing-page URL
    expect(candidates[0].candidateUrl).toBe("https://www.anthropic.com/news/claude-4");
  });

  it("changelog RSS items are tagged as discovery sourceType", () => {
    const raw = `<rss><channel>
      <item>
        <title>Deepgram Nova-3 improvements</title>
        <link>https://developers.deepgram.com/changelog/nova-3-update</link>
      </item>
    </channel></rss>`;

    const candidates = normalizeToDiscoveryCandidates(changelogSource, raw);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceType).toBe("discovery");
  });

  it("all required DiscoveryCandidate fields are present", () => {
    const raw = `<rss><channel><item><title>OpenAI o3</title><link>https://openai.com/index/o3/</link></item></channel></rss>`;
    const [c] = normalizeToDiscoveryCandidates(rssSource, raw);

    const requiredFields: (keyof typeof c)[] = [
      "lab", "provider", "sourceId", "sourceType", "sourceUrl",
      "candidateUrl", "canonicalUrl", "title", "summary",
      "publishedAt", "updatedAt", "confidence", "rawMetadata", "discoveredVia",
    ];
    for (const field of requiredFields) {
      expect(c, `DiscoveryCandidate must have field ${field}`).toHaveProperty(field);
    }
  });
});
