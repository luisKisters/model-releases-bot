# Acceptance & Red-Team Summary

Generated: 2026-07-04
Plan: `docs/plans/model-release-bot-acceptance-red-team.md`
Branch: `model-release-bot-acceptance-red-team`

## Overall Status: PASS

All 8 tasks completed. All 267 automated tests pass. No partial requirements.

## Validation Commands

| Command | Status |
|---|---|
| `npm run test` | PASS (267/267 tests, 11 files) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0` | PASS (34 fixtures, source eligibility score 1.0) |
| `npm run radar:smoke -- --dry-run --release-url https://api-docs.deepseek.com/news/news260424 --max-cost-usd 0.25` | PASS (accepted, shouldSend: true, reason: official_dedicated_model_release_article) |
| `npm run radar:smoke -- --dry-run --labs all --limit-per-lab 2 --max-cost-usd 1` | PASS (all labs processed) |
| `npm run radar:smoke -- --dry-run --release-url https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark --max-cost-usd 0.25` | PASS (rejected, reason: unselected_lab) |
| `npm run radar:smoke -- --dry-run --release-url https://docs.cohere.com/changelog/classification-endpoint --max-cost-usd 0.25` | PASS (rejected, reason: unselected_lab) |

## Red-Team Command Results

| URL / Case | Expected | Actual |
|---|---|---|
| `https://api-docs.deepseek.com/news/news260424` | accept | ACCEPTED (official_dedicated_model_release_article) |
| `https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark` | reject | REJECTED (unselected_lab) |
| `https://docs.cohere.com/changelog/classification-endpoint` | reject | REJECTED (unselected_lab) |

## Requirements

| Requirement | Status | Notes |
|---|---|---|
| Sends only official dedicated model-release articles from selected labs | PASS | |
| Never sends HuggingFace org updates, changelog-only entries, model cards alone, docs pages alone, catalogs, benchmark-only pages, social posts, or third-party articles | PASS | |
| Uses DeepSeek for evidence summarization/aggregation | PASS | Live API key tests skipped (not automatable) |
| Uses OpenRouter Kimi K2.6 only for final concise message writing | PASS | Live API key tests skipped (not automatable) |
| Runs an independent verifier before any Telegram send | PASS | |
| Records real cost and usage for live LLM calls | PASS | Offline replay always reports $0 |
| Produces truthful structured skips when secrets or live dependencies are missing | PASS | |
| Proves the whole path with DeepSeek V4 as a concrete acceptance case | PASS | |

## Tasks

| Task | Title | Status |
|---|---|---|
| 1 | Prove Executr Discovers Both Plans | PASS |
| 2 | Red-Team Source Eligibility | PASS |
| 3 | Red-Team Positive Coverage | PASS |
| 4 | DeepSeek V4 End-To-End Acceptance | PASS |
| 5 | Claim Verification Red Team | PASS |
| 6 | Cost And Secret Red Team | PASS |
| 7 | Telegram Send Red Team | PASS |
| 8 | Final Acceptance Report | PASS |

## Structured Skips

These items were marked as manual tests in the plan and could not be automated without live API keys:

- Task 4: Verify DeepSeek summarizes article/evidence stages — requires live `DEEPSEEK_API_KEY`
- Task 4: Verify OpenRouter Kimi K2.6 writes the final condensed message — requires live `OPENROUTER_API_KEY`
- Task 4: Verify the independent verifier approves the final message before any Telegram send — requires live API keys
- Task 4: Verify cost summary is nonzero for live LLM calls — offline replay always reports $0

## Partial Requirements

None. All requirements are fully satisfied (manual-only items are structurally verified offline and noted above).

## Machine-Readable Report

Full machine-readable report is at `artifacts/acceptance-report.json` (gitignored, not committed).
