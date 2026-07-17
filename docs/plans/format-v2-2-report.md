# Task 8 — Validation Run, Cost Report, And Push To Main

## Status: blocked on credentials — NOT pushed to main

This run could not complete Task 8's live-validation checkboxes and did **not**
merge/push to `main`. Recording why, what was still done, and what remains for
whoever finishes this task with real credentials.

## Why blocked

Task 1 (`docs/plans/format-v2-2-notes.md`) already established that this
sandbox has no access to real API keys — `.env.local` only carries
`CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL` / `NEXT_PUBLIC_CONVEX_SITE_URL`,
pointing at a local anonymous Convex backend, not the production deployment.
Re-checked at the start of this task: still true. `env | grep -iE
"DEEPSEEK|OPENROUTER|ARTIFICIAL|TELEGRAM|CONVEX_DEPLOY_KEY"` is empty, and no
`CONVEX_DEPLOY_KEY` is available to query the production deployment's env
vars. Running `npx tsx scripts/radar-smoke.mjs --release-url <url> --dry-run
--no-fetch` confirms the pipeline short-circuits at
`missing_llm_secrets` before reaching any LLM/AA call — see raw output below.

```
{
  "ok": true,
  "status": "skipped",
  "reason": "missing_llm_secrets",
  ...
  "missingSecrets": ["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"]
}
```

Without `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, and
`ARTIFICIAL_ANALYSIS_API_KEY`, the following Task 8 items are impossible to
do honestly in this environment:

- Run the real pipeline end-to-end for 3 articles with real DeepSeek/Kimi/AA
  calls.
- Produce a real per-stage cost breakdown or total/projected cost (the cost
  figures only exist once real `CostTracker` runs happen).
- Capture the 3 actual rendered message pairs as the writer would really
  produce them.
- Query `RADAR_TELEGRAM_SEND_ENABLED` on the production Convex deployment
  (no deploy key in this sandbox).

The plan's own hard-failure list forbids checking off a task with "stubs,
hardcoded outputs, or tests that don't run" — fabricating message pairs or
cost numbers would violate that, so this report does not include invented
figures.

## What was verified/fixed without live credentials

While auditing whether the codebase was even ready for a real validation run,
found and fixed a real wiring gap: `scripts/radar-smoke.mjs` — the CLI script
that is the actual "full pipeline" runner referenced by this task — was still
sending the legacy single-message `buildReleaseNote` / `sendReleaseNote` path
instead of the new v2.2 two-message `orchestrationResult.message1` /
`message2` via `sendReleasePair`. If run as-is with real keys, it would have
silently exercised the *old* message format, not the one this whole plan
implements. Fixed in this run (`scripts/radar-smoke.mjs`):

- Import `sendReleasePair` instead of the now-unused `sendReleaseNote`.
- The live-pipeline Telegram send now calls
  `sendReleasePair(orchestrationResult.message1, orchestrationResult.message2)`.
- The JSON result payload now surfaces `message1`/`message2` instead of the
  single `finalMessage` field.
- `buildReleaseNote`/`canSendReleaseNote` are kept for the verifier-approval
  gate and the structured `releaseNote` summary fields in the script's
  output — unrelated to which message text actually gets sent to Telegram.

Confirmed after the fix: `npx vitest run` (810 tests) and `npx tsc --noEmit`
both green; `npx tsx scripts/radar-smoke.mjs --release-url <url> --dry-run
--no-fetch` runs to the same `missing_llm_secrets` short-circuit as before
the fix (expected — the change is downstream of that gate and cannot be
exercised without real LLM keys).

## Grep-audit: no unconditional Telegram sends

Confirmed via `grep -rn "sendReleasePair\|sendReleaseNote\|sendTelegramMessage\|sendSourceFailureAlert"`
across `src/` and `convex/` (excluding tests):

- `sendReleaseNote`/`sendReleasePair`/`sendTelegramMessage` are only defined
  in `src/lib/radar/telegram.ts` and called from `scripts/radar-smoke.mjs`
  (gated behind `--send-telegram` / `RADAR_TELEGRAM_SEND_ENABLED=true`, and
  further gated behind `!dryRun`, `secretStatus.telegram`, and
  `canSendReleaseNote`/verifier-approved checks) — never from a Convex
  action, mutation, cron, or startup path.
- The only Convex-side Telegram call is `sendSourceFailureAlert` in
  `convex/polling.ts`, used after 10 consecutive poll failures — this is the
  documented pre-existing operational exception the plan allows to stay.
- No deploy/startup/baseline-poll code path sends a Telegram message.

This satisfies the pre-push safety checks' grep-audit requirement
independent of live credentials.

## Pre-push safety checks

- `npx vitest run` — green (810 tests).
- `npx tsc --noEmit` — clean.
- `RADAR_TELEGRAM_SEND_ENABLED` on production — **not verified**, no
  `CONVEX_DEPLOY_KEY` / production deployment access in this sandbox. Must be
  checked by whoever has deploy-key access before pushing:
  `npx convex env list --prod` (or equivalent). If truthy, set it to `false`
  before pushing.
- Grep-audit — done, see above.

## Merge to main / push to origin

**Not done in this run.** Reasons:

1. It is meaningless to push before a real validation run has actually
   demonstrated the new two-message format works end-to-end with real
   DeepSeek/Kimi/AA calls — that validation is exactly what's blocked above.
2. Pushing to `main` triggers a real production deploy via GitHub Actions.
   That is a shared, hard-to-reverse action; per this run's operating rules
   it requires the user's explicit, real-time authorization, not just the
   plan document's general allowance.

## What's needed to finish Task 8

1. Supply `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`,
   `MODEL_RELEASES_MAX_COST_USD` into this environment (or hand it a
   `CONVEX_DEPLOY_KEY` for the real deployment and pull them via
   `npx convex env get`).
2. Pick 3 real recent release articles and run:
   `npx tsx scripts/radar-smoke.mjs --release-url <url> --dry-run` (dry-run
   keeps `RADAR_TELEGRAM_SEND_ENABLED` off while still making real
   DeepSeek/Kimi/AA calls and populating a real `costReport`) for each of the
   3 URLs, or `--labs all --limit-per-lab 1 --dry-run` to auto-discover
   candidates.
3. Paste the 3 real `message1`/`message2` pairs and the 3 real
   `costReport`/`estimatedCostUsd` blocks from that output into this file,
   replacing this section, plus a total-cost and projected-monthly-cost
   estimate.
4. Verify `RADAR_TELEGRAM_SEND_ENABLED` is unset/false on production, run the
   grep-audit above again in case new code landed, then merge to `main` and
   push, watching the GitHub Actions run to green.

## How to go live

Production already runs the new code; to go live after user approval run
`npx convex env set RADAR_TELEGRAM_SEND_ENABLED true` on the production
deployment (and nothing else). To flip it back off:
`npx convex env set RADAR_TELEGRAM_SEND_ENABLED false`.

Note: as of this run, "production already runs the new code" is **not yet
true** — the push to `main` described above has not happened. This sentence
is the fixed text the plan requires this section to contain once that push
does happen; the go-live flip itself remains a manual, user-only action
either way.
