# Telegram release-message format v2.2 (design spec — FINAL for implementation)

v2 (2026-07-17): three competing drafts judged and merged into a single-message dashboard.
v2.1: verdict-first honest summary, unified rank-first AA benchmarks, all reasoning levels,
two-message default.
v2.2: message 1 slimmed — ⚠️ Weaknesses and 🛡 System-card teaser removed (verdict carries
the safety caveat; full system-card breakdown lives in the reply). Facts row gains API
availability + subscription availability.

## Structure

- **Message 1 — alert card**: header → Verdict → Facts → Benchmarks → Sources.
- **Message 2 — deep dive**, sent as a Telegram *reply* to message 1: in-depth blog
  summary + full system-card breakdown (interesting behaviors), in `<blockquote expandable>`.

## Mockups (Claude Sonnet 5 sample; all AA values are placeholders)

### Message 1 — alert card

```html
🟧 <b>Anthropic — Claude Sonnet 5</b> <code>claude-sonnet-5</code>
<i>Released 2026-06-30 · <a href="https://www.anthropic.com/news/claude-sonnet-5">Announcement</a></i>

<b>Verdict.</b> Overpriced for what it delivers: Opus 4.8 beats it on DeepSWE ([52.0%] vs [41.2%], placeholder) and is cheaper in every pricing category [placeholder], so there is little reason to pick Sonnet 5 for coding agents today. On the Artificial Analysis indices it lands mid-pack — top-10 but never top-3 [placeholder]. Its one real edge is throughput/latency for high-volume knowledge work [placeholder], not raw capability. The system card is candid but shows a HIGHER misaligned-behavior rate than Opus 4.8 — "safer than Sonnet 4.6" is not "safer than Opus." (full breakdown in reply ⤵️)

<b>Facts.</b> Context [200K placeholder] · Pricing [$3] in / [$15] out per Mtok [placeholder] · Open weights: No · API: available at launch (<code>claude-sonnet-5</code>) · Subscription: Claude Pro/Max + Claude Code [placeholder] · Focus: agentic coding, tool use, knowledge work

📊 <b>Benchmarks</b> <i>(Artificial Analysis — all values [placeholder])</i>
• Intelligence Index: #[9] of [42] — high [58] (#[9]) · medium [54] (#[13]) · low [47] (#[19]); best level between [Gemini 3 Flash] (high) and [GPT-5.2 mini] (high)
• Coding Index: #[7] of [40] — high [61] (#[7]) · medium [56] (#[11]); between [Opus 4.8] (medium) and [Grok 5] (high)
• Math Index: #[12] of [40] — high [72] (#[12]); between [o5] (high) and [Gemini 3 Flash] (high)
• Agentic Index: #[10] of [38] — high [55] (#[10]) · low [44] (#[21]); between [Opus 4.8] (low) and [DeepSeek V4] (high)
• DeepSWE: #[14] of [30] — [41.2%] (high); Opus 4.8 leads at [52.0%] (high) [placeholder]

🔗 <i>Sources: <a href="https://www.anthropic.com/news/claude-sonnet-5">Announcement</a> · System card · Artificial Analysis</i>
```

### Message 2 — reply deep dive

```html
↩️ <b>Claude Sonnet 5 — full breakdown</b>

📝 <b>In-depth summary</b>
<blockquote expandable>[Para 1 — Positioning: Anthropic frames Sonnet 5 as the workhorse tier below Opus 4.8, tuned for agentic coding, tool use and everyday knowledge work.]

[Para 2 — Evidence: where it actually lands on the AA indices and DeepSWE, per reasoning level, vs Opus 4.8 and same-price peers; the pricing gap that undercuts the pitch.]

[Para 3 — Real strengths: latency/throughput, tool-use reliability, improved safety profile vs Sonnet 4.6.]

[Para 4 — Optional: who should pick it and who shouldn't.]</blockquote>

🛡 <b>System card — published, mixed</b>
<blockquote expandable><b>Alignment.</b> Lower undesirable-behavior rate than Sonnet 4.6, but HIGHER misaligned-behavior rate than Opus 4.8 — a regression against the flagship even as it improves on its predecessor.
<b>Cyber.</b> Safeguards enabled by default; dangerous cyber capability much lower than Opus 4.8.
<b>Notable behaviors.</b> [sycophancy / eval-awareness / reward-hacking observations from the card]
<b>Safeguards & deployment.</b> [ASL level, classifiers, monitoring]
<b>Unknowns.</b> [behaviors the card flags as not fully characterized]</blockquote>
```

## Templates

### Message 1 — alert card

```html
{lab_emoji} <b>{lab} — {model}</b> <code>{api_id}</code>
<i>Released {date} · <a href="{announce_url}">Announcement</a></i>

<b>Verdict.</b> {verdict_3to5_sentences} (full breakdown in reply ⤵️)

<b>Facts.</b> Context {context} · Pricing {price_in} in / {price_out} out per Mtok · Open weights: {weights} · API: {api_availability} · Subscription: {subscription_availability} · Focus: {focus}

📊 <b>Benchmarks</b> <i>(Artificial Analysis)</i>
{benchmark_rows}

🔗 <i>Sources: {sources}</i>
```

- `{lab_emoji}` — lab-color square (Anthropic 🟧, OpenAI ⬛, Google 🔵, xAI ⬜, Meta 🔷, …).
- `{verdict_3to5_sentences}` — honest, conclusive: who beats it, on which benchmark, at
  what price; its one genuine edge; one system-card plus/caveat (this is where safety
  lives in message 1). Never marketing-neutral.
- `{api_availability}` — e.g. `available at launch (<code>{api_id}</code>)` /
  `coming {date}` / `not offered`.
- `{subscription_availability}` — which consumer/team plans include it, e.g.
  `Claude Pro/Max + Claude Code` / `ChatGPT Plus from {date}` / `none announced`.
- `{benchmark_rows}` — one row per AA capability index plus a DeepSWE row (shape below).
- `{sources}` — ` · `-separated links (Announcement · System card if any · Artificial
  Analysis if listed).

Benchmark row shape (rank first):

> `• {Benchmark}: #{rank} of {n} — {all_levels}; {anchor_placement}`

- `{all_levels}` = every tested reasoning level: `high 58 (#9) · medium 54 (#13) · low 47 (#19)`.
- `{anchor_placement}` = anchored on the best level: `best level between {higher_model} ({effort}) and {lower_model} ({effort})`.
- **#1 marker**: prefix `🥇`, say "highest tested, ahead of {runner_up} ({effort})".

Fallbacks (never delete a labeled section):

- Single reasoning level → show just that level.
- Index not reported → `• {Benchmark}: not yet reported by Artificial Analysis for this model.`
- No DeepSWE run → `• DeepSWE: not yet tested by Artificial Analysis for this model.`
- Model not on AA at all → keep the 📊 label, single line: `Not yet listed on Artificial Analysis.`
- No system card → verdict must say so ("no system card published"), and message 2's
  🛡 section uses its fallback line.

Over-budget cut order, message 1 (cap 4096):
1. Drop `(effort)` labels on non-anchor levels / shorten neighbor names.
2. Trim Facts to context + pricing + API.
3. Trim sources to two links.
4. Tighten verdict to 3 sentences (never fewer; never drop the conclusion or price comparison).

### Message 2 — reply deep dive

```html
↩️ <b>{model} — full breakdown</b>

📝 <b>In-depth summary</b>
<blockquote expandable>{summary_2to4_paragraphs}</blockquote>

🛡 <b>System card — {card_verdict}</b>
<blockquote expandable>{card_deep_dive}</blockquote>
```

- `{summary_2to4_paragraphs}` — positioning → evidence → real strengths → optional
  "who should pick it"; blank line between paragraphs.
- `{card_verdict}` — `published, {strong|mixed|concerning}` or `not published`.
- `{card_deep_dive}` — bold-tagged bullets: `<b>Alignment.</b>`, `<b>Cyber.</b>`,
  `<b>Notable behaviors.</b>`, `<b>Safeguards & deployment.</b>`, `<b>Unknowns.</b>` —
  emphasize interesting/idiosyncratic behaviors.
- No card → keep section, one line: `No system/model card published at launch.`

Cut order: drop 4th paragraph → merge Unknowns/Safeguards → trim Notable behaviors to two items.

Send order: message 1 first; message 2 as reply to message 1's `message_id`. If the
reply fails, message 1 stands alone; retry the reply, never merge back into one message.

## Writer contract (verbatim for the Kimi K2.6 final-writer system prompt)

1. **Two messages by default.** Emit Message 1 (alert card) and Message 2 (reply deep dive). Message 1 must read completely on its own if the reply is missing.
2. **Verdict is a real conclusion, not a pitch.** 3–5 visible sentences stating the judgment the evidence supports: who beats this model, on which benchmark, at what price; its one genuine edge; one honest system-card plus/caveat (or "no system card published"). Never marketing-neutral, never hedge away the conclusion.
3. **The verdict must follow from the data on screen.** Every comparative claim must be backed by a Facts figure or a Benchmarks row in the same message; unverified numbers are flagged `[placeholder]` in both places.
4. **Verdict ends with the pointer** `(full breakdown in reply ⤵️)`. The in-depth summary and system-card breakdown live only in Message 2.
5. **Facts row** carries: context, pricing, open weights, API availability (with the `<code>` model id), subscription availability (which plans), focus. Missing value → `[placeholder]`.
6. **Unified Benchmarks section**: every AA capability index (Intelligence, Coding, Math, Agentic — whatever AA provides) plus a DeepSWE row.
7. **Rank first**: `• {Benchmark}: #{rank} of {n} — {levels}; {placement}`.
8. **Show all tested reasoning levels**, compact (`high 58 (#9) · medium 54 (#13)`); anchor the placement on the best level. 🥇 prefix + "highest tested" when it tops a benchmark.
9. **DeepSWE fallback is mandatory**: if AA has not run it, emit exactly `• DeepSWE: not yet tested by Artificial Analysis for this model.`
10. **Placeholder discipline.** Every unverified value is wrapped `[placeholder]` inline — numbers, ranks, neighbors, prices, availability, URLs.
11. **Formatting invariants.** Telegram HTML whitelist only (`<b> <i> <a> <code> <blockquote expandable>`); escape `&` `<` `>` in interpolated text; 4096-char cap per message with the per-message cut order; labeled sections never deleted — emit the fallback line instead.

## Implementation plan (see repo issue/PR breakdown below)

Ordered so each step ships alone and the bot keeps working between steps.
Steps 0 and 7 are process gates requested by the user: probe reality before coding,
and validate on 3 real releases with a cost report + explicit approval before deploy.

### Step 0 — Environment + AA API ground truth (before writing any code)
- **Env sync from Convex.** Locally `.env.local` only has `CONVEX_DEPLOYMENT` /
  `NEXT_PUBLIC_CONVEX_URL` — no API keys. Pull the rest from the deployment:
  `npx convex env list`, then `npx convex env get` for `DEEPSEEK_API_KEY`,
  `OPENROUTER_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`, `OPENROUTER_KIMI_MODEL`, `MODEL_RELEASES_MAX_COST_USD`
  into `.env.local` (never commit; already gitignored). Any key missing on the
  deployment too → stop and ask the user for it.
- **Probe the Artificial Analysis API with the real key** before building step 2,
  because the placement design assumes fields that must be confirmed:
  - `GET /api/models` (or current endpoint per AA docs): confirm response shape,
    which capability indices exist (intelligence / coding / math / agentic),
    whether **DeepSWE** is a returned eval column, how **reasoning-effort variants**
    are represented (separate rows? suffix? field?), and whether **pricing**
    (input/output per Mtok) is included.
  - Save one raw response as a test fixture (`tests/fixtures/aa-models.json`,
    secrets stripped) — this becomes the ground truth for `computePlacements()` tests.
  - If DeepSWE or an index is NOT in the API, adjust step 2/format fallbacks
    accordingly and tell the user what is actually available before proceeding.

### Step 1 — AI release filtering (fixes the noise complaint)
- The filter decision is made by AI, not regex: `llm.ts` gains a `release_classifier`
  role in `DEEPSEEK_ROLES`.
- New pipeline stage (before evidence gathering, after article fetch): DeepSeek gets
  title + first ~2000 chars of article, returns strict JSON
  `{is_new_model_release: bool, model_names: string[], reason: string}`.
  "New model release" means a new model or model version becoming available —
  NOT feature launches, partnerships, pricing changes, research posts, or
  availability-region announcements. Non-releases → candidate `rejected`, never notify.
- The existing regex gate stays only as a cheap prefilter so the classifier isn't
  called on every page change; the AI verdict is authoritative. No schema change:
  classifier reason is stored in `gateResult.reasons`.

### Step 2 — AA leaderboard data (`benchmarks.ts`)
- New `fetchAALeaderboard()`: one call to AA `/api/models` keeping ALL rows, parsing
  per-model: capability index scores (intelligence, coding, math, agentic, DeepSWE
  column if present), reasoning-effort variant label, input/output pricing.
- New pure function `computePlacements(leaderboard, modelNames)` returning per index:
  `{index, levels: [{effort, score, rank}], n, bestRank, higherNeighbor, lowerNeighbor,
  isTop, deepswe?: same shape | "not_tested"}` plus a pricing comparison vs the two
  neighbors and the lab's own flagship.
- Pure function = unit-testable with a fixture leaderboard; no new tables — placements
  are computed per run and embedded in the evidence packet.

### Step 3 — Prompts + two-message output (`agents.ts`)
- `EvidencePacket` gains `placements` (from step 2) and `availability`
  (API/subscription strings extracted by the article summarizer — add one line to its
  prompt asking for them).
- `runFinalWriter`: replace system prompt with the two templates + 11-rule contract;
  writer returns both messages separated by a `===MESSAGE_2===` delimiter; split on it.
- `runSystemCardSummarizer`: rewrite prompt to hunt interesting behaviors
  (alignment audit results, sycophancy, eval-awareness, reward hacking, weird
  behaviors); raise input cap 6000 → 12000 chars.
- `llm.ts`: `max_tokens` 2048 → 4096 for `final_writer` only.

### Step 4 — Telegram HTML + threaded reply (`telegram.ts`)
- `sendTelegramMessage`: add `parse_mode: "HTML"` + optional `replyToMessageId`,
  return `message_id`.
- New `sendReleasePair(msg1, msg2)`: send msg1, then msg2 as reply; on Telegram 400
  (bad HTML), strip tags and resend plain — never lose a release.

### Step 5 — Verifier update (`agents.ts`)
- Benchmark/rank/comparison claims verify against `placements` (name, score, rank,
  neighbor must match the struct) instead of the old regex claims list.
- `[placeholder]`-flagged values are exempt from support checks.
- Drop `checkMissingWeaknesses` (section removed); add `checkVerdictSupported`:
  every "beats/cheaper" pairing in the verdict must exist in placements/pricing data.
- Keep URL whitelist check as is.

### Step 6 — Config + cleanup
- `llm.ts:8`: `DEFAULT_KIMI_MODEL` → `moonshotai/kimi-k2.6` (env already overrides).
- Update affected tests: `benchmarks.test.ts` (leaderboard fixture + placements),
  `agents.test.ts` (two-message split, new verifier), `messages.test.ts` /
  `releaseMessages.test.ts` (new render path), `redTeamTelegramSend.test.ts`
  (HTML + reply path).

### Step 7 — Validation run + cost report + approval gate (nothing deploys before this)
- Run the full new pipeline end-to-end for **3 real model releases** (pick 3 recent
  articles from the tracked labs, e.g. via the existing replay case URLs or fresh
  candidates), in dry-run mode: real DeepSeek + Kimi + AA calls, **no Telegram send**
  (`RADAR_TELEGRAM_SEND_ENABLED=false`), full message pair rendered per release.
- Deliver to the user: the 3 rendered message pairs + per-release cost breakdown from
  `CostTracker` (per stage: classifier / summarizers / synthesizer / writer) and the
  projected monthly cost at current release frequency.
- **Hard gate: the user must explicitly approve** the output + cost before deploy.
- On approval: deploy via the existing production deploy workflow
  (`.github/workflows/deploy.yml` / `npx convex deploy`), set
  `RADAR_TELEGRAM_SEND_ENABLED=true` on the production deployment, and confirm the
  next real release posts correctly.

Deliberately NOT doing (over-engineering guard): no new Convex tables (placements are
transient per run); no re-check cron for late DeepSWE/AA listings (manual re-run covers
it; add later if it hurts); no per-lab emoji config store (simple map in code); no HTML
sanitizer library (whitelist escape + Telegram-400 plain-text fallback is enough).
