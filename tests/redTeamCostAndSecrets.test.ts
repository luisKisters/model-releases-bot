import { describe, expect, it } from "vitest";
import {
  buildOfflineCostSummary,
  buildStructuredSkip,
  checkCostCap,
  containsSecrets,
  resolveSecretStatus,
} from "../src/lib/radar/costGuard";
import type { CostStage, CostSummary } from "../src/lib/radar/releaseMessages";
import {
  buildVerifiedReleaseNote,
  formatVerifiedReleaseNote,
  releaseReplayCases,
} from "../src/lib/radar/releaseMessages";

// ---------------------------------------------------------------------------
// 1. Live LLM usage records prompt tokens, completion tokens, model IDs,
//    provider IDs, stage names, and cost
// ---------------------------------------------------------------------------
describe("red-team cost & secrets: live LLM usage record structure", () => {
  it("buildVerifiedReleaseNote preserves live cost summary token counts from all pipeline stages", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4");
    if (!releaseCase) throw new Error("fixture deepseek-v4 not found");
    const note = buildVerifiedReleaseNote(releaseCase, {
      costSummary: {
        mode: "live",
        totalCostUsd: 0.12,
        stages: [
          { stage: "summarize_article", model: "deepseek-chat", providerId: "deepseek", costUsd: 0.08, promptTokens: 3000, completionTokens: 600 },
          { stage: "write_message", model: "openrouter/moonshotai/kimi-k2-6", providerId: "openrouter", costUsd: 0.04, promptTokens: 1000, completionTokens: 180 },
        ],
      },
    });
    expect(note.costSummary.mode).toBe("live");
    expect(note.costSummary.totalCostUsd).toBe(0.12);
    expect(note.costSummary.stages).toHaveLength(2);
    expect(note.costSummary.stages[0].stage).toBe("summarize_article");
    expect(note.costSummary.stages[0].providerId).toBe("deepseek");
    expect(note.costSummary.stages[0].promptTokens).toBe(3000);
    expect(note.costSummary.stages[0].completionTokens).toBe(600);
    expect(note.costSummary.stages[1].stage).toBe("write_message");
    expect(note.costSummary.stages[1].providerId).toBe("openrouter");
    expect(note.costSummary.stages[1].promptTokens).toBe(1000);
    expect(note.costSummary.stages[1].completionTokens).toBe(180);
  });

  it("formatVerifiedReleaseNote renders live cost line with dollar amount and stage count", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4");
    if (!releaseCase) throw new Error("fixture deepseek-v4 not found");
    const note = buildVerifiedReleaseNote(releaseCase, {
      costSummary: {
        mode: "live",
        totalCostUsd: 0.0750,
        stages: [
          { stage: "summarize_article", model: "deepseek-chat", providerId: "deepseek", costUsd: 0.05, promptTokens: 2000, completionTokens: 400 },
          { stage: "write_message", model: "openrouter/moonshotai/kimi-k2-6", providerId: "openrouter", costUsd: 0.025, promptTokens: 800, completionTokens: 150 },
        ],
      },
    });
    const message = formatVerifiedReleaseNote(note);
    expect(message).toContain("$0.0750");
    expect(message).toContain("2 stage(s)");
  });

  it("formatVerifiedReleaseNote renders offline cost line when mode is offline", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4");
    if (!releaseCase) throw new Error("fixture deepseek-v4 not found");
    const note = buildVerifiedReleaseNote(releaseCase);
    expect(note.costSummary.mode).toBe("offline");
    expect(note.costSummary.totalCostUsd).toBe(0);
    const message = formatVerifiedReleaseNote(note);
    expect(message).toContain("offline");
    expect(message).toContain("$0.00");
  });
});

// ---------------------------------------------------------------------------
// 2. --max-cost-usd aborts before Telegram send if projected or actual cost
//    exceeds the cap
// ---------------------------------------------------------------------------
describe("red-team cost & secrets: max-cost-usd enforcement", () => {
  it("checkCostCap blocks when actual cost exceeds the cap", () => {
    const result = checkCostCap(0.30, 0.25);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("max_cost_exceeded");
    expect(result.actualCostUsd).toBe(0.30);
    expect(result.maxCostUsd).toBe(0.25);
  });

  it("checkCostCap allows when cost equals the cap exactly", () => {
    const result = checkCostCap(0.25, 0.25);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("within_budget");
  });

  it("checkCostCap allows when cost is below the cap", () => {
    const result = checkCostCap(0.10, 0.25);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("within_budget");
    expect(result.actualCostUsd).toBe(0.10);
    expect(result.maxCostUsd).toBe(0.25);
  });

  it("checkCostCap blocks any positive cost when max is zero", () => {
    const result = checkCostCap(0.001, 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("max_cost_exceeded");
  });

  it("checkCostCap allows zero cost when max is zero", () => {
    const result = checkCostCap(0, 0);
    expect(result.allowed).toBe(true);
  });

  it("Telegram gate: cost exceeding cap prevents send", () => {
    const gate = checkCostCap(0.50, 0.25);
    const wouldSendTelegram = gate.allowed;
    expect(wouldSendTelegram).toBe(false);
  });

  it("Telegram gate: cost within budget allows send", () => {
    const gate = checkCostCap(0.15, 0.25);
    const wouldSendTelegram = gate.allowed;
    expect(wouldSendTelegram).toBe(true);
  });

  it("buildStructuredSkip for max_cost_exceeded includes cost details", () => {
    const skip = buildStructuredSkip("max_cost_exceeded", "Projected cost $0.50 exceeds max $0.25.");
    expect(skip.skipped).toBe(true);
    expect(skip.reason).toBe("max_cost_exceeded");
    expect(skip.detail).toContain("0.50");
    expect(skip.detail).toContain("0.25");
  });
});

// ---------------------------------------------------------------------------
// 3. Offline mode uses deterministic fake usage and spends no provider tokens
// ---------------------------------------------------------------------------
describe("red-team cost & secrets: offline mode determinism", () => {
  it("buildOfflineCostSummary returns mode=offline with zero cost", () => {
    const summary = buildOfflineCostSummary();
    expect(summary.mode).toBe("offline");
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.stages).toHaveLength(0);
  });

  it("buildOfflineCostSummary is deterministic across multiple calls", () => {
    const a = buildOfflineCostSummary();
    const b = buildOfflineCostSummary();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("buildVerifiedReleaseNote defaults to offline cost summary", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "anthropic-claude-sonnet-5")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    expect(note.costSummary.mode).toBe("offline");
    expect(note.costSummary.totalCostUsd).toBe(0);
    expect(note.costSummary.stages).toHaveLength(0);
  });

  it("offline cost summary has no stages with non-zero token counts", () => {
    const summary = buildOfflineCostSummary();
    const nonZeroTokenStages = summary.stages.filter(
      (s) => (s.promptTokens ?? 0) > 0 || (s.completionTokens ?? 0) > 0,
    );
    expect(nonZeroTokenStages).toHaveLength(0);
  });

  it("formatted release note shows offline ($0.00) cost line for offline mode", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const message = formatVerifiedReleaseNote(note);
    expect(message).toContain("offline ($0.00)");
  });

  it("formatted release note shows live cost line when cost summary is live", () => {
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase, {
      costSummary: { mode: "live", totalCostUsd: 0.07, stages: [
        { stage: "summarize_article", model: "deepseek-chat", costUsd: 0.07 },
      ]},
    });
    const message = formatVerifiedReleaseNote(note);
    expect(message).toContain("$0.0700");
    // The cost line itself must say "across ... stage(s)", not "offline ($0.00)"
    expect(message).toContain("across 1 stage(s)");
    expect(message).not.toContain("offline ($0.00)");
  });
});

// ---------------------------------------------------------------------------
// 4. Missing API keys produce structured skips
// ---------------------------------------------------------------------------
describe("red-team cost & secrets: missing API key structured skips", () => {
  it("resolveSecretStatus returns all false when env is empty", () => {
    const status = resolveSecretStatus({});
    expect(status.deepseek).toBe(false);
    expect(status.openrouter).toBe(false);
    expect(status.artificialAnalysis).toBe(false);
    expect(status.telegram).toBe(false);
  });

  it("resolveSecretStatus detects DEEPSEEK_API_KEY presence", () => {
    const status = resolveSecretStatus({ DEEPSEEK_API_KEY: "sk-fake-key" });
    expect(status.deepseek).toBe(true);
    expect(status.openrouter).toBe(false);
  });

  it("resolveSecretStatus detects OPENROUTER_API_KEY presence", () => {
    const status = resolveSecretStatus({ OPENROUTER_API_KEY: "sk-or-fake" });
    expect(status.openrouter).toBe(true);
    expect(status.deepseek).toBe(false);
  });

  it("resolveSecretStatus detects ARTIFICIAL_ANALYSIS_API_KEY presence", () => {
    const status = resolveSecretStatus({ ARTIFICIAL_ANALYSIS_API_KEY: "aa-fake-key" });
    expect(status.artificialAnalysis).toBe(true);
  });

  it("resolveSecretStatus requires both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID", () => {
    const tokenOnly = resolveSecretStatus({ TELEGRAM_BOT_TOKEN: "bottoken" });
    expect(tokenOnly.telegram).toBe(false);

    const chatOnly = resolveSecretStatus({ TELEGRAM_CHAT_ID: "12345" });
    expect(chatOnly.telegram).toBe(false);

    const both = resolveSecretStatus({ TELEGRAM_BOT_TOKEN: "bottoken", TELEGRAM_CHAT_ID: "12345" });
    expect(both.telegram).toBe(true);
  });

  it("buildStructuredSkip for missing DEEPSEEK_API_KEY has correct shape", () => {
    const skip = buildStructuredSkip(
      "missing_api_key",
      "DEEPSEEK_API_KEY is not set; LLM summarization stage skipped.",
      ["DEEPSEEK_API_KEY"],
    );
    expect(skip.skipped).toBe(true);
    expect(skip.reason).toBe("missing_api_key");
    expect(skip.missingKeys).toBeDefined();
    expect(skip.missingKeys).toContain("DEEPSEEK_API_KEY");
    expect(skip.detail).toContain("DEEPSEEK_API_KEY");
  });

  it("buildStructuredSkip for missing OPENROUTER_API_KEY has correct shape", () => {
    const skip = buildStructuredSkip(
      "missing_api_key",
      "OPENROUTER_API_KEY is not set; message writing stage skipped.",
      ["OPENROUTER_API_KEY"],
    );
    expect(skip.skipped).toBe(true);
    expect(skip.reason).toBe("missing_api_key");
    expect(skip.missingKeys).toContain("OPENROUTER_API_KEY");
  });

  it("buildStructuredSkip for missing Telegram vars has correct shape", () => {
    const skip = buildStructuredSkip(
      "missing_telegram",
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set; Telegram send skipped.",
    );
    expect(skip.skipped).toBe(true);
    expect(skip.reason).toBe("missing_telegram");
    expect(skip.detail).toContain("Telegram");
    expect(skip.missingKeys).toBeUndefined();
  });

  it("all four secret key types are represented in SecretStatus", () => {
    const status = resolveSecretStatus({});
    expect("deepseek" in status).toBe(true);
    expect("openrouter" in status).toBe(true);
    expect("artificialAnalysis" in status).toBe(true);
    expect("telegram" in status).toBe(true);
  });

  it("resolveSecretStatus treats an empty-string key as absent", () => {
    const status = resolveSecretStatus({ DEEPSEEK_API_KEY: "" });
    expect(status.deepseek).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. No secret value appears in logs, JSON reports, fixtures, or notifications
// ---------------------------------------------------------------------------
describe("red-team cost & secrets: no secret leakage in output", () => {
  it("containsSecrets returns false when text has no matching secret", () => {
    expect(containsSecrets("This is a safe log message.", ["sk-secret-key-abc123"])).toBe(false);
  });

  it("containsSecrets returns true when secret appears in text", () => {
    const secret = "sk-secret-key-abc12345";
    expect(containsSecrets(`API call failed: key=${secret}`, [secret])).toBe(true);
  });

  it("containsSecrets ignores short secrets under 8 characters", () => {
    expect(containsSecrets("The id is abc123 in the output.", ["abc123"])).toBe(false);
  });

  it("containsSecrets returns false for empty secrets list", () => {
    expect(containsSecrets("Any text here.", [])).toBe(false);
  });

  it("containsSecrets handles multiple secrets and detects any match", () => {
    const secrets = ["sk-harmless1234567", "sk-harmless-second-key"];
    expect(containsSecrets("Found: sk-harmless1234567 in logs", secrets)).toBe(true);
    expect(containsSecrets("Safe text with no keys", secrets)).toBe(false);
  });

  it("formatted release note does not include a fake injected API key", () => {
    const fakeSecret = "sk-deepseek-fakekeyvalue-xyzabc123";
    const releaseCase = releaseReplayCases.find((c) => c.id === "anthropic-claude-sonnet-5")!;
    const note = buildVerifiedReleaseNote(releaseCase);
    const message = formatVerifiedReleaseNote(note);
    expect(containsSecrets(message, [fakeSecret])).toBe(false);
    expect(message).not.toContain(fakeSecret);
  });

  it("structured skip does not echo back a secret value, only the key name", () => {
    const fakeSecret = "sk-or-v3-fakeopenrouterkey-abc12345";
    const skip = buildStructuredSkip(
      "missing_api_key",
      "OPENROUTER_API_KEY is not set.",
      ["OPENROUTER_API_KEY"],
    );
    expect(containsSecrets(JSON.stringify(skip), [fakeSecret])).toBe(false);
    expect(JSON.stringify(skip)).not.toContain(fakeSecret);
  });

  it("offline cost summary contains no bearer token or API key patterns", () => {
    const summary = buildOfflineCostSummary();
    const text = JSON.stringify(summary);
    expect(/sk-[a-zA-Z0-9]{16,}/.test(text)).toBe(false);
    expect(/Bearer\s+[a-zA-Z0-9]/.test(text)).toBe(false);
  });

  it("a release note with a live cost summary does not contain an injected fake key", () => {
    const fakeDeepSeekKey = "sk-deepseek-live-fakekeyabcde12345";
    const releaseCase = releaseReplayCases.find((c) => c.id === "deepseek-v4")!;
    const note = buildVerifiedReleaseNote(releaseCase, {
      costSummary: {
        mode: "live",
        totalCostUsd: 0.05,
        stages: [
          {
            stage: "summarize_article",
            model: "deepseek-chat",
            providerId: "deepseek",
            costUsd: 0.05,
            promptTokens: 2000,
            completionTokens: 300,
          },
        ],
      },
    });
    const text = JSON.stringify(note);
    expect(containsSecrets(text, [fakeDeepSeekKey])).toBe(false);
  });

  it("containsSecrets treats an empty string secret as absent (no false positives)", () => {
    expect(containsSecrets("Some log text", [""])).toBe(false);
  });
});
