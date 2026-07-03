import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "./shared-env.mjs";

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
  ok: true,
  mode: offline ? "offline" : "live-disabled-until-task-9",
  fixtureVersion: fixture.version ?? 1,
  totalCases: cases.length,
  positiveCases: positives.length,
  negativeCases: negatives.length,
  estimatedCostUsd,
  scores: {
    sourceEligibility: cases.length === 0 ? "not_scored" : 0,
    extractionCoverage: "not_scored",
    systemCardCoverage: "not_scored",
    benchmarkCoverage: "not_scored",
    finalMessageCoverage: "not_scored",
    verifierPrecision: "not_scored",
  },
  notes: [
    "Task 1 setup runner only; full benchmark scoring is implemented in later plan tasks.",
    "Offline mode performs no network calls and no LLM calls.",
  ],
};

console.log(JSON.stringify(result, null, 2));

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
