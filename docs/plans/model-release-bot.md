# Model Release Bot

## Overview
Build a verification-first bot that monitors selected AI labs, sends only official dedicated model-release articles, summarizes the article and linked safety/system material, compares the release against relevant benchmark evidence, and emits a concise verified release note. DeepSeek handles article/system-card summarization and evidence aggregation. Kimi K2.6 through OpenRouter writes the final condensed bullet message. The implementation must include an offline benchmark harness so every future run can be scored against known-good examples before any live provider spend.

## Context
The remote `main` branch is only an initial commit, but `origin/codex/model-release-radar` already contains the working app. This plan must execute against that implementation branch, not empty `main`. The app is a Next.js + Convex + Telegram radar with TypeScript source under `src/lib/radar`, Convex polling and persistence under `convex/`, and tests under `tests/`.

The implementation branch has `CLAUDE.md` and `AGENTS.md` requiring Convex guidance to be read before touching Convex code. The guidance says to use validators on all Convex functions, keep actions separate from queries/mutations when Node APIs are needed, avoid `ctx.db` in actions, use `internal` function references for crons, prefer indexes over filters, and use `convex-test` for Convex behavior when it is added.

There is no local `executr` checkout or `ralphex`/`executr` binary on PATH in this environment. The available Ralphex/executr plan rules come from `/home/devuser/projects/summario/CLAUDE.md` and `.agents/skills/ralphex-plan-writer/SKILL.md`: executable plans live in `docs/plans/*.md`, include `## Validation Commands`, use `### Task N:` headings, and keep all checkboxes inside task sections.

Emdash is the available local/remote agent orchestration repo. Its docs describe remote projects as SSH-backed worktrees under `<project>/.emdash/worktrees/<task-slug>/`, with PTYs streamed back to the renderer. Provider docs say Emdash supports many CLI agents, including Codex, Kimi, Mistral, Gemini, Claude, and others. This bot should not depend on Emdash internals, but the repo setup must be friendly to unattended remote execution: no committed secrets, deterministic tests, one-task-per-iteration slices, and clear live-smoke skips when secrets or browser access are absent.

Current implementation mismatch to fix: `src/lib/radar/sources.ts` monitors many broad surfaces, including release notes, model docs, Hugging Face orgs, OpenRouter, Artificial Analysis pages, Qwen, Kimi, Cohere, Z.ai, MiniMax, Xiaomi MiMo, and broad NVIDIA sources. `src/lib/radar/parsers.ts` emits generic signals from headings and catalog rows. This conflicts with the new product rule: selected labs only, official dedicated model-release article gate, Cohere out, Gemini official blog/dev-blog only, and NVIDIA Nemotron-only.

Current source-monitoring research to re-verify during implementation:

| Lab | Primary official source pattern | Notes |
| --- | --- | --- |
| OpenAI | `https://openai.com/news/rss.xml` and `https://openai.com/news/` | Dedicated release articles only. |
| Anthropic | `https://www.anthropic.com/news` | No reliable official RSS found; scrape official news page. |
| Google Gemini / DeepMind | `https://deepmind.google/blog/rss.xml`, `https://blog.google/products-and-platforms/products/gemini/rss/`, and official Gemini developer blog tags | A Gemini release must come from an official blog/article page, not an unsupported secondary source. |
| Mistral | `https://mistral.ai/rss.xml` and `https://mistral.ai/news/` | Feed is broad; filter hard for model releases. |
| DeepSeek | `https://api-docs.deepseek.com/news/` | Scrape official news index; no official RSS assumed. |
| Meta AI / Llama | `https://ai.meta.com/blog/` | Filter for Llama model-release articles. |
| xAI | `https://x.ai/news` | Scrape official news page. |
| NVIDIA Nemotron | `https://research.nvidia.com/labs/nemotron/feed.xml` and `https://research.nvidia.com/labs/nemotron/` | NVIDIA is Nemotron-only; reject broader NVIDIA AI announcements. |
| Deepgram | `https://developers.deepgram.com/changelog.rss` and official release/blog pages | Prefer dedicated model release pages; changelog may discover candidates but cannot bypass the article gate. |
| ElevenLabs | `https://elevenlabs.io/docs/changelog.rss`, `https://elevenlabs.io/docs/changelog`, and official blog pages | Prefer dedicated model release pages. |
| AssemblyAI | `https://www.assemblyai.com/changelog`, `https://www.assemblyai.com/blog`, and `https://www.assemblyai.com/collection/releases` | Scrape official release collection/blog pages; no RSS assumed. |

Artificial Analysis is usable for agents through `https://artificialanalysis.ai/api/v2` with `x-api-key`. Free endpoints include `/language/models/free`, `/media/text-to-speech/models/free`, `/media/speech-to-speech/models/free`, and `/media/speech-to-text/models/free`; Pro/Commercial endpoints add model detail and performance history. Attribution is required when displaying its data. The bot must degrade gracefully when no Artificial Analysis key is configured.

## Product Decisions
Only selected labs are in scope: OpenAI, Anthropic, Google Gemini/DeepMind, Mistral, DeepSeek, Meta/Llama, xAI, NVIDIA Nemotron-only, Deepgram, ElevenLabs, and AssemblyAI.

Cohere is out of scope unless explicitly re-added later.

Kimi K2.6 is the configured final-message writer through OpenRouter. Moonshot/Kimi and Qwen are not monitored release sources by default unless the product config later adds them as selected labs.

A candidate is sendable only when it has an official dedicated article page for a new model release. Feed entries, changelog snippets, model-card-only pages, social posts, benchmark pages, or third-party writeups may help discover or verify a release, but they do not make a release sendable by themselves.

The article gate must reject unsupported Gemini release sources and broad NVIDIA articles that are not specifically Nemotron model releases.

The message must summarize the dedicated article, include linked system/safety/model-card evidence when present, and state benchmark context with enough provenance for a verifier to check every claim.

The final user-facing message is short bullet points: where the model shines, strengths, weaknesses/unknowns, benchmark context, safety/system-card notes, and source links.

API keys must never be committed, printed in logs, stored in fixtures, or included in Ralphex progress files. Use `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, and optionally `ARTIFICIAL_ANALYSIS_API_KEY` from environment, `.env`, or remote secret storage.

## Architecture Decisions
Keep the existing Next.js + Convex + TypeScript stack. Do not rewrite to Python. Use pure TypeScript modules for the offline/eval pipeline, Convex internal actions for scheduled polling, and Node-only scripts for CLI smoke/eval commands that need filesystem snapshots or browser/PDF tooling.

Core modules:

| Module | Responsibility |
| --- | --- |
| `src/lib/radar/config.ts` | Load selected labs, provider models, source URLs, cost caps, and secrets from env without exposing secret values. |
| `src/lib/radar/sources.ts` | Replace broad v1 registry with official selected-lab source adapters and candidate discovery metadata. |
| `src/lib/radar/articleGate.ts` | Determines whether a candidate is an official dedicated new-model release article for a selected lab. |
| `src/lib/radar/fetching.ts` | HTTP fetch, browser fetch fallback interface, readability extraction, asset probing, and PDF/download handling. |
| `src/lib/radar/systemCards.ts` | Detects linked system cards, model cards, safety cards, and technical reports; extracts text and splits by topic. |
| `src/lib/radar/benchmarks.ts` | Collects Artificial Analysis data when available plus official/relevant benchmark references discovered from article/system-card links and configured search providers. |
| `src/lib/radar/llm.ts` | OpenAI-compatible clients for DeepSeek and OpenRouter Kimi K2.6; records usage and estimated cost. |
| `src/lib/radar/agents.ts` | Role orchestration for researcher, article summarizer, system-card summarizer, benchmark aggregator, final writer, and verifier. These roles are model/tool-call abstractions inside the bot, independent of Codex/Ralphex subagents. |
| `src/lib/radar/browserTools.ts` | Tool-callable browser functions: open URL, snapshot, extract readable text, find links, screenshot, probe images/assets, download linked PDFs. |
| `src/lib/radar/messages.ts` and `src/lib/radar/telegram.ts` | Final release-note schema and rendering for Telegram and plain text. |
| `src/lib/radar/eval.ts` and `scripts/radar-eval.mjs` | Offline benchmark runner, golden oracle comparison, claim verification checks, and cost report generation. |
| `convex/polling.ts` and `convex/schema.ts` | Integrate accepted verified release notes into scheduled polling and persistence only after reading Convex guidelines. |

Expose browser access to internal agents through typed tool functions rather than hidden ad hoc scraping. The default implementation should use Playwright when available and fall back to HTTP-only extraction with explicit reduced-confidence evidence.

System-card handling must support HTML and PDF. Split extracted text into stable topics such as overview, capabilities, benchmarks/evals, safety, misuse/limitations, deployment, data/training, and unknown/other. Tests should prove that long cards are split deterministically and that article summaries cite the relevant topic chunks.

Use DeepSeek for article summary, system-card topic summary, and benchmark/evidence aggregation. Use Kimi K2.6 through OpenRouter only for the final condensed message. Use a separate verifier role after final writing to check that every user-facing claim is supported by article, system-card, or benchmark evidence.

## Verification Contract
The project is not done until it has deterministic offline tests, a benchmark fixture set with at least two positive dedicated model-release articles per selected lab where official history allows it, negative examples that prove unwanted sends are rejected, and live smoke commands that can run with remote secrets under a max-cost cap.

The benchmark harness must score:

| Dimension | Required evidence |
| --- | --- |
| Source eligibility | Selected lab, official domain, dedicated article page, new model release. |
| Exclusion behavior | Cohere excluded, non-blog Gemini rejected, broad NVIDIA non-Nemotron rejected, model-card-only pages rejected. |
| Extraction | Article title/date/lab/model links, main text, images/assets, canonical URL. |
| System cards | Linked cards detected, fetched, read, split by topic, and tied back to summary claims. |
| Benchmarks | Artificial Analysis checked when configured, relevant benchmark claims normalized, unknowns called out rather than invented. |
| LLM routing | DeepSeek used for research/summarization/aggregation, Kimi K2.6 used for final bullets, verifier runs independently. |
| Cost | Usage and estimated cost recorded per stage and per release; live run can enforce `--max-cost-usd`. |
| Final message | Concise bullets, strengths/weaknesses, citations/source links, no unsupported claims. |

The evaluator should include one strong reference answer produced by a planning/research subagent. The bot output is compared against that oracle for coverage, factual support, unsupported-claim count, and concision. The oracle is not a source of truth by itself; it is a benchmark target whose claims must also be backed by fixture evidence.

Live tests must be best-effort and explicit: if API keys, Artificial Analysis access, browser dependencies, or network access are unavailable, the command records a structured skip with the blocker. It must not claim a live smoke passed when it only ran offline fixtures.

Benchmark corpus seed from the independent benchmark subagent. Every URL must be live re-verified before being captured into fixtures:

| Lab | Positive dedicated release article examples |
| --- | --- |
| OpenAI | `https://openai.com/index/gpt-4-1/`, `https://openai.com/index/hello-gpt-4o/` |
| Anthropic | `https://www.anthropic.com/news/claude-4`, `https://www.anthropic.com/news/claude-3-7-sonnet` |
| Google Gemini | `https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-model-thinking-updates-march-2025/`, `https://developers.googleblog.com/en/start-building-with-gemini-25-flash/` |
| Meta/Llama | `https://ai.meta.com/blog/llama-4-multimodal-intelligence/`, `https://ai.meta.com/blog/meta-llama-3-1/` |
| Mistral | `https://mistral.ai/news/codestral/`, `https://mistral.ai/news/mistral-3/` |
| DeepSeek | `https://api-docs.deepseek.com/news/news250120`, `https://api-docs.deepseek.com/news/news1226` |
| xAI | `https://x.ai/news/grok-4`, `https://x.ai/news/grok-3` |
| NVIDIA Nemotron | `https://developer.nvidia.com/blog/nvidia-llama-nemotron-ultra-open-model-delivers-groundbreaking-reasoning-accuracy/`, `https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/` |
| Deepgram | `https://deepgram.com/learn/introducing-nova-3-speech-to-text-api`, `https://deepgram.com/learn/introducing-aura-2-enterprise-text-to-speech` |
| ElevenLabs | `https://elevenlabs.io/blog/meet-scribe`, `https://elevenlabs.io/blog/eleven-v3` |
| AssemblyAI | `https://www.assemblyai.com/blog/announcing-universal-1-speech-recognition-model`, `https://www.assemblyai.com/blog/conformer-2` |

Negative corpus seed:

| Rejection class | Example |
| --- | --- |
| Unselected lab | Cohere Command A or Command A+ articles while Cohere is not selected. |
| Unsupported Gemini source | OpenRouter model pages, Google AI Studio model pages, or Gemini API docs pages without a dedicated official blog article. |
| Non-Nemotron NVIDIA | Blackwell hardware, inference, partner, or platform announcements that are not Nemotron model releases. |
| Non-article source | Release notes, changelogs, docs, social posts, newsletters, customer stories, pricing updates, and benchmark-only posts unless paired with an official dedicated model-release article. |

Hard-fail benchmark conditions: Cohere included while unselected, unsupported Gemini source accepted, non-Nemotron NVIDIA release accepted, no browser/tool access path, hallucinated source URL, or final message produced without independent verifier approval.

## Validation Commands
- `npm install`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run radar:eval -- --fixtures tests/fixtures/release-benchmark.json --offline --max-cost-usd 0`

### Task 1: Repository And Remote Execution Setup
- [x] Confirm the agent is working on a branch based on `origin/codex/model-release-radar`; do not restart from empty `main`.
- [x] Add `.ralphex/config` for this repo with `default_branch = codex/model-release-radar`, `plans_dir = docs/plans`, `external_review_tool = codex`, and completion behavior suitable for remote execution.
- [x] Update `.env.example` to document `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_KIMI_MODEL`, `ARTIFICIAL_ANALYSIS_API_KEY`, `MODEL_RELEASES_MAX_COST_USD`, destination Telegram variables, and browser/eval toggles without real values.
- [x] Confirm `.gitignore` covers `.env`, `.env.*`, browser artifacts, cost reports, and local caches while keeping `.env.example` tracked.
- [x] Add npm scripts for `radar:eval`, `radar:smoke`, and any required browser install helper without changing the existing `test`, `typecheck`, or `build` commands.
- [x] Update `README.md` to explain selected labs, dedicated-article gating, remote-secret expectations, offline eval, live smoke, Telegram dry-run behavior, and the rule that secrets are never committed.
- [x] Run the validation commands that can pass after this setup task and record any intentional skips.

### Task 2: Source Registry And Article Gate
- [ ] Implement selected-lab source configuration for OpenAI, Anthropic, Google Gemini/DeepMind, Mistral, DeepSeek, Meta/Llama, xAI, NVIDIA Nemotron, Deepgram, ElevenLabs, and AssemblyAI.
- [ ] Remove or disable default notifications for Cohere, Qwen, Kimi, Z.ai, MiniMax, Xiaomi MiMo, Hugging Face global new models, OpenRouter catalog, and broad Artificial Analysis catalog sources unless they are used only as non-sendable verification evidence.
- [ ] Replace broad NVIDIA sources with Nemotron-only official sources and reject non-Nemotron NVIDIA articles.
- [ ] Implement feed and scrape adapters that normalize candidates into lab, title, URL, date, source type, source confidence, and raw metadata.
- [ ] Implement `article_gate` rules for selected lab, official domain, dedicated article page, new model-release language, and lab-specific constraints.
- [ ] Add rejection tests for Cohere, unsupported Gemini source types, broad NVIDIA non-Nemotron pages, generic product updates, and model-card-only candidates.
- [ ] Add positive gate tests using fixture metadata for at least two model-release articles per selected lab where available, with explicit fixture waivers when official history cannot supply two.
- [ ] Run the validation commands and fix failures.

### Task 3: Benchmark Fixture And Oracle Harness
- [ ] Create `tests/fixtures/release-benchmark.json` with positive and negative cases, expected extracted fields, required links, expected system-card behavior, expected benchmark behavior, and lab-specific constraints.
- [ ] Seed the fixture set with two representative historical dedicated release articles per selected lab where possible; mark every URL as `requires_live_reverify: true` until the fetcher has captured sanitized fixture snapshots.
- [ ] Add a benchmark oracle file containing the strong reference answer from the research subagent, plus source-backed expected claims and known weaknesses/unknowns.
- [ ] Implement `npm run radar:eval -- --offline` to run the fixture set without network or LLM calls, using fake fetchers and fake LLM usage.
- [ ] Add scoring output for eligibility accuracy, extraction coverage, system-card coverage, benchmark coverage, final-message coverage, verifier precision, and estimated cost.
- [ ] Run the validation commands and fix failures.

### Task 4: Fetching, Browser Tools, Images, And Article Extraction
- [ ] Implement HTTP fetching with timeouts, robots-aware user agent configuration, canonical URL handling, and sanitized cached snapshots for tests.
- [ ] Implement Playwright-backed browser tools for open, snapshot, readable extraction, link discovery, screenshot capture, image/asset probing, and PDF/download retrieval.
- [ ] Expose the browser tools through typed schemas callable by internal LLM agent roles.
- [ ] Implement image/asset checks that verify article images resolve, have content type/dimensions when available, and are surfaced in evidence without embedding raw binary fixtures.
- [ ] Add offline tests using fixture HTML for article extraction, canonical URL detection, image probing, and browser-tool fallback behavior.
- [ ] Run the validation commands and fix failures.

### Task 5: System Card Detection, Fetching, And Topic Splitting
- [ ] Implement link detection for system cards, model cards, safety cards, technical reports, PDFs, and official model documentation linked from the release article.
- [ ] Implement HTML and PDF text extraction with source URL/page provenance and sanitized fixture snapshots.
- [ ] Implement deterministic topic splitting for overview, capabilities, benchmarks/evals, safety, misuse/limitations, deployment, data/training, and unknown/other.
- [ ] Add tests proving system cards are detected from articles, fetched, read, split by topic, and referenced by summaries.
- [ ] Add tests for missing, broken, or irrelevant card links so the bot reports unknowns instead of fabricating system-card evidence.
- [ ] Run the validation commands and fix failures.

### Task 6: Benchmark Research And Artificial Analysis Integration
- [ ] Implement an Artificial Analysis client for free language, TTS, speech-to-speech, and speech-to-text endpoints, with optional API key support, attribution metadata, rate-limit handling, and structured skips.
- [ ] Implement benchmark evidence normalization for article claims, system-card claims, Artificial Analysis rows, and configured official benchmark links.
- [ ] Map labs and modalities to relevant benchmark families so speech labs use STT/TTS/S2S endpoints and language labs use language endpoints.
- [ ] Add comparison logic that states support, contradiction, missing data, or not comparable for each important release claim.
- [ ] Add offline fixture tests for available benchmark data, missing Artificial Analysis key, rate limits, model-not-found, and modality mismatch.
- [ ] Run the validation commands and fix failures.

### Task 7: DeepSeek, OpenRouter Kimi, Cost Tracking, And Agent Roles
- [ ] Implement OpenAI-compatible DeepSeek client for article summary, system-card topic summary, and benchmark aggregation stages.
- [ ] Implement OpenRouter client for Kimi K2.6 final-message generation, with model name configurable by `OPENROUTER_KIMI_MODEL` and no fallback that silently changes the requested final writer.
- [ ] Implement fake LLM clients for offline tests that return deterministic outputs and token usage.
- [ ] Implement cost estimation from recorded prompt/completion token usage and configurable per-model pricing, with stage and per-release totals.
- [ ] Implement internal agent role orchestration for researcher, article summarizer, system-card summarizer, benchmark aggregator, final writer, and verifier.
- [ ] Add tests proving routing, cost accounting, max-cost enforcement, secret redaction, and deterministic fake-client behavior.
- [ ] Run the validation commands and fix failures.

### Task 8: Final Message Rendering And Independent Verification
- [ ] Define the final release-note schema with title, model, lab, release date, source links, strengths, weaknesses/unknowns, benchmark context, system-card notes, images/assets, and verification status.
- [ ] Implement Kimi-generated concise bullet rendering for plain text plus destination-ready variants if webhook targets are configured.
- [ ] Implement an independent verifier that checks each final-message claim against article, system-card, and benchmark evidence before the message can be sent.
- [ ] Add tests where the verifier catches unsupported strengths, unsupported benchmark claims, missing weaknesses, and source-link mismatches.
- [ ] Add tests proving unverified messages are not sent and verified messages include enough provenance for audit.
- [ ] Run the validation commands and fix failures.

### Task 9: Live Smoke Tests With Remote Secrets And Cost Caps
- [ ] Implement `npm run radar:smoke` with lab filters, per-lab limits, dry-run mode, max-cost cap, live network fetching, optional Artificial Analysis calls, and no destination send unless explicitly enabled.
- [ ] Add a live smoke profile that attempts two releases per major selected lab but can be narrowed for cost-controlled remote runs.
- [ ] Ensure the live smoke records exact skips for missing API keys, missing browser dependencies, network blocks, Artificial Analysis plan limitations, and source pages that changed shape.
- [ ] Add CI or remote-run documentation for installing browser dependencies before live browser smoke tests.
- [ ] Run a dry-run live smoke against a small selected-lab subset when secrets are present; otherwise record the structured skip and keep offline validation passing.
- [ ] Run the validation commands and fix failures.

### Task 10: Remote Handoff, Review Loop, And Completion
- [ ] Confirm `.ralphex/config` and this plan are tracked and format-valid with the Ralphex checker.
- [ ] Add a remote execution note describing how to set GitHub or executor secrets for `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, and optional `ARTIFICIAL_ANALYSIS_API_KEY` without exposing their values.
- [ ] Run the full offline validation suite and the highest-scope live dry-run allowed by available secrets and cost cap.
- [ ] Spawn or configure an independent verification pass that reviews the final bot output against the benchmark oracle and fixture evidence.
- [ ] Fix all verification findings or document exact blockers with expected vs actual behavior.
- [ ] Commit the completed setup and prepare the branch for remote Ralphex/executr pickup.
