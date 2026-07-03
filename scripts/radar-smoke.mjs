import { loadLocalEnv } from "./shared-env.mjs";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] !== false;
const maxCostUsd = Number(args["max-cost-usd"] ?? process.env.MODEL_RELEASES_MAX_COST_USD ?? 1);
const labs = String(args.labs ?? "openai,anthropic,google-gemini,mistral,deepseek,meta-llama,xai,nvidia-nemotron,deepgram,elevenlabs,assemblyai")
  .split(",")
  .map((lab) => lab.trim())
  .filter(Boolean);

const secretStatus = {
  deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  artificialAnalysis: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY),
};

const result = {
  ok: true,
  dryRun,
  labs,
  maxCostUsd,
  estimatedCostUsd: 0,
  secretStatus,
  destinationSendEnabled: process.env.RADAR_TELEGRAM_SEND_ENABLED === "true",
  status: "structured_skip",
  reason: "live smoke implementation is scheduled for Task 9; this command verifies configuration shape only.",
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
