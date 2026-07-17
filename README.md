# Inbox Concierge

AI-classified Gmail inbox: sign in with Google, your last ~200 threads get sorted into
LLM-classified buckets (Important, Can wait, Auto-archive, Newsletter, ...), with a
time/attention dashboard on top. Add a custom bucket and every email live-reflows into the
new categories, streamed in as classification batches complete — not a spinner-then-refresh.

Built for a job take-home. Full spec, architecture, and phase-by-phase build plan:
[`docs/inbox-concierge-build-guide.md`](docs/inbox-concierge-build-guide.md). The agentic
chat panel (search inbox / pull thread detail / draft replies) is documented separately in
[`docs/AGENTIC_CHAT.md`](docs/AGENTIC_CHAT.md).

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind + Recharts + Framer Motion
- **Backend:** Node + Fastify + TypeScript, Drizzle ORM, PostgreSQL
- **LLM:** Anthropic Claude — Haiku 4.5 for classification, Sonnet 5 for reasoning features
  (structured output only, via tool-use + Zod validation, never free-text JSON parsing)
- **Auth:** Google OAuth 2.0, `gmail.readonly` scope only — the app never modifies your mailbox
- **Monorepo:** npm workspaces (`apps/web`, `apps/server`, `packages/shared`)

## Prerequisites

- Node.js 20+ and npm
- A local PostgreSQL instance (or a connection string to a hosted one)
- A Google Cloud project with an OAuth 2.0 Client ID (Gmail API enabled, `gmail.readonly` scope,
  `http://localhost:3000/auth/google/callback` as an authorized redirect URI)
- An Anthropic API key

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (classification + agent features) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From your Google Cloud OAuth client |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/auth/google/callback` for local dev |
| `DATABASE_URL` | Postgres connection string, e.g. `postgresql://localhost:5432/inbox_concierge` |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `TOKEN_ENCRYPTION_KEY` | Same command as above — separate key, encrypts OAuth tokens at rest |
| `FRONTEND_URL` | `http://localhost:5173` for local dev |
| `PORT` | Server port, defaults to `3000` |

Create the database, then run migrations:

```bash
createdb inbox_concierge   # or point DATABASE_URL at an existing/hosted instance
npm run db:migrate
```

## Running it

```bash
npm run dev
```

Starts `packages/shared` in watch mode, the Fastify API on `:3000`, and the Vite dev server on
`:5173`, all concurrently. Open `http://localhost:5173` and sign in with Google.

## Testing and verification

```bash
npm run typecheck   # tsc --noEmit across all workspaces
npm run lint         # eslint .
npm run test          # node --test over apps/server/src/**/*.test.ts
```

### Classification eval harness

Runs the real classification pipeline against a hand-labeled fixture set and reports accuracy
(overall, per-bucket, and a table of misses). Cost-safe by default — dry run only, $0 spent,
unless you pass `--confirm`.

```bash
npm run eval                # dry run: cost estimate only
npm run eval -- --confirm   # actually classify (~$0.005 for 18 fixtures)
```

### Manual pipeline scripts

Proof scripts used during development to exercise the classification and agent pipelines
directly, before/without the UI. Also cost-safe by default (dry run unless `--confirm`).

```bash
# Classify an already-synced user's inbox end-to-end (bucket counts, sample justifications, cost/timing)
npm run classify:dev
npm run classify:dev -- --confirm
npm run classify:dev -- --confirm --email you@example.com

# Run one turn of the agentic chat against a synced, classified inbox
npm run agent:dev -- --query "emails from Sarah about the contract"
npm run agent:dev -- --query "actually the one about the lease" --history .agent-history.json
```

## Project structure

```
apps/web         React + Vite frontend (dashboard, bucket board, chat panel)
apps/server      Fastify API — auth, Gmail sync, classification, analytics, agent
packages/shared  Types/schemas shared between web and server
docs/            Build guide, agentic chat spec, corrections log
```

## Deployment

Deployed on Railway as a single service (`railway.json`): the build compiles
`packages/shared` → `apps/web` → `apps/server`, and the server serves the built frontend
statically alongside the API. Requires the same environment variables as above (with
`GOOGLE_REDIRECT_URI` and `FRONTEND_URL` updated to the deployed domain) plus a managed
Postgres instance's `DATABASE_URL`.

## Non-negotiable design constraints

- Structured output only (Claude tool-use + Zod), never regex-scraped free text from the model.
- Every Claude batch call has bounded concurrency and exponential backoff — no unbounded parallel calls.
- A failed classification batch is isolated, logged, and retried once — it never crashes the whole run.
- Only email metadata + snippet are sent to the LLM — never full email bodies.
- Streaming (SSE) is a deliberate architecture choice for live re-bucketing, not background job infra.
- The agentic chat panel is read-only and draft-only — no send capability, no broader OAuth scope.
