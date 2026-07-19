import type { FetchImpl } from "./fetching";

// --- Constants ---

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
export const DEFAULT_KIMI_MODEL = "moonshotai/kimi-k2.6";

// --- LLM Roles ---

export type LlmRole =
  | "release_classifier"
  | "article_summarizer"
  | "system_card_summarizer"
  | "benchmark_aggregator"
  | "evidence_synthesizer"
  | "final_writer";

// DeepSeek handles all stages except final message writing
export const DEEPSEEK_ROLES = new Set<LlmRole>([
  "release_classifier",
  "article_summarizer",
  "system_card_summarizer",
  "benchmark_aggregator",
  "evidence_synthesizer",
]);

// OpenRouter Kimi handles only the final condensed message
export const KIMI_ROLES = new Set<LlmRole>(["final_writer"]);

// --- Pricing ---

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheHitInputPerMillion?: number;
  currency: "USD";
  sourceUrl: string;
  lastVerifiedDate: string;
};

export const DEEPSEEK_PRICING: ModelPricing = {
  inputPerMillion: 0.27,
  outputPerMillion: 1.10,
  cacheHitInputPerMillion: 0.07,
  currency: "USD",
  sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  lastVerifiedDate: "2026-07-01",
};

export const OPENROUTER_KIMI_PRICING: ModelPricing = {
  inputPerMillion: 0.66,
  outputPerMillion: 3.41,
  currency: "USD",
  sourceUrl: "https://openrouter.ai/moonshotai/kimi-k2.6",
  lastVerifiedDate: "2026-07-18",
};

// --- Usage ---

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  providerResponseId: string | null;
  modelId: string;
  stage: LlmRole;
  estimatedCostUsd: number;
};

// --- Cost cap ---

export class CostCapExceededError extends Error {
  constructor(
    public readonly actual: number,
    public readonly cap: number,
  ) {
    super(`Cost cap exceeded: $${actual.toFixed(6)} > $${cap.toFixed(6)}`);
    this.name = "CostCapExceededError";
  }
}

// --- Cost tracker ---

export class CostTracker {
  private readonly _stages: LlmUsage[] = [];

  constructor(public readonly maxCostUsd: number) {}

  record(usage: LlmUsage): void {
    this._stages.push(usage);
  }

  get totalCostUsd(): number {
    return this._stages.reduce((sum, u) => sum + u.estimatedCostUsd, 0);
  }

  get stages(): readonly LlmUsage[] {
    return this._stages;
  }

  assertUnderBudget(): void {
    if (this.totalCostUsd > this.maxCostUsd) {
      throw new CostCapExceededError(this.totalCostUsd, this.maxCostUsd);
    }
  }

  report(): { totalCostUsd: number; stages: LlmUsage[]; maxCostUsd: number } {
    return {
      totalCostUsd: this.totalCostUsd,
      stages: [...this._stages],
      maxCostUsd: this.maxCostUsd,
    };
  }
}

// --- Secret redaction ---

export function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  return result;
}

// --- LLM types ---

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCompletion = {
  text: string;
  usage: LlmUsage;
};

// --- Cost calculation ---

export function computeEstimatedCostUsd(
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens: number,
  pricing: ModelPricing,
): number {
  const cacheMissTokens = Math.max(0, promptTokens - cacheHitTokens);
  const cacheHitRate = pricing.cacheHitInputPerMillion ?? pricing.inputPerMillion;
  return (
    (cacheHitTokens / 1_000_000) * cacheHitRate +
    (cacheMissTokens / 1_000_000) * pricing.inputPerMillion +
    (completionTokens / 1_000_000) * pricing.outputPerMillion
  );
}

// --- OpenAI-compatible response shape ---

type OpenAIUsageDetails = { cached_tokens?: number };
type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: OpenAIUsageDetails;
};
type OpenAIResponse = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: OpenAIUsage;
};

// --- Live OpenAI-compatible client ---

export type LiveClientConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  pricing: ModelPricing;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  allSecrets?: string[];
};

export async function callOpenAICompatible(
  role: LlmRole,
  messages: LlmMessage[],
  config: LiveClientConfig,
): Promise<LlmCompletion> {
  const {
    apiKey,
    baseUrl,
    model,
    pricing,
    fetchImpl = fetch,
    timeoutMs = 60_000,
    allSecrets = [],
  } = config;

  const secrets = [apiKey, ...allSecrets].filter((s) => typeof s === "string" && s.length >= 8);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/model-release-radar",
        "X-Title": "model-release-radar",
      },
      body: JSON.stringify({ model, messages, max_tokens: role === "final_writer" ? 4096 : 2048, stream: false }),
    });

    clearTimeout(timer);

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      const safeBody = redactSecrets(rawBody, secrets);
      throw new Error(
        `LLM API error ${response.status} for role "${role}": ${safeBody.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as OpenAIResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? {};
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const cacheHitTokens =
      usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        cacheHitTokens,
        providerResponseId: data.id ?? null,
        modelId: data.model ?? model,
        stage: role,
        estimatedCostUsd: computeEstimatedCostUsd(promptTokens, completionTokens, cacheHitTokens, pricing),
      },
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const safeMsg = redactSecrets(msg, secrets);
    if (safeMsg !== msg) {
      const safeError = new Error(safeMsg);
      safeError.name = err instanceof Error ? err.name : "Error";
      throw safeError;
    }
    throw err;
  }
}

// --- Fake LLM client ---

type FakeResponseDef = { text: string; promptTokens: number; completionTokens: number };

const FAKE_RESPONSES: Record<LlmRole, FakeResponseDef> = {
  release_classifier: {
    text: JSON.stringify({
      is_new_model_release: true,
      model_names: ["FAKE_MODEL"],
      reason: "FAKE_CLASSIFIER: deterministic fake release classification for offline testing.",
    }),
    promptTokens: 256,
    completionTokens: 32,
  },
  article_summarizer: {
    text: "FAKE_ARTICLE_SUMMARY: Deterministic fake article summary for offline testing.",
    promptTokens: 512,
    completionTokens: 64,
  },
  system_card_summarizer: {
    text: "FAKE_SYSTEM_CARD_SUMMARY: Deterministic fake system card summary for offline testing.",
    promptTokens: 768,
    completionTokens: 96,
  },
  benchmark_aggregator: {
    text: "FAKE_BENCHMARK_AGGREGATION: Deterministic fake benchmark aggregation for offline testing.",
    promptTokens: 400,
    completionTokens: 80,
  },
  evidence_synthesizer: {
    text: "FAKE_EVIDENCE_SYNTHESIS: Deterministic fake evidence synthesis for offline testing.",
    promptTokens: 600,
    completionTokens: 100,
  },
  final_writer: {
    text: "FAKE_FINAL_MESSAGE: Deterministic fake final Telegram message for offline testing. Limitations: independent benchmark verification unknown.",
    promptTokens: 1024,
    completionTokens: 128,
  },
};

export function makeFakeLlmCompletion(
  role: LlmRole,
  overrides?: Partial<FakeResponseDef>,
): LlmCompletion {
  const def = FAKE_RESPONSES[role];
  const promptTokens = overrides?.promptTokens ?? def.promptTokens;
  const completionTokens = overrides?.completionTokens ?? def.completionTokens;

  return {
    text: overrides?.text ?? def.text,
    usage: {
      promptTokens,
      completionTokens,
      cacheHitTokens: 0,
      providerResponseId: `fake-${role}-response-id`,
      modelId: `fake-${role}-model`,
      stage: role,
      estimatedCostUsd: 0,
    },
  };
}

// --- LLM Router ---

export type LlmRouterOptions = {
  deepseekApiKey?: string;
  openrouterApiKey?: string;
  kimiModel?: string;
  deepseekModel?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  offline?: boolean;
};

export type LlmRouter = {
  complete(role: LlmRole, messages: LlmMessage[]): Promise<LlmCompletion>;
  isOffline: boolean;
};

export function createLlmRouter(options: LlmRouterOptions = {}): LlmRouter {
  const {
    deepseekApiKey,
    openrouterApiKey,
    kimiModel = DEFAULT_KIMI_MODEL,
    deepseekModel = DEFAULT_DEEPSEEK_MODEL,
    fetchImpl,
    timeoutMs,
    offline = false,
  } = options;

  if (offline) {
    return {
      isOffline: true,
      async complete(role: LlmRole): Promise<LlmCompletion> {
        return makeFakeLlmCompletion(role);
      },
    };
  }

  const allSecrets = [deepseekApiKey, openrouterApiKey].filter(
    (s): s is string => typeof s === "string" && s.length >= 8,
  );

  return {
    isOffline: false,
    async complete(role: LlmRole, messages: LlmMessage[]): Promise<LlmCompletion> {
      if (DEEPSEEK_ROLES.has(role)) {
        if (!deepseekApiKey) {
          throw new Error(
            `DEEPSEEK_API_KEY is required for role "${role}" but was not provided. Do not silently fall back to another provider.`,
          );
        }
        return callOpenAICompatible(role, messages, {
          apiKey: deepseekApiKey,
          baseUrl: DEEPSEEK_BASE_URL,
          model: deepseekModel,
          pricing: DEEPSEEK_PRICING,
          fetchImpl,
          timeoutMs,
          allSecrets,
        });
      }

      if (KIMI_ROLES.has(role)) {
        if (!openrouterApiKey) {
          throw new Error(
            `OPENROUTER_API_KEY is required for role "${role}" (final_writer uses OpenRouter Kimi "${kimiModel}"). Do not silently fall back to another provider.`,
          );
        }
        return callOpenAICompatible(role, messages, {
          apiKey: openrouterApiKey,
          baseUrl: OPENROUTER_BASE_URL,
          model: kimiModel,
          pricing: OPENROUTER_KIMI_PRICING,
          fetchImpl,
          timeoutMs,
          allSecrets,
        });
      }

      throw new Error(
        `Unknown LLM role "${role}". Valid roles: ${[...DEEPSEEK_ROLES, ...KIMI_ROLES].join(", ")}`,
      );
    },
  };
}

// --- Budget-enforced completion ---

export async function completeWithBudget(
  router: LlmRouter,
  tracker: CostTracker,
  role: LlmRole,
  messages: LlmMessage[],
): Promise<LlmCompletion> {
  tracker.assertUnderBudget();
  const result = await router.complete(role, messages);
  tracker.record(result.usage);
  tracker.assertUnderBudget();
  return result;
}
