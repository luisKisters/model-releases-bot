# Task 1 — Environment And AA Ground Truth

## Credential blocker (read first)

This worktree has no access to real API keys for `DEEPSEEK_API_KEY`,
`OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`, or `MODEL_RELEASES_MAX_COST_USD`:

- `~/projects/model-releases-bot/.env.local` (copied into this worktree) only
  contains `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL` /
  `NEXT_PUBLIC_CONVEX_SITE_URL` — no API keys, matching what the spec doc
  already expected.
- `CONVEX_DEPLOYMENT=anonymous:anonymous-model-releases-bot` points at a
  **local, self-hosted anonymous Convex backend** (`http://127.0.0.1:3210`),
  not the real production deployment. Starting it (`npx convex dev --once`)
  creates a brand-new empty local deployment (`anonymous-format-v2-2` for this
  worktree) — `npx convex env list` against it returns "No environment
  variables set". This sandbox has never had a link to the actual production
  Convex project/account.
- Production secrets only exist as GitHub Actions repo secrets
  (`CONVEX_DEPLOY_KEY`, `VERCEL_*`, per `.github/workflows/deploy.yml`), which
  this local run correctly cannot and should not access directly — the plan's
  own hard-failure list forbids direct `npx convex deploy` to production from
  this run anyway; deploys only happen via the Task 8 push-to-main.
- No relevant key is present in the shell environment (`env | grep -i
  DEEPSEEK|OPENROUTER|ARTIFICIAL|TELEGRAM` is empty) or in
  `.vercel/.env.production.local` (that file only has Vercel/OIDC metadata,
  `NEXT_PUBLIC_CONVEX_URL` is blank there).

**Net effect:** every downstream task that needs a *real* authenticated AA /
DeepSeek / OpenRouter / Telegram call (Task 3's live fixture capture, Task 4/8's
end-to-end real-cost validation run, Task 8's production env-flag check) is
blocked on the user supplying credentials into this environment or running
those specific steps themselves. Recording this here per the plan's
instruction ("If a key exists in neither place, record it in the final report
as a blocker for the affected feature and continue with what is available").
This blocker must be carried into the Task 8 report.

## What was still verified without a key

Even without an API key, live HTTP probing against `artificialanalysis.ai`
(real network access confirmed — got real API JSON error bodies, not
connection failures) plus AA's own public API documentation established
concrete, checkable facts:

- **The endpoint used by the current code (`src/lib/radar/benchmarks.ts`,
  `/api/models` with `Authorization: Bearer <key>`) is stale/wrong.** Live
  probe:
  - `GET https://artificialanalysis.ai/api/v2/data/llms/models` with
    `Authorization: Bearer test` → `{"error":"API key is required"}` (header
    ignored/not recognized).
  - Same URL with `x-api-key: test` → `{"error":"Invalid API key."}` (key
    recognized as such, just invalid) — confirms auth is via the `x-api-key`
    header, not `Authorization: Bearer`.
  - Task 3 must update both the path (`/api/v2/data/llms/models`) and the auth
    header (`x-api-key`) when rewriting `queryArtificialAnalysis` /
    `fetchAALeaderboard`.
- **Response shape**, per AA's own published API reference example (fetched
  from `https://artificialanalysis.ai/api-reference` and
  `https://artificialanalysis.ai/data-api/docs`):

  ```json
  {
    "status": 200,
    "prompt_options": { "parallel_queries": 1, "prompt_length": "medium" },
    "data": [
      {
        "id": "2dad8957-4c16-4e74-bf2d-8b21514e0ae9",
        "name": "o3-mini",
        "slug": "o3-mini",
        "model_creator": { "id": "...", "name": "OpenAI", "slug": "openai" },
        "evaluations": {
          "artificial_analysis_intelligence_index": 62.9,
          "artificial_analysis_coding_index": 55.8,
          "artificial_analysis_math_index": 87.2,
          "mmlu_pro": 0.791,
          "gpqa": 0.748,
          "hle": 0.087,
          "livecodebench": 0.717,
          "scicode": 0.399,
          "math_500": 0.973,
          "aime": 0.77
        },
        "pricing": {
          "price_1m_blended_3_to_1": 1.925,
          "price_1m_input_tokens": 1.1,
          "price_1m_output_tokens": 4.4
        },
        "median_output_tokens_per_second": 153.831,
        "median_time_to_first_token_seconds": 14.939,
        "median_time_to_first_answer_token": 14.939
      }
    ]
  }
  ```

  A separate docs page also lists `artificial_analysis_agentic_index`,
  `artificial_analysis_openness_index`, `artificial_analysis_multilingual_index`,
  and a Pro-tier-only `reasoning_model` boolean — these were **not** present in
  the concrete example object above, so they are recorded as *unconfirmed
  without a live key* rather than assumed present. Capability indices to build
  around, in confidence order: `artificial_analysis_intelligence_index`,
  `artificial_analysis_coding_index`, `artificial_analysis_math_index`
  (confirmed in the example payload), `artificial_analysis_agentic_index`
  (documented elsewhere, not in the example — treat as present-but-verify).
  This matches the spec doc's own assumption (intelligence / coding / math /
  agentic).
- **DeepSWE: not a documented field anywhere.** No AA documentation page found
  during this probe mentions DeepSWE, SWE-bench, or any agentic-coding-specific
  eval column on the `/llms/models` endpoint. Per the spec
  (`docs/telegram-message-format-v2.md` rule 9 / line 102), this means Task 2-4
  code should always take the fallback path: `• DeepSWE: not yet tested by
  Artificial Analysis for this model.` No DeepSWE field should be coded to
  read from the API; if a future real pull reveals one, the code must be
  amended then, not now.
- **Reasoning-effort variants**: not spelled out field-by-field in the public
  docs, but AA's own site structure (e.g. a live "GPT-5 (high) vs o3"
  comparison page slug) confirms effort variants are surfaced as **separate
  entries in the `data` array** (distinct `slug`/`name`, e.g. a `(high)` /
  `(low)` suffix on the name), each with its own `evaluations`/`pricing` block
  — not a nested field on one shared entry. `computePlacements()` (Task 3)
  should group `data` rows by base model name and treat differing
  slug/name suffixes as effort levels, matching the plan's expected shape
  (`levels: [{effort, score, rank}]` per index).
- **Pricing is included** at the top level of each model entry
  (`price_1m_input_tokens`, `price_1m_output_tokens`,
  `price_1m_blended_3_to_1`) — confirmed.

## `tests/fixtures/aa-models.json`

Because no live authenticated pull was possible, the fixture is built from
AA's own published example object (above) plus additional synthetic sibling
entries needed to exercise the test cases Task 3 lists (multi-level model,
single-level model, #1 model, model absent from AA, DeepSWE absent — DeepSWE
is absent from every entry since it's not a real field, per the finding
above). **This fixture is NOT a live/raw capture of the AA API** — it is
sourced from AA's public documentation and synthetic-but-realistic sibling
rows for test coverage, and is clearly annotated as such at the top of the
file. When a real `ARTIFICIAL_ANALYSIS_API_KEY` becomes available, this
fixture should be regenerated from an actual `GET
/api/v2/data/llms/models` response (secrets stripped) and the annotation
removed.

## Action needed from the user

To unblock live validation (Task 8) and a real fixture capture (Task 3), the
user needs to supply, into this environment or the real Convex deployment:
`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`,
`MODEL_RELEASES_MAX_COST_USD`. Until then, Tasks 3/4/8 proceed using the
documented/public-docs-derived shape above, clearly flagged as unverified
where noted.
