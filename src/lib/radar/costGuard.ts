import type { CostSummary } from "./releaseMessages";

export type CostCapResult = {
  allowed: boolean;
  reason: "within_budget" | "max_cost_exceeded";
  actualCostUsd: number;
  maxCostUsd: number;
};

export type SecretStatus = {
  deepseek: boolean;
  openrouter: boolean;
  artificialAnalysis: boolean;
  telegram: boolean;
};

export type StructuredSkip = {
  skipped: true;
  reason: "missing_api_key" | "missing_telegram" | "max_cost_exceeded";
  missingKeys?: string[];
  detail: string;
};

export function checkCostCap(actualCostUsd: number, maxCostUsd: number): CostCapResult {
  if (actualCostUsd > maxCostUsd) {
    return { allowed: false, reason: "max_cost_exceeded", actualCostUsd, maxCostUsd };
  }
  return { allowed: true, reason: "within_budget", actualCostUsd, maxCostUsd };
}

export function resolveSecretStatus(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SecretStatus {
  return {
    deepseek: Boolean(env["DEEPSEEK_API_KEY"]),
    openrouter: Boolean(env["OPENROUTER_API_KEY"]),
    artificialAnalysis: Boolean(env["ARTIFICIAL_ANALYSIS_API_KEY"]),
    telegram: Boolean(env["TELEGRAM_BOT_TOKEN"] && env["TELEGRAM_CHAT_ID"]),
  };
}

export function buildStructuredSkip(
  reason: StructuredSkip["reason"],
  detail: string,
  missingKeys?: string[],
): StructuredSkip {
  const skip: StructuredSkip = { skipped: true, reason, detail };
  if (missingKeys && missingKeys.length > 0) {
    skip.missingKeys = missingKeys;
  }
  return skip;
}

export function containsSecrets(text: string, secrets: string[]): boolean {
  return secrets.some((secret) => secret.length >= 8 && text.includes(secret));
}

export function buildOfflineCostSummary(): CostSummary {
  return { mode: "offline", totalCostUsd: 0, stages: [] };
}
