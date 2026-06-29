import { describe, expect, it, vi } from "vitest";
import { pollSource } from "../src/lib/radar/poller";
import { stableHash } from "../src/lib/radar/hash";
import type { SourceConfig } from "../src/lib/radar/types";

const source: SourceConfig = {
  sourceId: "openai-test",
  provider: "OpenAI",
  label: "OpenAI test",
  url: "https://example.com/feed",
  parser: "rssAtom",
  confidence: "official",
  signalType: "release_note",
  pollEveryMinutes: 5,
  enabled: true,
  notify: true,
};

describe("pollSource", () => {
  it("creates parsed signals for changed content", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        `<rss><channel><item><title>Released GPT-5.3</title><link>https://example.com/release</link></item></channel></rss>`,
        { status: 200, headers: { etag: "abc" } },
      );
    });

    const result = await pollSource(source, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.parsedSignals).toHaveLength(1);
      expect(result.parsedSignals[0].shouldNotify).toBe(true);
      expect(result.etag).toBe("abc");
    }
  });

  it("does not parse unchanged content", async () => {
    const raw = `<rss><channel><item><title>Released GPT-5.3</title></item></channel></rss>`;
    const fetchImpl = vi.fn(async () => new Response(raw, { status: 200 }));

    const result = await pollSource({ ...source, lastContentHash: stableHash(raw) }, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
      expect(result.parsedSignals).toHaveLength(0);
    }
  });

  it("records fetch failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500, statusText: "Server Error" }));
    const result = await pollSource(source, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain("Server Error");
    }
  });
});
