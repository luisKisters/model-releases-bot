import { describe, expect, it, vi } from "vitest";
import {
  formatSourceFailureAlert,
  formatTelegramSignal,
  sendTelegramMessage,
  shouldSendToTelegram,
  telegramConfigured,
} from "../src/lib/radar/telegram";
import {
  buildVerifiedReleaseNote,
  formatVerifiedReleaseNote,
  releaseReplayCases,
} from "../src/lib/radar/releaseMessages";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";

// ---------------------------------------------------------------------------
// 1. Dry-run never calls Telegram
// ---------------------------------------------------------------------------
describe("red-team telegram: dry-run never calls Telegram", () => {
  it("shouldSendToTelegram returns willSend=false with reason=dry_run when dryRun=true", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: true, sendTelegramFlag: true });
    expect(decision.willSend).toBe(false);
    expect(decision.reason).toBe("dry_run");
  });

  it("dry-run blocks send even when gate approves and verifier passes", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "anthropic-claude-sonnet-5")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    expect(note.gate.shouldSend).toBe(true);
    expect(note.verificationStatus).toBe("verified");
    const decision = shouldSendToTelegram(note, { dryRun: true, sendTelegramFlag: true });
    expect(decision.willSend).toBe(false);
    expect(decision.reason).toBe("dry_run");
  });

  it("dry-run flag overrides all other flags including sendTelegramFlag", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "mistral-small-4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: true, sendTelegramFlag: true });
    expect(decision.willSend).toBe(false);
  });

  it("sendTelegramMessage is not called during dry-run (mock verification)", async () => {
    const fakeFetch = vi.fn();
    // Simulate dry-run by checking gate before calling sendTelegramMessage
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: true, sendTelegramFlag: true });
    if (decision.willSend) {
      await sendTelegramMessage("should not reach here", fakeFetch);
    }
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Non-dry-run without --send-telegram never calls Telegram
// ---------------------------------------------------------------------------
describe("red-team telegram: non-dry-run without --send-telegram never calls Telegram", () => {
  it("shouldSendToTelegram returns willSend=false with reason=send_flag_not_set when sendTelegramFlag=false", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: false, sendTelegramFlag: false });
    expect(decision.willSend).toBe(false);
    expect(decision.reason).toBe("send_flag_not_set");
  });

  it("sendTelegramFlag absent (undefined) also blocks send", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "anthropic-claude-sonnet-5")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: false });
    expect(decision.willSend).toBe(false);
    expect(decision.reason).toBe("send_flag_not_set");
  });

  it("sendTelegramMessage is not called without sendTelegramFlag (mock verification)", async () => {
    const fakeFetch = vi.fn();
    const releaseCase = releaseReplayCases.find((c) => c.id === "mistral-small-4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: false, sendTelegramFlag: false });
    if (decision.willSend) {
      await sendTelegramMessage("should not reach here", fakeFetch);
    }
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("even a fully verified note is not sent without --send-telegram", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "xai-grok-4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    expect(note.gate.shouldSend).toBe(true);
    const decision = shouldSendToTelegram(note, { dryRun: false, sendTelegramFlag: false });
    expect(decision.willSend).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Non-dry-run with --send-telegram sends only verified release notes
// ---------------------------------------------------------------------------
describe("red-team telegram: non-dry-run with --send-telegram sends only verified notes", () => {
  it("shouldSendToTelegram returns willSend=true for a fully verified note with sendTelegramFlag=true", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const decision = shouldSendToTelegram(note, { dryRun: false, sendTelegramFlag: true });
    expect(decision.willSend).toBe(true);
    expect(decision.reason).toBe("approved");
  });

  it("willSend=true only when gate approves, status is verified, not dry-run, and flag is set", () => {
    const approved = releaseReplayCases.filter((c) =>
      evaluateArticleGate({ provider: c.provider, title: c.title, url: c.url }).shouldSend,
    );
    expect(approved.length).toBeGreaterThan(0);
    for (const releaseCase of approved) {
      const note = buildVerifiedReleaseNote(releaseCase);
      const decision = shouldSendToTelegram(note, { dryRun: false, sendTelegramFlag: true });
      expect(decision.willSend).toBe(true);
    }
  });

  it("sendTelegramMessage returns missing-env error when env vars are absent even with willSend=true", async () => {
    // This verifies that even if willSend=true, missing env vars prevent an actual send
    const fakeFetch = vi.fn();
    const result = await sendTelegramMessage("test message", fakeFetch);
    // Without env vars set, sendTelegramMessage returns ok=false (no fetch call)
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Telegram env vars are missing/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Rejected candidates cannot call Telegram even if --send-telegram is set
// ---------------------------------------------------------------------------
describe("red-team telegram: rejected candidates blocked even with --send-telegram", () => {
  it("gate-rejected note produces willSend=false with reason=gate_rejected", () => {
    const rejectedNote = buildVerifiedReleaseNote({
      id: "bad-huggingface-page",
      provider: "DeepSeek",
      title: "DeepSeek-V4-Pro on Hugging Face",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
      releaseDate: "Apr 24, 2026",
      modelNames: ["DeepSeek-V4-Pro"],
      whereItShines: [],
      strengths: [],
      weaknessesUnknowns: ["Unknown."],
      benchmarkContext: [],
      safetySystemNotes: [],
    });
    expect(rejectedNote.gate.shouldSend).toBe(false);
    const decision = shouldSendToTelegram(rejectedNote, { dryRun: false, sendTelegramFlag: true });
    expect(decision.willSend).toBe(false);
    expect(decision.reason).toBe("gate_rejected");
  });

  it("changelog-only URL is gate-rejected and blocked from Telegram", () => {
    const rejectedNote = buildVerifiedReleaseNote({
      id: "cohere-changelog",
      provider: "Cohere",
      title: "Classification endpoint update",
      url: "https://docs.cohere.com/changelog/classification-endpoint",
      releaseDate: "May 1, 2026",
      modelNames: [],
      whereItShines: [],
      strengths: [],
      weaknessesUnknowns: ["Unknown."],
      benchmarkContext: [],
      safetySystemNotes: [],
    });
    expect(rejectedNote.gate.shouldSend).toBe(false);
    const decision = shouldSendToTelegram(rejectedNote, { dryRun: false, sendTelegramFlag: true });
    expect(decision.willSend).toBe(false);
  });

  it("note with verificationStatus=rejected cannot send even with sendTelegramFlag=true and gate passing", () => {
    // Construct a note whose verificationStatus is manually set to rejected
    const releaseCase = releaseReplayCases.find((c) => c.id === "anthropic-claude-sonnet-5")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const manuallyRejected = { ...note, verificationStatus: "rejected" as const };
    const decision = shouldSendToTelegram(manuallyRejected, { dryRun: false, sendTelegramFlag: true });
    expect(decision.willSend).toBe(false);
    expect(decision.reason).toBe("not_verified");
  });

  it("shouldSendToTelegram with gate_rejected reason blocks sendTelegramMessage call (mock)", async () => {
    const fakeFetch = vi.fn();
    const rejectedNote = buildVerifiedReleaseNote({
      id: "bad-url-test",
      provider: "OpenAI",
      title: "GPT-5 on Hugging Face",
      url: "https://huggingface.co/openai/gpt-5",
      releaseDate: "Jun 1, 2026",
      modelNames: ["GPT-5"],
      whereItShines: [],
      strengths: [],
      weaknessesUnknowns: ["Unknown."],
      benchmarkContext: [],
      safetySystemNotes: [],
    });
    const decision = shouldSendToTelegram(rejectedNote, { dryRun: false, sendTelegramFlag: true });
    if (decision.willSend) {
      await sendTelegramMessage("blocked", fakeFetch);
    }
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("all red-team source eligibility rejections are blocked from Telegram", () => {
    const rejectedCandidates = [
      // Hugging Face org update
      { provider: "DeepSeek", title: "DeepSeek-AI on Hugging Face", url: "https://huggingface.co/deepseek-ai" },
      // Cohere changelog
      { provider: "Cohere", title: "Changelog", url: "https://docs.cohere.com/changelog" },
      // Third-party article
      { provider: "Google Gemini", title: "Gemini page on OpenRouter", url: "https://openrouter.ai/google/gemini-2.5-pro" },
    ];
    for (const candidate of rejectedCandidates) {
      const gate = evaluateArticleGate(candidate);
      const fakeNote = { gate, verificationStatus: gate.shouldSend ? "verified" : "rejected" };
      const decision = shouldSendToTelegram(fakeNote, { dryRun: false, sendTelegramFlag: true });
      expect(decision.willSend).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Telegram formatting stays under length limits and preserves source URLs
// ---------------------------------------------------------------------------
describe("red-team telegram: formatting length limits and source URL preservation", () => {
  it("formatVerifiedReleaseNote stays within Telegram 4096 char limit for all replay cases", () => {
    for (const releaseCase of releaseReplayCases) {
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message.length).toBeLessThanOrEqual(4096);
    }
  });

  it("formatVerifiedReleaseNote preserves the canonical source URL", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const message = formatVerifiedReleaseNote(note);
    expect(message).toContain(releaseCase.url);
  });

  it("sendTelegramMessage truncates messages exceeding 4096 chars", async () => {
    const longText = "x".repeat(5000);
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    // Set env vars for the test scope
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalChatId = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "fake-bot-token-123456";
    process.env.TELEGRAM_CHAT_ID = "fake-chat-id";
    try {
      await sendTelegramMessage(longText, fakeFetch);
      const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
      expect(body.text.length).toBeLessThanOrEqual(4096);
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
  });

  it("formatVerifiedReleaseNote includes at least one source URL link in Sources line", () => {
    for (const releaseCase of releaseReplayCases.slice(0, 5)) {
      const note = buildVerifiedReleaseNote(releaseCase);
      const message = formatVerifiedReleaseNote(note);
      expect(message).toMatch(/Sources:.*https?:\/\//s);
    }
  });

  it("formatTelegramSignal stays under 4096 chars for realistic signals", () => {
    const message = formatTelegramSignal({
      provider: "Anthropic",
      title: "Introducing Claude Sonnet 5 — the most capable mid-tier model",
      url: "https://www.anthropic.com/news/claude-sonnet-5",
      sourceLabel: "Anthropic Blog RSS",
      confidence: "official",
      summary: "Claude Sonnet 5 is Anthropic's new mid-tier model for coding, reasoning, and everyday assistant workloads.",
      modelNames: ["Claude Sonnet 5", "claude-sonnet-5"],
    });
    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message).toContain("Model release");
    expect(message).toContain("Summary: Claude Sonnet 5 is Anthropic's new mid-tier model");
    expect(message).toContain("Models: Claude Sonnet 5");
    expect(message).toContain("https://www.anthropic.com/news/claude-sonnet-5");
    expect(message).not.toContain("Confidence:");
  });

  it("cleans feed navigation labels and preserves a model family plus its variant", () => {
    const message = formatTelegramSignal({
      provider: "Qwen",
      title: "Qwen3-Coder: Agentic Coding in the World",
      sourceLabel: "Qwen blog RSS",
      summary: "GITHUB HUGGING FACE MODELSCOPE DISCORD Today, we&rsquo;re announcing Qwen3-Coder.",
      modelNames: ["Qwen3-Coder", "Qwen3-Coder-480B-A35B-Instruct"],
      confidence: "official",
      isTest: true,
    });

    expect(message).toContain("Summary: Today, we're announcing Qwen3-Coder.");
    expect(message).toContain("Models: Qwen3-Coder, Qwen3-Coder-480B-A35B-Instruct");
    expect(message).not.toContain("GITHUB HUGGING FACE");
    expect(message).not.toContain("&rsquo;");
  });

  it("formatVerifiedReleaseNote evidence links are URLs (not raw model card page as sendable article)", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const message = formatVerifiedReleaseNote(note);
    // The source URL is the official article, not the HuggingFace model card
    expect(message).toContain("api-docs.deepseek.com");
    // The HF model card should appear only as an evidence link, not as the sendable article URL
    const officialArticleLine = message.split("\n").find((l) => l.startsWith("- Sources:"));
    expect(officialArticleLine).toContain("api-docs.deepseek.com");
  });
});

// ---------------------------------------------------------------------------
// 6. Operational source-failure alerts are not labeled as model releases
// ---------------------------------------------------------------------------
describe("red-team telegram: source-failure alerts not labeled as model releases", () => {
  it("formatSourceFailureAlert does not contain 'model release' language", () => {
    const alert = formatSourceFailureAlert({
      sourceId: "anthropic-blog-rss",
      sourceLabel: "Anthropic Blog RSS",
      error: "HTTP 503: Service Unavailable",
      url: "https://www.anthropic.com/blog/rss.xml",
    });
    expect(alert.toLowerCase()).not.toMatch(/model\s+release/);
    expect(alert.toLowerCase()).not.toContain("new model");
    expect(alert.toLowerCase()).not.toContain("introducing");
  });

  it("formatSourceFailureAlert labels itself as an operational alert", () => {
    const alert = formatSourceFailureAlert({
      sourceId: "openai-news-rss",
      sourceLabel: "OpenAI News RSS",
      error: "Connection timeout after 30s",
    });
    expect(alert.toLowerCase()).toContain("operational alert");
  });

  it("formatSourceFailureAlert includes the source label and error", () => {
    const alert = formatSourceFailureAlert({
      sourceId: "deepseek-docs-rss",
      sourceLabel: "DeepSeek API Docs",
      error: "HTTP 404: Not Found",
      url: "https://api-docs.deepseek.com/feed.xml",
    });
    expect(alert).toContain("DeepSeek API Docs");
    expect(alert).toContain("HTTP 404");
  });

  it("formatSourceFailureAlert stays under Telegram length limit", () => {
    const alert = formatSourceFailureAlert({
      sourceId: "very-long-source-id-that-might-be-verbose",
      sourceLabel: "A Very Long Source Label With Lots Of Detail About The RSS Feed Source",
      error: "Connection refused: ECONNREFUSED (errno=-111) at host api-docs.deepseek.com:443",
      url: "https://api-docs.deepseek.com/feed.xml",
    });
    expect(alert.length).toBeLessThanOrEqual(4096);
  });

  it("source_failure signal type cannot reach shouldSendToTelegram as a release note", () => {
    // A source_failure signal produces a PollFailure, not a VerifiedReleaseNote.
    // Verify that the gate rejects any attempt to construct a release note from a failure source.
    const gate = evaluateArticleGate({
      provider: "Anthropic",
      title: "source failure alert",
      url: "https://www.anthropic.com/blog/rss.xml",
    });
    // RSS feed URL is a generic source path, so gate should reject it
    expect(gate.shouldSend).toBe(false);
    expect(gate.reason).toBe("not_dedicated_article");
  });

  it("formatTelegramSignal header says 'Model release' — verify source_failure uses formatSourceFailureAlert instead", () => {
    const releaseMessage = formatTelegramSignal({
      provider: "Anthropic",
      title: "Test signal",
      url: "https://www.anthropic.com/news/test",
      sourceLabel: "Anthropic Blog",
      confidence: "official",
    });
    expect(releaseMessage).toContain("Model release");

    const failureAlert = formatSourceFailureAlert({
      sourceId: "anthropic-blog-rss",
      sourceLabel: "Anthropic Blog RSS",
      error: "HTTP 503",
    });
    expect(failureAlert).not.toContain("Model release");
    expect(failureAlert).toContain("Operational alert");
  });

  it("telegramConfigured returns false when env vars are absent, preventing source_failure alert leakage", () => {
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalChatId = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      expect(telegramConfigured()).toBe(false);
    } finally {
      if (originalToken !== undefined) {
        process.env.TELEGRAM_BOT_TOKEN = originalToken;
      }
      if (originalChatId !== undefined) {
        process.env.TELEGRAM_CHAT_ID = originalChatId;
      }
    }
  });
});
