# Model Release Bot Completion Plan

## Executr Pickup Contract

This is the primary implementation plan for executr/ralphex. The paired acceptance/red-team plan is `docs/plans/model-release-bot-acceptance-red-team.md`. The runner must pick both files from `docs/plans/` through `.ralphex/config` with `plans_dir = docs/plans`.

The plan is intentionally strict. The project is not complete until every checkbox in every task is complete, every validation command passes, and no output reports placeholder, replay-only, `not_scored`, fake-live, or hardcoded-release behavior.

Executr must treat these as hard failures:

- A Telegram message is sent from a Hugging Face org update, model-card-only URL, changelog-only URL, docs index, catalog row, social post, benchmark-only page, or third-party article.
- A selected lab release is sent without an official dedicated model-release article URL.
- Cohere, Qwen, Kimi/Moonshot, Z.ai, MiniMax, Xiaomi MiMo, generic Hugging Face, OpenRouter catalogs, or broad NVIDIA posts become sendable sources.
- DeepSeek Hugging Face updates such as `deepseek-ai/DeepSeek-V4-Pro-DSpark updated ...` produce Telegram messages.
- Xiaomi MiMo Hugging Face updates produce Telegram messages.
- Cohere changelog entries produce Telegram messages.
- The final user message is produced without independent verifier approval.
- The final user message contains a claim that cannot be traced to article text, linked system/model/safety/technical material, or benchmark evidence.
- Live smoke claims success while skipping network, LLMs, browser/PDF extraction, destination send, or provider keys without reporting the exact structured skip.
- Any cost field remains hardcoded to `0` for a live LLM run.
- Any benchmark/eval dimension remains `not_scored` in the final offline validation.
- Any task marks implementation complete with only docs, stubs, static replay fixtures, or hardcoded examples.

## Required Final Behavior

The bot monitors only these labs:

| Lab | Sendable source rule |
| --- | --- |
| OpenAI | Official OpenAI news/article page for a new model release. |
| Anthropic | Official Anthropic news/article page for a new Claude model release. |
| Google Gemini / DeepMind | Official Google, DeepMind, or Google Developers blog article for a Gemini/DeepMind model release; not AI Studio docs, OpenRouter, or generic model docs. |
| Mistral | Official Mistral news/article page for a new model release. |
| DeepSeek | Official DeepSeek API docs/news article for a new model release. Hugging Face links are evidence only. |
| Meta / Llama | Official AI at Meta blog article for a Llama model release. |
| xAI | Official xAI news article for a Grok model release. |
| NVIDIA Nemotron | Official Nemotron-specific release article only; broad NVIDIA hardware/platform/inference posts are not sendable. |
| Deepgram | Official dedicated Deepgram model release article; changelog entries are discovery only. |
| ElevenLabs | Official dedicated ElevenLabs model release article; changelog entries are discovery only. |
| AssemblyAI | Official dedicated AssemblyAI model release article; release collections are discovery only. |

A release message must include:

- Lab, model name(s), release date, canonical official article URL.
- Short bullets for where it shines, strengths, weaknesses/unknowns, benchmark context, safety/system-card notes, and source links.
- Explicit unknowns when evidence is absent.
- System/model/safety/technical evidence links when present.
- Benchmark evidence with provenance and comparison status: `supported`, `contradicted`, `missing`, or `not_comparable`.
- Verifier status and a traceable evidence map for every user-facing claim.
- Per-stage token usage and cost for DeepSeek, OpenRouter Kimi, and any benchmark provider calls.

DeepSeek must handle article summary, system-card summary, and benchmark/evidence aggregation. OpenRouter Kimi K2.6 must handle only the final condensed user-facing message. The verifier must be independent of the Kimi final writer.

## Current Known Gaps To Eliminate

- `scripts/radar-smoke.mjs` currently supports a small replay path. Replace this with a real live pipeline. Static replay cases may remain only as tests.
- `scripts/radar-eval.mjs` currently scores only gate and model-name extraction. It must score every required dimension.
- `estimatedCostUsd` is currently a placeholder. Implement real cost accounting from usage.
- Many source entries have `notify=false`. That is acceptable only if they are discovery sources that can still lead to a dedicated article candidate; it must not mean the lab is ignored.
- Article extraction, browser fallback, image probing, PDF/system-card reading, Artificial Analysis, DeepSeek LLM calls, OpenRouter Kimi calls, independent verifier, Convex verified-release persistence, and true live smoke are incomplete.
- The current Convex source reconciliation disables stale removed sources. Preserve that behavior and test it.

## Validation Commands

These commands must pass before any task can be marked complete:

- `npm install`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0`
- `npm run radar:smoke -- --dry-run --release-url https://api-docs.deepseek.com/news/news260424 --max-cost-usd 0.25`
- `npm run radar:smoke -- --dry-run --labs all --limit-per-lab 2 --max-cost-usd 1`

The final handoff must also run this command when Telegram and provider secrets are present:

- `npm run radar:smoke -- --release-url https://api-docs.deepseek.com/news/news260424 --no-dry-run --send-telegram --max-cost-usd 0.25`

If secrets are missing, the command must return a structured skip with `ok: true`, `status: "skipped"`, `missingSecrets`, and no misleading pass claim.

### Task 1: Executr And Repository Setup

- [x] Update `.ralphex/config` so executr checks out the current implementation branch, uses `plans_dir = docs/plans`, and points operators to this exact plan path.
- [x] Confirm `docs/plans/model-release-bot.md` is the primary implementation plan and `docs/plans/model-release-bot-acceptance-red-team.md` is the paired acceptance plan.
- [x] Update `README.md` to say executr/ralphex should run `docs/plans/model-release-bot.md` and should not run old partial plans.
- [x] Confirm `.gitignore` prevents committing `.env`, `.env.*`, Convex local env files, browser artifacts, cost reports, and raw downloaded documents.
- [x] Ensure `.env.example` documents all required keys without real values: `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_KIMI_MODEL`, `ARTIFICIAL_ANALYSIS_API_KEY`, `MODEL_RELEASES_MAX_COST_USD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and Telegram send toggle.
- [x] Run all validation commands that can run without secrets and record exact skips for secret-gated commands.

### Task 2: Source Registry, Discovery, And Stale Source Cleanup

- [x] Keep `src/lib/radar/sources.ts` limited to the selected labs listed above.
- [x] Implement source adapters that normalize every candidate into `lab`, `provider`, `sourceId`, `sourceType`, `sourceUrl`, `candidateUrl`, `canonicalUrl`, `title`, `summary`, `publishedAt`, `updatedAt`, `confidence`, `rawMetadata`, and `discoveredVia`.
- [x] Separate `discovery` from `sendable`. Changelogs, feeds, release collections, model cards, docs, catalogs, and benchmark pages can discover candidates but cannot directly send.
- [x] Preserve stale Convex source disabling: any enabled DB source not in the current registry must be patched to `enabled: false` and `notify: false`.
- [x] Add tests proving old `deepseek-ai` Hugging Face, `XiaomiMiMo` Hugging Face, and Cohere changelog source rows are disabled during source sync.
- [x] Add tests proving excluded provider strings do not appear in sendable source configuration.
- [x] Add tests for every selected lab source entry, including source type and whether it is discovery-only or sendable-candidate.
- [x] Run validation commands and fix all failures.

### Task 3: Article Gate And Source Eligibility

- [x] Implement a strict article gate for selected lab, official domain, dedicated article path, new model-release language, and lab-specific constraints.
- [x] The gate must return structured reasons such as `selected_lab`, `official_domain`, `dedicated_article`, `model_release_language`, `lab_specific_constraint`, and final `shouldSend`.
- [x] Reject model-card-only, docs-index-only, changelog-only, release-notes-only, catalog-only, benchmark-only, social-only, third-party-only, and generic homepage candidates.
- [x] Reject unsupported Gemini source types: OpenRouter, AI Studio model pages, and API docs pages unless linked from an official dedicated blog article.
- [x] Reject non-Nemotron NVIDIA posts even if the title contains `model`.
- [x] Add at least two positive article-gate tests per selected lab where public history allows it; if a lab has fewer than two official examples, add an explicit fixture waiver with evidence.
- [x] Add negative tests for Cohere, Qwen, Kimi, Z.ai, MiniMax, Xiaomi MiMo, DeepSeek Hugging Face-only, Xiaomi Hugging Face-only, and broad NVIDIA.
- [x] Run validation commands and fix all failures.

### Task 4: Fetching, Browser Tools, Article Extraction, And Assets

- [x] Implement `src/lib/radar/fetching.ts` with HTTP timeout, retry policy, content-type validation, canonical URL extraction, robots-aware user agent configuration, redirect handling, and sanitized snapshot output.
- [x] Implement `src/lib/radar/browserTools.ts` with Playwright-backed open, snapshot, readable extraction, link discovery, screenshot, image probing, and PDF/download retrieval.
- [x] Provide an HTTP-only fallback that returns `reducedConfidence: true` and explains missing browser capability.
- [x] Extract title, canonical URL, publication date, update date, article body, author/publisher when present, headings, outbound links, images, and downloadable assets.
- [x] Verify images/assets resolve and record content type, byte size, dimensions when available, alt text, and source URL. Do not store raw binaries in fixtures.
- [x] Add sanitized fixture snapshots for representative articles, including DeepSeek V4, Anthropic Claude, OpenAI, Gemini, Mistral, Deepgram, ElevenLabs, and AssemblyAI.
- [x] Add tests for JavaScript-heavy pages, canonical URL mismatches, redirects, missing article body, broken images, and browser fallback behavior.
- [x] Run validation commands and fix all failures.

### Task 5: Fixture Corpus And Offline Oracle

- [x] Expand `tests/fixtures/release-benchmark.json` so it contains at least two positive dedicated release articles per selected lab where available.
- [x] Include DeepSeek V4 Preview Release `https://api-docs.deepseek.com/news/news260424` as a required positive fixture.
- [x] For every fixture, include expected lab, model names, release date, canonical article URL, required evidence links, required system/model/safety/technical links, benchmark expectations, expected unknowns, and expected send/reject decision.
- [x] Add negative fixtures for every exclusion rule, including the exact noisy examples that previously reached Telegram.
- [x] Add an oracle file under `tests/fixtures/` with source-backed reference answers and known weaknesses/unknowns for at least one release per lab.
- [x] Fixture snapshots must be sanitized and must not contain secrets, raw API responses with credentials, or raw binary files.
- [x] Offline eval must use fixture fetchers and fake LLM clients only. No network calls and no provider calls are allowed in offline mode.
- [x] Run validation commands and fix all failures.

### Task 6: System Card, Model Card, Safety Card, Technical Report, And PDF Handling

- [x] Implement `src/lib/radar/systemCards.ts`.
- [x] Detect links to system cards, model cards, safety cards, technical reports, PDFs, official model docs, and official model repositories from article pages.
- [x] Fetch HTML and PDF evidence with source URL, canonical URL, page number when applicable, and sanitized text.
- [x] Split evidence into deterministic topics: overview, capabilities, benchmarks/evals, safety, misuse/limitations, deployment, data/training, pricing/API, and unknown/other.
- [x] Summaries must cite topic chunks by source URL and chunk ID.
- [x] If no card/report exists, the output must explicitly say `system_card_status: "not_found"` and must not invent safety details.
- [x] Add tests for DeepSeek V4 tech report/model weights, Anthropic system card, Mistral model card/docs, broken PDF links, irrelevant PDF links, and long-document chunking.
- [x] Run validation commands and fix all failures.

### Task 7: Benchmark Evidence And Artificial Analysis

- [x] Implement `src/lib/radar/benchmarks.ts`.
- [x] Add an Artificial Analysis client for free endpoints: language, text-to-speech, speech-to-speech, and speech-to-text.
- [x] Support optional `ARTIFICIAL_ANALYSIS_API_KEY`; missing key must produce structured skip, not failure, unless a live command explicitly requires it.
- [x] Normalize benchmark claims from article text, system cards, technical reports, official benchmark links, Artificial Analysis rows, and other configured official evidence.
- [x] Map lab/model modality to relevant benchmarks: language, coding, reasoning, multimodal, STT, TTS, S2S, latency, throughput, price/performance.
- [x] Compare important claims as `supported`, `contradicted`, `missing`, or `not_comparable`.
- [x] Attribute Artificial Analysis data whenever it is used.
- [x] Add tests for available benchmark data, missing AA key, rate limits, model not found, modality mismatch, vendor-only benchmark claims, and contradiction handling.
- [x] Run validation commands and fix all failures.

### Task 8: DeepSeek, OpenRouter Kimi, Fake Clients, And Cost Accounting

- [x] Implement `src/lib/radar/llm.ts` with OpenAI-compatible clients for DeepSeek and OpenRouter.
- [x] DeepSeek must be used for article summarization, system-card topic summaries, benchmark aggregation, and evidence synthesis.
- [x] OpenRouter Kimi K2.6 must be used only for final condensed message writing.
- [x] `OPENROUTER_KIMI_MODEL` must be configurable and default to the requested Kimi K2.6 model. Do not silently switch to another final writer.
- [x] Implement fake LLM clients for offline tests with deterministic text and deterministic token usage.
- [x] Implement pricing configuration for DeepSeek and OpenRouter Kimi, including input, output, cache-hit input where providers report it, currency, source URL, and last verified date.
- [x] Record prompt tokens, completion tokens, cache-hit tokens when available, provider response IDs, model IDs, stage names, and per-stage estimated cost.
- [x] Enforce `--max-cost-usd` before and during live runs. Abort before send if the cost cap is exceeded.
- [x] Redact API keys in logs, errors, traces, fixtures, and cost reports.
- [x] Add tests proving routing, fake-client determinism, cost math, max-cost enforcement, secret redaction, and no silent fallback model.
- [x] Run validation commands and fix all failures.

### Task 9: Agent Orchestration And Independent Verifier

- [x] Implement `src/lib/radar/agents.ts` with internal roles: researcher, article summarizer, system-card summarizer, benchmark aggregator, final writer, and verifier.
- [x] Each role must have typed input/output schemas and must record evidence references.
- [x] The final writer must not call browser/search/fetch tools directly. It receives verified evidence packets only.
- [x] The verifier must run after final writing and before Telegram send.
- [x] The verifier must check every final-message claim against article, evidence chunks, benchmark rows, or explicit unknowns.
- [x] Unsupported claims must block sending and return actionable verifier findings.
- [x] Add tests where verifier catches unsupported strengths, unsupported benchmark claims, missing weaknesses, wrong source URL, stale article URL, and invented safety claims.
- [x] Add tests proving verified messages pass and unverified messages are never sent.
- [x] Run validation commands and fix all failures.

### Task 10: Final Release Note Schema, Rendering, And Telegram

- [x] Implement `src/lib/radar/messages.ts` with a release-note schema containing title, lab, model names, release date, canonical source URL, summary, where it shines, strengths, weaknesses/unknowns, benchmark context, safety/system notes, evidence links, image/assets metadata, verifier status, and cost summary.
- [x] Telegram rendering must be concise, readable, and under Telegram length limits.
- [x] Telegram rendering must include source links and must not hide verification failures.
- [x] Implement destination-ready variants for plain text and Telegram. Do not send Markdown unless the escaping is correct and tested.
- [x] Replace raw `formatTelegramSignal` sends for model releases with verified release-note rendering.
- [x] Keep source failure alerts separate from release alerts and make them clearly operational, not model-release announcements.
- [x] Add tests for long messages, source-link formatting, special characters, Unicode model names, Telegram length truncation, and no send on unverified note.
- [x] Run validation commands and fix all failures.

### Task 11: Convex Persistence And Scheduled Polling

- [x] Before touching Convex code, read `convex/_generated/ai/guidelines.md`.
- [x] Update `convex/schema.ts` with tables for release candidates, article snapshots, evidence documents/chunks, benchmark evidence, LLM usage/costs, verified release notes, verifier findings, and notifications.
- [x] Use validators for every Convex function argument.
- [x] Keep actions separate from queries/mutations when Node APIs are needed.
- [x] Never use `ctx.db` in Convex actions.
- [x] Use `internal` function references for cron scheduling.
- [x] Scheduled polling must create candidates, verify releases, persist evidence/costs, and send only verified release notes.
- [x] Baseline source snapshots must never send old releases on first run.
- [x] Duplicate detection must use canonical article URL and stable release identity, not only title strings.
- [x] Add Convex tests using `convex-test` for source sync, stale-source disable, candidate persistence, duplicate suppression, verified send, unverified block, and notification records.
- [x] Run validation commands and fix all failures.

### Task 12: Evaluation Harness And Scoring

- [x] Implement a real `src/lib/radar/eval.ts`.
- [x] `npm run radar:eval -- --offline` must score source eligibility, extraction coverage, system-card coverage, benchmark coverage, LLM routing, cost accounting, final-message coverage, verifier precision, unsupported-claim count, and concision.
- [x] The final offline eval must fail if any dimension is `not_scored`.
- [x] The final offline eval must fail if any fixture with expected `shouldSend: false` is accepted.
- [x] The final offline eval must fail if any expected positive release lacks a verified final message.
- [x] The final offline eval must fail if any source URL in output is not present in fixture evidence.
- [x] The final offline eval must include a machine-readable JSON report and a human-readable summary.
- [x] Add tests for evaluator failure cases and success cases.
- [x] Run validation commands and fix all failures.

### Task 13: Live Smoke CLI

- [x] Replace replay-only `scripts/radar-smoke.mjs` with a real live smoke command.
- [x] Support `--release-url`, `--labs`, `--limit-per-lab`, `--dry-run`, `--no-dry-run`, `--send-telegram`, `--max-cost-usd`, `--require-browser`, `--require-llm`, and `--require-artificial-analysis`.
- [x] `--release-url` must run the full pipeline for the supplied official article URL.
- [x] `--labs all --limit-per-lab 2` must attempt up to two releases per selected lab.
- [x] Dry run must run the full fetch/extract/LLM/verifier path but must not send Telegram.
- [x] Missing secrets must return structured skip unless the corresponding `--require-*` flag is set.
- [x] Network failures, source shape changes, browser dependency failures, LLM failures, benchmark provider failures, and Telegram failures must have distinct structured reasons.
- [x] Live smoke must record exact provider usage and estimated cost.
- [x] Add tests for CLI arg parsing, dry-run behavior, send toggle behavior, max-cost abort, structured skips, and DeepSeek V4 URL run.
- [x] Run validation commands and fix all failures.

### Task 14: DeepSeek V4 Required Acceptance Example

- [x] Run `npm run radar:smoke -- --dry-run --release-url https://api-docs.deepseek.com/news/news260424 --max-cost-usd 0.25`.
- [x] Confirm the source gate accepts it as `DeepSeek`, `official_dedicated_model_release_article`.
- [x] Confirm it extracts `DeepSeek-V4-Pro`, `DeepSeek-V4-Flash`, release date `2026/04/24`, tech report link, open weights link, API availability, and deprecation note for `deepseek-chat` and `deepseek-reasoner`.
- [x] Confirm Hugging Face links are recorded only as evidence, not as sendable release sources.
- [x] Confirm benchmark claims are marked vendor-provided unless supported by independent benchmark evidence.
- [x] Confirm safety/system-card status is explicit: found, not found, or not applicable, with no invented safety claims.
- [x] Confirm DeepSeek stage usage, Kimi final-writer usage, verifier status, and total estimated cost are present.
- [x] Confirm final Telegram text includes strengths, weaknesses/unknowns, benchmark context, safety/system notes, and sources.
- [x] Confirm no Telegram send happens in dry run.
- [x] Run the non-dry-run Telegram command only when Telegram env vars are present; otherwise record structured skip.

### Task 15: Dashboard And Operator Visibility

- [x] Update the dashboard to show selected sources, discovery-only versus sendable status, latest candidates, verifier status, evidence links, costs, and notification status.
- [x] Make excluded/stale sources visible as disabled operational rows rather than silently disappearing.
- [x] Add dashboard states for missing secrets, latest smoke status, latest eval score, and last successful Telegram send.
- [x] Do not expose secret values in the dashboard.
- [x] Add tests or typed component checks for dashboard data shape.
- [x] Run validation commands and fix all failures.

### Task 16: Documentation, Remote Secrets, And Handoff

- [x] Update README with final setup, selected-lab policy, exact rejection policy, source discovery behavior, cost model, eval commands, live smoke commands, and Telegram send instructions.
- [x] Document how executr/Docker should supply secrets without committing them.
- [x] Document browser dependency setup for Playwright inside executr.
- [x] Document how to run the DeepSeek V4 acceptance example.
- [x] Document how to interpret structured skips and verifier failures.
- [x] Add a final implementation report under `docs/` summarizing completed tasks, validation outputs, live smoke outputs, and any unavoidable waivers.
- [x] Run validation commands and fix all failures.

### Task 17: Final Review And Completion Gate

- [ ] Run the full validation command list.
- [ ] Run offline eval and confirm every score dimension is numeric/passing, not `not_scored`.
- [ ] Run DeepSeek V4 live dry-run and confirm it fulfills every acceptance check in Task 14.
- [ ] Run all-labs live dry-run with cost cap and record exact results.
- [ ] If secrets are present, send one verified DeepSeek V4 Telegram message and record Telegram API success status without logging secrets.
- [ ] Perform a code review focused on false-positive sends, unsupported claims, cost cap bypass, duplicate sends, source stale rows, and secret leakage.
- [ ] Fix every review finding or document an explicit blocker with owner and reproduction command.
- [ ] Commit all completed implementation and plan changes.
- [ ] Do not mark this plan complete until every previous checkbox is complete and all validation commands pass.
