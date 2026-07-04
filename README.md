# Model Release Radar

A Next.js + Convex app that watches selected AI labs and sends Telegram alerts for verified model releases.

The target behavior is stricter than the original v1 radar: only selected labs are eligible, and a release is sendable only when there is an official dedicated model-release article. Discovery feeds, docs, changelogs, catalogs, and benchmark pages can provide evidence, but they cannot bypass the dedicated-article gate.

## Selected Labs

- OpenAI
- Anthropic
- Google Gemini / DeepMind
- Mistral
- DeepSeek
- Meta / Llama
- xAI
- NVIDIA Nemotron only
- Deepgram
- ElevenLabs
- AssemblyAI

Cohere, Qwen, Kimi, Z.ai, MiniMax, Xiaomi MiMo, generic Hugging Face discovery, OpenRouter catalogs, and broad NVIDIA announcements are not sendable release sources unless the product config explicitly changes later. Kimi K2.6 is used as the final-message writer through OpenRouter; it is not a monitored lab by default.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy env vars:

   ```bash
   cp .env.example .env.local
   ```

3. Create a Convex deployment:

   ```bash
   npm run convex:dev
   ```

   Copy the generated `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` into `.env.local` if the CLI does not do it for you.

4. Add Telegram secrets to `.env.local`:

   ```bash
   TELEGRAM_BOT_TOKEN=123456:abc
   TELEGRAM_CHAT_ID=123456789
   RADAR_TELEGRAM_SEND_ENABLED=false
   DEEPSEEK_API_KEY=...
   OPENROUTER_API_KEY=...
   OPENROUTER_KIMI_MODEL=moonshotai/kimi-k2.6
   ARTIFICIAL_ANALYSIS_API_KEY=...
   MODEL_RELEASES_MAX_COST_USD=1.00
   ```

   Keep real keys in `.env.local`, Convex env, GitHub Actions secrets, or the executor's secret store. Never commit real API keys or write them into Ralphex progress files.

5. If you do not know the chat id yet, send your bot a message in Telegram, then run:

   ```bash
   npm run telegram:chats
   ```

6. Set Telegram secrets for the Convex deployment too:

   ```bash
   awk -F= '/^TELEGRAM_BOT_TOKEN=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set TELEGRAM_BOT_TOKEN
   awk -F= '/^TELEGRAM_CHAT_ID=/{print substr($0, index($0, "=")+1)}' .env.local | npx convex env set TELEGRAM_CHAT_ID
   ```

7. Verify Telegram directly:

   ```bash
   npm run telegram:test
   ```

8. Run the dashboard:

   ```bash
   npm run dev
   ```

Convex runs the poller every 5 minutes through `convex/crons.ts`.

## Evaluation And Smoke Commands

Offline eval is deterministic and does not spend provider tokens:

```bash
npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0
```

Live smoke is dry-run by default. The Task 1 implementation only checks configuration shape; later plan tasks add real fetching, browser verification, system-card reading, benchmark comparison, and LLM calls.

```bash
npm run radar:smoke -- --dry-run --labs openai,mistral --max-cost-usd 1
```

Install browser dependencies before live browser verification:

```bash
npm run radar:browser:install
```

## Ralphex / Executr Handoff

The executable plan lives at `docs/plans/model-release-bot.md`. The repo-level `.ralphex/config` points at the existing implementation branch `codex/model-release-radar`.

This environment did not have a local `ralphex` or `executr` binary on `PATH`, and the GitHub repository has no Actions workflow that auto-runs plans. A runner must be started externally against the plan file.

## Commands

```bash
npm run test
npm run typecheck
npm run build
npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0
npm run radar:smoke -- --dry-run
npm run convex:dev
```
