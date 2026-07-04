import { stableHash } from "./hash";
import { parseSourceContent } from "./parsers";
import type { PollResult, PollSourceInput } from "./types";

type FetchLike = typeof fetch;

export async function pollSource(source: PollSourceInput, fetchImpl: FetchLike = fetch): Promise<PollResult> {
  try {
    const headers: Record<string, string> = {
      accept: acceptHeader(source.parser),
      "user-agent": "model-release-radar/0.1 (+https://github.com)",
    };

    if (source.etag) {
      headers["if-none-match"] = source.etag;
    }

    if (source.lastModified) {
      headers["if-modified-since"] = source.lastModified;
    }

    const response = await fetchImpl(source.url, { headers });

    if (response.status === 304) {
      return {
        ok: true,
        sourceId: source.sourceId,
        changed: false,
        statusCode: response.status,
        parsedSignals: [],
        itemCount: 0,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        sourceId: source.sourceId,
        statusCode: response.status,
        error: `${response.status} ${response.statusText}`,
      };
    }

    const raw = await response.text();
    const contentHash = stableHash(raw);

    if (source.lastContentHash && source.lastContentHash === contentHash) {
      return {
        ok: true,
        sourceId: source.sourceId,
        changed: false,
        statusCode: response.status,
        contentHash,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        parsedSignals: [],
        itemCount: 0,
      };
    }

    const parsedSignals = parseSourceContent(source, raw);

    return {
      ok: true,
      sourceId: source.sourceId,
      changed: true,
      statusCode: response.status,
      contentHash,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      parsedSignals,
      itemCount: parsedSignals.length,
    };
  } catch (error) {
    return {
      ok: false,
      sourceId: source.sourceId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function acceptHeader(parser: PollSourceInput["parser"]): string {
  if (parser === "huggingfaceOrg" || parser === "jsonCatalog") {
    return "application/json,text/plain;q=0.8,*/*;q=0.5";
  }

  if (parser === "rssAtom" || parser === "sitemap") {
    return "application/xml,text/xml,application/rss+xml,application/atom+xml,text/plain;q=0.8,*/*;q=0.5";
  }

  return "text/markdown,text/plain,text/html,*/*;q=0.5";
}
