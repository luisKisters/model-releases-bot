import { loadLocalEnv } from "./shared-env.mjs";
import {
  buildVerifiedReleaseNote,
  defaultReplayReleaseIds,
  extractArticleMetadata,
  formatVerifiedReleaseNote,
  releaseReplayCases,
  selectReleaseReplayCases,
} from "../src/lib/radar/releaseMessages.ts";
import { evaluateArticleGate, identifyProviderForUrl } from "../src/lib/radar/articleGate.ts";
import { sendTelegramMessage, shouldSendToTelegram, telegramConfigured } from "../src/lib/radar/telegram.ts";
import { verifyClaims } from "../src/lib/radar/claimVerifier.ts";
import { checkCostCap } from "../src/lib/radar/costGuard.ts";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const dryRun = booleanArg(args["dry-run"], true);
const fetchArticles = booleanArg(args.fetch, true);
const sendTelegram = booleanArg(args["send-telegram"] ?? args.send, false) || process.env.RADAR_TELEGRAM_SEND_ENABLED === "true";
const maxCostUsd = Number(args["max-cost-usd"] ?? process.env.MODEL_RELEASES_MAX_COST_USD ?? 1);
const requestedIds = listArg(args["release-ids"] ?? args.releases);
const requestedLabs = listArg(args.labs);
const releaseUrl = args["release-url"] ? String(args["release-url"]) : null;
const limitPerLab = args["limit-per-lab"] ? Number(args["limit-per-lab"]) : null;

const secretStatus = {
  deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  artificialAnalysis: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY),
  telegram: telegramConfigured(),
};

const results = [];
let ok = true;
let selectedCases = [];

if (releaseUrl) {
  const result = await runReleaseUrl(releaseUrl);
  results.push(result);
  if (!result.gate.shouldSend) {
    ok = false;
  }
} else {
  selectedCases = selectCases(requestedIds, requestedLabs, limitPerLab);

  for (const releaseCase of selectedCases) {
    const fetchResult = fetchArticles ? await fetchArticle(releaseCase.url) : { ok: false, skipped: true };
    const note = buildVerifiedReleaseNote(releaseCase, fetchResult.ok ? { html: fetchResult.html } : {});

    const claimResult = verifyClaims(note);
    if (!claimResult.approved) {
      note.verificationStatus = "rejected";
    }

    const message = formatVerifiedReleaseNote(note);
    let telegramResult = null;

    if (!note.gate.shouldSend) {
      ok = false;
    }

    const decision = shouldSendToTelegram(note, { dryRun, sendTelegramFlag: sendTelegram });
    if (decision.willSend) {
      const costCheck = checkCostCap(note.costSummary.totalCostUsd, maxCostUsd);
      if (costCheck.allowed) {
        telegramResult = await sendTelegramMessage(message);
        if (!telegramResult.ok) {
          ok = false;
        }
      } else {
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
}

if (!dryRun && sendTelegram && !telegramConfigured()) {
  ok = false;
}

const selectedReleaseIds = releaseUrl ? [] : selectedCases.map((c) => c.id);

const result = {
  ok,
  dryRun,
  fetchArticles,
  releaseUrl: releaseUrl ?? undefined,
  selectedReleaseIds,
  maxCostUsd,
  estimatedCostUsd: 0,
  secretStatus,
  destinationSendEnabled: sendTelegram && !dryRun,
  status: ok ? "completed" : "rejected",
  results,
};

console.log(JSON.stringify(result, null, 2));

if (!ok) {
  process.exitCode = 1;
}

async function runReleaseUrl(url) {
  const fetchResult = fetchArticles ? await fetchArticle(url) : { ok: false, skipped: true };
  const html = fetchResult.ok ? fetchResult.html : "";

  const provider = identifyProviderForUrl(url);
  const metadata = html ? extractArticleMetadata(html, url) : null;
  const title = metadata?.title ?? "";

  const gate = evaluateArticleGate({ provider: provider ?? "__unknown__", title, url });

  const fetched = fetchResult.ok
    ? { ok: true, status: fetchResult.status, bytes: fetchResult.bytes }
    : fetchResult;

  if (!gate.shouldSend) {
    return {
      id: null,
      provider: provider ?? null,
      title,
      sourceUrl: url,
      gate,
      verificationStatus: "rejected",
      fetched,
      evidenceLinks: metadata?.evidenceLinks ?? [],
      telegram: null,
      message: null,
    };
  }

  const releaseCase = {
    id: `url-${slugify(url)}`,
    provider: provider,
    title,
    url,
    releaseDate: metadata?.releaseDate ?? "unknown",
    modelNames: [],
    whereItShines: [],
    strengths: [],
    weaknessesUnknowns: [],
    benchmarkContext: [],
    safetySystemNotes: [],
    evidenceLinks: metadata?.evidenceLinks ?? [],
  };

  const note = buildVerifiedReleaseNote(releaseCase, { html });
  const message = formatVerifiedReleaseNote(note);
  let telegramResult = null;

  const decision = shouldSendToTelegram(note, { dryRun, sendTelegramFlag: sendTelegram });
  if (decision.willSend) {
    const costCheck = checkCostCap(note.costSummary.totalCostUsd, maxCostUsd);
    if (costCheck.allowed) {
      telegramResult = await sendTelegramMessage(message);
      if (!telegramResult.ok) {
        ok = false;
      }
    } else {
      ok = false;
    }
  }

  return {
    id: releaseCase.id,
    provider: note.provider,
    title: note.title,
    sourceUrl: note.sourceUrl,
    gate: note.gate,
    verificationStatus: note.verificationStatus,
    fetched,
    evidenceLinks: note.evidenceLinks,
    telegram: telegramResult,
    message,
  };
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

function selectCases(requestedCaseIds, requestedLabSlugs, limit) {
  let cases;

  if (requestedCaseIds.length > 0) {
    cases = selectReleaseReplayCases(requestedCaseIds);
  } else if (requestedLabSlugs.length > 0 && requestedLabSlugs[0] !== "all") {
    const labs = new Set(requestedLabSlugs.map(slugify));
    cases = releaseReplayCases.filter((releaseCase) => labs.has(slugify(releaseCase.provider)));
  } else if (requestedLabSlugs.length > 0 && requestedLabSlugs[0] === "all") {
    cases = [...releaseReplayCases];
  } else {
    cases = selectReleaseReplayCases(defaultReplayReleaseIds);
  }

  if (limit != null && Number.isFinite(limit) && limit > 0) {
    const countByLab = new Map();
    const limited = [];
    for (const releaseCase of cases) {
      const count = countByLab.get(releaseCase.provider) ?? 0;
      if (count < limit) {
        limited.push(releaseCase);
        countByLab.set(releaseCase.provider, count + 1);
      }
    }
    return limited;
  }

  return cases;
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
