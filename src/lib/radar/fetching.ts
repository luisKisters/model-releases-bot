import type { FetchedContent, FetchOptions } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_USER_AGENT = "model-release-radar/0.1 (+https://github.com)";

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const ACCEPTABLE_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/xhtml",
  "application/pdf",
  "application/json",
];

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchUrl(
  url: string,
  options: FetchOptions & { fetchImpl?: FetchImpl } = {},
  retryCount = 0,
): Promise<FetchedContent> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    userAgent = DEFAULT_USER_AGENT,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timer);

    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      if (RETRYABLE_STATUSES.has(response.status) && retryCount < maxRetries) {
        return fetchUrl(url, options, retryCount + 1);
      }
      throw new FetchError(`HTTP ${response.status} ${response.statusText}`, response.status);
    }

    if (!isAcceptableContentType(contentType)) {
      return {
        url,
        finalUrl: response.url || url,
        statusCode: response.status,
        contentType,
        isRedirected: response.redirected,
        body: "",
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      };
    }

    const body = await response.text();

    return {
      url,
      finalUrl: response.url || url,
      statusCode: response.status,
      contentType,
      isRedirected: response.redirected,
      body,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    };
  } catch (error) {
    clearTimeout(timer);

    if (error instanceof FetchError) {
      throw error;
    }

    const isTimeout =
      error instanceof Error && (error.name === "AbortError" || error.message.includes("abort"));

    if (isTimeout && retryCount < maxRetries) {
      return fetchUrl(url, options, retryCount + 1);
    }

    throw error;
  }
}

export function extractCanonicalUrl(html: string, baseUrl: string): string | null {
  const match =
    html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i) ??
    html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:url["'][^>]*>/i);

  if (!match?.[1]) {
    return null;
  }

  try {
    return new URL(match[1], baseUrl).href;
  } catch {
    return null;
  }
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

function isAcceptableContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return ACCEPTABLE_CONTENT_TYPES.some((t) => lower.includes(t));
}

export async function probeAsset(
  url: string,
  options: FetchOptions & { fetchImpl?: FetchImpl } = {},
): Promise<{ contentType: string | null; byteSize: number | null; resolves: boolean }> {
  const { fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT, timeoutMs = 8_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "user-agent": userAgent },
    });

    clearTimeout(timer);

    if (!response.ok) {
      return { contentType: null, byteSize: null, resolves: false };
    }

    const contentType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");

    return {
      contentType,
      byteSize: contentLength ? Number(contentLength) : null,
      resolves: true,
    };
  } catch {
    clearTimeout(timer);
    return { contentType: null, byteSize: null, resolves: false };
  }
}
