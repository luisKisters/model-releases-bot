# No-Key Model Release Radar

A small Next.js + Convex app that watches public model-release surfaces and sends Telegram alerts when high-confidence release signals change.

The bot does not require provider API keys. It uses public RSS/Atom feeds, markdown docs, HTML pages, Hugging Face org APIs, GitHub Atom/API-light sources, public catalog JSON, and public benchmark pages.

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
   ```

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

Convex runs the real poller every 5 minutes through `convex/crons.ts`.

## What v1 Watches

- Providers: OpenAI, Anthropic, Google/Gemini, xAI, Meta/Llama, Mistral, DeepSeek, Qwen, Kimi, Cohere, Z.ai, MiniMax, Xiaomi MiMo, NVIDIA.
- Aggregators: Artificial Analysis, OpenRouter, Hugging Face global new models, GitHub Atom feeds.

Authenticated provider model-list APIs are intentionally excluded from v1.

## Commands

```bash
npm run test
npm run typecheck
npm run build
npm run convex:dev
```
