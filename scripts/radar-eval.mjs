import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "./shared-env.mjs";
import { evaluateArticleGate } from "../src/lib/radar/articleGate.ts";
import { extractModelNames } from "../src/lib/radar/text.ts";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const fixturesPath = resolve(String(args.fixtures ?? "tests/fixtures/release-benchmark.json"));
const offline = Boolean(args.offline);
const maxCostUsd = Number(args["max-cost-usd"] ?? process.env.MODEL_RELEASES_MAX_COST_USD ?? 0);

if (!existsSync(fixturesPath)) {
  console.error(`Fixture file not found: ${fixturesPath}`);
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(fixturesPath, "utf8"));
const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
const positives = cases.filter((entry) => entry.expected?.shouldSend === true);
const negatives = cases.filter((entry) => entry.expected?.shouldSend === false);
const estimatedCostUsd = 0;
const evaluatedCases = cases.map((entry) => evaluateCase(entry));
const correctEligibility = evaluatedCases.filter((entry) => entry.sourceEligibilityCorrect).length;
const modelChecks = evaluatedCases.filter((entry) => entry.expectedModelNames.length > 0);
const correctModelChecks = modelChecks.filter((entry) => entry.modelExtractionCorrect).length;

if (estimatedCostUsd > maxCostUsd) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: "max_cost_exceeded",
        estimatedCostUsd,
        maxCostUsd,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const result = {
  ok: evaluatedCases.every((entry) => entry.sourceEligibilityCorrect && entry.modelExtractionCorrect),
  mode: offline ? "offline" : "live-disabled-until-task-9",
  fixtureVersion: fixture.version ?? 1,
  totalCases: cases.length,
  positiveCases: positives.length,
  negativeCases: negatives.length,
  estimatedCostUsd,
  scores: {
    sourceEligibility: cases.length === 0 ? "not_scored" : correctEligibility / cases.length,
    extractionCoverage: modelChecks.length === 0 ? "not_scored" : correctModelChecks / modelChecks.length,
    systemCardCoverage: "not_scored",
    benchmarkCoverage: "not_scored",
    finalMessageCoverage: "not_scored",
    verifierPrecision: "not_scored",
  },
  evaluatedCases,
  notes: [
    "Offline mode checks article-gate eligibility and expected model-name extraction without network or LLM calls.",
    "System-card, benchmark, final-message, and verifier scoring are still not fully implemented.",
    "Offline mode performs no network calls and no LLM calls.",
  ],
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
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

function evaluateCase(entry) {
  const decision = evaluateArticleGate({
    provider: String(entry.provider ?? ""),
    title: String(entry.title ?? ""),
    url: String(entry.url ?? ""),
  });
  const expectedShouldSend = Boolean(entry.expected?.shouldSend);
  const expectedLab = entry.expected?.lab ? String(entry.expected.lab) : undefined;
  const expectedModelNames = Array.isArray(entry.expected?.modelNames) ? entry.expected.modelNames.map(String) : [];
  const extractedModelNames = extractModelNames(`${entry.title ?? ""} ${entry.summary ?? ""}`);

  return {
    id: entry.id ?? entry.url,
    decision,
    expectedShouldSend,
    sourceEligibilityCorrect:
      decision.shouldSend === expectedShouldSend && (!expectedLab || decision.lab === expectedLab),
    expectedModelNames,
    extractedModelNames,
    modelExtractionCorrect: expectedModelNames.every((name) =>
      extractedModelNames.some((extracted) => extracted.toLowerCase() === name.toLowerCase()),
    ),
  };
}
