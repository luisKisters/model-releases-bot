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

- Any Telegram message is actually sent during this run — not from local pipeline
  runs, not from tests, not as a side effect of deploying. All pipeline runs use
  `RADAR_TELEGRAM_SEND_ENABLED=false` / dry-run. Live sending is enabled only by
  the user, manually, after this run ends.
- `RADAR_TELEGRAM_SEND_ENABLED` is set to anything truthy on the production
  Convex deployment, or any code path is added that sends a Telegram message on
  deploy/startup/baseline poll ("test message", "deploy notification", etc.).
- Direct `npx convex deploy` to production from this run. Production deploys
  happen ONLY via the push to main in Task 8 (GitHub Actions), which is allowed
  and intended.
- Secrets are committed, printed to logs, or written into fixtures.
- The final writer role is moved off OpenRouter Kimi, or analysis roles off DeepSeek.
- The verifier is weakened to "always approve" instead of being taught the new
  claim types.
- AA response shape is assumed instead of probed (Task 1) — if the probe shows a
  field is absent (e.g. DeepSWE), the code must handle the documented fallback,
  not fabricate the field.
- A task is checked off with stubs, hardcoded outputs, or tests that don't run.

Validation for every task: `npx vitest run` passes and `npx tsc --noEmit` passes.

### Task 1: Environment And AA Ground Truth

- [x] If running in a fresh worktree, copy `.env.local` from the main checkout
      (`~/projects/model-releases-bot/.env.local`) if it exists.
- [x] Run `npx convex env list`. Pull every key needed but missing locally into
      `.env.local` via `npx convex env get <NAME>`: `DEEPSEEK_API_KEY`,
      `OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `TELEGRAM_BOT_TOKEN`,
      `TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`, `MODEL_RELEASES_MAX_COST_USD`.
      If a key exists in neither place, record it in the final report as a blocker
      for the affected feature and continue with what is available.
      (blocked - not automatable: `CONVEX_DEPLOYMENT` in this sandbox is a local
      anonymous dev backend, not the real production deployment; `npx convex env
      list` against it returns no variables, and none of these keys exist
      anywhere accessible in this environment. Recorded as a blocker in
      `docs/plans/format-v2-2-notes.md` for the Task 8 report, per this
      checkbox's own fallback instruction.)
- [x] Probe the Artificial Analysis API with the real key (start from the
      endpoints in `src/lib/radar/benchmarks.ts` and the official AA API docs).
      Determine and WRITE DOWN in `docs/plans/format-v2-2-notes.md`:
      which capability indices exist (intelligence/coding/math/agentic/...),
      whether DeepSWE is returned and under what field name, how reasoning-effort
      variants are represented, whether input/output pricing is included, and the
      exact JSON shape.
      (no real key available in this sandbox — see blocker above. Verified what
      was possible without one: live unauthenticated probing confirmed the real
      endpoint/auth header, which differ from what the current code assumes
      (`/api/v2/data/llms/models` + `x-api-key`, not `/api/models` +
      `Authorization: Bearer`); AA's own public API docs supplied a verbatim
      example response shape; findings, including what remains unconfirmed
      without a live key, are written up in `docs/plans/format-v2-2-notes.md`.)
- [x] Save one raw `/api/models` (or equivalent) response, secrets stripped, as
      `tests/fixtures/aa-models.json`.
      (no live key to capture a real response — fixture built from AA's public
      docs example plus synthetic sibling rows for test coverage, explicitly
      annotated as non-live via a `_fixture_provenance` field; see notes.md.)
- [x] If DeepSWE or any assumed index is absent from the API, note it and use the
      spec's fallback lines; do not invent data.
      (DeepSWE is not a documented AA field anywhere found during this probe —
      noted in format-v2-2-notes.md; downstream tasks must use the spec's
      mandatory fallback line rather than reading a DeepSWE field from the API.)

### Task 2: AI Release Classifier

- [x] `src/lib/radar/llm.ts`: add `release_classifier` to `LlmRole` and
      `DEEPSEEK_ROLES`.
- [x] New classifier stage (new module or in `agents.ts`): input = title + first
      ~2000 chars of extracted article text; output = strict JSON
      `{is_new_model_release: boolean, model_names: string[], reason: string}`.
      Definition: a new model or new model version becoming available. Feature
      launches, partnerships, pricing changes, research posts, region/availability
      announcements are NOT releases. Parse defensively; on malformed output retry
      once, then treat as not-a-release.
      (implemented in new module `src/lib/radar/classifier.ts` —
      `runReleaseClassifier`.)
- [x] Wire into the pipeline after article fetch, before evidence gathering.
      Rejected candidates are marked `rejected` with the classifier reason in
      `gateResult.reasons`; they never notify. The existing regex gate stays as
      cheap prefilter only.
      (wired as Step 0 of `runAgentOrchestration` in `agents.ts`, before the
      researcher/summarizer/writer stages; rejected candidates short-circuit with
      `OrchestratorResult.rejected = true` and the classifier reason surfaced in
      `verifierOutput.findings` — this is the in-process equivalent of
      `gateResult.reasons` for the orchestration layer. `articleGate.ts`'s regex
      gate is untouched and still runs first, at the source-polling layer in
      `convex/polling.ts`, as the cheap prefilter before this AI classifier ever
      runs.)
- [x] Tests: classifier prompt/parse unit tests with faked LLM responses (accept,
      reject, malformed); pipeline test proving a non-release never reaches the
      writer.
      (`tests/classifier.test.ts` and the "release classifier gate" describe
      block in `tests/agents.test.ts`.)

### Task 3: AA Leaderboard And Placements

- [x] `src/lib/radar/benchmarks.ts`: add `fetchAALeaderboard()` keeping ALL models
      from the AA response (per Task 1's actual shape): per model — capability
      index scores, DeepSWE if present, reasoning-effort variant, input/output
      pricing.
      (uses the real `/api/v2/data/llms/models` endpoint + `x-api-key` header
      confirmed in Task 1's live probe, not the stale `/api/models` +
      `Authorization: Bearer` the old `queryArtificialAnalysis` used. DeepSWE is
      never read from a guessed field — per Task 1's notes it is not a
      documented AA field, so every entry gets `deepswe: null`, which
      `computePlacements` turns into the mandatory "not_tested" fallback.)
- [x] Add pure `computePlacements(leaderboard, modelNames)` returning per index:
      all tested effort levels with score + rank, `n`, best rank, higher/lower
      neighbors (with their effort labels), `isTop` flag; DeepSWE same shape or
      `"not_tested"`; plus pricing comparison vs both neighbors and the lab's own
      flagship.
- [x] Unit tests against `tests/fixtures/aa-models.json` covering: multi-level
      model, single-level model, #1 model, model absent from AA, DeepSWE absent.
      (`tests/benchmarks.test.ts`, new `fetchAALeaderboard` and
      `computePlacements` describe blocks.)

### Task 4: Prompts And Two-Message Writer

- [x] `EvidencePacket` (`src/lib/radar/agents.ts`): add `placements` and
      `availability` (API availability + subscription availability strings; add
      one instruction to the article-summarizer prompt to extract them).
      (`placements: ModelPlacements | null` computed via `computePlacements`
      from an optional `OrchestratorOptions.leaderboard`; `availability:
      AvailabilityInfo` parsed from `API_AVAILABILITY:` /
      `SUBSCRIPTION_AVAILABILITY:` lines the article-summarizer prompt now asks
      for, defaulting to the `[placeholder]` placeholder discipline when
      absent.)
- [x] `runFinalWriter`: replace the system prompt with the Message 1 + Message 2
      templates and the 11-rule writer contract from
      `docs/telegram-message-format-v2.md` (verbatim contract). Writer emits both
      messages separated by `===MESSAGE_2===`; split and return
      `{message1, message2}`.
      (`FINAL_WRITER_SYSTEM_PROMPT` embeds both templates, the 11 numbered
      rules, and the mandatory fallback lines; `splitWriterOutput` splits on
      the delimiter; missing-delimiter output is treated as message1 and
      message2 is regenerated once via a dedicated message-2-only prompt.
      `OrchestratorResult` now exposes `message1`/`message2` alongside a
      `finalMessage` alias (`= message1`) kept for the pre-v2.2
      `messages.ts`/`buildReleaseNote` consumers until Task 5/6 migrate them.)
- [x] `runSystemCardSummarizer`: rewrite prompt to hunt interesting behaviors
      (alignment audit results, sycophancy, eval-awareness, reward hacking,
      notable quirks); raise input cap 6000 → 12000 chars.
- [x] `llm.ts`: raise `max_tokens` to 4096 for `final_writer` only.
- [x] Tests: two-message split (incl. missing delimiter fallback = treat whole
      output as message 1 and regenerate message 2 once), fallback lines for
      no-AA / no-DeepSWE / no-system-card.
      (new tests in the "runFinalWriter – offline" describe block in
      `tests/agents.test.ts`; existing orchestration/message tests updated for
      the new `EvidencePacket`/`FinalWriterOutput`/`OrchestratorResult` shapes.
      `npx vitest run` (795 tests) and `npx tsc --noEmit` both green.)

### Task 5: Telegram HTML And Threaded Reply

- [x] `src/lib/radar/telegram.ts`: `sendTelegramMessage` gains
      `parse_mode: "HTML"`, optional `replyToMessageId`, and returns the
      `message_id` from the API response.
      (`sendTelegramMessage` now takes an optional third `TelegramMessageOptions`
      param — `{ parseMode?: "HTML"; replyToMessageId?: number }` — and returns
      `messageId` on success; existing two-arg callers (`sendReleaseNote`,
      `sendSourceFailureAlert`) are unaffected since options default to `{}`.)
- [x] Add `sendReleasePair(msg1, msg2)`: send msg1, then msg2 as reply to msg1's
      id. On Telegram 400 (HTML parse error): strip tags and resend plain text —
      a release must never be dropped due to markup.
      (`sendReleasePair` sends message1 with `parseMode: "HTML"`; on a 400 it
      strips tags/decodes entities and resends plain, then sends message2 as a
      reply to message1's `messageId` — with the same 400 → plain-text fallback,
      still linked via `reply_to_message_id`. If message1 fails for a non-400
      reason, message2 is never attempted.)
- [x] HTML escaping helper for interpolated text (`&`, `<`, `>`), used by the
      fallback renderer too.
      (`escapeHtml` exported from `telegram.ts`; the plain-text fallback
      renderer (`stripHtmlToPlainText`) performs the inverse decode so the
      400-fallback resend reads as natural plain text instead of raw entities.)
- [x] Tests with mocked fetch: pair send, reply linkage, 400 → plain-text retry,
      dry-run still sends nothing.
      (new `tests/telegram.test.ts`: 13 tests covering `escapeHtml`, HTML/reply
      options on `sendTelegramMessage`, and `sendReleasePair` — pair send with
      reply linkage, 400 fallback on message1, 400 fallback on message2, a
      heavily-tagged message1 that still succeeds via plain-text fallback,
      message2 skipped on a non-400 message1 failure, dry-run gate never
      reaching `sendReleasePair`, and missing-env-var short circuit. Full suite:
      `npx vitest run` 808 tests green, `npx tsc --noEmit` clean.)

### Task 6: Verifier Update

- [ ] `runVerifier`: benchmark/rank/comparison claims verify against the
      `placements` struct (benchmark name, score, rank, neighbors must match);
      `[placeholder]`-flagged values are exempt from support checks.
- [ ] Remove `checkMissingWeaknesses`. Add `checkVerdictSupported`: every
      beats/cheaper pairing in the verdict must exist in placements/pricing data.
- [ ] Keep the URL whitelist check and safety-invention check. Verifier stays
      independent of the writer.
- [ ] Tests: valid verdict approved; fabricated rank blocked; fabricated
      price-comparison blocked; placeholder values pass.

### Task 7: Config And Cleanup

- [ ] `llm.ts`: `DEFAULT_KIMI_MODEL` → `moonshotai/kimi-k2.6`.
- [ ] Update all affected existing tests; full `npx vitest run` green,
      `npx tsc --noEmit` clean.

### Task 8: Validation Run, Cost Report, And Push To Main

- [ ] Pick 3 real recent model-release articles from tracked labs (fresh URLs or
      the replay-case URLs in `src/lib/radar/releaseMessages.ts`).
- [ ] Run the full new pipeline end-to-end for each with REAL DeepSeek, Kimi, and
      AA calls and `RADAR_TELEGRAM_SEND_ENABLED=false`. Respect
      `MODEL_RELEASES_MAX_COST_USD` via the existing `CostTracker`.
- [ ] Write `docs/plans/format-v2-2-report.md` containing: the 3 rendered message
      pairs (exact HTML as they would post), per-release per-stage cost breakdown
      (classifier, summarizers, synthesizer, writer, AA), total cost of the
      validation run, projected monthly cost, any blockers from Task 1, any AA
      fields that turned out unavailable, and a "How to go live" section (see
      final checkbox).
- [ ] Pre-push safety checks (all mandatory):
      - `npx vitest run` and `npx tsc --noEmit` green.
      - Verify `RADAR_TELEGRAM_SEND_ENABLED` on the PRODUCTION Convex deployment
        is unset or false (`npx convex env list --prod` or equivalent with the
        deploy key). If it is truthy, set it to false BEFORE pushing and note
        this in the report.
      - Grep-audit that no code path sends Telegram messages on deploy, startup,
        or baseline polls, and that every release-send call is gated on
        `RADAR_TELEGRAM_SEND_ENABLED`. The only pre-existing exception is the
        source-failure alert after 10 consecutive poll failures, which is
        operational and stays.
- [ ] Merge the plan branch into main and PUSH to origin/main. This triggers the
      GitHub Actions deploy (verify job, then Convex + Vercel). Watch the run
      (`gh run watch` or `gh run list`) until green; if it fails, fix and re-push
      until green. Because the send flag is false in production, the deployed
      code runs pollers but sends NOTHING to Telegram.
- [ ] Final checkbox = the "How to go live" section in the report must say
      exactly: production already runs the new code; to go live after user
      approval run `npx convex env set RADAR_TELEGRAM_SEND_ENABLED true` on the
      production deployment (and nothing else). Include the command to flip it
      back to false. This flip is done manually by the user, never by this run.
