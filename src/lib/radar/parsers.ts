import type { ParsedSignal, SourceConfig } from "./types";
import { stableFingerprint } from "./hash";
import { decodeEntities, extractModelNames, normalizeWhitespace, stripTags } from "./text";

const MAX_ITEMS = 12;

export function parseSourceContent(source: SourceConfig, raw: string): ParsedSignal[] {
  if (source.parser === "huggingfaceOrg") {
    return parseHuggingFace(source, raw);
  }

  if (source.parser === "jsonCatalog") {
    return parseJsonCatalog(source, raw);
  }

  if (source.parser === "rssAtom") {
    return parseRssAtom(source, raw);
  }

  if (source.parser === "sitemap") {
    return parseSitemap(source, raw);
  }

  return parseMarkdownOrHtml(source, raw);
}

function signalFromParts(
  source: SourceConfig,
  title: string,
  url: string | undefined,
  summary?: string,
): ParsedSignal {
  const cleanedTitle = normalizeWhitespace(title).slice(0, 220) || `${source.label} changed`;
  const cleanedSummary = summary ? normalizeWhitespace(summary).slice(0, 500) : undefined;
  const modelNames = extractModelNames(`${cleanedTitle} ${cleanedSummary ?? ""}`);

  return {
    title: cleanedTitle,
    url: url || source.url,
    summary: cleanedSummary,
    modelNames,
    fingerprint: stableFingerprint([source.provider, source.sourceId, cleanedTitle, url || source.url]),
    confidence: source.confidence,
    signalType: source.signalType,
    shouldNotify: source.notify && source.confidence !== "weak_page_change",
  };
}

function parseRssAtom(source: SourceConfig, raw: string): ParsedSignal[] {
  const blocks = [
    ...raw.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...raw.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);

  return blocks.slice(0, MAX_ITEMS).map((block) => {
    const title = tagText(block, "title") || tagText(block, "id") || source.label;
    const link = tagText(block, "link") || attrText(block, "link", "href");
    const summary = tagText(block, "description") || tagText(block, "summary") || tagText(block, "content");

    return signalFromParts(source, title, link, summary ? stripTags(summary) : undefined);
  });
}

function parseHuggingFace(source: SourceConfig, raw: string): ParsedSignal[] {
  const payload = JSON.parse(raw) as Array<Record<string, unknown>>;

  return payload.slice(0, MAX_ITEMS).map((model) => {
    const id = String(model.id ?? model.modelId ?? "unknown-model");
    const updated = String(model.lastModified ?? model.createdAt ?? "");
    const title = updated ? `${id} updated ${updated}` : id;

    return signalFromParts(source, title, `https://huggingface.co/${id}`, model.pipeline_tag as string | undefined);
  });
}

function parseJsonCatalog(source: SourceConfig, raw: string): ParsedSignal[] {
  const payload = JSON.parse(raw) as unknown;
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : [];

  return items.slice(0, MAX_ITEMS).map((item) => {
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? row.slug ?? row.name ?? "unknown-catalog-item");
    const name = String(row.name ?? row.title ?? id);
    const title = id === name ? name : `${name} (${id})`;

    return signalFromParts(source, title, source.url, String(row.description ?? ""));
  });
}

function parseSitemap(source: SourceConfig, raw: string): ParsedSignal[] {
  const blocks = [...raw.matchAll(/<url\b[\s\S]*?<\/url>/gi)].map((match) => match[0]);
  const includes = source.urlIncludes ?? [];

  return blocks
    .map((block) => {
      const loc = tagText(block, "loc");
      const lastmod = tagText(block, "lastmod");
      return { loc, lastmod };
    })
    .filter(({ loc }) => loc && (includes.length === 0 || includes.some((part) => loc.includes(part))))
    .slice(0, MAX_ITEMS)
    .map(({ loc, lastmod }) => signalFromParts(source, `${source.provider} page changed ${lastmod ?? ""}`, loc));
}

function parseMarkdownOrHtml(source: SourceConfig, raw: string): ParsedSignal[] {
  const headingMatches = [
    ...raw.matchAll(/^#{1,3}\s+(.+)$/gm),
    ...raw.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi),
    ...raw.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi),
  ];

  const candidates = headingMatches
    .map((match) => stripTags(match[1] ?? ""))
    .filter(Boolean)
    .filter((line) => looksReleaseRelevant(line));

  if (candidates.length === 0) {
    const text = stripTags(raw);
    const lines = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length >= 12 && looksReleaseRelevant(line));

    candidates.push(...lines);
  }

  if (candidates.length === 0) {
    return [signalFromParts(source, `${source.label} changed`, source.url)];
  }

  return unique(candidates)
    .slice(0, MAX_ITEMS)
    .map((title) => signalFromParts(source, decodeEntities(title), source.url));
}

function looksReleaseRelevant(value: string): boolean {
  return /model|release|launch|available|api|pricing|changelog|gpt|claude|gemini|grok|llama|mistral|deepseek|qwen|kimi|glm|minimax|mimo|nemotron/i.test(
    value,
  );
}

function tagText(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function attrText(block: string, tag: string, attr: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] ? decodeEntities(match[1]) : undefined;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
