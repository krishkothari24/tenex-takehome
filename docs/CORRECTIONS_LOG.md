# AI Corrections Log

A running record of every place Claude Code's first output was wrong, incomplete, or risky — and how it got caught and fixed. Kept specifically to answer the interview question "how did you verify and refine AI output" (see docs/BUILD_GUIDE.md §8.6) with real, specific examples instead of a hypothetical.

**Rules for this file:**
- Append only. Never edit or delete a past entry, even if it looks minor in hindsight.
- Short and factual. This is a log, not a narrative.
- One entry per incident, in the format below.
- Ordered chronologically — newest at the bottom.

---

## Entry template (copy this for each new entry)

```
### [Phase X] — <short title> — YYYY-MM-DD
**What Claude Code generated first:**
<one or two sentences>

**What was wrong / the risk:**
<one or two sentences>

**How it was caught:**
<typecheck failure | lint failure | test failure | manual review | runtime error | human rejected the plan>

**The fix:**
<one or two sentences>

**Why it matters:**
<tie to production-quality / rate-limits / security / correctness / cost — whichever applies>
```

---

## Entries

### [Phase 1] — Pinned "latest" tool versions crashed the lint toolchain — 2026-07-14
**What Claude Code generated first:**
Root `package.json` pinned every dependency to the newest npm registry version at build time, including `typescript@7.0.2` and `eslint@10.7.0`.

**What was wrong / the risk:**
`typescript-eslint@8.64.0`'s peer range is `typescript >=4.8.4 <6.1.0`, so TS 7.0.2 crashed `eslint .` with an internal `Cannot read properties of undefined (reading 'Cjs')` error. Separately, `eslint-plugin-react@7.37.5`'s peer range tops out at `eslint ^9.7`, so ESLint 10 crashed a second time with `contextOrFilename.getFilename is not a function` while linting a React file. "Newest version" was not the same as "newest version the toolchain actually supports."

**How it was caught:**
Runtime error — `npm run lint` threw an unhandled internal exception (not a normal lint failure) on the first run, and again after the first fix, when actually exercising the command rather than just checking `npm view` version numbers.

**The fix:**
Downgraded `typescript` to `6.0.3` (the newest release still inside typescript-eslint's supported range) and `eslint`/`@eslint/js` to `9.39.5` (newest release inside eslint-plugin-react's and eslint-plugin-jsx-a11y's supported range). Also needed `npm install --legacy-peer-deps` since `eslint-plugin-jsx-a11y@6.10.2` hasn't published a peer range covering ESLint 9/10 at all yet, despite working fine in practice.

**Why it matters:**
Production quality means the lint gate actually runs, not just that package.json looks current. Verifying a toolchain by executing it (not just checking that each package's version number resolves) caught two separate crash-level incompatibilities before they became "lint is silently broken" for the rest of the build.

### [Phase 1] — dotenv default lookup broke for workspace-run scripts — 2026-07-14
**What Claude Code generated first:**
`apps/server/src/config/env.ts` and `apps/server/drizzle.config.ts` both used `import 'dotenv/config'`, which loads `.env` relative to `process.cwd()`.

**What was wrong / the risk:**
Both files are only ever run via `npm run <script> -w apps/server`, which sets `cwd` to `apps/server`, not the repo root where the actual `.env` lives. The server booted with every env var reported as missing, and `drizzle-kit migrate` failed with "Please provide required params for Postgres driver: url: undefined" even though `.env` existed and was fully populated.

**How it was caught:**
Runtime error on first `npm run db:migrate` and first `npm run dev` — env validation failed loud (by design), which is what surfaced the misconfiguration immediately instead of silently reading undefined values.

**The fix:**
Both files now resolve the repo-root `.env` path explicitly from `import.meta.url` (`dotenv.config({ path: ... })`) instead of relying on `dotenv/config`'s cwd-relative default, so it works regardless of which workspace script invoked the process.

**Why it matters:**
This is exactly the kind of "works on the author's machine, breaks for anyone who runs it differently" bug the production-quality bar calls out — caught by actually running the commands end-to-end rather than trusting that the code compiled.

### [Phase 2] — Cost-guardrail `--confirm` flag was swallowed by the root npm passthrough — 2026-07-14
**What Claude Code generated first:**
The classify/eval scripts gate real API spend behind a `--confirm` flag (dry-run by default), and the root `package.json` aliased them as `npm run eval -w apps/server` (and likewise `classify:dev`).

**What was wrong / the risk:**
`npm run eval -- --confirm` forwarded `--confirm` to the *inner* `npm run eval -w apps/server`, where npm consumed it as an unknown CLI config (`npm warn Unknown cli config "--confirm"`) instead of passing it to the script. The confirmed/paid path silently ran as a dry run. For a spend gate this is a real hazard in either direction — a `--confirm` that's silently dropped (or, worse, silently honored) defeats the guardrail.

**How it was caught:**
Runtime — running the dry-run kill-switch verification end-to-end and noticing the output said "Dry run — no API calls made" even though `--confirm` was passed. Typecheck/lint could never have caught this.

**The fix:**
Appended a trailing `--` to the root passthrough scripts (`npm run eval -w apps/server --`) so npm forwards user args into the workspace script; re-ran and confirmed `--confirm` now reaches the script.

**Why it matters:**
The entire cost-guardrail story depends on `--confirm` actually being honored. A flag that's silently dropped by an npm-nesting quirk makes the safety gate meaningless, and only executing the command (not reading it) surfaced it.

### [Phase 2] — Eval report called `.toFixed()` on a nullable confidence — 2026-07-14
**What Claude Code generated first:**
`run-eval.ts` formatted predicted confidences as `predicted.confidence.toFixed(2)` (and the same in the ambiguous-items loop).

**What was wrong / the risk:**
The shared `EmailClassification.confidence` is `number | null` — it is null for the `unclassified` state (a failed batch). So the report would throw at runtime precisely on an unclassified result, i.e. on the failure branch §5.8 requires to degrade gracefully rather than crash.

**How it was caught:**
Typecheck (`TS18047: 'predicted.confidence' is possibly 'null'`).

**The fix:**
Null-guarded both call sites (`confidence != null ? \` conf=${…}\` : ''`).

**Why it matters:**
A null-unsafe formatter on the unclassified path would crash the eval/report on the very case the pipeline is designed to surface safely — the strict-mode + `noUncheckedIndexedAccess` config paid for itself here.

### [Phase 3] — Mount effect double-fired the classify SSE call — 2026-07-15
**What Claude Code generated first:**
`App.tsx`'s sign-in effect (`useEffect(() => { if (!user) return; void loadBoard(); }, [user])`) called `loadBoard()` directly, which — when a synced-but-unclassified inbox is detected — kicks off `POST /api/classify`, a real, billable Anthropic API run.

**What was wrong / the risk:**
React StrictMode (enabled in `main.tsx`) intentionally double-invokes mount effects in dev to surface non-idempotent side effects. With no de-dupe guard, the effect fired `loadBoard()` twice on first mount, and the client-side `useClassifyStream` hook's `abortRef.current?.abort()` only cancels the *first* fetch client-side after the *second* has already been issued — both `POST /api/classify` requests actually reach the server. In dry-run this is free; with a real API key it would mean two concurrent `classifyEmails()` runs against the same inbox, i.e. ~2x real spend for one page load (idempotent persistence means the data ends up correct, but the tokens are still paid for twice).

**How it was caught:**
Manual review — verifying the Phase 3 SSE flow end-to-end with Playwright against a throwaway test user (`CLASSIFIER_DRY_RUN=true`, $0 cost) and inspecting the network log showed `GET /api/emails`, `GET /api/buckets`, and `POST /api/classify` each fired exactly twice on first load. Not caught by typecheck or lint — this is a runtime effect-timing bug, invisible in the diff.

**The fix:**
Added a `useRef<string | null>` (`bootstrappedForUserId`) keyed on the signed-in user's id; the mount effect no-ops if it has already bootstrapped for that user, so StrictMode's remount is a cheap no-op instead of a second real network flow. Re-verified with the same Playwright + dry-run setup: each route now fires exactly once.

**Why it matters:**
This is the same class of issue as the Phase 2 concurrency-cap correction (§8.6's canonical example) — the AI-generated code was structurally reasonable but hadn't been exercised against a real render lifecycle where "the effect can legitimately run twice" matters, and here that gap would have doubled real classification spend, not just wasted a network call.

### [Phase 4] — Time-cost dashboard tile planned as a hardcoded per-bucket table — 2026-07-15
**What Claude Code generated first:**
The Phase 4 plan's time-cost dashboard metric ("~X hours of reading") was designed around a static constant, `BUCKET_MINUTES_PER_EMAIL: Record<string, number>` (e.g. "Important = 3 min, Promotions = 0.25 min"), summed per bucket.

**What was wrong / the risk:**
A hardcoded lookup table is exactly the kind of arbitrary, non-AI-native shortcut the build guide's own framing ("genuine LLM-engineering depth over feature count") argues against — especially in a codebase whose entire premise is an LLM classification pipeline that already reads every email's actual content. The number would have been a bucket-level guess, not grounded in what a given email actually says.

**How it was caught:**
Human rejected the plan before execution — "why not have an agent make the decision... rather than having the minutes hardcoded."

**The fix:**
Redesigned so the classifier estimates `estimatedReadMinutes` per email as one more field in the same batched Haiku tool-use call that already classifies each email (prompt.ts, validation.ts's Zod schema with a `[0,30]` value guard, threaded through `EmailClassification`, persisted on `classification_results`). Zero extra API calls; the dashboard now sums/averages real per-email model output instead of a static table.

**Why it matters:**
This is precisely the "verify and refine AI output" story the build guide asks candidates to have ready — the first plan was structurally reasonable but settled for a cheaper, less-grounded design when the harder, more AI-native version was available at no extra cost.

### [Phase 4] — Assumed a missing FK cascade on `classificationResults.bucketId` — 2026-07-15
**What Claude Code generated first:**
While reasoning about why bucket deletion wasn't wired up, the plan asserted `classificationResults.bucketId`'s foreign key had no `onDelete` clause, so deleting a bucket would throw a Postgres FK violation.

**What was wrong / the risk:**
Reading `db/schema.ts` directly showed `bucketId` already has `onDelete: 'cascade'` — deleting a bucket would silently cascade-delete its emails' classification rows, not throw. The initial claim was an assumption made without reading the file, and would have been a wrong "reason it's safe not to build delete" if repeated uncorrected.

**How it was caught:**
Manual review — reading the actual schema file before finalizing the plan, rather than trusting the first-pass reasoning about FK behavior.

**The fix:**
Corrected the plan's stated rationale to reflect the real cascade behavior before any code was written; bucket deletion remains out of scope for Phase 4 (not required by the assignment), but the documented reasoning is now accurate.

**Why it matters:**
A plan's claims about existing code are only as good as whether they were actually verified against the file — this is the same "read it, don't guess it" discipline the production-quality bar expects from the code itself.

### [Phase 4] — `exactOptionalPropertyTypes` rejected `exit={undefined}` when adding reduced-motion support — 2026-07-15
**What Claude Code generated first:**
Adding a `useReducedMotion()` gate to `EmailCard.tsx`'s Framer Motion props, the exit animation was written as `exit={reduceMotion ? undefined : { opacity: 0 }}`.

**What was wrong / the risk:**
The repo's `tsconfig` has `exactOptionalPropertyTypes: true`, under which explicitly passing `undefined` to an optional prop is a different (rejected) type than omitting the prop entirely — `tsc` failed with `Type 'undefined' is not assignable to type 'TargetAndTransition | VariantLabels'`.

**How it was caught:**
Typecheck (`npm run typecheck -w apps/web`).

**The fix:**
Changed the reduced-motion branch to a no-op transition (`{ opacity: 1 }`) instead of `undefined`, so the prop's type is always a valid `TargetAndTransition`.

**Why it matters:**
Small, mechanical, and exactly what strict compiler flags are for — caught before it ever reached a browser, consistent with this repo's pattern of `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` paying for themselves (see the Phase 2 nullable-confidence entry above).

### [Phase 5] — `apps/web` typecheck failed against a stale `packages/shared/dist` after adding `isAmbiguous` — 2026-07-15
**What Claude Code generated first:**
Added `isAmbiguous` to `emailWithClassificationSchema` in `packages/shared/src/schemas/inbox.ts` and immediately ran `npm run typecheck` from the repo root.

**What was wrong / the risk:**
`apps/web` resolves `@inbox-concierge/shared` against the workspace's built `dist/` output, not `src/` directly, so `EmailCard.tsx`'s new `email.isAmbiguous` read failed with `TS2339: Property 'isAmbiguous' does not exist` even though the source schema was already correct — the compiled type declarations just hadn't been regenerated yet. Easy to misdiagnose as a bug in the new frontend code instead of a stale build artifact.

**How it was caught:**
Typecheck (`npm run typecheck`), then traced the mismatch back to `packages/shared/dist/schemas/inbox.d.ts` still reflecting the pre-edit schema.

**The fix:**
Ran `npm run build -w packages/shared` to regenerate `dist/` before re-running typecheck across the monorepo; passed clean afterward. No source code changed.

**Why it matters:**
A monorepo workspace boundary (`src` vs. built `dist`) can produce a typecheck failure that looks like an application bug but is actually a build-order gotcha — worth remembering (and worth eventually scripting as a `pretypecheck` step) any time a shared-package schema changes.

### [Phase 6] — Dry-run verification wiped 200 real classification rows — 2026-07-15
**What Claude Code generated first:**
To verify the new `hasDeadline`/`deadlineText` fields flowed through the pipeline at $0 before spending real money, ran `CLASSIFIER_DRY_RUN=true npm run classify:dev -w apps/server -- --confirm` directly against the dev database.

**What was wrong / the risk:**
The dry-run kill switch's documented behavior (`config.ts`'s `isDryRun()`, `pipeline.ts:120-142`) is to mark *every targeted email* `unclassified` in the DB — that's how it "exercises the plumbing" at zero API cost. The database already held 200 real, previously-classified emails (real bucket assignments, confidences, justifications) for the signed-in user. The command was run without first checking whether the target database held real, non-disposable data — it overwrote all 200 rows to `status: 'unclassified'`, discarding every existing classification.

**How it was caught:**
Manual review — querying `classification_results` immediately after the dry run and seeing `{status: 'unclassified', count: 200}` where a healthy distribution across buckets was expected.

**The fix:**
Attempted an immediate real (`--confirm`, no dry-run) re-classify to regenerate the lost data, which surfaced a second problem: `ANTHROPIC_API_KEY` in `.env` is empty (0 characters) in this sandbox, so the classifications cannot currently be regenerated at all. The 200 `emails` rows (subject/snippet/sender/etc.) are untouched and intact — only the derived `classification_results` were lost, and they are re-derivable once a real key is available. Flagged directly to the human rather than continuing to build on top of it; did not attempt any further workaround (e.g. fabricating placeholder classifications) that would mask the data loss.

**Why it matters:**
`git status` before a destructive git command is the established habit for code; this is the same discipline applied to a database — check what a "$0, safe, exercises the plumbing" command actually does to *existing* data before running it against anything that isn't disposable seed data. A dry-run flag lowering *API* cost to zero does not mean the command is non-destructive to the database.

### [Phase 7] — Live reclassify never updated a card's deadline badge in the UI — 2026-07-15
**What Claude Code generated first:**
Phase 6's `App.tsx` classify-stream merge effect (`prev.map(...)` around the `isAmbiguous` field) copied `bucket`, `secondaryBucket`, `confidence`, `justification`, `status`, and `isAmbiguous` from each incoming `EmailClassification` onto local email state, but not `hasDeadline`/`deadlineText` — even though those fields were added to the same `EmailClassification` type in that same phase.

**What was wrong / the risk:**
A live classify or reclassify run would persist the new `hasDeadline`/`deadlineText` correctly to Postgres (via `upsertClassification`) and the SSE event carried the right values, but the deadline badge on `EmailCard` wouldn't update until the next full page reload (`GET /api/emails`) — the exact "looks right in the DB, wrong on screen" gap a reviewer reading the diff wouldn't catch either, since the merge effect's shape looked complete at a glance.

**How it was caught:**
Discovered while building Feature 1's sender-rule-application path, which emits a synthetic `batch` SSE event carrying a ruled email's *existing* `hasDeadline`/`deadlineText` so the board can show it without a reload — tracing that path through the merge effect surfaced that the two fields were never being read from `update` at all.

**The fix:**
Added `hasDeadline: update.hasDeadline` and `deadlineText: update.deadlineText` to the merge effect's returned object, so both live classify and reclassify runs update the badge immediately, matching every other classification-derived field.

**Why it matters:**
The same "verify by tracing an actual data path end to end" discipline that caught the Phase 3 StrictMode double-classify bug — a field added to a shared type doesn't automatically reach every consumer of that type, and nothing short of tracing a concrete new code path (here, the sender-rule feature) surfaced that this one had been silently dropped since the field was introduced.
