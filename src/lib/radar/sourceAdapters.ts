import { decodeEntities, normalizeWhitespace, stripTags } from "./text";
import type { DiscoveryCandidate, SourceConfig } from "./types";

const MAX_ITEMS = 12;

/**
 * Normalize raw source content into DiscoveryCandidate records.
 * canonicalUrl is always null at this stage — it is populated by a later
 * fetching pass (Task 4) after following redirects.
 */
export function normalizeToDiscoveryCandidates(
  source: SourceConfig,
  rawText: string,
): DiscoveryCandidate[] {
  if (source.parser === "rssAtom") {
    return parseRssAtomCandidates(source, rawText);
  }
  if (source.parser === "huggingfaceOrg") {
    return parseHuggingFaceCandidates(source, rawText);
  }
  if (source.parser === "jsonCatalog") {
    return parseJsonCatalogCandidates(source, rawText);
  }
  if (source.parser === "sitemap") {
    return parseSitemapCandidates(source, rawText);
  }
  return parseHtmlCandidates(source, rawText);
}

function base(
  source: SourceConfig,
  title: string,
  candidateUrl: string | null,
  extra: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  return {
    lab: source.provider,
    provider: source.provider,
    sourceId: source.sourceId,
    sourceType: source.sourceRole,
    sourceUrl: source.url,
    candidateUrl,
    canonicalUrl: null,
    title: normalizeWhitespace(title).slice(0, 220) || source.label,
    summary: null,
    publishedAt: null,
    updatedAt: null,
    confidence: source.confidence,
    rawMetadata: {},
    discoveredVia: source.parser,
    ...extra,
  };
}

function parseRssAtomCandidates(
  source: SourceConfig,
  raw: string,
): DiscoveryCandidate[] {
  const blocks = [
    ...raw.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...raw.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  return blocks.slice(0, MAX_ITEMS).map((block) => {
    const title = tagText(block, "title") ?? tagText(block, "id") ?? source.label;
    const link = tagText(block, "link") ?? attrText(block, "link", "href") ?? null;
    const summary = tagText(block, "description") ?? tagText(block, "summary") ?? tagText(block, "content");
    const publishedAt =
      tagText(block, "pubDate") ??
      tagText(block, "published") ??
      tagText(block, "dc:date") ??
      null;
    const updatedAt = tagText(block, "updated") ?? tagText(block, "lastmod") ?? null;

    return base(source, title, link, {
      summary: summary ? normalizeWhitespace(stripTags(summary)).slice(0, 500) : null,
      publishedAt,
      updatedAt,
      rawMetadata: { block: block.slice(0, 2000) },
    });
  });
}

function parseHuggingFaceCandidates(
  source: SourceConfig,
  raw: string,
): DiscoveryCandidate[] {
  const payload = JSON.parse(raw) as Array<Record<string, unknown>>;

  return payload.slice(0, MAX_ITEMS).map((model) => {
    const id = String(model.id ?? model.modelId ?? "unknown");
    const updatedAt = String(model.lastModified ?? model.updatedAt ?? "");
    const createdAt = String(model.createdAt ?? "");
    const title = updatedAt ? `${id} updated ${updatedAt}` : id;

    return base(source, title, `https://huggingface.co/${id}`, {
      summary: model.pipeline_tag ? String(model.pipeline_tag) : null,
      publishedAt: createdAt || null,
      updatedAt: updatedAt || null,
      rawMetadata: { id, pipeline_tag: model.pipeline_tag, lastModified: model.lastModified },
    });
  });
}

function parseJsonCatalogCandidates(
  source: SourceConfig,
  raw: string,
): DiscoveryCandidate[] {
  const payload = JSON.parse(raw) as unknown;
  const items: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];

  return items.slice(0, MAX_ITEMS).map((item) => {
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? row.slug ?? row.name ?? "unknown");
    const name = String(row.name ?? row.title ?? id);
    const title = id === name ? name : `${name} (${id})`;

    return base(source, title, source.url, {
      summary: row.description ? normalizeWhitespace(String(row.description)).slice(0, 500) : null,
      rawMetadata: { id, name, description: row.description },
    });
  });
}

function parseSitemapCandidates(
  source: SourceConfig,
  raw: string,
): DiscoveryCandidate[] {
  const includes = source.urlIncludes ?? [];
  const blocks = [...raw.matchAll(/<url\b[\s\S]*?<\/url>/gi)].map((m) => m[0]);

  return blocks
    .map((block) => ({
      loc: tagText(block, "loc") ?? null,
      lastmod: tagText(block, "lastmod") ?? null,
    }))
    .filter(({ loc }) => loc && (includes.length === 0 || includes.some((p) => loc!.includes(p))))
    .slice(0, MAX_ITEMS)
    .map(({ loc, lastmod }) =>
      base(source, `${source.provider} page changed ${lastmod ?? ""}`, loc, {
        updatedAt: lastmod,
        rawMetadata: { loc, lastmod },
      }),
    );
}

function parseHtmlCandidates(
  source: SourceConfig,
  raw: string,
): DiscoveryCandidate[] {
  const headingMatches = [
    ...raw.matchAll(/^#{1,3}\s+(.+)$/gm),
    ...raw.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi),
    ...raw.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi),
  ];

  const candidates = headingMatches
    .map((m) => stripTags(m[1] ?? ""))
    .filter(Boolean)
    .filter(looksReleaseRelevant);

  if (candidates.length === 0) {
    return [base(source, `${source.label} changed`, source.url)];
  }

  const seen = new Set<string>();
  return candidates
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_ITEMS)
    .map((title) => base(source, decodeEntities(title), source.url));
}

function looksReleaseRelevant(value: string): boolean {
  return /model|release|launch|available|api|pricing|changelog|gpt|claude|gemini|grok|llama|mistral|deepseek|qwen|kimi|glm|minimax|mimo|nemotron/i.test(
    value,
  );
}

function tagText(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1] ? stripTags(m[1]) : undefined;
}

function attrText(block: string, tag: string, attr: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return m?.[1] ? decodeEntities(m[1]) : undefined;
}
