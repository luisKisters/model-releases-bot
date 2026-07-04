import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "./shared-env.mjs";
import { evaluateOffline } from "../src/lib/radar/eval.ts";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const fixturesPath = resolve(
  String(args.fixtures ?? "tests/fixtures/release-benchmark.json"),
);
const offline = args.offline !== false; // default to offline mode
const maxCostUsd = Number(
  args["max-cost-usd"] ?? process.env.MODEL_RELEASES_MAX_COST_USD ?? 0,
);

if (!existsSync(fixturesPath)) {
  console.error(`Fixture file not found: ${fixturesPath}`);
  process.exit(1);
}

const fixtureData = JSON.parse(readFileSync(fixturesPath, "utf8"));

if (offline) {
  const report = evaluateOffline(fixtureData, { offline: true, maxCostUsd });

  // Machine-readable JSON report to stdout
  console.log(JSON.stringify(report, null, 2));

  // Human-readable summary to stderr
  console.error(report.humanSummary);

  if (!report.ok) {
    process.exitCode = 1;
  }
} else {
  // Live mode: not yet implemented (Task 13)
  const result = {
    ok: true,
    status: "skipped",
    reason: "live_eval_not_ready",
    mode: "live",
    detail:
      "Live eval requires the full pipeline (Tasks 13+). Use --offline for offline evaluation.",
    maxCostUsd,
  };
  console.log(JSON.stringify(result, null, 2));
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
