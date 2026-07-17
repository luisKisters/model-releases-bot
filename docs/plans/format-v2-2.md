# Telegram Message Format v2.2 Implementation Plan

## Executr Pickup Contract

This plan implements the message-format v2.2 redesign. The full design spec —
message templates, mockups, writer contract, fallback rules — is in
`docs/telegram-message-format-v2.md`. Read that file FIRST; it is the source of
truth for every format decision. This plan only sequences the work.

Run this plan alone. Do NOT pick up `docs/plans/model-release-bot.md` or the
acceptance plan in the same run; they describe an older message format that
v2.2 supersedes where they conflict (the older plans' sourcing/eligibility and
verification-independence rules still hold).

Hard failures — the run is broken if any of these happen:

- Any Telegram message is actually sent during this run. All pipeline runs use
  `RADAR_TELEGRAM_SEND_ENABLED=false` / dry-run. Sending is enabled only after
  explicit user approval, which is OUTSIDE this plan.
- Anything is deployed to production (no `convex deploy` to prod, no pushes that
  trigger `.github/workflows/deploy.yml` on main). Work stays on this branch.
- Secrets are committed, printed to logs, or written into fixtures.
- The final writer role is moved off OpenRouter Kimi, or analysis roles off DeepSeek.
- The verifier is weakened to "always approve" instead of being taught the new
  claim types.
- AA response shape is assumed instead of probed (Task 0) — if the probe shows a
  field is absent (e.g. DeepSWE), the code must handle the documented fallback,
  not fabricate the field.
- A task is checked off with stubs, hardcoded outputs, or tests that don't run.

Validation for every task: `npx vitest run` passes and `npx tsc --noEmit` passes.

## Task 0 — Environment + AA ground truth

- [ ] If running in a fresh worktree, copy `.env.local` from the main checkout
      (`~/projects/model-releases-bot/.env.local`) if it exists.
- [ ] Run `npx convex env list`. Pull every key needed but missing locally into
      `.env.local` via `npx convex env get <NAME>`: `DEEPSEEK_API_KEY`,
      `OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `TELEGRAM_BOT_TOKEN`,
      `TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`, `MODEL_RELEASES_MAX_COST_USD`.
      If a key exists in neither place, record it in the final report as a blocker
      for the affected feature and continue with what is available.
- [ ] Probe the Artificial Analysis API with the real key (start from the
      endpoints in `src/lib/radar/benchmarks.ts` and the official AA API docs).
      Determine and WRITE DOWN in `docs/plans/format-v2-2-notes.md`:
      which capability indices exist (intelligence/coding/math/agentic/...),
      whether DeepSWE is returned and under what field name, how reasoning-effort
      variants are represented, whether input/output pricing is included, and the
      exact JSON shape.
- [ ] Save one raw `/api/models` (or equivalent) response, secrets stripped, as
      `tests/fixtures/aa-models.json`.
- [ ] If DeepSWE or any assumed index is absent from the API, note it and use the
      spec's fallback lines; do not invent data.

## Task 1 — AI release classifier

- [ ] `src/lib/radar/llm.ts`: add `release_classifier` to `LlmRole` and
      `DEEPSEEK_ROLES`.
- [ ] New classifier stage (new module or in `agents.ts`): input = title + first
      ~2000 chars of extracted article text; output = strict JSON
      `{is_new_model_release: boolean, model_names: string[], reason: string}`.
      Definition: a new model or new model version becoming available. Feature
      launches, partnerships, pricing changes, research posts, region/availability
      announcements are NOT releases. Parse defensively; on malformed output retry
      once, then treat as not-a-release.
- [ ] Wire into the pipeline after article fetch, before evidence gathering.
      Rejected candidates are marked `rejected` with the classifier reason in
      `gateResult.reasons`; they never notify. The existing regex gate stays as
      cheap prefilter only.
- [ ] Tests: classifier prompt/parse unit tests with faked LLM responses (accept,
      reject, malformed); pipeline test proving a non-release never reaches the
      writer.

## Task 2 — AA leaderboard + placements

- [ ] `src/lib/radar/benchmarks.ts`: add `fetchAALeaderboard()` keeping ALL models
      from the AA response (per Task 0's actual shape): per model — capability
      index scores, DeepSWE if present, reasoning-effort variant, input/output
      pricing.
- [ ] Add pure `computePlacements(leaderboard, modelNames)` returning per index:
      all tested effort levels with score + rank, `n`, best rank, higher/lower
      neighbors (with their effort labels), `isTop` flag; DeepSWE same shape or
      `"not_tested"`; plus pricing comparison vs both neighbors and the lab's own
      flagship.
- [ ] Unit tests against `tests/fixtures/aa-models.json` covering: multi-level
      model, single-level model, #1 model, model absent from AA, DeepSWE absent.

## Task 3 — Prompts + two-message writer

- [ ] `EvidencePacket` (`src/lib/radar/agents.ts`): add `placements` and
      `availability` (API availability + subscription availability strings; add
      one instruction to the article-summarizer prompt to extract them).
- [ ] `runFinalWriter`: replace the system prompt with the Message 1 + Message 2
      templates and the 11-rule writer contract from
      `docs/telegram-message-format-v2.md` (verbatim contract). Writer emits both
      messages separated by `===MESSAGE_2===`; split and return
      `{message1, message2}`.
- [ ] `runSystemCardSummarizer`: rewrite prompt to hunt interesting behaviors
      (alignment audit results, sycophancy, eval-awareness, reward hacking,
      notable quirks); raise input cap 6000 → 12000 chars.
- [ ] `llm.ts`: raise `max_tokens` to 4096 for `final_writer` only.
- [ ] Tests: two-message split (incl. missing delimiter fallback = treat whole
      output as message 1 and regenerate message 2 once), fallback lines for
      no-AA / no-DeepSWE / no-system-card.

## Task 4 — Telegram HTML + threaded reply

- [ ] `src/lib/radar/telegram.ts`: `sendTelegramMessage` gains
      `parse_mode: "HTML"`, optional `replyToMessageId`, and returns the
      `message_id` from the API response.
- [ ] Add `sendReleasePair(msg1, msg2)`: send msg1, then msg2 as reply to msg1's
      id. On Telegram 400 (HTML parse error): strip tags and resend plain text —
      a release must never be dropped due to markup.
- [ ] HTML escaping helper for interpolated text (`&`, `<`, `>`), used by the
      fallback renderer too.
- [ ] Tests with mocked fetch: pair send, reply linkage, 400 → plain-text retry,
      dry-run still sends nothing.

## Task 5 — Verifier update

- [ ] `runVerifier`: benchmark/rank/comparison claims verify against the
      `placements` struct (benchmark name, score, rank, neighbors must match);
      `[placeholder]`-flagged values are exempt from support checks.
- [ ] Remove `checkMissingWeaknesses`. Add `checkVerdictSupported`: every
      beats/cheaper pairing in the verdict must exist in placements/pricing data.
- [ ] Keep the URL whitelist check and safety-invention check. Verifier stays
      independent of the writer.
- [ ] Tests: valid verdict approved; fabricated rank blocked; fabricated
      price-comparison blocked; placeholder values pass.

## Task 6 — Config + cleanup

- [ ] `llm.ts`: `DEFAULT_KIMI_MODEL` → `moonshotai/kimi-k2.6`.
- [ ] Update all affected existing tests; full `npx vitest run` green,
      `npx tsc --noEmit` clean.

## Task 7 — Validation run + cost report (STOP HERE)

- [ ] Pick 3 real recent model-release articles from tracked labs (fresh URLs or
      the replay-case URLs in `src/lib/radar/releaseMessages.ts`).
- [ ] Run the full new pipeline end-to-end for each with REAL DeepSeek, Kimi, and
      AA calls and `RADAR_TELEGRAM_SEND_ENABLED=false`. Respect
      `MODEL_RELEASES_MAX_COST_USD` via the existing `CostTracker`.
- [ ] Write `docs/plans/format-v2-2-report.md` containing: the 3 rendered message
      pairs (exact HTML as they would post), per-release per-stage cost breakdown
      (classifier, summarizers, synthesizer, writer, AA), total cost of the
      validation run, projected monthly cost, any blockers from Task 0, and any
      AA fields that turned out unavailable.
- [ ] Commit everything on the plan branch. DO NOT deploy, DO NOT enable Telegram
      send, DO NOT merge to main. The user reviews the report and approves (or
      not) deployment manually. This is the end of the automated run.
