# Agentic Chat Layer — Assessment & Phased Build Plan

This is a companion to `docs/AGENTIC_CHAT.md` (the original spec/pitch, left unchanged). That file describes *what* to build and *why*; this file records the assessment against the actual current repo state, the scope decisions made, and the phase-by-phase build order that will be followed **when implementation starts**. Nothing in this document has been implemented yet — this is planning only.

## Context

`docs/AGENTIC_CHAT.md` proposes a chat panel backed by a real multi-step Claude tool-use agent (search → thread detail → draft reply), pitched explicitly as closing an evaluation gap: the core app is a classification *pipeline* (single forced-tool-call batches, single-call digest) and doesn't demonstrate multi-turn autonomous tool use or ambiguity handling, which is called out as something Tenex evaluates directly. This plan was written after assessing the proposal against the *actual* current repo state (not the possibly-stale `CLAUDE.md`/build-guide descriptions), since the codebase has moved past what those docs describe (e.g. `CLAUDE.md` points at `docs/BUILD_GUIDE.md`, which doesn't exist — the real file is `docs/inbox-concierge-build-guide.md`).

Three parallel codebase explorations (backend, frontend, rate-limit/maturity posture) found:

- **"Search" and "draft replies"** (from commit `003170a`) are decoys relative to what AGENTIC_CHAT.md describes: search is a client-side `Array.filter()` over already-loaded emails (no backend route at all), and draft-reply is a static `draftReply` string bolted onto the existing single Sonnet digest call. Neither involves multi-turn tool use.
- **No agentic infrastructure exists anywhere** — no `/api/agent` route, no conversation/message DB tables, no chat UI component, and the only two Anthropic call sites (`classifier/batch.ts`, `digest/generate.ts`) both use a single *forced* tool call for structured extraction, not a model-driven `tool_choice: auto` loop. This would be a genuinely new pattern for the codebase, not an extension of one.
- **What *is* directly reusable**: the SSE hijack pattern (`reply.hijack()` + `reply.raw.write`), the shared Anthropic client wrapper (`maxRetries: 2`, `isInsufficientCreditsError`), the Zod-validated tool-use idiom, the async-generator SSE client hooks (`useClassifyStream`/`useDigestStream`), and the dark-slate/Framer-Motion design system.
- **A real design conflict surfaced during review**: the `emails` table stores only subject/sender/snippet/headers, never a full body. AGENTIC_CHAT.md's `get_thread_detail` tool assumes "fuller content" is available, but `CLAUDE.md`'s non-negotiable rule is "metadata + snippet only to the LLM — never full email bodies," with no carve-out. **Resolved: keep the rule intact, no live Gmail body fetch.** `get_thread_detail` is deferred entirely for v1, and if built later it returns richer metadata only, never a body.

**Scope decisions:**
1. Thread detail: snippet/metadata-only, no exception to the "never full bodies" rule.
2. Build scope: **trimmed MVP** — ship `search_emails` + `draft_reply` only; defer `get_thread_detail`.
3. Conversation state: **ephemeral, client-held** — no new DB tables; full history resent each turn, consistent with the rest of the app's stateless-per-request SSE design.

## Assessment summary

**Pros:** this is the one place in the app that would demonstrate a real `tool_choice: auto` multi-turn loop, ambiguity handling ("three Johns"), and grounding (no hallucinated results) — exactly the failure modes AGENTIC_CHAT.md says are being evaluated. It's additive (doesn't touch the classification pipeline, dashboard, or bucket board), needs no new OAuth scope, and reuses a lot of established plumbing (SSE, Anthropic client, Zod, design system).

**Cons:** it is real net-new complexity, not polish — a new subsystem (loop controller, tool handlers, SSE route, chat UI, tool-visibility indicators) comparable in size to another full phase, in a codebase with no CI and no frontend tests, so correctness rests on manual/scripted verification (matching AGENTIC_CHAT.md's own §9 checklist: curl-test the loop before any UI). Cost/latency also compounds with iteration count in a way the single-call classifier/digest paths don't — worth a conservative iteration cap and cost-conscious model choice, same spirit as `MAX_EMAILS_PER_RUN`/cost ceilings elsewhere.

**Home run angle:** the ambiguity-handling and grounding requirements are the actual differentiator — most tool-use demos just call tools; explicitly refusing to guess between multiple "Johns" and refusing to fabricate when a search returns nothing is the depth that maps directly to "agent reliability and failure modes." The "model can only ask, code decides what's allowed" framing (`draft_reply` structurally cannot send) is also a strong continuation of the same architectural philosophy as the rest of the app (structured tool-use output, never free-text parsing) — good narrative continuity for the demo video.

**Sequencing note:** at the time this plan was written, branch `phase-8-bucket-board-polish` had uncommitted changes. Per the `CLAUDE.md` workflow rule ("don't start the next phase until the current one is solid and committed"), that phase should be typechecked/linted, committed, and pushed before starting this new track on its own branch (e.g. `agentic-chat-mvp`, since AGENTIC_CHAT.md explicitly frames this as a separate track, not a numbered phase).

---

## Build order (phases — matching this project's existing per-phase, commit-checkpoint workflow)

This track sits outside the numbered build-guide phases, but is built with the same discipline: one phase solid + typechecked + committed before the next starts, each ending in its own branch + commit + push. Scope is the trimmed MVP agreed above — `search_emails` + `draft_reply` only, `get_thread_detail` deferred.

**Phase 9a — Agent loop backend, no UI.** Build the whole tool-use loop and prove it with scripts/curl before any frontend exists — this is deliberate, matching AGENTIC_CHAT.md §9's own checklist ("test with a script/curl, not the UI first") and this project's habit of proving the pipeline before wiring it up (Phase 2 did the same for classification).

New folder `services/agent/`, mirroring `services/classifier/` and `services/digest/`:
- **`config.ts`** — `MAX_TOOL_ITERATIONS = 5`, Sonnet as the model (better reasoning for ambiguity/grounding/drafting than Haiku), system prompt encoding the "ask, don't guess" ambiguity rule, the grounding rule (only claim what a tool actually returned), and the "say so, don't fabricate" no-results rule.
- **`tools.ts`** — Anthropic tool schema defs for `search_emails` and `draft_reply` + Zod schemas validating the model's tool-call inputs before execution.
- **`search-emails.ts`** — **new** DB query (today's "search" is client-only, so this is genuinely new code): query `emails` joined with `classificationResults`, filter by keyword (subject/snippet), bucket name, sender, `unread_only`, `limit`, scoped to the authenticated user.
- **`draft-reply.ts`** — handler receives `{thread_id, intent}`. Looks up subject/sender/snippet by `thread_id` (DB, scoped to user) — **no body fetch**, per the "never full bodies" rule. Makes its own bounded, tool-forced, Zod-validated Sonnet call (same idiom as `digest/generate.ts`) to produce `{draftText: string}` — keeps "structured output only" intact and makes the draft trivial to detect for the UI later. Counts as one of the 5 iteration-budget calls.
- **`loop.ts`** — the orchestrator: seed `messages` with system prompt + history + new user message; loop up to `MAX_TOOL_ITERATIONS`; on `tool_use`, dispatch to the matching handler (wrapped in try/catch — a DB failure must produce a relayable error, not crash the loop); on `end_turn`, return final text; if the cap is hit without a final answer, return a graceful "I wasn't able to fully answer that" message. Log every tool call (name, args, result summary) via `request.log`. Reuse `getAnthropicClient()` and `isInsufficientCreditsError()`.
- **Tests**: Node-test-runner unit tests (matching existing `.test.ts` convention) for `search-emails.ts` query logic and the loop's iteration-cap/error-handling branches.
- **Verification gate for this phase**: a script/curl pass exercising (a) a normal search, (b) an ambiguous-sender query against real data with 2+ distinct people sharing a first name — confirm the agent asks instead of guessing, (c) a query with zero matches — confirm it says so instead of fabricating, (d) a full `draft_reply` round trip, (e) forcing the 5-iteration cap — confirm graceful degradation. Do not proceed to 9b until all five pass consistently.
- Commit checkpoint: typecheck + lint, commit, push on a new branch (e.g. `agentic-chat-mvp`).

**Phase 9b — Streaming route + chat UI.** Only start once 9a's verification gate is green.
- **`stream-route.ts`** — new `POST /api/agent/chat`, same `reply.hijack()` + raw SSE write pattern as `classifier/stream-route.ts`. New discriminated-union event type in `packages/shared` (`started | status | draft | done | error`), following the existing `ClassifyStreamEvent`/digest conventions — `status` events carry human-readable tool activity ("Searching your inbox…", "Preparing a draft…").
- Register the route in `apps/server/src/index.ts`.
- **`hooks/useAgentChatStream.ts`** — same async-generator + `AbortController` reducer pattern as `useClassifyStream.ts`/`useDigestStream.ts`.
- **`components/AgentChatPanel.tsx`** — message list + input box; renders `status` events as an inline tool-activity indicator (visible, not hidden behind a spinner); renders `draft` events as a distinct, clearly-labeled draft card with a copy button, reusing the copy-to-clipboard + timed "Copied!" affordance already in `DigestPanel.tsx`.
- **`App.tsx`** — extend the `View` union (`'dashboard' | 'board'`) with `'chat'`, added to the existing tab button-group.
- Reuse existing dark-slate/card/focus-ring styling and `useReducedMotion` guards.
- **Verification gate**: manually exercise in the browser — normal query, ambiguous sender, no-results query, a full draft round trip and copy button, an intentionally looping query to confirm the 5-call cap degrades gracefully in the UI, not just the API.
- Commit checkpoint: typecheck + lint, commit, push.

**Phase 9c — Deferred/stretch (only if 9a+9b are solid).** `get_thread_detail` as metadata-only (no body, per the resolved design conflict), richer disambiguation UX (e.g. clickable choices instead of plain text when the agent asks "which John?"), persisted conversation history if cross-session chat turns out to matter. Do not start this while 9b is still shaky — same "don't cut rigor for scope" rule the existing build guide states for its own stretch phase.

### Ongoing

- Add real entries to `docs/CORRECTIONS_LOG.md` for anything caught while building any of the above, per project convention.
- Commit/push any in-progress phase before starting `agentic-chat-mvp`, per the "don't start the next phase until the current one is committed" rule.
