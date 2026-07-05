import type { DownloadableAsset, ExtractedArticle, FetchOptions, ImageAsset } from "./types";
import { fetchUrl, extractCanonicalUrl, probeAsset } from "./fetching";
import type { FetchImpl } from "./fetching";
import { stripTags, normalizeWhitespace } from "./text";

const DOWNLOADABLE_EXTENSIONS = /\.(pdf|docx?|pptx?|xlsx?|zip|tar\.gz|epub)(\?[^"']*)?$/i;

export type BrowserPage = {
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
};

export type BrowserLauncher = {
  newPage(url: string): Promise<BrowserPage>;
  close(): Promise<void>;
};

export type ExtractionOptions = FetchOptions & {
  fetchImpl?: FetchImpl;
  browserLauncher?: BrowserLauncher;
  probeImages?: boolean;
  maxImages?: number;
  maxLinks?: number;
};

export async function extractArticle(
  url: string,
  options: ExtractionOptions = {},
): Promise<ExtractedArticle> {
  const { browserLauncher, fetchImpl, ...fetchOptions } = options;

  if (browserLauncher) {
    let launcher = browserLauncher;
    let page: BrowserPage | null = null;

    try {
      page = await launcher.newPage(url);
      const html = await page.content();
      const finalUrl = page.url();

      const result = extractArticleFromHtml(html, finalUrl);
      result.finalUrl = finalUrl;
      result.reducedConfidence = false;

      if (options.probeImages !== false) {
        result.images = await probeImages(result.images, fetchOptions);
      }

      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Fall through to HTTP extraction
      return extractViaHttp(url, { ...fetchOptions, fetchImpl }, `browser_error: ${reason}`);
    } finally {
      await page?.close().catch(() => undefined);
      await launcher.close().catch(() => undefined);
    }
  }

  return extractViaHttp(url, { ...fetchOptions, fetchImpl }, "no_browser_configured");
}

async function extractViaHttp(
  url: string,
  options: FetchOptions & { fetchImpl?: FetchImpl },
  missingBrowserReason: string,
): Promise<ExtractedArticle> {
  const fetched = await fetchUrl(url, options);
  const result = extractArticleFromHtml(fetched.body, fetched.finalUrl);
  result.finalUrl = fetched.finalUrl;
  result.reducedConfidence = true;
  result.missingBrowserReason = missingBrowserReason;

  return result;
}

export function extractArticleFromHtml(html: string, baseUrl: string): ExtractedArticle {
  const title = extractTitle(html);
  const canonicalUrl = extractCanonicalUrl(html, baseUrl);
  const author = extractMeta(html, ["author", "article:author"]);
  const publisher = extractMeta(html, ["og:site_name"]);
  const publishedAt = extractMeta(html, ["article:published_time", "datePublished", "date"]) ?? extractJsonLdDate(html, "datePublished");
  const updatedAt = extractMeta(html, ["article:modified_time", "dateModified"]) ?? extractJsonLdDate(html, "dateModified");

  const bodySection = extractBodySection(html);
  const body = bodySection ? normalizeWhitespace(stripTags(bodySection)).slice(0, 20_000) || null : null;

  const headings = extractHeadings(bodySection ?? html);
  const outboundLinks = extractLinks(bodySection ?? html, baseUrl);
  const images = extractImages(bodySection ?? html, baseUrl);
  const downloadableAssets = extractDownloadableAssets(bodySection ?? html, baseUrl);

  return {
    url: baseUrl,
    canonicalUrl,
    finalUrl: baseUrl,
    title,
    author,
    publisher,
    publishedAt,
    updatedAt,
    body,
    headings,
    outboundLinks,
    images,
    downloadableAssets,
    reducedConfidence: true,
  };
}

function extractTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i)?.[1];

  if (og) {
    return decodeHtmlEntities(og).trim();
  }

  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (titleTag) {
    return decodeHtmlEntities(titleTag).trim().replace(/\s*[|\-–—]\s*.+$/, "").trim();
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) {
    return stripTags(h1).trim();
  }

  return null;
}

function extractMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const value =
      html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escapeRegex(name)}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${escapeRegex(name)}["'][^>]*>`, "i"))?.[1];

    if (value) {
      return decodeHtmlEntities(value).trim();
    }
  }
  return null;
}

function extractJsonLdDate(html: string, field: string): string | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const value = data[field];
      if (typeof value === "string") {
        return value;
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  return null;
}

function extractBodySection(html: string): string | null {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  if (article) return article;

  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (main) return main;

  const roleMain = html.match(/<(?:div|section)[^>]+role=["']main["'][^>]*>[\s\S]*?<\/(?:div|section)>/i)?.[0];
  if (roleMain) return roleMain;

  const contentDiv =
    html.match(/<div[^>]+(?:class|id)=["'][^"']*(?:post|content|entry|article|story|text|body)[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0];
  if (contentDiv) return contentDiv;

  return null;
}

function extractHeadings(html: string): string[] {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  return matches
    .map((m) => stripTags(m[1]).trim())
    .filter(Boolean)
    .slice(0, 30);
}

function extractLinks(html: string, baseUrl: string): string[] {
  const matches = [...html.matchAll(/<a[^>]+href=["']([^"'#][^"']*?)["'][^>]*>/gi)];
  const seen = new Set<string>();
  const links: string[] = [];

  for (const match of matches) {
    try {
      const resolved = new URL(match[1], baseUrl).href;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        links.push(resolved);
      }
    } catch {
      // skip invalid URLs
    }
  }

  return links.slice(0, 100);
}

function extractImages(html: string, baseUrl: string): ImageAsset[] {
  const matches = [...html.matchAll(/<img[^>]+>/gi)];
  const seen = new Set<string>();
  const images: ImageAsset[] = [];

  for (const match of matches) {
    const tag = match[0];
    const src = attrValue(tag, "src") ?? attrValue(tag, "data-src");
    if (!src) continue;

    let resolved: string;
    try {
      resolved = new URL(src, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const width = attrValue(tag, "width");
    const height = attrValue(tag, "height");

    images.push({
      src: resolved,
      altText: attrValue(tag, "alt"),
      contentType: null,
      byteSize: null,
      width: width ? parseInt(width, 10) || null : null,
      height: height ? parseInt(height, 10) || null : null,
      resolves: false,
    });
  }

  return images.slice(0, 50);
}

function extractDownloadableAssets(html: string, baseUrl: string): DownloadableAsset[] {
  const matches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)];
  const seen = new Set<string>();
  const assets: DownloadableAsset[] = [];

  for (const match of matches) {
    const href = match[1];
    if (!DOWNLOADABLE_EXTENSIONS.test(href)) continue;

    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const parts = resolved.split("/");
    const filename = parts[parts.length - 1]?.split("?")[0] ?? null;

    assets.push({
      url: resolved,
      contentType: null,
      byteSize: null,
      filename: filename || null,
    });
  }

  return assets;
}

async function probeImages(
  images: ImageAsset[],
  options: FetchOptions & { fetchImpl?: FetchImpl; maxImages?: number },
): Promise<ImageAsset[]> {
  const limit = options.maxImages ?? 10;
  const toProbe = images.slice(0, limit);
  const rest = images.slice(limit);

  const probed = await Promise.all(
    toProbe.map(async (img): Promise<ImageAsset> => {
      const result = await probeAsset(img.src, options);
      return { ...img, ...result };
    }),
  );

  return [...probed, ...rest];
}

function attrValue(tag: string, attr: string): string | null {
  const match =
    tag.match(new RegExp(`\\s${escapeRegex(attr)}=["']([^"']*)["']`, "i")) ??
    tag.match(new RegExp(`\\s${escapeRegex(attr)}=([^\\s>]+)`, "i"));
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function tryPlaywrightLauncher(): Promise<BrowserLauncher | null> {
  try {
    // Dynamic import via eval avoids static module resolution when playwright
    // is an optional runtime dependency not present in all environments.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = await (Function('return import("playwright")')() as Promise<any>);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const browser = await pw.chromium.launch({ headless: true });

    return {
      async newPage(url: string): Promise<BrowserPage> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const page = await browser.newPage();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        return {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          content: () => page.content() as Promise<string>,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          url: () => page.url() as string,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          close: () => page.close() as Promise<void>,
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      close: () => browser.close() as Promise<void>,
    };
  } catch {
    return null;
  }
}
