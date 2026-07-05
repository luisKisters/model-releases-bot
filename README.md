# Model Release Radar

A Next.js + Convex app that watches selected AI labs and sends Telegram alerts for verified model releases.

Only official dedicated model-release articles pass the gate. Discovery feeds, docs, changelogs, catalogs, and benchmark pages can provide evidence but cannot trigger a send on their own.

## Selected Labs And Rejection Policy

### Sendable Labs

| Lab | Sendable source rule |
| --- | --- |
| OpenAI | Official OpenAI news/article page for a new model release |
| Anthropic | Official Anthropic news/article page for a new Claude model release |
| Google Gemini / DeepMind | Official Google, DeepMind, or Google Developers blog article for a Gemini/DeepMind model release |
| Mistral | Official Mistral news/article page for a new model release |
| DeepSeek | Official DeepSeek API docs/news article for a new model release |
| Meta / Llama | Official AI at Meta blog article for a Llama model release |
| xAI | Official xAI news article for a Grok model release |
| NVIDIA Nemotron | Official Nemotron-specific release article only |
| Deepgram | Official dedicated Deepgram model release article |
| ElevenLabs | Official dedicated ElevenLabs model release article |
| AssemblyAI | Official dedicated AssemblyAI model release article |

### Always Rejected (Never Sendable)

- Cohere, Qwen, Kimi/Moonshot, Z.ai, MiniMax, Xiaomi MiMo — not monitored labs
- Generic Hugging Face updates (e.g. `deepseek-ai/DeepSeek-V4-Pro-DSpark updated ...`) — discovery evidence only
- OpenRouter catalog pages — discovery evidence only
- Broad NVIDIA hardware/platform/inference posts — must be Nemotron-specific
- AI Studio model docs, OpenRouter Gemini pages — not an official blog article
- Changelog-only pages, docs-index-only pages, catalog-row-only pages, benchmark-only pages, social posts, third-party articles

Kimi K2 is used through OpenRouter as the final-message writer. It is not a monitored lab.

### Source Discovery Behavior

Discovery sources (changelogs, feeds, model-card repos, release collections) can surface a candidate URL. That candidate URL is then re-evaluated through the article gate. A discovery source that passes a non-article URL will be rejected at the gate. `notify=false` on a source means it is discovery-only; the bot still fetches it and follows candidate links.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Copy Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with real values. See the Environment Variables section below.

### 3. Create A Convex Deployment

```bash
npm run convex:dev
```

Copy the generated `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` into `.env.local` if the CLI does not do it automatically.

### 4. Set Convex Environment Variables

Propagate secrets to your Convex deployment:

```bash
awk -F= '/^TELEGRAM_BOT_TOKEN=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set TELEGRAM_BOT_TOKEN
awk -F= '/^TELEGRAM_CHAT_ID=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set TELEGRAM_CHAT_ID
awk -F= '/^DEEPSEEK_API_KEY=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set DEEPSEEK_API_KEY
awk -F= '/^OPENROUTER_API_KEY=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set OPENROUTER_API_KEY
awk -F= '/^OPENROUTER_KIMI_MODEL=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set OPENROUTER_KIMI_MODEL
```

### 5. Browser Dependencies (Playwright)

The live pipeline uses Playwright for JavaScript-heavy pages and PDF retrieval. Install Chromium:

```bash
npm run radar:browser:install
```

Inside a Docker container or executr environment, install system dependencies first:

```bash
npx playwright install-deps chromium
npm run radar:browser:install
```

If Playwright is not available, the pipeline falls back to HTTP-only fetching and marks results with `reducedConfidence: true`.

### 6. Verify Telegram

Find the Telegram chat id if needed:

```bash
npm run telegram:chats
```

Send a test message:

```bash
npm run telegram:test
```

### 7. Run The Dashboard

```bash
npm run dev
```

Convex schedules a polling cron every 5 minutes via `convex/crons.ts`.

## Environment Variables

All required variables are documented in `.env.example` without real values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Convex deployment URL |
| `CONVEX_DEPLOYMENT` | Yes | Convex deployment identifier |
| `TELEGRAM_BOT_TOKEN` | For send | Telegram bot token |
| `TELEGRAM_CHAT_ID` | For send | Telegram target chat id |
| `RADAR_TELEGRAM_SEND_ENABLED` | No | Set `true` to enable live sends; default `false` |
| `DEEPSEEK_API_KEY` | For live LLM | DeepSeek API key for article/evidence summarization |
| `OPENROUTER_API_KEY` | For live LLM | OpenRouter API key for Kimi K2 final writer |
| `OPENROUTER_KIMI_MODEL` | No | Model ID; default `moonshotai/kimi-k2` |
| `ARTIFICIAL_ANALYSIS_API_KEY` | No | Artificial Analysis API key for benchmark data |
| `MODEL_RELEASES_MAX_COST_USD` | No | Per-run cost cap in USD; default `1.00` |
| `RADAR_BROWSER_ENABLED` | No | Set `true` to enable Playwright browser; default `false` |

## Cost Model

The bot uses two LLM providers:

- DeepSeek — article summarization, system-card topic summaries, benchmark aggregation, and evidence synthesis
- OpenRouter Kimi K2 — final condensed user-facing message only

Pricing is configured in `src/lib/radar/llm.ts` with input/output token rates and last-verified dates. Per-stage token usage and estimated cost are recorded in every pipeline run and included in the final Telegram message.

Set `MODEL_RELEASES_MAX_COST_USD` to enforce a hard cap. The pipeline aborts before sending if the cap would be exceeded.

## Evaluation Commands

Offline eval is fully deterministic. No network calls, no provider tokens spent:

```bash
npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0
```

The eval scores ten dimensions: source eligibility, extraction coverage, system-card coverage, benchmark coverage, LLM routing, cost accounting, final-message coverage, verifier precision, unsupported-claim count, and concision. A `not_scored` dimension fails the run.

## Live Smoke Commands

All smoke commands default to dry-run. The full fetch/extract/LLM/verifier path runs but no Telegram message is sent.

### DeepSeek V4 Acceptance Example

```bash
npm run radar:smoke -- --dry-run --release-url https://api-docs.deepseek.com/news/news260424 --max-cost-usd 0.25
```

This is the required acceptance example. See the DeepSeek V4 Acceptance section below for expected output.

### All-Labs Dry Run

```bash
npm run radar:smoke -- --dry-run --labs all --limit-per-lab 2 --max-cost-usd 1
```

Attempts up to two releases per selected lab. Structured skips are returned for labs with no recent article.

### Send A Verified Release (Telegram Required)

```bash
npm run radar:smoke -- --release-url https://api-docs.deepseek.com/news/news260424 --no-dry-run --send-telegram --max-cost-usd 0.25
```

Only runs when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are present. Returns a structured skip otherwise.

## DeepSeek V4 Acceptance Example

Required acceptance checks for `https://api-docs.deepseek.com/news/news260424`:

- Article gate accepts it as lab `DeepSeek`, type `official_dedicated_model_release_article`
- Extracts model names `DeepSeek-V4-Pro` and `DeepSeek-V4-Flash`
- Extracts release date `2026/04/24`
- Extracts tech report link, open weights link, API availability, and deprecation note for `deepseek-chat` and `deepseek-reasoner`
- Hugging Face links recorded as evidence only, not as sendable release sources
- Benchmark claims marked `vendor_provided` unless supported by independent evidence
- Safety/system-card status is explicit (`found`, `not_found`, or `not_applicable`) — no invented safety claims
- DeepSeek stage usage, Kimi final-writer usage, verifier status, and total estimated cost are present in output
- Final Telegram text includes strengths, weaknesses/unknowns, benchmark context, safety/system notes, and sources
- No Telegram send in dry-run mode

## Interpreting Structured Skips

When secrets are missing or a required capability is unavailable, the pipeline returns a structured skip instead of failing:

```json
{
  "ok": true,
  "status": "skipped",
  "missingSecrets": ["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"],
  "skippedStages": ["llm_summarization", "final_writer", "verifier"],
  "detail": "LLM secrets missing; pipeline ran fetch and gate only."
}
```

A structured skip with `ok: true` means no error occurred — the stage was intentionally bypassed. A structured skip with `ok: false` means a `--require-*` flag was set but the required resource was absent; the exit code is non-zero.

Stage-level skips appear under `skippedStages` with the exact reason string. The pipeline never silently proceeds past a missing dependency — every skip is reported.

## Interpreting Verifier Failures

The independent verifier runs after final writing and before any Telegram send. When a claim cannot be traced to article text, evidence chunks, benchmark rows, or explicit unknowns, the verifier blocks the send:

```json
{
  "verifierStatus": "blocked",
  "findings": [
    {
      "claim": "Achieves 95% on MMLU",
      "reason": "not_in_evidence",
      "suggestion": "Mark as vendor-provided or remove"
    }
  ]
}
```

A blocked verifier means no message is sent. The pipeline exits with `ok: false`, `status: "verifier_blocked"`, and the findings list. Fix by either removing the unsupported claim or adding it to explicit unknowns. A passing verifier returns `verifierStatus: "passed"` with a full evidence map.

## Ralphex / Executr Handoff

The executable plans live in `docs/plans/`:

- `docs/plans/model-release-bot.md` — primary implementation plan
- `docs/plans/model-release-bot-acceptance-red-team.md` — acceptance/red-team plan

`.ralphex/config` sets `branch = model-release-bot` and `plans_dir = docs/plans`.

### Supplying Secrets In Executr / Docker

Never commit secrets. Supply them through one of these mechanisms:

1. GitHub Actions secrets — set `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`, `ARTIFICIAL_ANALYSIS_API_KEY`, and `MODEL_RELEASES_MAX_COST_USD` as repository secrets. Reference them in the workflow with `${{ secrets.NAME }}`.

2. Docker environment injection — pass secrets at container startup:
   ```bash
   docker run --env-file /path/to/secrets.env model-release-radar npm run radar:smoke -- --dry-run
   ```
   Never copy `secrets.env` into the image. Use `--env-file` at runtime only.

3. Convex environment variables — use `npx convex env set KEY VALUE` for secrets that the Convex backend needs. These are stored encrypted in Convex's secret store and never appear in the codebase.

4. Executr secret store — set secrets in the executr operator panel. The runner injects them as environment variables before each plan step.

### Browser Setup In Executr

Install Playwright inside the executr container before running live smoke:

```bash
npx playwright install-deps chromium
npx playwright install chromium
```

Add these steps to the executr pre-run hook or Dockerfile. Without Chromium, the pipeline falls back to HTTP-only mode (`reducedConfidence: true`) and logs the exact capability skip.

## Commands Reference

```bash
npm run test                     # Run all tests
npm run typecheck                # TypeScript type check
npm run build                    # Build production bundle
npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0
npm run radar:smoke -- --dry-run --release-url https://api-docs.deepseek.com/news/news260424 --max-cost-usd 0.25
npm run radar:smoke -- --dry-run --labs all --limit-per-lab 2 --max-cost-usd 1
npm run convex:dev               # Start Convex dev server
npm run radar:browser:install    # Install Playwright Chromium
npm run telegram:test            # Send test Telegram message
npm run telegram:chats           # List available Telegram chats
```
