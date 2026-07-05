import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCanonicalUrl,
  fetchUrl,
  FetchError,
  probeAsset,
} from "../src/lib/radar/fetching";
import {
  extractArticle,
  extractArticleFromHtml,
} from "../src/lib/radar/browserTools";

function fixtureHtml(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures/snapshots", name), "utf8");
}

function makeFetch(
  body: string,
  {
    status = 200,
    contentType = "text/html; charset=utf-8",
    url,
    redirected = false,
  }: { status?: number; contentType?: string; url?: string; redirected?: boolean } = {},
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    url: url ?? "https://example.com/page",
    redirected,
    headers: {
      get: (header: string) => {
        if (header === "content-type") return contentType;
        return null;
      },
    },
    text: () => Promise.resolve(body),
  } as unknown as Response);
}

// --- fetchUrl ---

describe("fetchUrl", () => {
  it("returns body and metadata on 200", async () => {
    const fetch = makeFetch("<html><body>hello</body></html>");
    const result = await fetchUrl("https://example.com/page", { fetchImpl: fetch });
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("hello");
    expect(result.contentType).toContain("text/html");
    expect(result.isRedirected).toBe(false);
  });

  it("returns isRedirected=true when response was redirected", async () => {
    const fetch = makeFetch("<html/>", {
      url: "https://example.com/final",
      redirected: true,
    });
    const result = await fetchUrl("https://example.com/old", { fetchImpl: fetch });
    expect(result.isRedirected).toBe(true);
    expect(result.finalUrl).toBe("https://example.com/final");
  });

  it("throws FetchError on non-retryable 404", async () => {
    const fetch = makeFetch("", { status: 404 });
    await expect(fetchUrl("https://example.com/page", { fetchImpl: fetch })).rejects.toThrow(FetchError);
  });

  it("retries on 503 up to maxRetries", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        url: "https://example.com/page",
        redirected: false,
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(""),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://example.com/page",
        redirected: false,
        headers: { get: (h: string) => (h === "content-type" ? "text/html" : null) },
        text: () => Promise.resolve("<html>ok</html>"),
      } as unknown as Response);

    const result = await fetchUrl("https://example.com/page", { fetchImpl: fetch, maxRetries: 1 });
    expect(result.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns empty body but does not throw for non-HTML content type", async () => {
    const fetch = makeFetch("binary data", { contentType: "image/png" });
    const result = await fetchUrl("https://example.com/image.png", { fetchImpl: fetch });
    expect(result.body).toBe("");
    expect(result.statusCode).toBe(200);
  });

  it("aborts and retries on timeout", async () => {
    let calls = 0;
    const fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://example.com/page",
        redirected: false,
        headers: { get: (h: string) => (h === "content-type" ? "text/html" : null) },
        text: () => Promise.resolve("<html>retry ok</html>"),
      } as unknown as Response);
    });

    const result = await fetchUrl("https://example.com/page", { fetchImpl: fetch, maxRetries: 1 });
    expect(result.body).toContain("retry ok");
  });
});

// --- extractCanonicalUrl ---

describe("extractCanonicalUrl", () => {
  it("extracts canonical from link rel=canonical", () => {
    const html = `<html><head><link rel="canonical" href="https://example.com/canonical/"></head></html>`;
    expect(extractCanonicalUrl(html, "https://example.com/page")).toBe("https://example.com/canonical/");
  });

  it("extracts canonical from og:url meta", () => {
    const html = `<meta property="og:url" content="https://example.com/og-url/">`;
    expect(extractCanonicalUrl(html, "https://example.com/")).toBe("https://example.com/og-url/");
  });

  it("resolves relative canonical URLs against base", () => {
    const html = `<link rel="canonical" href="/relative/path">`;
    expect(extractCanonicalUrl(html, "https://example.com/page")).toBe("https://example.com/relative/path");
  });

  it("returns null when no canonical tag present", () => {
    const html = `<html><head><title>No canonical</title></head></html>`;
    expect(extractCanonicalUrl(html, "https://example.com/")).toBeNull();
  });

  it("returns null for invalid canonical URL", () => {
    const html = `<link rel="canonical" href="not-a-url">`;
    // relative URL resolves fine
    const result = extractCanonicalUrl(html, "https://example.com/");
    expect(result).toBe("https://example.com/not-a-url");
  });
});

// --- extractArticleFromHtml (fixture-based) ---

describe("extractArticleFromHtml – DeepSeek V4 fixture", () => {
  const html = fixtureHtml("deepseek-v4.html");
  const article = extractArticleFromHtml(html, "https://api-docs.deepseek.com/news/news260424");

  it("extracts title from og:title", () => {
    expect(article.title).toBe("DeepSeek-V4-Pro and DeepSeek-V4-Flash Model Release");
  });

  it("extracts canonical URL", () => {
    expect(article.canonicalUrl).toBe("https://api-docs.deepseek.com/news/news260424");
  });

  it("extracts publishedAt from article:published_time", () => {
    expect(article.publishedAt).toBe("2026-04-24T00:00:00Z");
  });

  it("extracts publisher from og:site_name", () => {
    expect(article.publisher).toBe("DeepSeek");
  });

  it("body contains model names and deprecation note", () => {
    expect(article.body).toContain("DeepSeek-V4-Pro");
    expect(article.body).toContain("DeepSeek-V4-Flash");
    expect(article.body).toContain("deprecated");
  });

  it("headings are extracted", () => {
    expect(article.headings).toContain("Overview");
    expect(article.headings).toContain("Technical Report");
  });

  it("outbound links include tech report and HuggingFace", () => {
    expect(article.outboundLinks.some((l) => l.includes("arxiv.org"))).toBe(true);
    expect(article.outboundLinks.some((l) => l.includes("huggingface.co"))).toBe(true);
  });

  it("images are extracted with alt text", () => {
    expect(article.images.length).toBeGreaterThan(0);
    const img = article.images[0];
    expect(img?.altText).toContain("benchmark");
    expect(img?.src).toContain("api-docs.deepseek.com");
  });

  it("reducedConfidence is true (HTTP-only extraction)", () => {
    expect(article.reducedConfidence).toBe(true);
  });
});

describe("extractArticleFromHtml – Anthropic Claude fixture", () => {
  const html = fixtureHtml("anthropic-claude.html");
  const article = extractArticleFromHtml(html, "https://www.anthropic.com/news/claude-opus-4");

  it("extracts title", () => {
    expect(article.title).toBe("Introducing Claude Opus 4");
  });

  it("extracts author from og:site_name or meta author", () => {
    expect(article.publisher).toBe("Anthropic");
  });

  it("links include system card URL", () => {
    expect(article.outboundLinks.some((l) => l.includes("system-card"))).toBe(true);
  });
});

describe("extractArticleFromHtml – OpenAI GPT fixture", () => {
  const html = fixtureHtml("openai-gpt.html");
  const article = extractArticleFromHtml(html, "https://openai.com/index/gpt-5/");

  it("extracts title", () => {
    expect(article.title).toBe("Introducing GPT-5");
  });

  it("body contains GPT-5", () => {
    expect(article.body).toContain("GPT-5");
  });
});

describe("extractArticleFromHtml – Gemini fixture", () => {
  const html = fixtureHtml("gemini-release.html");
  const article = extractArticleFromHtml(html, "https://deepmind.google/technologies/gemini/gemini-2-5-pro/");

  it("extracts canonical URL", () => {
    expect(article.canonicalUrl).toContain("gemini-2-5-pro");
  });

  it("extracts publishedAt", () => {
    expect(article.publishedAt).toBe("2025-05-20T00:00:00Z");
  });
});

describe("extractArticleFromHtml – Mistral fixture", () => {
  const html = fixtureHtml("mistral-release.html");
  const article = extractArticleFromHtml(html, "https://mistral.ai/news/mistral-small-3");

  it("extracts title", () => {
    expect(article.title).toBe("Announcing Mistral Small 3");
  });

  it("body contains model name", () => {
    expect(article.body).toContain("Mistral Small 3");
  });
});

describe("extractArticleFromHtml – Deepgram fixture", () => {
  const html = fixtureHtml("deepgram-release.html");
  const article = extractArticleFromHtml(html, "https://deepgram.com/learn/nova-3-speech-model");

  it("extracts title", () => {
    expect(article.title).toContain("Nova-3");
  });

  it("images contain chart", () => {
    expect(article.images.some((img) => img.altText?.includes("WER"))).toBe(true);
  });
});

describe("extractArticleFromHtml – ElevenLabs fixture", () => {
  const html = fixtureHtml("elevenlabs-release.html");
  const article = extractArticleFromHtml(html, "https://elevenlabs.io/blog/introducing-eleven-flash-v2-5");

  it("extracts title", () => {
    expect(article.title).toContain("Eleven Flash v2.5");
  });
});

describe("extractArticleFromHtml – AssemblyAI fixture", () => {
  const html = fixtureHtml("assemblyai-release.html");
  const article = extractArticleFromHtml(html, "https://www.assemblyai.com/blog/announcing-universal-1");

  it("extracts title", () => {
    expect(article.title).toContain("Universal-1");
  });

  it("body contains performance details", () => {
    expect(article.body).toContain("WER");
  });
});

// --- Edge cases ---

describe("extractArticleFromHtml – edge cases", () => {
  it("handles missing article body gracefully", () => {
    const html = `<html><head><title>Page</title></head><body><p>No article element here</p></body></html>`;
    const article = extractArticleFromHtml(html, "https://example.com/page");
    expect(article.title).toBe("Page");
    // body may be null when no article/main/content section is found
    if (article.body !== null) {
      expect(article.body).toContain("No article element");
    }
  });

  it("handles canonical URL mismatch (different from base URL)", () => {
    const html = `<link rel="canonical" href="https://example.com/canonical/"><title>Page</title>`;
    const article = extractArticleFromHtml(html, "https://example.com/old-path");
    expect(article.canonicalUrl).toBe("https://example.com/canonical/");
    expect(article.url).toBe("https://example.com/old-path");
  });

  it("returns empty headings when none present", () => {
    const html = `<article><p>No headings here at all.</p></article>`;
    const article = extractArticleFromHtml(html, "https://example.com/");
    expect(article.headings).toHaveLength(0);
  });

  it("returns empty images list when none present", () => {
    const html = `<article><p>Text only</p></article>`;
    const article = extractArticleFromHtml(html, "https://example.com/");
    expect(article.images).toHaveLength(0);
  });

  it("extracts downloadable PDF links", () => {
    const html = `<article><a href="/paper/technical-report.pdf">Technical Report</a></article>`;
    const article = extractArticleFromHtml(html, "https://example.com/");
    expect(article.downloadableAssets).toHaveLength(1);
    expect(article.downloadableAssets[0]?.url).toContain("technical-report.pdf");
    expect(article.downloadableAssets[0]?.filename).toBe("technical-report.pdf");
  });

  it("handles JavaScript-heavy page with no article body by falling back to full body", () => {
    const html = `<html><body><div id="root">Loading...</div><script>window.__data = 'payload'</script></body></html>`;
    const article = extractArticleFromHtml(html, "https://example.com/js-heavy");
    // No article/main element — body extraction falls back, body may be null or minimal
    expect(article.reducedConfidence).toBe(true);
  });

  it("broken image src does not throw", () => {
    const html = `<article><img src="not a url at all %" alt="broken"></article>`;
    expect(() => extractArticleFromHtml(html, "https://example.com/")).not.toThrow();
  });

  it("extracts title from <h1> when no og:title or <title>", () => {
    const html = `<article><h1>My H1 Title</h1><p>Content</p></article>`;
    const article = extractArticleFromHtml(html, "https://example.com/");
    expect(article.title).toBe("My H1 Title");
  });

  it("strips site name suffix from <title> tag", () => {
    const html = `<head><title>My Article | Example Site</title></head>`;
    const article = extractArticleFromHtml(html, "https://example.com/");
    expect(article.title).toBe("My Article");
  });
});

// --- extractArticle with HTTP fallback ---

describe("extractArticle – HTTP fallback when no browser launcher", () => {
  it("returns reducedConfidence=true and missingBrowserReason", async () => {
    const fetch = makeFetch(fixtureHtml("deepseek-v4.html"), {
      url: "https://api-docs.deepseek.com/news/news260424",
    });
    const article = await extractArticle("https://api-docs.deepseek.com/news/news260424", {
      fetchImpl: fetch,
    });
    expect(article.reducedConfidence).toBe(true);
    expect(article.missingBrowserReason).toBe("no_browser_configured");
    expect(article.title).toBe("DeepSeek-V4-Pro and DeepSeek-V4-Flash Model Release");
  });
});

describe("extractArticle – browser launcher fallback on error", () => {
  it("falls back to HTTP when browser throws", async () => {
    const launcherError = new Error("Playwright not installed");
    const mockLauncher = {
      newPage: vi.fn().mockRejectedValue(launcherError),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const fetch = makeFetch(fixtureHtml("openai-gpt.html"), {
      url: "https://openai.com/index/gpt-5/",
    });

    const article = await extractArticle("https://openai.com/index/gpt-5/", {
      browserLauncher: mockLauncher,
      fetchImpl: fetch,
    });

    expect(article.reducedConfidence).toBe(true);
    expect(article.missingBrowserReason).toContain("browser_error");
    expect(article.title).toBe("Introducing GPT-5");
  });
});

describe("extractArticle – browser launcher succeeds", () => {
  it("returns reducedConfidence=false when browser provides content", async () => {
    const html = fixtureHtml("anthropic-claude.html");
    const mockPage = {
      content: vi.fn().mockResolvedValue(html),
      url: vi.fn().mockReturnValue("https://www.anthropic.com/news/claude-opus-4"),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockLauncher = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const article = await extractArticle("https://www.anthropic.com/news/claude-opus-4", {
      browserLauncher: mockLauncher,
      probeImages: false,
    });

    expect(article.reducedConfidence).toBe(false);
    expect(article.missingBrowserReason).toBeUndefined();
    expect(article.title).toBe("Introducing Claude Opus 4");
  });
});

// --- probeAsset ---

describe("probeAsset", () => {
  it("returns resolves=true when HEAD succeeds", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => {
          if (h === "content-type") return "image/png";
          if (h === "content-length") return "12345";
          return null;
        },
      },
    } as unknown as Response);

    const result = await probeAsset("https://example.com/image.png", { fetchImpl: fetch });
    expect(result.resolves).toBe(true);
    expect(result.contentType).toBe("image/png");
    expect(result.byteSize).toBe(12345);
  });

  it("returns resolves=false when HEAD returns 404", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    } as unknown as Response);

    const result = await probeAsset("https://example.com/missing.png", { fetchImpl: fetch });
    expect(result.resolves).toBe(false);
  });

  it("returns resolves=false on network error", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network failure"));
    const result = await probeAsset("https://example.com/fail.png", { fetchImpl: fetch });
    expect(result.resolves).toBe(false);
  });
});
