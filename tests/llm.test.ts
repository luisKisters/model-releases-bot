import { describe, expect, it, vi } from "vitest";
import {
  createLlmRouter,
  makeFakeLlmCompletion,
  CostTracker,
  CostCapExceededError,
  completeWithBudget,
  computeEstimatedCostUsd,
  redactSecrets,
  callOpenAICompatible,
  DEEPSEEK_PRICING,
  OPENROUTER_KIMI_PRICING,
  DEFAULT_KIMI_MODEL,
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_BASE_URL,
  OPENROUTER_BASE_URL,
  type LlmRole,
  type LlmMessage,
} from "../src/lib/radar/llm";

// --- Test helpers ---

function makeJsonResponse(
  body: unknown,
  { status = 200 }: { status?: number } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : ""),
    headers: { get: () => null },
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not JSON")),
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response;
}

function makeOpenAIResponse(
  text: string,
  opts: {
    id?: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    cacheHitTokens?: number;
  } = {},
) {
  return makeJsonResponse({
    id: opts.id ?? "resp-default",
    model: opts.model ?? "deepseek-chat",
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: opts.promptTokens ?? 100,
      completion_tokens: opts.completionTokens ?? 50,
      ...(opts.cacheHitTokens !== undefined
        ? { prompt_cache_hit_tokens: opts.cacheHitTokens }
        : {}),
    },
  });
}

const SAMPLE_MESSAGES: LlmMessage[] = [
  { role: "user", content: "Summarize this article about a new AI model release." },
];

// ===================================================
// Routing: DeepSeek stages
// ===================================================

describe("createLlmRouter – DeepSeek routing", () => {
  it("routes article_summarizer to DeepSeek base URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("summary"));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    const result = await router.complete("article_summarizer", SAMPLE_MESSAGES);

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(DEEPSEEK_BASE_URL);
    expect(result.usage.stage).toBe("article_summarizer");
  });

  it("routes system_card_summarizer to DeepSeek", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("summary"));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    await router.complete("system_card_summarizer", SAMPLE_MESSAGES);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(DEEPSEEK_BASE_URL);
  });

  it("routes benchmark_aggregator to DeepSeek", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("summary"));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    await router.complete("benchmark_aggregator", SAMPLE_MESSAGES);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(DEEPSEEK_BASE_URL);
  });

  it("routes evidence_synthesizer to DeepSeek", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("summary"));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    await router.complete("evidence_synthesizer", SAMPLE_MESSAGES);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(DEEPSEEK_BASE_URL);
  });

  it("sends DEFAULT_DEEPSEEK_MODEL in request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    await router.complete("article_summarizer", SAMPLE_MESSAGES);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_DEEPSEEK_MODEL);
  });

  it("uses custom deepseekModel when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));
    const router = createLlmRouter({
      deepseekApiKey: "ds-key-longerthan8",
      deepseekModel: "deepseek-reasoner",
      fetchImpl,
    });
    await router.complete("article_summarizer", SAMPLE_MESSAGES);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("deepseek-reasoner");
  });
});

// ===================================================
// Routing: OpenRouter Kimi
// ===================================================

describe("createLlmRouter – OpenRouter Kimi routing", () => {
  it("routes final_writer to OpenRouter base URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("final message"));
    const router = createLlmRouter({ openrouterApiKey: "or-key-longerthan8", fetchImpl });
    const result = await router.complete("final_writer", SAMPLE_MESSAGES);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(OPENROUTER_BASE_URL);
    expect(result.usage.stage).toBe("final_writer");
  });

  it("uses DEFAULT_KIMI_MODEL when kimiModel is not configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));
    const router = createLlmRouter({ openrouterApiKey: "or-key-longerthan8", fetchImpl });
    await router.complete("final_writer", SAMPLE_MESSAGES);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_KIMI_MODEL);
  });

  it("uses custom kimiModel override", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));
    const router = createLlmRouter({
      openrouterApiKey: "or-key-longerthan8",
      kimiModel: "moonshotai/kimi-k2.5",
      fetchImpl,
    });
    await router.complete("final_writer", SAMPLE_MESSAGES);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("moonshotai/kimi-k2.5");
  });

  it("does not route final_writer to DeepSeek even when both keys are set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));
    const router = createLlmRouter({
      deepseekApiKey: "ds-key-longerthan8",
      openrouterApiKey: "or-key-longerthan8",
      fetchImpl,
    });
    await router.complete("final_writer", SAMPLE_MESSAGES);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(OPENROUTER_BASE_URL);
    expect(url).not.toContain(DEEPSEEK_BASE_URL);
  });

  it("does not route article_summarizer to OpenRouter even when both keys are set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));
    const router = createLlmRouter({
      deepseekApiKey: "ds-key-longerthan8",
      openrouterApiKey: "or-key-longerthan8",
      fetchImpl,
    });
    await router.complete("article_summarizer", SAMPLE_MESSAGES);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(DEEPSEEK_BASE_URL);
    expect(url).not.toContain(OPENROUTER_BASE_URL);
  });
});

// ===================================================
// No silent fallback
// ===================================================

describe("createLlmRouter – no silent fallback model", () => {
  it("throws describing missing DEEPSEEK_API_KEY for article_summarizer", async () => {
    const router = createLlmRouter({});
    await expect(router.complete("article_summarizer", SAMPLE_MESSAGES)).rejects.toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });

  it("throws describing missing DEEPSEEK_API_KEY for system_card_summarizer", async () => {
    const router = createLlmRouter({});
    await expect(router.complete("system_card_summarizer", SAMPLE_MESSAGES)).rejects.toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });

  it("throws describing missing DEEPSEEK_API_KEY for benchmark_aggregator", async () => {
    const router = createLlmRouter({});
    await expect(router.complete("benchmark_aggregator", SAMPLE_MESSAGES)).rejects.toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });

  it("throws describing missing DEEPSEEK_API_KEY even when OpenRouter key is present", async () => {
    const router = createLlmRouter({ openrouterApiKey: "or-key-longerthan8" });
    await expect(router.complete("evidence_synthesizer", SAMPLE_MESSAGES)).rejects.toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });

  it("throws describing missing OPENROUTER_API_KEY for final_writer", async () => {
    const router = createLlmRouter({});
    await expect(router.complete("final_writer", SAMPLE_MESSAGES)).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it("error for missing final_writer key names the Kimi model", async () => {
    const router = createLlmRouter({ kimiModel: "moonshotai/kimi-k2.5" });
    try {
      await router.complete("final_writer", SAMPLE_MESSAGES);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("moonshotai/kimi-k2.5");
    }
  });

  it("throws for an unknown role rather than silently picking a provider", async () => {
    const router = createLlmRouter({
      deepseekApiKey: "ds-key-longerthan8",
      openrouterApiKey: "or-key-longerthan8",
    });
    await expect(router.complete("unknown_role" as LlmRole, SAMPLE_MESSAGES)).rejects.toThrow(
      /unknown.*role/i,
    );
  });
});

// ===================================================
// Fake client determinism
// ===================================================

describe("makeFakeLlmCompletion – determinism", () => {
  it("returns identical text and tokens for the same role on every call", () => {
    const first = makeFakeLlmCompletion("article_summarizer");
    const second = makeFakeLlmCompletion("article_summarizer");
    expect(first.text).toBe(second.text);
    expect(first.usage.promptTokens).toBe(second.usage.promptTokens);
    expect(first.usage.completionTokens).toBe(second.usage.completionTokens);
    expect(first.usage.stage).toBe("article_summarizer");
  });

  it("produces different text for different roles", () => {
    const article = makeFakeLlmCompletion("article_summarizer");
    const finalMsg = makeFakeLlmCompletion("final_writer");
    expect(article.text).not.toBe(finalMsg.text);
  });

  it("records the correct stage for every role", () => {
    const roles: LlmRole[] = [
      "article_summarizer",
      "system_card_summarizer",
      "benchmark_aggregator",
      "evidence_synthesizer",
      "final_writer",
    ];
    for (const role of roles) {
      expect(makeFakeLlmCompletion(role).usage.stage).toBe(role);
    }
  });

  it("allows text override while preserving default token counts", () => {
    const result = makeFakeLlmCompletion("article_summarizer", { text: "custom" });
    expect(result.text).toBe("custom");
    expect(result.usage.promptTokens).toBe(512); // default for article_summarizer
    expect(result.usage.completionTokens).toBe(64);
  });

  it("allows token overrides", () => {
    const result = makeFakeLlmCompletion("final_writer", {
      promptTokens: 999,
      completionTokens: 42,
    });
    expect(result.usage.promptTokens).toBe(999);
    expect(result.usage.completionTokens).toBe(42);
  });

  it("always has zero estimated cost (fake clients cost nothing)", () => {
    const roles: LlmRole[] = ["article_summarizer", "benchmark_aggregator", "final_writer"];
    for (const role of roles) {
      expect(makeFakeLlmCompletion(role).usage.estimatedCostUsd).toBe(0);
    }
  });

  it("includes a provider response ID and model ID for each fake completion", () => {
    const result = makeFakeLlmCompletion("evidence_synthesizer");
    expect(result.usage.providerResponseId).toBeTruthy();
    expect(result.usage.modelId).toBeTruthy();
  });
});

// ===================================================
// Offline router
// ===================================================

describe("createLlmRouter – offline mode", () => {
  it("sets isOffline to true", () => {
    const router = createLlmRouter({ offline: true });
    expect(router.isOffline).toBe(true);
  });

  it("live router sets isOffline to false", () => {
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8" });
    expect(router.isOffline).toBe(false);
  });

  it("does not make network calls in offline mode", async () => {
    const fetchImpl = vi.fn();
    const router = createLlmRouter({ offline: true, fetchImpl });
    await router.complete("article_summarizer", SAMPLE_MESSAGES);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("offline mode does not require any API keys", async () => {
    const router = createLlmRouter({ offline: true });
    await expect(router.complete("article_summarizer", SAMPLE_MESSAGES)).resolves.toBeDefined();
    await expect(router.complete("final_writer", SAMPLE_MESSAGES)).resolves.toBeDefined();
  });

  it("returns deterministic responses for all roles in offline mode", async () => {
    const router = createLlmRouter({ offline: true });
    const roles: LlmRole[] = [
      "article_summarizer",
      "system_card_summarizer",
      "benchmark_aggregator",
      "evidence_synthesizer",
      "final_writer",
    ];
    for (const role of roles) {
      const a = await router.complete(role, SAMPLE_MESSAGES);
      const b = await router.complete(role, SAMPLE_MESSAGES);
      expect(a.text).toBe(b.text);
      expect(a.usage.promptTokens).toBe(b.usage.promptTokens);
    }
  });
});

// ===================================================
// Cost math
// ===================================================

describe("computeEstimatedCostUsd", () => {
  it("computes input cost with DeepSeek pricing", () => {
    const cost = computeEstimatedCostUsd(1_000_000, 0, 0, DEEPSEEK_PRICING);
    expect(cost).toBeCloseTo(0.27, 6);
  });

  it("computes output cost with DeepSeek pricing", () => {
    const cost = computeEstimatedCostUsd(0, 1_000_000, 0, DEEPSEEK_PRICING);
    expect(cost).toBeCloseTo(1.10, 6);
  });

  it("applies cache-hit discount: 1M cache-hit tokens costs less than 1M regular input", () => {
    const cacheHitCost = computeEstimatedCostUsd(1_000_000, 0, 1_000_000, DEEPSEEK_PRICING);
    const regularCost = computeEstimatedCostUsd(1_000_000, 0, 0, DEEPSEEK_PRICING);
    expect(cacheHitCost).toBeLessThan(regularCost);
    expect(cacheHitCost).toBeCloseTo(0.07, 6); // $0.07/M cache-hit
  });

  it("splits cache-hit and cache-miss correctly", () => {
    // 500k cache hits, 500k cache misses
    const cost = computeEstimatedCostUsd(1_000_000, 0, 500_000, DEEPSEEK_PRICING);
    const expected = (500_000 / 1_000_000) * 0.07 + (500_000 / 1_000_000) * 0.27;
    expect(cost).toBeCloseTo(expected, 9);
  });

  it("combines input and output cost for Kimi pricing", () => {
    const cost = computeEstimatedCostUsd(1_000_000, 1_000_000, 0, OPENROUTER_KIMI_PRICING);
    expect(cost).toBeCloseTo(1.00 + 3.00, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeEstimatedCostUsd(0, 0, 0, DEEPSEEK_PRICING)).toBe(0);
  });

  it("live router attaches nonzero cost when tokens are returned", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOpenAIResponse("ok", { promptTokens: 1000, completionTokens: 200 }),
      );
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    const result = await router.complete("article_summarizer", SAMPLE_MESSAGES);
    expect(result.usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.usage.promptTokens).toBe(1000);
    expect(result.usage.completionTokens).toBe(200);
  });
});

// ===================================================
// CostTracker
// ===================================================

describe("CostTracker", () => {
  function makeUsage(stage: LlmRole, cost: number): Parameters<CostTracker["record"]>[0] {
    return {
      promptTokens: 0,
      completionTokens: 0,
      cacheHitTokens: 0,
      providerResponseId: null,
      modelId: "m",
      stage,
      estimatedCostUsd: cost,
    };
  }

  it("starts with zero cost and empty stages", () => {
    const tracker = new CostTracker(1.0);
    expect(tracker.totalCostUsd).toBe(0);
    expect(tracker.stages).toHaveLength(0);
  });

  it("accumulates costs from multiple stages", () => {
    const tracker = new CostTracker(10.0);
    tracker.record(makeUsage("article_summarizer", 0.01));
    tracker.record(makeUsage("final_writer", 0.05));
    expect(tracker.totalCostUsd).toBeCloseTo(0.06, 9);
    expect(tracker.stages).toHaveLength(2);
  });

  it("does not throw assertUnderBudget when under the cap", () => {
    const tracker = new CostTracker(1.0);
    tracker.record(makeUsage("article_summarizer", 0.50));
    expect(() => tracker.assertUnderBudget()).not.toThrow();
  });

  it("throws CostCapExceededError when over budget", () => {
    const tracker = new CostTracker(0.1);
    tracker.record(makeUsage("article_summarizer", 0.20));
    expect(() => tracker.assertUnderBudget()).toThrow(CostCapExceededError);
  });

  it("CostCapExceededError carries actual and cap values", () => {
    const tracker = new CostTracker(0.10);
    tracker.record(makeUsage("article_summarizer", 0.25));
    let caught: unknown;
    try {
      tracker.assertUnderBudget();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CostCapExceededError);
    const ce = caught as CostCapExceededError;
    expect(ce.actual).toBeCloseTo(0.25, 9);
    expect(ce.cap).toBe(0.10);
  });

  it("report includes totalCostUsd, maxCostUsd, and all stage records", () => {
    const tracker = new CostTracker(5.0);
    tracker.record(makeUsage("article_summarizer", 0.01));
    tracker.record(makeUsage("final_writer", 0.05));
    const report = tracker.report();
    expect(report.totalCostUsd).toBeCloseTo(0.06, 9);
    expect(report.maxCostUsd).toBe(5.0);
    expect(report.stages).toHaveLength(2);
    expect(report.stages[0]?.stage).toBe("article_summarizer");
    expect(report.stages[1]?.stage).toBe("final_writer");
  });

  it("stages array is a snapshot (not mutated by later records)", () => {
    const tracker = new CostTracker(10.0);
    tracker.record(makeUsage("article_summarizer", 0.01));
    const snapshot = tracker.report().stages;
    tracker.record(makeUsage("final_writer", 0.05));
    expect(snapshot).toHaveLength(1); // snapshot is unaffected
  });
});

// ===================================================
// completeWithBudget
// ===================================================

describe("completeWithBudget", () => {
  it("aborts before completion when already over budget", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(0.0);
    tracker.record({
      promptTokens: 0, completionTokens: 0, cacheHitTokens: 0,
      providerResponseId: null, modelId: "m", stage: "article_summarizer",
      estimatedCostUsd: 0.01,
    });
    await expect(
      completeWithBudget(router, tracker, "article_summarizer", SAMPLE_MESSAGES),
    ).rejects.toThrow(CostCapExceededError);
  });

  it("records usage after a successful completion", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10.0);
    await completeWithBudget(router, tracker, "article_summarizer", SAMPLE_MESSAGES);
    expect(tracker.stages).toHaveLength(1);
    expect(tracker.stages[0]?.stage).toBe("article_summarizer");
  });

  it("succeeds and returns the completion when under budget", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10.0);
    const result = await completeWithBudget(router, tracker, "final_writer", SAMPLE_MESSAGES);
    expect(result.text).toBeTruthy();
  });

  it("tracks costs from multiple sequential calls", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(10.0);
    await completeWithBudget(router, tracker, "article_summarizer", SAMPLE_MESSAGES);
    await completeWithBudget(router, tracker, "system_card_summarizer", SAMPLE_MESSAGES);
    await completeWithBudget(router, tracker, "final_writer", SAMPLE_MESSAGES);
    expect(tracker.stages).toHaveLength(3);
  });
});

// ===================================================
// Secret redaction
// ===================================================

describe("redactSecrets", () => {
  it("replaces a secret in a string", () => {
    const key = "sk-supersecretapikey12345678";
    const message = `authorization failed with key ${key}`;
    expect(redactSecrets(message, [key])).not.toContain(key);
    expect(redactSecrets(message, [key])).toContain("[REDACTED]");
  });

  it("replaces multiple different secrets", () => {
    const key1 = "deepseek-key-abcdefgh1234";
    const key2 = "openrouter-key-xyz9876543";
    const message = `key1=${key1} key2=${key2}`;
    const redacted = redactSecrets(message, [key1, key2]);
    expect(redacted).not.toContain(key1);
    expect(redacted).not.toContain(key2);
    expect((redacted.match(/\[REDACTED\]/g) ?? []).length).toBe(2);
  });

  it("leaves text unchanged when secrets list is empty", () => {
    const message = "no secrets here at all";
    expect(redactSecrets(message, [])).toBe(message);
  });

  it("skips secrets shorter than 8 characters to avoid false positives", () => {
    const message = "error near key abc in request";
    expect(redactSecrets(message, ["abc"])).toBe(message);
  });

  it("redacts secret from stringified JSON (fixture/cost-report scenario)", () => {
    const key = "my-super-secret-api-key-99999";
    const json = JSON.stringify({ Authorization: `Bearer ${key}`, data: "test" });
    const redacted = redactSecrets(json, [key]);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain("[REDACTED]");
    expect(() => JSON.parse(redacted)).not.toThrow();
  });

  it("does not alter text when the secret is not present", () => {
    const message = "this is a normal log message without secrets";
    const result = redactSecrets(message, ["totally-different-secret-key"]);
    expect(result).toBe(message);
  });
});

// ===================================================
// API key not present in error messages
// ===================================================

describe("callOpenAICompatible – API key redaction in errors", () => {
  it("redacts API key when provider returns it in an error body", async () => {
    const apiKey = "ultra-secret-deepseek-key-foobar123";
    const fetchImpl = vi.fn().mockResolvedValue(
      makeErrorResponse(401, `Invalid authorization header: Bearer ${apiKey}`),
    );

    let caughtMessage = "";
    try {
      await callOpenAICompatible("article_summarizer", SAMPLE_MESSAGES, {
        apiKey,
        baseUrl: DEEPSEEK_BASE_URL,
        model: DEFAULT_DEEPSEEK_MODEL,
        pricing: DEEPSEEK_PRICING,
        fetchImpl,
      });
    } catch (err) {
      caughtMessage = err instanceof Error ? err.message : String(err);
    }

    expect(caughtMessage).not.toContain(apiKey);
    expect(caughtMessage).toContain("[REDACTED]");
  });

  it("redacts all secrets from the error message including secondary secrets", async () => {
    const primary = "primary-api-key-abcdefghij";
    const secondary = "secondary-api-key-1234567890";
    const fetchImpl = vi.fn().mockResolvedValue(
      makeErrorResponse(403, `Forbidden: ${primary} and also ${secondary}`),
    );

    let caughtMessage = "";
    try {
      await callOpenAICompatible("article_summarizer", SAMPLE_MESSAGES, {
        apiKey: primary,
        baseUrl: DEEPSEEK_BASE_URL,
        model: DEFAULT_DEEPSEEK_MODEL,
        pricing: DEEPSEEK_PRICING,
        fetchImpl,
        allSecrets: [secondary],
      });
    } catch (err) {
      caughtMessage = err instanceof Error ? err.message : String(err);
    }

    expect(caughtMessage).not.toContain(primary);
    expect(caughtMessage).not.toContain(secondary);
  });

  it("API key does not appear in request body (only in Authorization header)", async () => {
    const apiKey = "my-deepseek-api-key-secret-abc123";
    const fetchImpl = vi.fn().mockResolvedValue(makeOpenAIResponse("ok"));

    await callOpenAICompatible("article_summarizer", SAMPLE_MESSAGES, {
      apiKey,
      baseUrl: DEEPSEEK_BASE_URL,
      model: DEFAULT_DEEPSEEK_MODEL,
      pricing: DEEPSEEK_PRICING,
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const bodyStr = typeof init.body === "string" ? init.body : "";
    expect(bodyStr).not.toContain(apiKey);
  });
});

// ===================================================
// Usage recording
// ===================================================

describe("Usage recording", () => {
  it("records prompt and completion tokens from provider response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOpenAIResponse("result", { promptTokens: 1500, completionTokens: 200 }),
      );
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    const result = await router.complete("article_summarizer", SAMPLE_MESSAGES);
    expect(result.usage.promptTokens).toBe(1500);
    expect(result.usage.completionTokens).toBe(200);
  });

  it("records cache-hit tokens from prompt_cache_hit_tokens field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeJsonResponse({
        id: "r1",
        model: "deepseek-chat",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2000, completion_tokens: 100, prompt_cache_hit_tokens: 1500 },
      }),
    );
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    const result = await router.complete("article_summarizer", SAMPLE_MESSAGES);
    expect(result.usage.cacheHitTokens).toBe(1500);
  });

  it("cache-hit tokens reduce the estimated cost", async () => {
    const makeWithCacheHit = (cacheHitTokens: number) =>
      makeJsonResponse({
        id: "r1",
        model: "deepseek-chat",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2000, completion_tokens: 100, prompt_cache_hit_tokens: cacheHitTokens },
      });

    const fetchNoCacheHit = vi.fn().mockResolvedValue(makeWithCacheHit(0));
    const fetchWithCacheHit = vi.fn().mockResolvedValue(makeWithCacheHit(1500));

    const routerNoCacheHit = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl: fetchNoCacheHit });
    const routerWithCacheHit = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl: fetchWithCacheHit });

    const noCacheHitResult = await routerNoCacheHit.complete("article_summarizer", SAMPLE_MESSAGES);
    const withCacheHitResult = await routerWithCacheHit.complete("article_summarizer", SAMPLE_MESSAGES);

    expect(withCacheHitResult.usage.estimatedCostUsd).toBeLessThan(
      noCacheHitResult.usage.estimatedCostUsd,
    );
  });

  it("records provider response ID", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeOpenAIResponse("ok", { id: "resp-abc123" }));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    const result = await router.complete("article_summarizer", SAMPLE_MESSAGES);
    expect(result.usage.providerResponseId).toBe("resp-abc123");
  });

  it("records model ID from provider response (overrides configured model)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeOpenAIResponse("ok", { model: "deepseek-chat-v3-0324" }));
    const router = createLlmRouter({ deepseekApiKey: "ds-key-longerthan8", fetchImpl });
    const result = await router.complete("article_summarizer", SAMPLE_MESSAGES);
    expect(result.usage.modelId).toBe("deepseek-chat-v3-0324");
  });
});

// ===================================================
// Pricing configuration
// ===================================================

describe("Pricing configuration", () => {
  it("DEEPSEEK_PRICING has input, output, cache-hit rates, source URL, and date", () => {
    expect(DEEPSEEK_PRICING.inputPerMillion).toBeGreaterThan(0);
    expect(DEEPSEEK_PRICING.outputPerMillion).toBeGreaterThan(0);
    expect(DEEPSEEK_PRICING.cacheHitInputPerMillion).toBeGreaterThan(0);
    expect(DEEPSEEK_PRICING.currency).toBe("USD");
    expect(DEEPSEEK_PRICING.sourceUrl).toMatch(/^https?:\/\//);
    expect(DEEPSEEK_PRICING.lastVerifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("OPENROUTER_KIMI_PRICING has input, output rates, source URL, and date", () => {
    expect(OPENROUTER_KIMI_PRICING.inputPerMillion).toBeGreaterThan(0);
    expect(OPENROUTER_KIMI_PRICING.outputPerMillion).toBeGreaterThan(0);
    expect(OPENROUTER_KIMI_PRICING.currency).toBe("USD");
    expect(OPENROUTER_KIMI_PRICING.sourceUrl).toMatch(/^https?:\/\//);
    expect(OPENROUTER_KIMI_PRICING.lastVerifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("DeepSeek cache-hit rate is cheaper than regular input rate", () => {
    expect(DEEPSEEK_PRICING.cacheHitInputPerMillion!).toBeLessThan(
      DEEPSEEK_PRICING.inputPerMillion,
    );
  });
});
