# Model Release Bot Acceptance And Red-Team Plan

## Executr Pickup Contract

This is the second executable plan for executr. It lives in `docs/plans/` so the existing `.ralphex/config` with `plans_dir = docs/plans` will discover it.

Run this plan after, or in parallel with, `docs/plans/model-release-bot.md`. This plan does not replace the implementation plan. It exists to make sure the implementation cannot be called done unless it actually satisfies the original product requirements.

If this plan fails, the bot is not complete.

## Purpose

The implementation plan builds the missing pipeline. This plan attacks it. It verifies that the bot:

- Sends only official dedicated model-release articles from selected labs.
- Never sends Hugging Face org updates, changelog-only entries, model cards alone, docs pages alone, catalogs, benchmark-only pages, social posts, or third-party articles.
- Uses DeepSeek for evidence summarization/aggregation.
- Uses OpenRouter Kimi K2.6 only for final concise message writing.
- Runs an independent verifier before any Telegram send.
- Records real cost and usage for live LLM calls.
- Produces truthful structured skips when secrets or live dependencies are missing.
- Proves the whole path with DeepSeek V4 as a concrete acceptance case.

## Validation Commands

- `npm install`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0`
- `npm run radar:smoke -- --dry-run --release-url https://api-docs.deepseek.com/news/news260424 --max-cost-usd 0.25`
- `npm run radar:smoke -- --dry-run --labs all --limit-per-lab 2 --max-cost-usd 1`
- `npm run radar:smoke -- --dry-run --release-url https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark --max-cost-usd 0.25`
- `npm run radar:smoke -- --dry-run --release-url https://docs.cohere.com/changelog/classification-endpoint --max-cost-usd 0.25`

The last two commands must reject the input as non-sendable. They must not return a verified release note.

### Task 1: Prove Executr Discovers Both Plans

- [x] Confirm `.ralphex/config` has `plans_dir = docs/plans`.
- [x] Confirm `docs/plans/model-release-bot.md` exists.
- [x] Confirm `docs/plans/model-release-bot-acceptance-red-team.md` exists.
- [x] Confirm README or handoff docs name both plans and explain execution order.
- [x] Confirm no old plan file contradicts the selected-lab, dedicated-article, verifier, LLM-routing, or cost requirements.
- [x] Run validation commands and fix all failures.

### Task 2: Red-Team Source Eligibility

- [ ] Build a red-team fixture set with previously bad examples: DeepSeek Hugging Face org update, Xiaomi MiMo Hugging Face org update, Cohere changelog entries, OpenRouter Gemini model page, Google AI Studio/Gemini docs page, broad NVIDIA Blackwell post, generic docs index, benchmark-only page, and third-party article.
- [ ] Verify every red-team case is rejected before article extraction, LLM calls, or Telegram send.
- [ ] Verify rejected cases still produce useful structured reasons for operators.
- [ ] Verify no excluded source remains enabled and notifying in Convex source sync.
- [ ] Verify first-run baseline behavior does not send old releases.
- [ ] Run validation commands and fix all failures.

### Task 3: Red-Team Positive Coverage

- [ ] For every selected lab, run at least two official dedicated release article fixtures where available.
- [ ] Verify every expected positive fixture reaches a verified release-note object.
- [ ] Verify every positive fixture includes canonical URL, release date, model names, source links, evidence status, benchmark status, verifier status, and cost status.
- [ ] Verify discovery-only sources can lead to a dedicated article but cannot send directly.
- [ ] Run validation commands and fix all failures.

### Task 4: DeepSeek V4 End-To-End Acceptance

- [ ] Run the DeepSeek V4 official article through live dry-run: `https://api-docs.deepseek.com/news/news260424`.
- [ ] Verify gate result is `shouldSend: true`, lab `DeepSeek`, reason `official_dedicated_model_release_article`.
- [ ] Verify extracted models include `DeepSeek-V4-Pro` and `DeepSeek-V4-Flash`.
- [ ] Verify extracted evidence includes tech report and open weights links as evidence only.
- [ ] Verify Hugging Face links are never treated as the sendable article.
- [ ] Verify DeepSeek summarizes article/evidence stages.
- [ ] Verify OpenRouter Kimi K2.6 writes the final condensed message.
- [ ] Verify the independent verifier approves the final message before any Telegram send.
- [ ] Verify final message includes strengths, weaknesses/unknowns, benchmark context, safety/system-card notes, and sources.
- [ ] Verify cost summary is nonzero for live LLM calls and exactly traceable by stage.
- [ ] Run validation commands and fix all failures.

### Task 5: Claim Verification Red Team

- [ ] Inject unsupported benchmark claims into fake Kimi output and prove verifier blocks send.
- [ ] Inject invented safety/system-card claims and prove verifier blocks send.
- [ ] Inject wrong source URLs and prove verifier blocks send.
- [ ] Inject stale release dates and prove verifier blocks send.
- [ ] Inject missing weaknesses/unknowns and prove verifier blocks send.
- [ ] Verify verifier findings identify the unsupported claim and missing evidence source.
- [ ] Run validation commands and fix all failures.

### Task 6: Cost And Secret Red Team

- [ ] Verify live LLM usage records prompt tokens, completion tokens, model IDs, provider IDs, stage names, and cost.
- [ ] Verify `--max-cost-usd` aborts before Telegram send if projected or actual cost exceeds the cap.
- [ ] Verify offline mode uses deterministic fake usage and spends no provider tokens.
- [ ] Verify missing `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, and Telegram env vars produce structured skips unless required by flags.
- [ ] Verify no secret value appears in logs, JSON reports, fixtures, dashboard data, or notification records.
- [ ] Run validation commands and fix all failures.

### Task 7: Telegram Send Red Team

- [ ] Verify dry-run never calls Telegram.
- [ ] Verify non-dry-run without `--send-telegram` never calls Telegram.
- [ ] Verify non-dry-run with `--send-telegram` sends only verified release notes.
- [ ] Verify rejected candidates cannot call Telegram even if `--send-telegram` is set.
- [ ] Verify Telegram formatting stays under length limits and preserves source URLs.
- [ ] Verify operational source-failure alerts are not labeled as model releases.
- [ ] Run validation commands and fix all failures.

### Task 8: Final Acceptance Report

- [ ] Produce a machine-readable acceptance report under `artifacts/` or `cost-reports/` that is gitignored.
- [ ] Produce a short tracked summary under `docs/` with command names, pass/fail status, and any structured skips, but no secrets.
- [ ] Confirm every red-team command has the expected result.
- [ ] Confirm every original requirement is marked pass, not partial.
- [ ] If any requirement is partial, reopen `docs/plans/model-release-bot.md` and do not mark either plan complete.
- [ ] Run validation commands and fix all failures.
