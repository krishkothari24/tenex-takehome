# Inbox Concierge — Complete Build Guide

**Audience:** Claude Code agents building this app. **Read this whole file before writing any code.**
This is a job-interview take-home assignment. The bar is not "working" — it's "clearly the strongest submission in the pile." Every decision below is deliberate; where a choice is left open, it's marked. When in doubt, optimize for (1) a demo that is visually impressive without narration, (2) code whose decisions the author can defend on camera, and (3) genuine LLM-engineering depth over feature count.

---

## 0. The original assignment prompt (verbatim, for grounding)

> **Inbox Concierge**
> Through this interface, a user should be able to authenticate a G-Suite account, which should be used to give gmail access. On load, group the user's last 200 threads into buckets (Important, Can wait, Auto-archive, Newsletter, etc.) using an LLM-powered classification pipeline you design. You only need to show the emails with their subject lines and a preview, like the homepage of any email application. Users do not have to be able to click into the emails. Then, allow the users to create their own buckets, outside of the default options you choose, which should then recategorize all of the emails based on the new buckets.
>
> **Web interface must use React.** Submission: an unlisted 10–20 min YouTube walkthrough, a public GitHub repo with a clear README, and a deployed live link.

Everything in this guide is an elevation on top of that minimum spec. The minimum spec is the floor, not the goal.

---

## 0.5 The bar this will be judged against (from Tenex — internalize this)

> **"At Tenex, we don't ship 'demos'—we ship systems. We are looking for AI-native speed paired with elite-level engineering rigor."**

Four explicit evaluation axes. Every phase of this build must satisfy all four, not just the demo:

1. **Production quality.** Is the code modular, linted, and edge-case aware — real error handling, rate-limit handling, no happy-path-only code? This is the axis most take-homes fail. It's weighted as heavily as the wow factor here. See §5.8 and §7.5 for the specific rigor requirements — these are not optional polish, they are graded.

2. **AI-native speed.** Did you use AI to build ~10x faster — *and can you explain how you verified and refined its output?* Using Claude Code to build this is expected and good. The trap is not being able to defend what it produced. Throughout the build, the human must understand every architectural decision well enough to explain why it's correct, not just that it works. (This is also Tenex's stated top watch-out for candidates: leaning on AI output you can't defend.)

3. **The "wow" factor.** A high-leverage extension that significantly elevates the result — not five shallow features, one deep one. For this build, the wow is the **live streaming reflow + the quantified cost dashboard**, and (if built) the **production feedback loop** where user corrections improve the model. Depth over breadth.

4. **The video** (see §11 — structure is fixed by Tenex).

**Design implication:** because "we ship systems, not demos" and "production quality" are explicit, this build cannot be a pretty front-end over fragile internals. Error handling, rate-limit backoff, input validation, and graceful degradation are first-class deliverables — a reviewer will look for them in the code, not just watch the video. Budget real time for §5.8 and §7.5.

---

## 1. What this app is, who it's for, and the goal

**What it is:** "Inbox Concierge" — an AI layer over Gmail that classifies the user's inbox into meaningful buckets *and quantifies the time/attention cost of their inbox*, turning raw email into an at-a-glance intelligence dashboard.

**Who it's for:** busy professionals (framed for the demo as someone client-facing whose inbox is a real daily time sink).

**The goal / business framing (this is the demo's opening line):** most people spend hours a week triaging email manually. This app does the triage automatically, tells you *how much time your inbox is actually costing you and where*, and lets you reshape the categories to fit how you actually work. It's not "an email sorter" — it's "quantified inbox intelligence."

**Why this framing matters:** the assignment tests "product and design taste" and "business impact." A bare classified list demonstrates neither. The dashboard + cost framing is what elevates a generic sorter into something with a business case.

---

## 2. The two demo moments the entire build must protect

Everything is in service of these. If a decision trades away either of these, it's the wrong decision.

1. **The dashboard opener.** On load, the user sees a dashboard with a real number: "This inbox holds X hours of low-priority reading, Y unanswered threads from important people, Z newsletters." This is the first 30 seconds of the video and it must land.

2. **The live re-bucketing reflow.** The user types a new custom bucket (e.g., "Needs my signature"), hits enter, and watches all 200 emails visibly re-sort in real time — cards animating into their new buckets. This is the single most impressive visual beat in the whole demo, and it must feel *fast and alive*, not a spinner-then-refresh.

**Non-negotiable performance requirement:** re-bucketing must reflow visibly and quickly. Stream results in as classification batches complete; optimistically animate cards as results arrive rather than blocking on the full pipeline. If this feels slow, the demo fails regardless of how good the backend is.

---

## 3. Tech stack (and why — the author must be able to defend each choice)

| Layer | Choice | Why (the on-camera justification) |
|---|---|---|
| Frontend | **React + Vite + TypeScript** | Assignment requires React. Vite for fast dev/build. TS for the same schema-as-type discipline used in production-grade codebases. |
| Styling | **Tailwind CSS** | Fast, consistent, no CSS-cancellation issues. |
| Charts | **Recharts** | Clean React-native charting for the dashboard. |
| Backend | **Node.js + TypeScript + Fastify** | Long-lived server (needed for streaming + persistent DB connection). Fastify chosen deliberately — lightweight, first-class TypeScript, schema validation built in. |
| LLM | **Anthropic Claude API** — Haiku 4.5 for classification, Sonnet 5 for reasoning-heavy features | Haiku is purpose-built and priced for high-volume classification/extraction ($1/$5 per M tokens). Sonnet 5 only where reasoning quality matters (e.g., digest). This routing *is* a cost-engineering decision to narrate. |
| Structured output | **Zod schemas + Claude tool-use / JSON schema** | Forced structured output, NOT free-text JSON parsing. Schema is both the runtime validator and the TS type. This is a deliberate anti-fragility choice (see §7). |
| Auth | **Google OAuth 2.0** (`gmail.readonly` scope only) | Minimum necessary scope — a real security instinct. Read-only; the app never modifies the user's mailbox. |
| Database | **PostgreSQL** (via Railway/Render managed Postgres) | Persist classifications so reopening is instant and re-classification is never re-paid. Use Prisma or Drizzle as the ORM (Drizzle preferred for TS-native types). |
| Hosting | **Railway or Render** | Long-lived server for streaming + persistent Postgres. Single service + managed DB. |
| Repo | **Monorepo** (frontend + backend in one repo) | Simplest to run, clone, and deploy for a reviewer. |

**Model note:** verify current model IDs and pricing at build time — the API model strings and rates shift. As of writing: `claude-haiku-4-5` for classification, `claude-sonnet-5` for reasoning. Sonnet 5 has intro pricing through Aug 31 2026.

---

## 4. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│ BROWSER (React + Vite + TS)                                  │
│  - Google sign-in                                            │
│  - Dashboard (Recharts): time-cost, VIP unanswered, volume   │
│  - Bucket board: columns of email cards                      │
│  - "Add custom bucket" input → triggers live reflow          │
│  - Streams classification results in as they arrive          │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS + Server-Sent Events (streaming)
                ▼
┌─────────────────────────────────────────────────────────────┐
│ API SERVER (Node + Fastify + TS)                             │
│                                                              │
│  /auth/google        OAuth start + callback                  │
│  /api/inbox/sync     fetch last 200 threads from Gmail       │
│  /api/classify       classify (streams results via SSE)      │
│  /api/buckets        CRUD for user-defined buckets           │
│  /api/reclassify     re-run against new bucket set (streams) │
│  /api/analytics      dashboard aggregates                    │
│                                                              │
│  ├── Gmail client (googleapis)                               │
│  ├── Classification pipeline (batched Haiku calls)           │
│  ├── Analytics aggregator                                    │
│  └── Postgres (Drizzle) — users, emails, buckets, results    │
└───────────────┬─────────────────────────────────────────────┘
                │
      ┌─────────┴─────────┐
      ▼                   ▼
┌───────────┐     ┌──────────────┐
│ Gmail API │     │ Claude API   │
│ (readonly)│     │ Haiku/Sonnet │
└───────────┘     └──────────────┘
```

### Data flow, step by step
1. User signs in with Google → OAuth returns tokens → store securely (encrypted at rest or in secure session).
2. `/api/inbox/sync` pulls the last 200 threads via Gmail API. **Fetch metadata + snippet only** (subject, sender, date, snippet) — NOT full bodies. This saves tokens, speeds fetch, and is a genuine privacy point to state on camera.
3. Store raw email metadata in Postgres.
4. `/api/classify` runs the classification pipeline (batched Haiku calls) and **streams results back over SSE** as each batch completes. Persist each result.
5. Frontend renders cards into buckets as results stream in — the visible reflow.
6. On subsequent loads, results come straight from Postgres → instant, no re-classification, no re-paying.
7. User adds a custom bucket → `/api/reclassify` re-runs classification against the new bucket set, streaming results → cards animate into new positions.

---

## 5. The classification pipeline (the technical core — spend your depth here)

This is the part the assignment explicitly leaves to you ("a classification pipeline you design"), so it's where all the engineering signal lives.

### 5.1 Default buckets
Start with sensible defaults (the spec's own examples are fine): **Important**, **Can Wait**, **Newsletter**, **Auto-archive**, **Promotions**. Keep the set small and clearly distinct.

### 5.2 Batching (the core cost/quality decision)
- Classify **~15–20 emails per Claude call**, not one-at-a-time (wasteful) and not all 200 at once (the model loses track of individual items in a crowded prompt).
- Run batches **in parallel** (e.g., `Promise.allSettled`), so ~200 emails = ~10–13 concurrent calls completing in a few seconds.
- **Be ready to explain the batch-size tradeoff on camera:** larger batches = fewer calls = cheaper, but past a point the model's per-item accuracy degrades because each email gets less "attention" in a crowded context. This is a real context-engineering decision, not an arbitrary number.

### 5.3 Structured output (do NOT parse free text)
- Use Claude tool-use / JSON-schema-constrained output so each result arrives as a parsed object, not text you regex-scrape.
- Schema per email: `{ emailId, bucket (enum), confidence (0–1), justification (one short sentence) }`.
- Validate every result against a Zod schema. Anything that doesn't conform is retried once, then flagged — never silently dropped.
- **Why this matters (on-camera point):** free-text JSON parsing is fragile — models add prose, break formatting, drop fields. Forced tool-use eliminates that class of failure by construction.

### 5.4 The justification field (small feature, big payoff)
Every classification carries a one-sentence reason ("mentions a Friday deadline," "bulk sender, no personal address"). This does triple duty:
- A nice UX touch (hover/click a card to see why it landed where it did).
- A second, smaller demo "wow" moment.
- A visible demonstration of grounded, explainable AI — the reasoning is tied to something real in the email, not a black-box label. Mention on camera that this is the same instinct as requiring evidence for a claim rather than trusting the model blindly.

### 5.5 Ambiguity handling (a real design decision to showcase)
Some emails plausibly fit two buckets. Handle this deliberately:
- If the model's top-choice confidence is below a threshold (e.g., 0.6), OR two buckets score closely, mark a **secondary bucket** and surface a subtle indicator on the card.
- Do NOT silently force one answer. Being explicit about ambiguity is a strength signal — it shows you understand classification isn't always clean.

### 5.6 Custom-bucket recategorization
- When a user adds a bucket, re-run classification against the full new bucket set.
- **Design decision to state on camera:** full re-run vs. incremental. Full re-run is simpler and guarantees consistency (every email judged against the same complete bucket set); incremental is cheaper but risks inconsistency. For 200 emails at Haiku prices, full re-run is the right correctness/cost tradeoff — say so, and note that at 100k emails you'd revisit this.
- Stream results as they complete so the reflow is visible and fast.

### 5.8 Production-quality requirements for the pipeline (GRADED — not optional)
The bar explicitly checks for rate-limit and edge-case handling. The classification pipeline must have all of the following, and the code should make them visible to a reviewer reading it:
- **Rate-limit handling on Claude calls.** The Anthropic API returns 429s under concurrency. Implement exponential backoff with jitter and a bounded concurrency limit (e.g., cap simultaneous in-flight batches with a small semaphore/pool rather than firing all 13 at once). This is a specific thing a reviewer will look for — batching 200 emails naively into 13 parallel calls with no concurrency cap is exactly the "demo, not system" failure the bar calls out.
- **Retry with correction, then fail loud.** A batch that returns malformed/unvalidatable output is retried once with a corrective instruction; a second failure throws a named, logged error and marks those emails as "unclassified" in a visible state — never a silent drop, never a crash of the whole run.
- **Partial-failure isolation.** One failed batch must not fail the other twelve. Use `Promise.allSettled`, surface which emails couldn't be classified, and let the user see/retry them.
- **Empty/degenerate inputs.** Handle inboxes with <200 emails, empty inboxes, threads with no subject or no snippet, non-English content, and duplicate/near-identical bulk mail without crashing.
- **Token/size guards.** Truncate over-long snippets before batching so a single giant email can't blow the context budget or the cost.
- **Idempotency.** Re-running sync/classify shouldn't duplicate rows; key on Gmail thread/message IDs.

### 5.7 A small, real eval set (this directly answers a known interview probe)
- Hand-label 15–20 emails yourself with their "correct" bucket.
- Write a script that runs your pipeline against them and reports accuracy.
- Include it in the repo (`/eval`) and mention the number in the video.
- **Why:** the interviewers are known to probe "how do you think about evals / feedback loops." Having a real, if small, eval harness — not a hypothetical — is a strong differentiator. Bonus: describe on camera how you'd extend this into a production feedback loop (capture user corrections when they manually move an email to a different bucket → fold those into the eval set → measure regression over time).

---

## 6. The dashboard (the business-impact layer)

Built with Recharts. On load, show:
- **Inbox time-cost estimate** — assign a rough reading-minutes weight per bucket, sum it, display "~X hours of reading in this inbox." (State the assumption openly; it's an estimate, and being honest about that is fine.)
- **Attention view** — count of "Important" threads that appear unanswered (heuristic: from a real person, no sent reply in thread).
- **Volume breakdown** — emails per bucket (bar or donut).
- **Sender frequency** — top senders by volume.

Keep it clean and genuinely informative — this is where "product taste" is judged. Open the demo here, not on the email list.

### Stretch analytics (optional, clearly phased — build only after core is solid)
- Deadline/urgency detection (flag emails mentioning a date or explicit ask).
- VIP/relationship scoring inferred from reply-frequency history.
- A proactively generated weekly digest (uses Sonnet 5) — adds a genuinely *agentic/proactive* element, which is this project's one weak spot by default. Worth doing if time allows.

---

## 7. Design & UX direction

Follow these, and treat the UI as a graded surface (the assignment tests design taste):
- **Familiar inbox mental model:** each email card shows sender, subject, snippet, a colored bucket tag, and (on hover/click) its justification. Users don't need to click *into* emails (spec confirms this).
- **Bucket board layout:** columns per bucket (kanban-like) reads more "intelligent triage tool" than a flat list, and makes the reflow animation far more visually striking as cards move between columns.
- **Animate the reflow:** use a layout-animation approach (e.g., Framer Motion's layout animations) so cards smoothly transition between buckets when recategorized. This animation *is* the demo — invest in it.
- **Streaming feedback:** as first-load classification runs, cards should visibly populate/settle rather than showing a blank screen then a sudden dump.
- **Empty/loading/error states** written in the interface's own voice — clear, active, never a vague spinner. "Reading your last 200 threads…" beats a bare spinner.
- **Don't reach for the generic AI-app look** (cream background + serif + terracotta accent is an overused default). Pick a deliberate, distinct visual identity — a calm, focused, "control panel for your attention" feel suits the subject. Spend boldness in one place (likely the dashboard hero or the reflow animation); keep everything else quiet.
- **Quality floor:** responsive to mobile, visible keyboard focus, respects reduced-motion.

---

## 8. Security & privacy (real, and worth stating on camera)
- `gmail.readonly` scope only — the app can never modify or send mail.
- Metadata + snippet only; full email bodies are never sent to the LLM. This is both a token-cost win and a genuine privacy stance.
- OAuth tokens encrypted at rest / kept in secure server-side session, never exposed to the client.
- The Google app stays in "testing" mode with the developer's own account as the sole test user — correct and expected for a take-home; do not attempt Google verification.
- Note on camera what production would add: proper token refresh handling, per-user data isolation, a data-retention/deletion policy for a tool that reads someone's inbox.

---

## 8.5 App-wide production-quality checklist (GRADED — "systems not demos")

A reviewer will read the repo, not just watch the video. Hold the whole codebase to this:
- **Modular structure.** Clear separation: routes / services (Gmail client, classifier, analytics) / data layer / types. No 500-line files, no business logic in route handlers, no direct API calls scattered through the UI. A stranger should grasp the shape in minutes.
- **Linting + formatting.** ESLint + Prettier configured and passing, committed config, no lint errors in the tree. TypeScript in strict mode.
- **Typed end to end.** Shared types between frontend and backend (or a shared package). Zod schemas as the single source of truth where data crosses a boundary.
- **Error handling everywhere data crosses a boundary.** Gmail API failures (expired token, quota, network), Claude API failures, DB failures — all caught, logged, and surfaced to the UI as a clear message in the interface's own voice, never an unhandled rejection or a blank screen.
- **Gmail API rate limits & pagination.** Gmail enforces per-user quota; fetching 200 threads means paginated list + batched `get` calls. Handle 429/quota responses with backoff, and page correctly rather than assuming one response returns everything.
- **Auth edge cases.** Token expiry mid-session → refresh flow. Revoked access → clear message and re-auth path. Never leave the app in a broken half-authed state.
- **Loading, empty, and error states** for every async surface — no bare spinners, no dead ends.
- **No secrets in the repo.** `.env.example` committed with placeholders; real `.env` gitignored.
- **Sensible logging.** Structured logs on the server for the classification run (batch counts, failures, timing) — useful for the demo *and* evidence of a systems mindset.
- **A test or two where it counts.** Full coverage isn't expected in the timeframe, but a couple of unit tests on the pure logic (e.g., the analytics/time-cost aggregation, the ambiguity tie-break) signals rigor. The pipeline itself is better covered by the eval harness (§5.7) than by unit tests — and saying *why* (its behavior is model behavior, not deterministic logic) is a strong on-camera point.

---

## 8.6 AI-native speed — how to build 10x faster AND defend it (GRADED)

Tenex explicitly rewards using AI to build fast *and* penalizes not being able to explain the output. Both halves matter.

**Build fast:**
- Use Claude Code agents for scaffolding, boilerplate, the Gmail/OAuth integration, the Recharts dashboard, and the streaming plumbing. This is the expected way to build here — lean into it.

**Verify and refine (this is what's actually graded):**
- **The human must be able to explain every architectural decision** in this doc in their own words — batch size and its tradeoff, why streaming instead of background jobs, why Haiku for classification and Sonnet for reasoning, how rate limits are handled, why full re-run over incremental. If AI generated something the human can't explain, that's a gap to close *before* the interview, not a detail to gloss.
- **Review AI output, don't accept it blind.** Especially: the rate-limit/concurrency logic, the anti-hallucination validation, and anything touching auth/secrets. These are the places AI-generated code is most likely to be subtly wrong, and exactly the places a reviewer will probe.
- **Keep a short mental (or written) log of where AI got it wrong and you corrected it.** "Claude Code first wrote the classifier firing all batches at once with no concurrency cap; I added a bounded pool after seeing 429s" is a *perfect* answer to the "how did you verify and refine AI output" question — it proves you're driving the tool, not the other way around. Have two or three of these ready.

---

## 9. Build order (phases — get each solid before the next)

**Phase 1 — Skeleton & auth.** Monorepo scaffold, Fastify server, React app, Postgres connected, Google OAuth working end to end (sign in, get a token, store it). Verify you can hit the Gmail API and pull 200 threads' metadata.

**Phase 2 — Classification pipeline.** Batched Haiku classification with structured output + Zod validation + retry-once. Persist results. Prove it works with a script before wiring the UI.

**Phase 3 — Core UI.** Bucket-board layout, email cards, results rendering from Postgres. Get first-load streaming working (SSE) so cards populate live.

**Phase 4 — The two demo moments.** (a) Dashboard with the time-cost opener. (b) Custom-bucket creation → streaming reclassification → animated reflow. Polish these two hard — they carry the video.

**Phase 5 — Depth & polish.** Justification tooltips, ambiguity/secondary-bucket indicator, the eval harness + accuracy number, empty/error states, responsive/a11y pass.

**Phase 6 — Stretch (only if solid).** Deadline detection, VIP scoring, weekly digest, sender analytics.

**Phase 7 — Ship.** Deploy to Railway/Render, seed a clean demo state, write the README, record the video.

**Guidance for agents:** do not start Phase N+1 while Phase N is shaky. The committed deliverable is Phases 1–5. Phase 6 is genuinely optional — a rock-solid Phase 1–5 build beats a broken ambitious one.

**Production rigor is not a phase — it's continuous.** The §5.8 pipeline hardening and the §8.5 app-wide checklist are NOT a cleanup pass at the end. Error handling, rate-limit backoff, validation, and modular structure are written *as you build each phase*, not bolted on after. The bar weights "production quality" as heavily as the wow factor; a build that nails the two demo moments but has happy-path-only code with no rate-limit handling will read as exactly the "demo, not system" failure Tenex calls out. If time gets tight, cut a Phase 6 stretch feature — never cut the rigor.

---

## 10. Deployment

- **Host:** Railway or Render. Single Node service (serves the API; either serve the built React app from the same service or deploy the frontend as a static site pointing at the API).
- **Database:** managed Postgres on the same platform.
- **Env vars (never commit):** `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DATABASE_URL`, a session secret.
- **OAuth redirect:** register both the local dev URL and the deployed URL in the Google Cloud console.
- **Deliverable:** a live link a reviewer can open. Seed or preserve a clean, populated demo state so the live link looks good on arrival (a reviewer opening it should see a classified inbox + dashboard, not an empty sign-in with no context).
- **README must let a stranger run it in under 5 minutes:** prerequisites, env var list with instructions for getting Google OAuth creds and an Anthropic key, install/run commands, and how to run the eval script. Assume the reader is an engineer who's never seen the project.

---

## 11. The submission video (10–20 min, required structure)

The video is graded as heavily as the code. Record after the app is solid and seeded. Be yourself, no script, bring real energy (this is explicitly flagged as something that separates candidates). Required sections:

1. **Product demo (< half the video)** — open on the dashboard with the time-cost number. Show the classified bucket board. Then the headline moment: add a custom bucket, watch the live reflow. Show a justification tooltip. Frame the *why* and business impact throughout — this solves a real daily time cost.
2. **Tech stack** — what you picked and why. Hit the deliberate ones: Fastify, Haiku-for-classification/Sonnet-for-reasoning routing, forced structured output, metadata-only for privacy+cost.
3. **Architectural decisions** — the high-level design and the signals behind it: batching strategy and the size tradeoff, streaming for the live reflow, persist-to-Postgres so reopening is instant, ambiguity handling, the eval harness.
4. **Technical trade-offs** — what you chose *not* to do and why (background-job infra you deliberately skipped in favor of streaming; full re-run vs incremental recategorization), and what you'd do to production-ize: real feedback loop from user corrections into the eval set, scale past 200 threads with pagination + rate-limit handling, token-refresh and data-retention for a real inbox tool.

**On-camera discipline (important):** narrate the decisions *you* made in your own words. Since AI tooling helped build this, over-index on explaining *why* each choice was made — batch size, model routing, ambiguity threshold — rather than just describing what exists. Being able to defend a choice under a "why did you do it that way?" follow-up is exactly what's being tested.

**Weave in AI-native speed explicitly.** The bar grades whether you used AI to build 10x faster *and* can explain how you verified/refined it. Don't hide that you used AI — the opposite. Somewhere in the tech-stack or architecture section, say plainly: "I built this fast with AI tooling, and here's a case where its first output was wrong and how I caught it" (e.g., the rate-limit/concurrency example from §8.6). That single beat hits the AI-native-speed axis *and* demonstrates the rigor that separates driving the tool from being carried by it.

**Show the code, not just the running app.** Because the bar is "systems, not demos," spend part of the architecture/trade-offs sections actually showing the codebase — the modular structure, the rate-limit backoff, the validation/retry logic, the eval harness. A reviewer who hears "production quality" wants to see it, briefly, in the repo — not just take the working demo's word for it.

---

## 12. Open items for the human (answer if you have a preference; otherwise agents use the default)
- **ORM:** Drizzle (default, TS-native) vs Prisma. Either fine.
- **Frontend deploy shape:** serve React from the Node service (simplest, one URL) vs separate static deploy. Default: serve from the Node service.
- **Animation lib:** Framer Motion (default, best layout animations) vs a lighter CSS approach.
- **Visual identity:** if the human has a palette/vibe preference, use it; otherwise the agent picks a deliberate, distinct "attention control panel" direction (and avoids the generic AI-app default look).

---

## 13. The one-line north star
**This is not an email sorter. It's a tool that tells you what your inbox is costing you and lets you reshape it live — and the build exists to make two moments (the cost dashboard and the live reflow) land in a 10-minute video, backed by classification engineering the author can defend under questioning.**
