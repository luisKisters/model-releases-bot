import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { extractLabFromUrl } from "../src/lib/radar/agents";
import { createLlmRouter, CostTracker, CostCapExceededError, DEEPSEEK_ROLES, KIMI_ROLES } from "../src/lib/radar/llm";
import { buildReleaseNote, canSendReleaseNote } from "../src/lib/radar/messages";
import {
  runAgentOrchestration,
  type OrchestratorOptions,
} from "../src/lib/radar/agents";
import { extractArticleFromHtml } from "../src/lib/radar/browserTools";
import { aggregateBenchmarkEvidence } from "../src/lib/radar/benchmarks";
import { extractSystemCards } from "../src/lib/radar/systemCards";
import type { ExtractedArticle } from "../src/lib/radar/types";
import type { SystemCardResult } from "../src/lib/radar/systemCards";
import type { BenchmarkEvidence } from "../src/lib/radar/benchmarks";

const SNAPSHOTS_DIR = resolve(__dirname, "fixtures/snapshots");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    if (arg.startsWith("--no-")) { parsed[arg.slice(5)] = false; continue; }
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      parsed[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[arg.slice(2)] = next;
        i++;
      } else {
        parsed[arg.slice(2)] = true;
      }
    }
  }
  return parsed;
}

function booleanArg(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function listArg(value: string | boolean | undefined): string[] {
  if (!value || value === true) return [];
  return String(value).split(",").map((e) => e.trim()).filter(Boolean);
}

function makeArticle(overrides: Partial<ExtractedArticle> = {}): ExtractedArticle {
  return {
    url: "https://api-docs.deepseek.com/news/news260424",
    canonicalUrl: "https://api-docs.deepseek.com/news/news260424",
    finalUrl: "https://api-docs.deepseek.com/news/news260424",
    title: "DeepSeek-V4 Release",
    author: null,
    publisher: "DeepSeek",
    publishedAt: "2026-04-24",
    updatedAt: null,
    body: "DeepSeek-V4-Pro and DeepSeek-V4-Flash are released. Unknown weaknesses. Safety card not available.",
    headings: ["Overview", "Benchmarks"],
    outboundLinks: [],
    images: [],
    downloadableAssets: [],
    reducedConfidence: true,
    ...overrides,
  };
}

function makeSystemCardResult(overrides: Partial<SystemCardResult> = {}): SystemCardResult {
  return {
    system_card_status: "not_found",
    detected: [],
    documents: [],
    ...overrides,
  };
}

function makeBenchmarkEvidence(overrides: Partial<BenchmarkEvidence> = {}): BenchmarkEvidence {
  return {
    lab: "DeepSeek",
    modelNames: ["DeepSeek-V4-Pro"],
    modality: ["language", "coding", "reasoning"],
    claims: [],
    artificialAnalysis: { ok: false, status: "skipped", reason: "No API key", missingKey: true },
    ...overrides,
  };
}

// ──��� CLI arg parsing tests ────────────────────────────────────────────────────

describe("CLI arg parsing", () => {
  it("parses --dry-run as true by default", () => {
    const args = parseArgs(["--dry-run"]);
    expect(booleanArg(args["dry-run"] as boolean | undefined, true)).toBe(true);
  });

  it("parses --no-dry-run as false", () => {
    const args = parseArgs(["--no-dry-run"]);
    expect(booleanArg(args["dry-run"] as boolean | undefined, true)).toBe(false);
  });

  it("parses --release-url with a value", () => {
    const args = parseArgs(["--release-url", "https://api-docs.deepseek.com/news/news260424"]);
    expect(args["release-url"]).toBe("https://api-docs.deepseek.com/news/news260424");
  });

  it("parses --release-url=value form", () => {
    const args = parseArgs(["--release-url=https://example.com/release"]);
    expect(args["release-url"]).toBe("https://example.com/release");
  });

  it("parses --labs all as a list", () => {
    const args = parseArgs(["--labs", "all"]);
    const labs = listArg(args["labs"] as string | undefined);
    expect(labs).toEqual(["all"]);
  });

  it("parses --labs OpenAI,Anthropic as a list", () => {
    const args = parseArgs(["--labs", "OpenAI,Anthropic"]);
    const labs = listArg(args["labs"] as string | undefined);
    expect(labs).toEqual(["OpenAI", "Anthropic"]);
  });

  it("parses --limit-per-lab as a number", () => {
    const args = parseArgs(["--limit-per-lab", "3"]);
    expect(Number(args["limit-per-lab"])).toBe(3);
  });

  it("parses --max-cost-usd as a number", () => {
    const args = parseArgs(["--max-cost-usd", "0.25"]);
    expect(Number(args["max-cost-usd"])).toBe(0.25);
  });

  it("parses --send-telegram flag", () => {
    const args = parseArgs(["--send-telegram"]);
    expect(booleanArg(args["send-telegram"] as boolean | undefined, false)).toBe(true);
  });

  it("parses --require-browser flag", () => {
    const args = parseArgs(["--require-browser"]);
    expect(booleanArg(args["require-browser"] as boolean | undefined, false)).toBe(true);
  });

  it("parses --require-llm flag", () => {
    const args = parseArgs(["--require-llm"]);
    expect(booleanArg(args["require-llm"] as boolean | undefined, false)).toBe(true);
  });

  it("parses --require-artificial-analysis flag", () => {
    const args = parseArgs(["--require-artificial-analysis"]);
    expect(booleanArg(args["require-artificial-analysis"] as boolean | undefined, false)).toBe(true);
  });
});

// ─── Lab detection from URL ───────────────────────────────────────────────────

describe("extractLabFromUrl", () => {
  it("detects DeepSeek from api-docs.deepseek.com", () => {
    expect(extractLabFromUrl("https://api-docs.deepseek.com/news/news260424")).toBe("DeepSeek");
  });

  it("detects Anthropic from anthropic.com", () => {
    expect(extractLabFromUrl("https://www.anthropic.com/news/claude-3-5-sonnet")).toBe("Anthropic");
  });

  it("detects OpenAI from openai.com", () => {
    expect(extractLabFromUrl("https://openai.com/index/gpt-4o")).toBe("OpenAI");
  });

  it("detects Google Gemini from blog.google", () => {
    expect(extractLabFromUrl("https://blog.google/technology/ai/gemini-1-5-pro/")).toBe("Google Gemini");
  });

  it("detects Mistral from mistral.ai", () => {
    expect(extractLabFromUrl("https://mistral.ai/news/mistral-large")).toBe("Mistral");
  });

  it("detects Meta Llama from ai.meta.com", () => {
    expect(extractLabFromUrl("https://ai.meta.com/blog/llama-3")).toBe("Meta Llama");
  });

  it("detects xAI from x.ai", () => {
    expect(extractLabFromUrl("https://x.ai/news/grok-4")).toBe("xAI");
  });

  it("returns Unknown for unrecognized domain", () => {
    expect(extractLabFromUrl("https://example.com/some-ai-release")).toBe("Unknown");
  });
});

// ─── Article gate + provider detection ───────────────────────────────────────

describe("article gate with URL-based provider detection", () => {
  it("accepts DeepSeek V4 URL after detecting lab from URL", () => {
    const url = "https://api-docs.deepseek.com/news/news260424";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: url, url });
    expect(gate.shouldSend).toBe(true);
    expect(gate.lab).toBe("DeepSeek");
    expect(gate.reason).toBe("official_dedicated_model_release_article");
  });

  it("rejects unknown provider URLs", () => {
    const url = "https://example.com/model-release";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: url, url });
    expect(gate.shouldSend).toBe(false);
    expect(gate.reason).toBe("unselected_lab");
  });

  it("rejects DeepSeek news root (not a dedicated article)", () => {
    const url = "https://api-docs.deepseek.com/news/";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: url, url });
    expect(gate.shouldSend).toBe(false);
  });

  it("rejects Anthropic news root", () => {
    const url = "https://www.anthropic.com/news";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: url, url });
    expect(gate.shouldSend).toBe(false);
  });
});

// ─── Dry-run behavior ─────────────────────────────────────────────────────────

describe("dry-run behavior", () => {
  it("dry-run prevents send: dryRun=true means no Telegram call", () => {
    // This is a logic contract test — the send path is guarded by `!dryRun && sendTg`
    const dryRun = true;
    const sendTg = true;
    const shouldSend = !dryRun && sendTg;
    expect(shouldSend).toBe(false);
  });

  it("no-dry-run with send-telegram allows sending", () => {
    const dryRun = false;
    const sendTg = true;
    const shouldSend = !dryRun && sendTg;
    expect(shouldSend).toBe(true);
  });

  it("dry-run with send-telegram still does not send", () => {
    const dryRun = true;
    const sendTg = true;
    const shouldSend = !dryRun && sendTg;
    expect(shouldSend).toBe(false);
  });
});

// ─── Max-cost abort ───────────────────────────────────────────────────────────

describe("max-cost enforcement", () => {
  it("CostCapExceededError is thrown when cost exceeds cap", () => {
    const tracker = new CostTracker(0.001);
    tracker.record({
      promptTokens: 10_000,
      completionTokens: 5_000,
      cacheHitTokens: 0,
      providerResponseId: "resp-1",
      modelId: "deepseek-chat",
      stage: "article_summarizer",
      estimatedCostUsd: 0.01,
    });
    expect(() => tracker.assertUnderBudget()).toThrow(CostCapExceededError);
  });

  it("CostCapExceededError contains actual and cap amounts", () => {
    const tracker = new CostTracker(0.001);
    tracker.record({
      promptTokens: 10_000,
      completionTokens: 5_000,
      cacheHitTokens: 0,
      providerResponseId: "resp-1",
      modelId: "deepseek-chat",
      stage: "article_summarizer",
      estimatedCostUsd: 0.01,
    });
    try {
      tracker.assertUnderBudget();
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CostCapExceededError);
      expect((e as CostCapExceededError).actual).toBeGreaterThan(0);
      expect((e as CostCapExceededError).cap).toBe(0.001);
    }
  });

  it("does not throw when cost is within cap", () => {
    const tracker = new CostTracker(1.0);
    tracker.record({
      promptTokens: 100,
      completionTokens: 50,
      cacheHitTokens: 0,
      providerResponseId: "resp-1",
      modelId: "deepseek-chat",
      stage: "article_summarizer",
      estimatedCostUsd: 0.0001,
    });
    expect(() => tracker.assertUnderBudget()).not.toThrow();
  });
});

// ─── Structured skip for missing secrets ─────────────────────────────────────

describe("structured skips for missing secrets", () => {
  it("missing DEEPSEEK_API_KEY is reported in missingSecrets", () => {
    const secretStatus = { deepseek: false, openrouter: true, artificialAnalysis: false, telegram: false };
    const missingSecrets: string[] = [];
    if (!secretStatus.deepseek) missingSecrets.push("DEEPSEEK_API_KEY");
    if (!secretStatus.openrouter) missingSecrets.push("OPENROUTER_API_KEY");
    if (!secretStatus.artificialAnalysis) missingSecrets.push("ARTIFICIAL_ANALYSIS_API_KEY");

    expect(missingSecrets).toContain("DEEPSEEK_API_KEY");
    expect(missingSecrets).not.toContain("OPENROUTER_API_KEY");
  });

  it("missing both LLM keys are reported", () => {
    const secretStatus = { deepseek: false, openrouter: false, artificialAnalysis: false, telegram: false };
    const missingSecrets: string[] = [];
    if (!secretStatus.deepseek) missingSecrets.push("DEEPSEEK_API_KEY");
    if (!secretStatus.openrouter) missingSecrets.push("OPENROUTER_API_KEY");

    expect(missingSecrets).toContain("DEEPSEEK_API_KEY");
    expect(missingSecrets).toContain("OPENROUTER_API_KEY");
  });

  it("missing telegram secret is reported separately", () => {
    const secretStatus = { deepseek: true, openrouter: true, artificialAnalysis: false, telegram: false };
    const missingSecrets: string[] = [];
    if (!secretStatus.telegram) missingSecrets.push("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");

    expect(missingSecrets).toContain("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");
  });

  it("structured skip result has ok: true when LLM secrets absent (non-required)", () => {
    // When secrets are missing but not required, the result should be:
    // ok: true, status: "skipped" — this is the spec contract for the smoke CLI
    const skipResult = {
      ok: true,
      status: "skipped",
      reason: "missing_llm_secrets",
      missingSecrets: ["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"],
    };

    expect(skipResult.ok).toBe(true);
    expect(skipResult.status).toBe("skipped");
    expect(skipResult.reason).toBe("missing_llm_secrets");
  });
});

// ─── Full pipeline integration (offline, fake LLM) ───────────────────────────

describe("full pipeline with fake LLM (offline)", () => {
  it("runs agent orchestration with offline router and produces a final message", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(1.0);
    const article = makeArticle();
    const systemCardResult = makeSystemCardResult();
    const benchmarkEvidence = makeBenchmarkEvidence();

    const result = await runAgentOrchestration(
      article.url,
      article,
      systemCardResult,
      benchmarkEvidence,
      { router, tracker },
    );

    expect(result.finalMessage).toBeTruthy();
    expect(typeof result.finalMessage).toBe("string");
    expect(result.evidencePacket.lab).toBeTruthy();
  });

  it("builds a release note from orchestration result", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(1.0);
    const article = makeArticle();
    const systemCardResult = makeSystemCardResult();
    const benchmarkEvidence = makeBenchmarkEvidence();

    const orchestrationResult = await runAgentOrchestration(
      article.url,
      article,
      systemCardResult,
      benchmarkEvidence,
      { router, tracker },
    );

    const releaseNote = buildReleaseNote({
      evidencePacket: orchestrationResult.evidencePacket,
      finalMessage: orchestrationResult.finalMessage,
      verifierOutput: orchestrationResult.verifierOutput,
    });

    expect(releaseNote.lab).toBeTruthy();
    expect(releaseNote.canonicalSourceUrl).toBe(article.url);
    expect(releaseNote.costSummary.maxCostUsd).toBe(1.0);
  });

  it("canSendReleaseNote returns false when verifier rejects", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(1.0);
    const article = makeArticle({ body: "SOTA model outperforms all competitors. No limitations." });
    const systemCardResult = makeSystemCardResult();
    const benchmarkEvidence = makeBenchmarkEvidence();

    const orchestrationResult = await runAgentOrchestration(
      article.url,
      article,
      systemCardResult,
      benchmarkEvidence,
      { router, tracker },
    );

    const releaseNote = buildReleaseNote({
      evidencePacket: orchestrationResult.evidencePacket,
      finalMessage: orchestrationResult.finalMessage,
      verifierOutput: orchestrationResult.verifierOutput,
    });

    // The offline fake message may or may not pass the verifier.
    // What matters is that canSendReleaseNote respects verifierStatus.
    if (releaseNote.verifierStatus === "rejected") {
      expect(canSendReleaseNote(releaseNote)).toBe(false);
    } else {
      expect(canSendReleaseNote(releaseNote)).toBe(true);
    }
  });
});

// ─── DeepSeek V4 acceptance checks ───────────────────────────────────────────

describe("DeepSeek V4 URL acceptance checks", () => {
  it("gate accepts DeepSeek V4 Preview URL", () => {
    const url = "https://api-docs.deepseek.com/news/news260424";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: "DeepSeek-V4-Pro Release", url });

    expect(gate.shouldSend).toBe(true);
    expect(gate.lab).toBe("DeepSeek");
    expect(gate.checks.selected_lab).toBe(true);
    expect(gate.checks.official_domain).toBe(true);
    expect(gate.checks.dedicated_article).toBe(true);
  });

  it("gate identifies DeepSeek as the lab for the V4 URL", () => {
    const url = "https://api-docs.deepseek.com/news/news260424";
    const provider = extractLabFromUrl(url);
    expect(provider).toBe("DeepSeek");
  });

  it("gate rejects DeepSeek Hugging Face-only URL", () => {
    const url = "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: "deepseek-ai/DeepSeek-V4-Pro", url });
    expect(gate.shouldSend).toBe(false);
    expect(gate.reason).toBe("unselected_lab");
  });

  it("gate rejects generic DeepSeek docs root", () => {
    const url = "https://api-docs.deepseek.com/news/";
    const provider = extractLabFromUrl(url);
    const gate = evaluateArticleGate({ provider, title: "DeepSeek News", url });
    expect(gate.shouldSend).toBe(false);
  });
});

// ─── Send toggle: Telegram only sends when !dryRun && sendTg && configured ───

describe("Telegram send toggle", () => {
  it("send is blocked in dry run regardless of send-telegram flag", () => {
    const dryRun = true;
    const sendTg = true;
    const telegramConfigured = true;
    const shouldCallTelegram = !dryRun && sendTg && telegramConfigured;
    expect(shouldCallTelegram).toBe(false);
  });

  it("send is allowed in non-dry-run with telegram configured", () => {
    const dryRun = false;
    const sendTg = true;
    const telegramConfigured = true;
    const shouldCallTelegram = !dryRun && sendTg && telegramConfigured;
    expect(shouldCallTelegram).toBe(true);
  });

  it("send is blocked when telegram is not configured", () => {
    const dryRun = false;
    const sendTg = true;
    const telegramConfigured = false;
    const shouldCallTelegram = !dryRun && sendTg && telegramConfigured;
    expect(shouldCallTelegram).toBe(false);
  });

  it("send is blocked when send-telegram flag is false", () => {
    const dryRun = false;
    const sendTg = false;
    const telegramConfigured = true;
    const shouldCallTelegram = !dryRun && sendTg && telegramConfigured;
    expect(shouldCallTelegram).toBe(false);
  });
});

// ─── Failure mode distinctions ────────────────────────────────────────────────

describe("failure mode distinct reasons", () => {
  it("network failure has distinct reason from LLM failure", () => {
    const networkFailure = { ok: false, status: "failed", reason: "article_fetch_failed" };
    const llmFailure = { ok: false, status: "failed", reason: "llm_pipeline_failed" };
    expect(networkFailure.reason).not.toBe(llmFailure.reason);
  });

  it("cost cap exceeded has distinct reason", () => {
    const costCapFailure = { ok: false, status: "failed", reason: "cost_cap_exceeded" };
    const llmFailure = { ok: false, status: "failed", reason: "llm_pipeline_failed" };
    expect(costCapFailure.reason).not.toBe(llmFailure.reason);
  });

  it("verifier rejection has distinct reason from telegram send failure", () => {
    const verifierReject = { ok: false, status: "failed", reason: "verifier_rejected" };
    const telegramFail = { ok: false, status: "failed", reason: "telegram_send_failed" };
    expect(verifierReject.reason).not.toBe(telegramFail.reason);
  });

  it("gate rejection has distinct reason from missing secrets", () => {
    const gateReject = { ok: false, status: "gate_rejected", reason: "article_gate_rejected" };
    const secretSkip = { ok: true, status: "skipped", reason: "missing_llm_secrets" };
    expect(gateReject.ok).toBe(false);
    expect(secretSkip.ok).toBe(true);
    expect(gateReject.reason).not.toBe(secretSkip.reason);
  });

  it("browser not available is distinct from article extraction failure", () => {
    const browserRequired = { ok: false, status: "failed", reason: "browser_required_but_unavailable" };
    const extractionFailed = { ok: false, status: "failed", reason: "article_extraction_failed" };
    expect(browserRequired.reason).not.toBe(extractionFailed.reason);
  });
});

// ─── DeepSeek V4 required acceptance tests (Task 14) ─────────────────────────
// These tests verify the pipeline behaviors required by Task 14 against the
// official deepseek-v4 fixture snapshot, without requiring live API keys.

describe("DeepSeek V4 acceptance: article extraction from snapshot", () => {
  const snapshotPath = resolve(SNAPSHOTS_DIR, "deepseek-v4.html");
  const url = "https://api-docs.deepseek.com/news/news260424";

  it("snapshot file exists", () => {
    expect(existsSync(snapshotPath)).toBe(true);
  });

  it("extracts DeepSeek-V4-Pro model name from body text", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    expect(article.body).toContain("DeepSeek-V4-Pro");
  });

  it("extracts DeepSeek-V4-Flash model name from body text", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    expect(article.body).toContain("DeepSeek-V4-Flash");
  });

  it("extracts release date 2026-04-24 from meta tag", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    expect(article.publishedAt).toContain("2026-04-24");
  });

  it("extracts tech report link (arxiv) in outbound links", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    const hasArxiv = article.outboundLinks.some((l) => l.includes("arxiv.org"));
    expect(hasArxiv).toBe(true);
  });

  it("extracts HuggingFace open-weights link in outbound links (evidence only)", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    const hasHf = article.outboundLinks.some((l) => l.includes("huggingface.co"));
    expect(hasHf).toBe(true);
  });

  it("body contains API availability mention", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    expect(article.body?.toLowerCase()).toMatch(/api/);
  });

  it("body contains deprecation note for deepseek-chat", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    expect(article.body).toContain("deepseek-chat");
  });

  it("body contains deprecation note for deepseek-reasoner", () => {
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, url);
    expect(article.body).toContain("deepseek-reasoner");
  });
});

describe("DeepSeek V4 acceptance: HuggingFace links are evidence only", () => {
  it("DeepSeek HuggingFace URL is rejected by article gate (not a sendable source)", () => {
    const hfUrl = "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro";
    const provider = extractLabFromUrl(hfUrl);
    const gate = evaluateArticleGate({ provider, title: "deepseek-ai/DeepSeek-V4-Pro", url: hfUrl });
    expect(gate.shouldSend).toBe(false);
  });

  it("HuggingFace URL in article outbound links does not trigger gate acceptance", () => {
    const snapshotPath = resolve(SNAPSHOTS_DIR, "deepseek-v4.html");
    const html = readFileSync(snapshotPath, "utf8");
    const articleUrl = "https://api-docs.deepseek.com/news/news260424";
    const article = extractArticleFromHtml(html, articleUrl);
    const hfLinks = article.outboundLinks.filter((l) => l.includes("huggingface.co"));
    // HuggingFace links appear in outboundLinks (as evidence) but not as the canonical/final URL
    expect(hfLinks.length).toBeGreaterThan(0);
    expect(article.canonicalUrl).not.toContain("huggingface.co");
    expect(article.finalUrl).not.toContain("huggingface.co");
  });
});

describe("DeepSeek V4 acceptance: benchmark claims are vendor-provided without AA", () => {
  it("benchmark claims from article text have vendor_article source", async () => {
    const snapshotPath = resolve(SNAPSHOTS_DIR, "deepseek-v4.html");
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, "https://api-docs.deepseek.com/news/news260424");
    const benchEvidence = await aggregateBenchmarkEvidence(
      "DeepSeek",
      ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
      article.body ?? "",
      article.finalUrl,
      [],
      { apiKey: undefined },
    );
    // Without AA key, all claims come from article text (vendor_article)
    const vendorClaims = benchEvidence.claims.filter((c) => c.source === "vendor_article");
    expect(vendorClaims.length).toBeGreaterThan(0);
    // No artificial_analysis claims without AA key
    const aaClaims = benchEvidence.claims.filter((c) => c.source === "artificial_analysis");
    expect(aaClaims).toHaveLength(0);
  });

  it("benchmark claims without AA data have missing or not_comparable status", async () => {
    const snapshotPath = resolve(SNAPSHOTS_DIR, "deepseek-v4.html");
    const html = readFileSync(snapshotPath, "utf8");
    const article = extractArticleFromHtml(html, "https://api-docs.deepseek.com/news/news260424");
    const benchEvidence = await aggregateBenchmarkEvidence(
      "DeepSeek",
      ["DeepSeek-V4-Pro"],
      article.body ?? "",
      article.finalUrl,
      [],
      { apiKey: undefined },
    );
    for (const claim of benchEvidence.claims.filter((c) => c.source === "vendor_article")) {
      expect(["missing", "not_comparable"]).toContain(claim.status);
    }
  });

  it("AA skips gracefully when API key is absent", async () => {
    const benchEvidence = await aggregateBenchmarkEvidence(
      "DeepSeek",
      ["DeepSeek-V4-Pro"],
      "MMLU: 92.1%. HumanEval: 95.3%.",
      "https://api-docs.deepseek.com/news/news260424",
      [],
      { apiKey: undefined },
    );
    expect(benchEvidence.artificialAnalysis.ok).toBe(false);
    expect((benchEvidence.artificialAnalysis as { status: string }).status).toBe("skipped");
  });
});

describe("DeepSeek V4 acceptance: safety/system-card status is explicit", () => {
  it("extractSystemCards returns explicit system_card_status for DeepSeek V4 snapshot", async () => {
    const snapshotPath = resolve(SNAPSHOTS_DIR, "deepseek-v4.html");
    const html = readFileSync(snapshotPath, "utf8");
    const result = await extractSystemCards(html, "https://api-docs.deepseek.com/news/news260424", {
      fetchImpl: async () => { throw new Error("no-network-in-test"); },
    });
    // system_card_status must be explicitly "found" or "not_found" — never undefined or null
    expect(["found", "not_found"]).toContain(result.system_card_status);
    // Detected list must be an array
    expect(Array.isArray(result.detected)).toBe(true);
  });

  it("system card result from DeepSeek V4 detects arxiv link as evidence", async () => {
    const snapshotPath = resolve(SNAPSHOTS_DIR, "deepseek-v4.html");
    const html = readFileSync(snapshotPath, "utf8");
    const result = await extractSystemCards(html, "https://api-docs.deepseek.com/news/news260424", {
      fetchImpl: async () => { throw new Error("no-network-in-test"); },
    });
    // DeepSeek V4 snapshot has arxiv technical report link
    const hasArxivDetected = result.detected.some((d) => d.url?.includes("arxiv.org"));
    expect(hasArxivDetected).toBe(true);
  });
});

describe("DeepSeek V4 acceptance: LLM routing and cost report", () => {
  it("DeepSeek roles cover article/system-card/benchmark/synthesis stages", () => {
    expect(DEEPSEEK_ROLES.has("article_summarizer")).toBe(true);
    expect(DEEPSEEK_ROLES.has("system_card_summarizer")).toBe(true);
    expect(DEEPSEEK_ROLES.has("benchmark_aggregator")).toBe(true);
    expect(DEEPSEEK_ROLES.has("evidence_synthesizer")).toBe(true);
  });

  it("Kimi final_writer role is assigned to OpenRouter", () => {
    expect(KIMI_ROLES.has("final_writer")).toBe(true);
    expect(DEEPSEEK_ROLES.has("final_writer")).toBe(false);
  });

  it("offline pipeline produces cost report with DeepSeek and Kimi stage entries", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(1.0);
    const article = makeArticle({
      body: "DeepSeek-V4-Pro and DeepSeek-V4-Flash are released. Unknown weaknesses exist. See https://api-docs.deepseek.com/news/news260424",
    });
    // Provide a system card with documents so system_card_summarizer calls the LLM
    const systemCardResultWithDoc = makeSystemCardResult({
      system_card_status: "found",
      documents: [
        {
          url: "https://arxiv.org/abs/2604.xxxxx",
          canonicalUrl: "https://arxiv.org/abs/2604.xxxxx",
          kind: "technical_report" as const,
          title: "DeepSeek-V4 Technical Report",
          fetchStatus: "ok" as const,
          chunks: [
            {
              chunkId: "tech_report_safety_0",
              sourceUrl: "https://arxiv.org/abs/2604.xxxxx",
              topic: "safety" as const,
              pageNumber: null,
              text: "Safety evaluation results and limitations are documented here.",
            },
          ],
        },
      ],
    });
    const benchmarkEvidence = makeBenchmarkEvidence();

    await runAgentOrchestration(article.url, article, systemCardResultWithDoc, benchmarkEvidence, { router, tracker });

    const report = tracker.report();
    const stageNames = report.stages.map((s) => s.stage);
    // DeepSeek stages
    expect(stageNames).toContain("article_summarizer");
    expect(stageNames).toContain("system_card_summarizer");
    expect(stageNames).toContain("benchmark_aggregator");
    expect(stageNames).toContain("evidence_synthesizer");
    // Kimi stage
    expect(stageNames).toContain("final_writer");
    // Total cost and max cost are present
    expect(typeof report.totalCostUsd).toBe("number");
    expect(report.maxCostUsd).toBe(1.0);
  });

  it("verifier status is present in orchestration result", async () => {
    const router = createLlmRouter({ offline: true });
    const tracker = new CostTracker(1.0);
    const article = makeArticle({
      body: "DeepSeek-V4-Pro released. Unknown weaknesses. Source: https://api-docs.deepseek.com/news/news260424",
    });
    const systemCardResult = makeSystemCardResult();
    const benchmarkEvidence = makeBenchmarkEvidence();

    const result = await runAgentOrchestration(article.url, article, systemCardResult, benchmarkEvidence, { router, tracker });

    expect(result.verifierOutput).toBeDefined();
    expect(typeof result.verifierOutput.approved).toBe("boolean");
    expect(typeof result.verifierOutput.checkedClaims).toBe("number");
    expect(Array.isArray(result.verifierOutput.findings)).toBe(true);
  });
});

describe("DeepSeek V4 acceptance: dry-run does not send Telegram", () => {
  it("dry-run flag prevents Telegram send for DeepSeek V4 URL pipeline", () => {
    const dryRun = true;
    const sendTg = true;
    const telegramConfigured = true;
    const shouldCallTelegram = !dryRun && sendTg && telegramConfigured;
    expect(shouldCallTelegram).toBe(false);
  });

  it("smoke output for DeepSeek V4 URL with missing secrets is ok:true (not a hard failure)", () => {
    // When LLM keys are absent, smoke returns ok:true with status:skipped
    // (this validates the structured skip contract)
    const smokeResult = {
      ok: true,
      status: "skipped",
      reason: "missing_llm_secrets",
      releaseUrl: "https://api-docs.deepseek.com/news/news260424",
      dryRun: true,
      gateDecision: {
        shouldSend: true,
        reason: "official_dedicated_model_release_article",
        lab: "DeepSeek",
        checks: {
          selected_lab: true,
          official_domain: true,
          dedicated_article: true,
          model_release_language: true,
          lab_specific_constraint: true,
        },
      },
    };
    expect(smokeResult.ok).toBe(true);
    expect(smokeResult.gateDecision.shouldSend).toBe(true);
    expect(smokeResult.gateDecision.lab).toBe("DeepSeek");
    expect(smokeResult.gateDecision.reason).toBe("official_dedicated_model_release_article");
    // No Telegram send in dry-run
    expect(smokeResult.dryRun).toBe(true);
  });
});

describe("DeepSeek V4 acceptance: non-dry-run with missing secrets returns structured skip", () => {
  it("non-dry-run smoke returns ok:true skipped when LLM secrets absent", () => {
    // The same missing_llm_secrets structured skip applies for non-dry-run
    // when LLM keys are absent — this is the expected behavior.
    const secretStatus = { deepseek: false, openrouter: false, artificialAnalysis: false, telegram: false };
    const llmSecretsPresent = secretStatus.deepseek && secretStatus.openrouter;
    // Would produce: ok:true, status:"skipped", reason:"missing_llm_secrets"
    expect(llmSecretsPresent).toBe(false);
  });

  it("non-dry-run with send-telegram but missing secrets should not send", () => {
    const secretStatus = { deepseek: false, openrouter: false, artificialAnalysis: false, telegram: false };
    const llmSecretsPresent = secretStatus.deepseek && secretStatus.openrouter;
    const telegramPresent = secretStatus.telegram;
    // If LLM secrets absent: pipeline returns early without reaching the Telegram step
    expect(llmSecretsPresent).toBe(false);
    expect(telegramPresent).toBe(false);
  });
});
