# Inbox Concierge

AI-classified Gmail inbox with a quantified-cost dashboard and live re-bucketing. Built for a job take-home — production quality is graded, not just the demo.

Full spec, architecture, and phase-by-phase plan: **@docs/BUILD_GUIDE.md** — read the relevant phase section before starting work on it. Don't re-read the whole file every session; jump to the section that matters.

## Stack
Frontend: React + Vite + TS + Tailwind + Recharts + Framer Motion.
Backend: Node + Fastify + TS, Drizzle ORM, Postgres.
LLM: Claude Haiku 4.5 (classification), Claude Sonnet 5 (reasoning features). Structured output via tool-use + Zod validation — never free-text JSON parsing.
Auth: Google OAuth, `gmail.readonly` scope only.
Host: Railway or Render.

## Commands
(fill in once scaffolded, e.g.:)
- `npm run dev` — start dev servers
- `npm run lint` — must pass before commit
- `npm run typecheck` — must pass before commit
- `npm run eval` — run the classification eval harness (docs/BUILD_GUIDE.md §5.7)

## Non-negotiable rules
- Structured output only (Claude tool-use schema), never regex-scraped free text.
- Every Claude batch call has bounded concurrency + exponential backoff — no unbounded parallel calls.
- A failed batch degrades gracefully (isolated, logged, retried once) — never crashes the whole classify run.
- Metadata + snippet only to the LLM — never full email bodies.
- No secrets committed. Real values live in `.env` (gitignored); `.env.example` stays in git with placeholders.
- Streaming (SSE), not background job infra — this is a deliberate architecture choice, don't "fix" it into a queue.

## Corrections log — maintain this automatically
Whenever any of the following happens, append an entry to **docs/CORRECTIONS_LOG.md** using the template at the top of that file — do this without being asked, as part of the work, not as a separate step:
- Code you generate fails typecheck, lint, or a test and you have to revise it.
- The human rejects or changes a plan before you execute it.
- You discover a bug or gap in your own earlier output (this session or a prior one) and fix it.
- A manual review catches something wrong that automated checks didn't (e.g., a security, cost, or correctness issue).

Keep entries factual and short. Never edit or delete a past entry — this is a running record, not a changelog to tidy up. This log is deliberately kept: the human needs real, specific "here's where AI got it wrong and I caught it" examples to speak to.

## Workflow
- Work one phase at a time (see docs/BUILD_GUIDE.md §9). Don't start the next phase until the current one is solid and committed.
- Typecheck + lint after any series of changes.
- make a new branch and commit at the end of each phase as a checkpoint and then push in that branch. 
