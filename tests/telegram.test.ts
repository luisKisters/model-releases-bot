import { describe, expect, it, vi } from "vitest";
import {
  escapeHtml,
  sendReleasePair,
  sendTelegramMessage,
  shouldSendToTelegram,
} from "../src/lib/radar/telegram";

async function withTelegramEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "fake-bot-token-123456";
  process.env.TELEGRAM_CHAT_ID = "fake-chat-id";
  try {
    return await run();
  } finally {
    if (originalToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    } else {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
    if (originalChatId !== undefined) {
      process.env.TELEGRAM_CHAT_ID = originalChatId;
    } else {
      delete process.env.TELEGRAM_CHAT_ID;
    }
  }
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 400 ? "Bad Request" : "OK",
    json: async () => payload,
  };
}

describe("escapeHtml", () => {
  it("escapes &, <, > in order without double-escaping", () => {
    expect(escapeHtml("Foo & Bar <script> tag")).toBe("Foo &amp; Bar &lt;script&gt; tag");
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("DeepSeek-V4 pricing $1.10/Mtok")).toBe("DeepSeek-V4 pricing $1.10/Mtok");
  });
});

describe("sendTelegramMessage HTML + reply options", () => {
  it("includes parse_mode HTML in the request body when requested", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 42 } }));
      const result = await sendTelegramMessage("<b>hi</b>", fakeFetch, { parseMode: "HTML" });
      const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
      expect(body.parse_mode).toBe("HTML");
      expect(result.messageId).toBe(42);
    }));

  it("includes reply_to_message_id in the request body when provided", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 43 } }));
      await sendTelegramMessage("reply text", fakeFetch, { replyToMessageId: 42 });
      const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
      expect(body.reply_to_message_id).toBe(42);
    }));

  it("omits parse_mode and reply_to_message_id when not provided", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 44 } }));
      await sendTelegramMessage("plain text", fakeFetch);
      const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
      expect(body.parse_mode).toBeUndefined();
      expect(body.reply_to_message_id).toBeUndefined();
    }));

  it("does not surface a messageId when the send fails", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(400, { ok: false, description: "bad entities" }));
      const result = await sendTelegramMessage("<b>broken", fakeFetch, { parseMode: "HTML" });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.messageId).toBeUndefined();
    }));
});

describe("sendReleasePair", () => {
  it("sends message1 then message2 as a threaded reply to message1's id", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 100 } }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 101 } }));

      const result = await sendReleasePair("<b>Message 1</b>", "<b>Message 2</b>", fakeFetch);

      expect(fakeFetch).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
      const secondBody = JSON.parse(fakeFetch.mock.calls[1][1].body as string);

      expect(firstBody.parse_mode).toBe("HTML");
      expect(firstBody.reply_to_message_id).toBeUndefined();
      expect(secondBody.parse_mode).toBe("HTML");
      expect(secondBody.reply_to_message_id).toBe(100);

      expect(result.ok).toBe(true);
      expect(result.message1.messageId).toBe(100);
      expect(result.message2?.messageId).toBe(101);
      expect(result.message1PlainTextFallback).toBe(false);
      expect(result.message2PlainTextFallback).toBe(false);
    }));

  it("falls back to plain text and resends message1 on a 400 HTML parse error", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(400, { ok: false, description: "can't parse entities" }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 200 } }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 201 } }));

      const result = await sendReleasePair("<b>Broken & unclosed", "<b>Message 2</b>", fakeFetch);

      expect(fakeFetch).toHaveBeenCalledTimes(3);
      const plainRetryBody = JSON.parse(fakeFetch.mock.calls[1][1].body as string);
      expect(plainRetryBody.parse_mode).toBeUndefined();
      expect(plainRetryBody.text).toBe("Broken & unclosed");

      expect(result.ok).toBe(true);
      expect(result.message1PlainTextFallback).toBe(true);
      expect(result.message1.messageId).toBe(200);
      // message2 still links as a reply to the successfully-sent (plain) message1
      const message2Body = JSON.parse(fakeFetch.mock.calls[2][1].body as string);
      expect(message2Body.reply_to_message_id).toBe(200);
    }));

  it("falls back to plain text and resends message2 on a 400 HTML parse error", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 300 } }))
        .mockResolvedValueOnce(jsonResponse(400, { ok: false, description: "can't parse entities" }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 301 } }));

      const result = await sendReleasePair("<b>Message 1</b>", "<i>Broken</i> <tag>", fakeFetch);

      expect(fakeFetch).toHaveBeenCalledTimes(3);
      const plainRetryBody = JSON.parse(fakeFetch.mock.calls[2][1].body as string);
      expect(plainRetryBody.parse_mode).toBeUndefined();
      expect(plainRetryBody.reply_to_message_id).toBe(300);
      expect(plainRetryBody.text).toBe("Broken ");

      expect(result.ok).toBe(true);
      expect(result.message2PlainTextFallback).toBe(true);
      expect(result.message2?.messageId).toBe(301);
    }));

  it("never drops the release: message1 send still succeeds via plain-text fallback even when heavily tagged", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(400, { ok: false, description: "can't parse entities" }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 400 } }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 401 } }));

      const html = '<b>Lab</b> <i>Released</i> <a href="https://example.com">link</a> &amp; more';
      const result = await sendReleasePair(html, "<b>Message 2</b>", fakeFetch);

      const plainRetryBody = JSON.parse(fakeFetch.mock.calls[1][1].body as string);
      expect(plainRetryBody.text).toBe("Lab Released link & more");
      expect(result.ok).toBe(true);
    }));

  it("does not attempt message2 when message1 fails for a non-HTML reason", async () =>
    withTelegramEnv(async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, description: "server error" }));
      const result = await sendReleasePair("<b>Message 1</b>", "<b>Message 2</b>", fakeFetch);

      expect(fakeFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.message2).toBeNull();
    }));

  it("dry-run callers never invoke sendReleasePair at all (gate checked before send)", async () => {
    const fakeFetch = vi.fn();
    const decision = shouldSendToTelegram(
      { gate: { shouldSend: true }, verificationStatus: "verified" },
      { dryRun: true, sendTelegramFlag: true },
    );
    expect(decision.willSend).toBe(false);
    if (decision.willSend) {
      await sendReleasePair("msg1", "msg2", fakeFetch);
    }
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("missing Telegram env vars: message1 fails with no fetch call and message2 is never attempted", async () => {
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalChatId = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      const fakeFetch = vi.fn();
      const result = await sendReleasePair("<b>Message 1</b>", "<b>Message 2</b>", fakeFetch);
      expect(fakeFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.message1.error).toMatch(/Telegram env vars are missing/);
    } finally {
      if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
      if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
    }
  });
});
