import { loadLocalEnv } from "./shared-env.mjs";
import {
  buildVerifiedReleaseNote,
  defaultReplayReleaseIds,
  formatVerifiedReleaseNote,
  releaseReplayCases,
  selectReleaseReplayCases,
} from "../src/lib/radar/releaseMessages.ts";
import { sendTelegramMessage, telegramConfigured } from "../src/lib/radar/telegram.ts";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const dryRun = booleanArg(args["dry-run"], true);
const fetchArticles = booleanArg(args.fetch, true);
const sendTelegram = booleanArg(args["send-telegram"] ?? args.send, false) || process.env.RADAR_TELEGRAM_SEND_ENABLED === "true";
const maxCostUsd = Number(args["max-cost-usd"] ?? process.env.MODEL_RELEASES_MAX_COST_USD ?? 1);
const releaseUrl = args["release-url"] ? String(args["release-url"]) : null;
const limitPerLab = args["limit-per-lab"] ? Number(args["limit-per-lab"]) : null;
const requestedIds = listArg(args["release-ids"] ?? args.releases);
const requestedLabs = listArg(args.labs);

const secretStatus = {
  deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  artificialAnalysis: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY),
  telegram: telegramConfigured(),
};

// --release-url: full article→LLM→verifier pipeline not yet wired (Task 13).
// Return a structured skip so callers know exactly what was skipped and why.
if (releaseUrl) {
  const result = {
    ok: true,
    status: "skipped",
    reason: "release_url_pipeline_not_ready",
    releaseUrl,
    dryRun,
    maxCostUsd,
    estimatedCostUsd: 0,
    secretStatus,
    missingPipeline: [
      "LLM routing (Task 8 — module implemented, not yet wired into smoke)",
      "Agent orchestration (Task 9)",
      "Final message rendering (Task 10)",
      "Convex persistence (Task 11)",
      "Live smoke CLI (Task 13)",
    ],
    detail:
      "The full article→LLM→verifier pipeline for --release-url requires Tasks 9-13. " +
      "Use --release-ids for replay-based smoke runs.",
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const selectedCases = selectCases(requestedIds, requestedLabs);

const results = [];
let ok = true;

for (const releaseCase of selectedCases) {
  const fetchResult = fetchArticles ? await fetchArticle(releaseCase.url) : { ok: false, skipped: true };
  const note = buildVerifiedReleaseNote(releaseCase, fetchResult.ok ? { html: fetchResult.html } : {});
  const message = formatVerifiedReleaseNote(note);
  let telegramResult = null;

  if (!note.gate.shouldSend) {
    ok = false;
  }

  if (!dryRun && sendTelegram) {
    telegramResult = await sendTelegramMessage(message);
    if (!telegramResult.ok) {
      ok = false;
    }
  }

  results.push({
    id: releaseCase.id,
    provider: note.provider,
    title: note.title,
    sourceUrl: note.sourceUrl,
    gate: note.gate,
    verificationStatus: note.verificationStatus,
    fetched: fetchResult.ok
      ? { ok: true, status: fetchResult.status, bytes: fetchResult.bytes }
      : fetchResult,
    evidenceLinks: note.evidenceLinks,
    telegram: telegramResult,
    message,
  });
}

if (!dryRun && sendTelegram && !telegramConfigured()) {
  ok = false;
}

const result = {
  ok,
  dryRun,
  fetchArticles,
  selectedReleaseIds: selectedCases.map((releaseCase) => releaseCase.id),
  maxCostUsd,
  estimatedCostUsd: 0,
  secretStatus,
  destinationSendEnabled: sendTelegram && !dryRun,
  status: ok ? "completed" : "failed",
  results,
};

console.log(JSON.stringify(result, null, 2));

if (!ok) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    if (arg.startsWith("--no-")) {
      parsed[arg.slice(5)] = false;
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }

  return parsed;
}

function selectCases(requestedCaseIds, requestedLabSlugs) {
  if (requestedCaseIds.length > 0) {
    return selectReleaseReplayCases(requestedCaseIds);
  }

  if (requestedLabSlugs.length > 0) {
    const labs = new Set(requestedLabSlugs.map(slugify));
    return releaseReplayCases.filter((releaseCase) => labs.has(slugify(releaseCase.provider)));
  }

  return selectReleaseReplayCases(defaultReplayReleaseIds);
}

function listArg(value) {
  if (!value || value === true) {
    return [];
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function booleanArg(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function fetchArticle(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "model-release-radar/0.1 (+https://github.com)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: `${response.status} ${response.statusText}` };
    }

    const html = await response.text();
    return { ok: true, status: response.status, bytes: html.length, html };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
