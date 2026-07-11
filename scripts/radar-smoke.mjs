import { loadLocalEnv } from "./shared-env.mjs";
import { evaluateArticleGate } from "../src/lib/radar/articleGate.ts";
import { extractArticleFromHtml } from "../src/lib/radar/browserTools.ts";
import { extractSystemCards } from "../src/lib/radar/systemCards.ts";
import { aggregateBenchmarkEvidence } from "../src/lib/radar/benchmarks.ts";
import { runAgentOrchestration, extractLabFromUrl } from "../src/lib/radar/agents.ts";
import { buildReleaseNote, canSendReleaseNote } from "../src/lib/radar/messages.ts";
import {
  sendReleaseNote,
  sendTelegramMessage,
  shouldSendToTelegram,
  telegramConfigured,
} from "../src/lib/radar/telegram.ts";
import { createLlmRouter, CostTracker, CostCapExceededError } from "../src/lib/radar/llm.ts";
import { extractModelNames } from "../src/lib/radar/text.ts";
import { sourceRegistry } from "../src/lib/radar/sources.ts";
import { pollSource } from "../src/lib/radar/poller.ts";
import { fetchUrl } from "../src/lib/radar/fetching.ts";
// Legacy replay imports (backward compat for --release-ids)
import {
  buildVerifiedReleaseNote,
  defaultReplayReleaseIds,
  formatVerifiedReleaseNote,
  releaseReplayCases,
  selectReleaseReplayCases,
} from "../src/lib/radar/releaseMessages.ts";
import { verifyClaims } from "../src/lib/radar/claimVerifier.ts";
import { checkCostCap } from "../src/lib/radar/costGuard.ts";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const dryRun = booleanArg(args["dry-run"], true);
const fetchArticles = booleanArg(args.fetch, true);
const sendTg = booleanArg(args["send-telegram"] ?? args.send, false) || process.env.RADAR_TELEGRAM_SEND_ENABLED === "true";
const maxCostUsd = Number(args["max-cost-usd"] ?? process.env.MODEL_RELEASES_MAX_COST_USD ?? 1);
const releaseUrl = args["release-url"] ? String(args["release-url"]) : null;
const limitPerLab = args["limit-per-lab"] ? Number(args["limit-per-lab"]) : null;
const requestedIds = listArg(args["release-ids"] ?? args.releases);
const requestedLabs = listArg(args.labs);
const requireBrowser = booleanArg(args["require-browser"], false);
const requireLlm = booleanArg(args["require-llm"], false);
const requireArtificialAnalysis = booleanArg(args["require-artificial-analysis"], false);

if (!Number.isFinite(maxCostUsd)) {
  console.error(
    JSON.stringify({
      ok: false,
      status: "failed",
      reason: "invalid_max_cost_usd",
      detail: "--max-cost-usd must be a finite number.",
    }, null, 2)
  );
  process.exit(1);
}

const secretStatus = {
  deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  artificialAnalysis: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY),
  telegram: telegramConfigured(),
};

// Determine which secrets are missing
const missingSecrets = [];
if (!secretStatus.deepseek) missingSecrets.push("DEEPSEEK_API_KEY");
if (!secretStatus.openrouter) missingSecrets.push("OPENROUTER_API_KEY");
if (!secretStatus.artificialAnalysis) missingSecrets.push("ARTIFICIAL_ANALYSIS_API_KEY");
if (!secretStatus.telegram) missingSecrets.push("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");

// Enforce --require-* flags
if (requireLlm && missingSecrets.some((s) => s.includes("DEEPSEEK") || s.includes("OPENROUTER"))) {
  console.error(
    JSON.stringify({
      ok: false,
      status: "failed",
      reason: "missing_required_llm_secrets",
      missingSecrets: missingSecrets.filter((s) => s.includes("DEEPSEEK") || s.includes("OPENROUTER")),
      detail: "--require-llm was set but LLM secrets are missing.",
    }, null, 2)
  );
  process.exit(1);
}

if (requireArtificialAnalysis && !secretStatus.artificialAnalysis) {
  console.error(
    JSON.stringify({
      ok: false,
      status: "failed",
      reason: "missing_required_artificial_analysis_key",
      missingSecrets: ["ARTIFICIAL_ANALYSIS_API_KEY"],
      detail: "--require-artificial-analysis was set but ARTIFICIAL_ANALYSIS_API_KEY is missing.",
    }, null, 2)
  );
  process.exit(1);
}

// --release-url: full live pipeline
if (releaseUrl) {
  const result = await runReleasePipeline(releaseUrl, {
    dryRun,
    sendTg,
    maxCostUsd,
    requireBrowser,
    requireLlm,
    requireArtificialAnalysis,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  process.exit(0);
}

// --labs: discover and run pipeline for candidates per lab
if (requestedLabs.length > 0) {
  const result = await runLabsPipeline(requestedLabs, {
    dryRun,
    sendTg,
    maxCostUsd,
    limitPerLab: limitPerLab ?? 2,
    requireBrowser,
    requireLlm,
    requireArtificialAnalysis,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  process.exit(0);
}

// Legacy replay path (--release-ids or default replay IDs)
const selectedCases = selectCases(requestedIds, []);
const results = [];
let ok = true;

for (const releaseCase of selectedCases) {
  let fetchResult = { ok: false, skipped: true };
  if (fetchArticles) {
    try {
      const res = await fetch(releaseCase.url, {
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
          "user-agent": "model-release-radar/0.1 (+https://github.com)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const html = await res.text();
        fetchResult = { ok: true, status: res.status, bytes: html.length, html };
      } else {
        fetchResult = { ok: false, status: res.status, error: `${res.status} ${res.statusText}` };
      }
    } catch (error) {
      fetchResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const note = buildVerifiedReleaseNote(releaseCase, fetchResult.ok ? { html: fetchResult.html } : {});
  const claimResult = verifyClaims(note);
  if (!claimResult.approved) {
    note.verificationStatus = "rejected";
  }

  const message = formatVerifiedReleaseNote(note);
  let telegramResult = null;

  if (!note.gate.shouldSend || !claimResult.approved) {
    ok = false;
  }

  const telegramDecision = shouldSendToTelegram(note, { dryRun, sendTelegramFlag: sendTg });
  if (telegramDecision.willSend) {
    const costCheck = checkCostCap(note.costSummary.totalCostUsd, maxCostUsd);
    if (costCheck.allowed) {
      telegramResult = await sendTelegramMessage(message);
      if (!telegramResult.ok) {
        ok = false;
      }
    } else {
      ok = false;
      telegramResult = {
        ok: false,
        status: 0,
        error: `Cost cap exceeded: $${costCheck.actualCostUsd} > $${costCheck.maxCostUsd}`,
      };
    }
  }

  results.push({
    id: releaseCase.id,
    provider: note.provider,
    title: note.title,
    sourceUrl: note.sourceUrl,
    gate: note.gate,
    verificationStatus: note.verificationStatus,
    claimVerification: claimResult,
    fetched: fetchResult.ok
      ? { ok: true, status: fetchResult.status, bytes: fetchResult.bytes }
      : fetchResult,
    evidenceLinks: note.evidenceLinks,
    telegramDecision,
    telegram: telegramResult,
    message,
  });
}

if (!dryRun && sendTg && !telegramConfigured()) ok = false;

const legacyResult = {
  ok,
  dryRun,
  fetchArticles,
  mode: "replay",
  selectedReleaseIds: selectedCases.map((c) => c.id),
  maxCostUsd,
  estimatedCostUsd: 0,
  secretStatus,
  destinationSendEnabled: sendTg && !dryRun,
  status: ok ? "completed" : "failed",
  results,
};

console.log(JSON.stringify(legacyResult, null, 2));
if (!ok) process.exitCode = 1;

// ─── Full live pipeline for a single URL ─────────────────────────────────────

async function runReleasePipeline(url, { dryRun, sendTg, maxCostUsd, requireBrowser, requireLlm, requireArtificialAnalysis }) {
  // --- Article gate (detect provider from URL domain) ---
  const detectedProvider = extractLabFromUrl(url);
  const gateResult = evaluateArticleGate({ provider: detectedProvider, title: url, url });
  if (!gateResult.shouldSend) {
    return {
      ok: false,
      status: "gate_rejected",
      reason: "article_gate_rejected",
      gateReason: gateResult.reason,
      gateChecks: gateResult.checks,
      releaseUrl: url,
      dryRun,
      secretStatus,
      estimatedCostUsd: 0,
      detail: `Article gate rejected: ${gateResult.reason}`,
    };
  }

  // --- LLM secrets check ---
  const llmSecretsPresent = secretStatus.deepseek && secretStatus.openrouter;
  if (!llmSecretsPresent) {
    if (requireLlm) {
      return {
        ok: false,
        status: "failed",
        reason: "missing_required_llm_secrets",
        releaseUrl: url,
        dryRun,
        secretStatus,
        estimatedCostUsd: 0,
        missingSecrets: missingSecrets.filter((s) => s.includes("DEEPSEEK") || s.includes("OPENROUTER")),
        detail: "--require-llm was set but LLM secrets are missing.",
      };
    }
    return {
      ok: true,
      status: "skipped",
      reason: "missing_llm_secrets",
      releaseUrl: url,
      dryRun,
      secretStatus,
      estimatedCostUsd: 0,
      missingSecrets: missingSecrets.filter((s) => s.includes("DEEPSEEK") || s.includes("OPENROUTER")),
      gateDecision: gateResult,
      detail: "LLM keys not present. Full pipeline requires DEEPSEEK_API_KEY and OPENROUTER_API_KEY.",
    };
  }

  const tracker = new CostTracker(maxCostUsd);

  try {
    // --- Fetch raw HTML (needed for system card link detection + article body) ---
    let rawHtml = "";
    let fetchedContent;
    try {
      fetchedContent = await fetchUrl(url, { timeoutMs: 30_000, maxRetries: 2 });
      rawHtml = fetchedContent.body ?? "";
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        reason: "article_fetch_failed",
        releaseUrl: url,
        dryRun,
        secretStatus,
        estimatedCostUsd: tracker.totalCostUsd,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // --- Article extraction ---
    let article;
    try {
      article = extractArticleFromHtml(rawHtml, fetchedContent.finalUrl ?? url);
      article.finalUrl = fetchedContent.finalUrl ?? url;
      article.reducedConfidence = true;
      article.missingBrowserReason = "no_browser_configured";
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        reason: "article_extraction_failed",
        releaseUrl: url,
        dryRun,
        secretStatus,
        estimatedCostUsd: tracker.totalCostUsd,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    if (requireBrowser && article.reducedConfidence) {
      return {
        ok: false,
        status: "failed",
        reason: "browser_required_but_unavailable",
        releaseUrl: url,
        dryRun,
        secretStatus,
        estimatedCostUsd: tracker.totalCostUsd,
        missingBrowserReason: article.missingBrowserReason,
        detail: "--require-browser was set but browser extraction is not available.",
      };
    }

    // --- System card extraction ---
    let systemCardResult;
    try {
      systemCardResult = await extractSystemCards(rawHtml, fetchedContent.finalUrl ?? url, {
        timeoutMs: 20_000,
        maxRetries: 1,
      });
    } catch (err) {
      systemCardResult = {
        system_card_status: "not_found",
        detected: [],
        documents: [],
        fetchError: err instanceof Error ? err.message : String(err),
      };
    }

    // --- Benchmark evidence ---
    const modelNames = extractModelNames(`${article.title ?? ""} ${article.body ?? ""}`);
    let benchmarkEvidence;
    try {
      benchmarkEvidence = await aggregateBenchmarkEvidence(
        gateResult.lab ?? "Unknown",
        modelNames,
        article.body ?? "",
        url,
        systemCardResult.documents.flatMap((d) => d.chunks),
        {
          apiKey: process.env.ARTIFICIAL_ANALYSIS_API_KEY,
          timeoutMs: 15_000,
          requireArtificialAnalysis,
        },
      );
    } catch (err) {
      if (requireArtificialAnalysis) {
        return {
          ok: false,
          status: "failed",
          reason: "artificial_analysis_required_but_failed",
          releaseUrl: url,
          dryRun,
          secretStatus,
          estimatedCostUsd: tracker.totalCostUsd,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      benchmarkEvidence = {
        lab: gateResult.lab ?? "Unknown",
        modelNames: [],
        modality: ["language"],
        claims: [],
        artificialAnalysis: { ok: false, status: "error", reason: err instanceof Error ? err.message : String(err) },
      };
    }

    // --- Agent orchestration ---
    const router = createLlmRouter({
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      kimiModel: process.env.OPENROUTER_KIMI_MODEL,
    });

    let orchestrationResult;
    try {
      orchestrationResult = await runAgentOrchestration(
        url,
        article,
        systemCardResult,
        benchmarkEvidence,
        { router, tracker },
      );
    } catch (err) {
      if (err instanceof CostCapExceededError) {
        return {
          ok: false,
          status: "failed",
          reason: "cost_cap_exceeded",
          releaseUrl: url,
          dryRun,
          secretStatus,
          estimatedCostUsd: tracker.totalCostUsd,
          maxCostUsd,
          detail: err.message,
        };
      }
      return {
        ok: false,
        status: "failed",
        reason: "llm_pipeline_failed",
        releaseUrl: url,
        dryRun,
        secretStatus,
        estimatedCostUsd: tracker.totalCostUsd,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // --- Build release note ---
    const releaseNote = buildReleaseNote({
      evidencePacket: orchestrationResult.evidencePacket,
      finalMessage: orchestrationResult.finalMessage,
      verifierOutput: orchestrationResult.verifierOutput,
    });

    // --- Telegram send ---
    let telegramResult = null;
    if (!dryRun && sendTg) {
      if (!secretStatus.telegram) {
        return {
          ok: false,
          status: "failed",
          reason: "telegram_not_configured",
          releaseUrl: url,
          dryRun,
          secretStatus,
          estimatedCostUsd: tracker.totalCostUsd,
          missingSecrets: ["TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID"],
          detail: "--send-telegram was set but Telegram secrets are missing.",
        };
      }

      if (!canSendReleaseNote(releaseNote)) {
        return {
          ok: false,
          status: "failed",
          reason: "verifier_rejected",
          releaseUrl: url,
          dryRun,
          secretStatus,
          estimatedCostUsd: tracker.totalCostUsd,
          verifierStatus: releaseNote.verifierStatus,
          verifierFindings: releaseNote.verifierFindings,
          detail: `Verifier rejected the release note. ${releaseNote.verifierFindings.length} finding(s) prevented send.`,
        };
      }

      try {
        const sendResult = await sendReleaseNote(releaseNote);
        telegramResult = sendResult;
        if (!sendResult.ok) {
          return {
            ok: false,
            status: "failed",
            reason: "telegram_send_failed",
            releaseUrl: url,
            dryRun,
            secretStatus,
            estimatedCostUsd: tracker.totalCostUsd,
            telegramResult,
            detail: sendResult.reason ?? "Telegram send returned not-ok.",
          };
        }
      } catch (err) {
        return {
          ok: false,
          status: "failed",
          reason: "telegram_send_error",
          releaseUrl: url,
          dryRun,
          secretStatus,
          estimatedCostUsd: tracker.totalCostUsd,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      ok: true,
      status: dryRun ? "dry_run_complete" : "completed",
      mode: "live",
      releaseUrl: url,
      dryRun,
      secretStatus,
      estimatedCostUsd: tracker.totalCostUsd,
      costReport: tracker.report(),
      gateDecision: gateResult,
      articleExtraction: {
        finalUrl: article.finalUrl,
        title: article.title,
        reducedConfidence: article.reducedConfidence,
        missingBrowserReason: article.missingBrowserReason,
        bodyLength: article.body?.length ?? 0,
      },
      systemCardStatus: systemCardResult.system_card_status,
      benchmarkClaimsCount: benchmarkEvidence.claims.length,
      artificialAnalysisStatus: benchmarkEvidence.artificialAnalysis.ok ? "ok" : benchmarkEvidence.artificialAnalysis.status,
      orchestration: {
        lab: orchestrationResult.evidencePacket.lab,
        modelNames: orchestrationResult.evidencePacket.modelNames,
        releaseDate: orchestrationResult.evidencePacket.releaseDate,
      },
      verifierStatus: releaseNote.verifierStatus,
      verifierApproved: orchestrationResult.approved,
      verifierFindings: orchestrationResult.verifierOutput.findings,
      finalMessage: orchestrationResult.finalMessage,
      releaseNote: {
        title: releaseNote.title,
        lab: releaseNote.lab,
        modelNames: releaseNote.modelNames,
        releaseDate: releaseNote.releaseDate,
        canonicalSourceUrl: releaseNote.canonicalSourceUrl,
        verifierStatus: releaseNote.verifierStatus,
        evidenceLinksCount: releaseNote.evidenceLinks.length,
      },
      telegramSent: !dryRun && sendTg && telegramResult?.ok === true,
      telegramResult,
    };
  } catch (err) {
    return {
      ok: false,
      status: "failed",
      reason: "unexpected_error",
      releaseUrl: url,
      dryRun,
      secretStatus,
      estimatedCostUsd: tracker.totalCostUsd,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Labs pipeline: discover candidates and run pipeline ─────────────────────

async function runLabsPipeline(labSlugs, { dryRun, sendTg, maxCostUsd, limitPerLab, requireBrowser, requireLlm, requireArtificialAnalysis }) {
  const allLabs = [...new Set(sourceRegistry.map((s) => s.provider))];
  const isAll = labSlugs.includes("all");
  const targetLabs = isAll
    ? allLabs
    : allLabs.filter((lab) => labSlugs.some((slug) => slugify(lab) === slugify(slug)));

  if (targetLabs.length === 0) {
    return {
      ok: false,
      status: "failed",
      reason: "no_matching_labs",
      requestedLabs: labSlugs,
      availableLabs: allLabs,
      detail: `No labs matched the requested slugs: ${labSlugs.join(", ")}`,
    };
  }

  const labResults = [];
  let globalOk = true;
  let totalCostUsd = 0;

  for (const lab of targetLabs) {
    const labSources = sourceRegistry.filter((s) => s.provider === lab && s.enabled);
    const seenUrls = new Set();
    const gatedCandidates = [];

    // Discover candidates from each source. Discovery blog/index sources can still
    // produce alertable articles after the article gate approves the individual URL.
    for (const source of labSources) {
      try {
        const pollResult = await pollSource({
          ...source,
          etag: undefined,
          lastModified: undefined,
          lastContentHash: undefined,
        });

        if (pollResult.ok && pollResult.parsedSignals) {
          for (const signal of pollResult.parsedSignals) {
            if (!signal.url || seenUrls.has(signal.url)) continue;
            const gate = evaluateArticleGate({
              provider: source.provider,
              title: signal.title,
              url: signal.url,
              summary: signal.summary,
              source,
            });
            if (!gate.shouldSend) continue;
            seenUrls.add(signal.url);
            gatedCandidates.push({
              candidateUrl: signal.url,
              candidateTitle: signal.title,
              modelNames: signal.modelNames,
              gateReason: gate.reason,
            });
          }
        }
      } catch {
        // Source polling failure is non-fatal; continue to next source
      }
    }

    const toProcess = gatedCandidates.slice(0, limitPerLab);
    const labPipelineResults = [];

    for (const candidate of toProcess) {
      const pipelineResult = await runReleasePipeline(candidate.candidateUrl, {
        dryRun,
        sendTg,
        maxCostUsd: maxCostUsd - totalCostUsd,
        requireBrowser,
        requireLlm,
        requireArtificialAnalysis,
      });

      totalCostUsd += pipelineResult.estimatedCostUsd ?? 0;
      if (!pipelineResult.ok) globalOk = false;

      labPipelineResults.push({
        candidateUrl: candidate.candidateUrl,
        candidateTitle: candidate.candidateTitle,
        result: pipelineResult,
      });

      // Abort if cost cap is exceeded
      if (totalCostUsd >= maxCostUsd) {
        labPipelineResults.push({
          candidateUrl: null,
          candidateTitle: null,
          gate: null,
          result: {
            ok: false,
            status: "skipped",
            reason: "cost_cap_reached",
            detail: `Cost cap of $${maxCostUsd} reached. Remaining lab candidates skipped.`,
          },
        });
        break;
      }
    }

    labResults.push({
      lab,
      sourcesChecked: labSources.length,
      candidatesPassingGate: gatedCandidates.length,
      candidatesProcessed: toProcess.length,
      results: labPipelineResults,
    });

    if (totalCostUsd >= maxCostUsd) break;
  }

  return {
    ok: globalOk,
    status: globalOk ? (dryRun ? "dry_run_complete" : "completed") : "completed_with_failures",
    mode: "live_labs",
    dryRun,
    requestedLabs: labSlugs,
    targetLabs,
    limitPerLab,
    maxCostUsd,
    estimatedCostUsd: totalCostUsd,
    secretStatus,
    labResults,
  };
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    if (arg.startsWith("--no-")) { parsed[arg.slice(5)] = false; continue; }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const next = argv[i + 1];
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      i++;
    } else {
      parsed[rawKey] = true;
    }
  }
  return parsed;
}

function selectCases(requestedCaseIds, requestedLabSlugs) {
  if (requestedCaseIds.length > 0) return selectReleaseReplayCases(requestedCaseIds);
  if (requestedLabSlugs.length > 0) {
    const labs = new Set(requestedLabSlugs.map(slugify));
    return releaseReplayCases.filter((c) => labs.has(slugify(c.provider)));
  }
  return selectReleaseReplayCases(defaultReplayReleaseIds);
}

function listArg(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((e) => e.trim()).filter(Boolean);
}

function booleanArg(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
