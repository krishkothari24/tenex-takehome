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

### [Phase 7] — `client.messages.create()` had no error handling for a depleted Anthropic credit balance — 2026-07-15
**What Claude Code generated first:**
`classifyBatch` (classifier/batch.ts) and `generateDigest` (digest/generate.ts) each called `client.messages.create(...)` with no surrounding try/catch — only the downstream Zod validation was wrapped. A billing/auth-level SDK error (e.g. a depleted credit balance) would throw straight out of the function unhandled instead of going through the existing corrective-retry or partial-failure-isolation paths.

**What was wrong / the risk:**
For classification specifically, this meant every concurrent batch would independently hit the same wall and pay for the same doomed API round trip, then report N near-identical "batch failed" messages with the raw SDK error text instead of one clear, actionable top-level error — the exact opposite of CLAUDE.md's "failed batch degrades gracefully" intent, since a depleted balance is an account-level condition, not a per-batch data problem.

**How it was caught:**
Manual review, prompted by a user question about billing behavior (does it keep charging, what error comes back) — tracing the actual call sites showed the `messages.create()` call itself sat outside every try/catch in both files.

**The fix:**
Added `isInsufficientCreditsError()` (classifier/anthropic.ts, checks the SDK's `.type === 'billing_error'` with a message-text fallback) and a dedicated `InsufficientCreditsError`. Both call sites now catch the API call specifically, skip the pointless corrective retry, and throw immediately. `classifyEmails` short-circuits any batch not yet started once one batch hits this error and propagates it as a whole-run failure (`INSUFFICIENT_CREDITS` SSE code) rather than N duplicate per-batch failures; the digest route does the same.

**Why it matters:**
Matches CLAUDE.md's non-negotiable on graceful batch degradation, and turns an opaque "classification failed" wall of red text into one clear, actionable message telling the user exactly what happened and what to do about it — without wasting API round trips on calls already known to fail.

### [Phase 8] — Signed-out visitors got stuck on "Checking your inbox…" forever — 2026-07-15
**What Claude Code generated first (pre-existing, found during this phase's own verification, not part of this phase's diff):**
`App.tsx`'s top-level render gate was `if (loading || phase === 'checking') return <Checking...>`. `phase` starts at `'checking'` and only ever advances via `loadBoard()`, which the bootstrap effect calls exclusively when `user` is truthy.

**What was wrong / the risk:**
For a signed-out visitor, `user` never becomes truthy, so `loadBoard()` never runs and `phase` never leaves `'checking'` — even after `useSession`'s `loading` correctly resolves to `false` on the 401 from `/auth/me`. The "Sign in with Google" button (gated behind a separate `if (!user)` check further down) was unreachable code for that entire user segment. Every prior manual test session had a real signed-in cookie already in the browser, so this path was never exercised.

**How it was caught:**
Manual browser verification (Playwright) for this phase's own changes — driving a cold, cookie-less load of the app to confirm no runtime errors surfaced this instead: the page was stuck on "Checking your inbox…" with zero console/page errors. Instrumented `useSession`'s `refresh()` with temporary diagnostic logging to confirm `loading` did reach `false` and `user` did reach `null`, proving the bug was in the render gate's `phase` check, not the session hook.

**The fix:**
Split the single `if (loading || phase === 'checking')` gate into three ordered checks: `loading` alone, then `!user`, then `phase === 'checking'` (now only reachable for a signed-in user whose `loadBoard()` hasn't resolved yet — a narrow, real window, not a permanent trap).

**Why it matters:**
A first-time or signed-out visitor is the very first impression of the app, and this bug meant that impression was a permanently frozen loading screen with no way forward — the kind of gap that's invisible in every "already logged in" dev session (including the human's own prior local testing) and only surfaces by deliberately testing the unauthenticated path.

### [Phase 8] — Dragging an email card also dragged its whole column, and collapsing a bucket flashed full-width before truncating — 2026-07-15
**What Claude Code generated first:**
`BucketBoard.tsx` nested each `EmailCard` (its own `motion.article` with `drag` + `useDragControls`, started from a grip handle via `onPointerDown={(e) => dragControls.start(e)}`) directly inside a `Reorder.Item` (column-level drag-to-reorder) that used Framer Motion's default `dragListener={true}` and default `layout={true}`.

**What was wrong / the risk:**
`Reorder.Item`'s default `dragListener` makes the *entire column box* listen for pointerdown, so grabbing an email card's grip handle — a descendant DOM node — also armed the column's own drag-to-reorder gesture; the whole bucket column would move instead of (or along with) the single email. `e.stopPropagation()` in the card's handler wouldn't have reliably fixed this either, since `Reorder.Item`'s pan recognizer is a native `addEventListener` on an ancestor node that fires during real DOM bubble phase before React's synthetic dispatch reaches a handler that far up the tree. Separately, `Reorder.Item`'s default full `layout` animation FLIPs *size* as well as position; collapsing a column is a plain Tailwind width-class swap (`w-72` → `w-20`) with the email list unmounting instantly, so the DOM/CSS (and its `truncate` text) snapped to the narrow layout immediately while the ancestor `Reorder.Item`'s FLIP correction was still visually animating the box back down from its old expanded size — the column appeared to stay full width, then the already-truncated text caught up, reading as "expands then ellipses."

**How it was caught:**
Human manual testing after the Phase 8 commit ("the moving of each individual email sucks... the whole bucket moves with it... the collapsing... expands on the screen but then it becomes ellipses").

**The fix:**
Extracted a `DraggableBucketColumn` wrapper that owns a per-column `dragControls`, sets `dragListener={false}` + `layout="position"` on `Reorder.Item`, and only starts the column drag from a dedicated grip handle in the column header (mirroring the existing `EmailCard` handle pattern) — structurally non-overlapping gesture zones instead of racing propagation order. Also added `min-w-0` to the truncated bucket-name `<span>` (a flex item missing the override needed for `truncate` to actually constrain instead of fight its flex parent) and a `transition-[width]` on the column for a smooth, non-Framer-animated collapse.

**Why it matters:**
Both bugs shipped in a commit whose own message claimed "UX polish from first local test pass" — a reminder that "I clicked around and it looked fine" doesn't cover drag gestures or FLIP-animation timing, which only surface under an actual pointer-drag interaction or a fast collapse/expand toggle, not a static screenshot.

### [Phase 4, reversed] — Inbox time-cost dashboard tile removed as a product decision — 2026-07-16
**What Claude Code generated first:**
Phase 4 built the "~X hours of reading" hero stat (`TimeCostHero.tsx`, `analytics/time-cost.ts`, and the `estimatedReadMinutes` field the classifier estimates per email end-to-end through the prompt, DB column, and shared schema), per the build guide's explicit framing of it as the dashboard's headline "wow" moment.

**What was wrong / the risk:**
Not a bug — a human product judgment call after using the app: the human found the stat overemphasized relative to what it actually conveys (an LLM's per-email guess summed into one number, with no action attached to it), and asked that it be removed entirely rather than reframed or demoted.

**How it was caught:**
Human rejected a previously-shipped plan/feature during manual use of the app.

**The fix:**
Removed `estimatedReadMinutes` end-to-end: the classifier prompt/tool-schema/validation no longer ask for or accept it, the DB column was dropped via a new migration (`0006_drop_estimated_read_minutes.sql`), the shared `emailClassificationSchema`/`dashboardAnalyticsSchema` no longer carry it, the analytics service no longer aggregates it, and the dashboard no longer renders `TimeCostHero`. `AttentionStat` now leads the dashboard's stat row.

**Why it matters:**
A stat that's technically correct but doesn't drive any action is still a cost — it's dashboard real estate, prompt tokens, a DB column, and a response field that all have to stay correct for a claim nobody acts on. Worth cutting once real usage shows it isn't earning its place, even when a planning doc had originally called it out as the centerpiece.

### [Phase 8, plan mode] — Human rejected the white-space-below-the-fold diagnosis; re-investigation confirmed the original fix was right — 2026-07-16
**What Claude Code generated first:**
A plan to fix "white space below the fold on the Board tab" by repairing a malformed CSS comment in `apps/web/src/styles/index.css` (an unclosed `/*` was swallowing the file's `html, body { background-color: #020617 }` rule into a dead comment), based on a static code read plus an Explore-agent sweep.

**What was wrong / the risk:**
The human rejected this plan outright ("all that will do is just make the page below the fold blue... you need to understand the deeper idea... some height restriction on the board and inner elements"), convinced the real bug was a height-capped/clipped container, not a missing background color.

**How it was caught:**
Human rejected the plan before execution (`ExitPlanMode` denied). Re-investigated with a second independent full codebase sweep (confirmed zero `overflow: hidden` and no fixed/capped height anywhere in the ancestor chain — the theorized clipping container didn't exist), then used `AskUserQuestion` to pin down the actual runtime behavior: DevTools showed no element in the blank area, it appeared regardless of content length, but only *while actively scrolling/overscrolling past the true bottom of the page*, snapping back at rest. That combination is the exact signature of browser rubber-band overscroll, not a layout bug — confirming the original diagnosis was correct all along, and `#020617` is Tailwind's literal `slate-950` (matches the rest of the theme, not a mismatched blue).

**The fix:**
Re-submitted the same CSS fix, this time with the reasoning made explicit in the plan (tied directly to the human's own DevTools observations) so it was legible why a background-color rule fixes a "not part of the DOM" gap. Separately, also found and fixed a real, previously-unverified bug in the same area: cross-bucket email drag-and-drop was silently broken because `BucketBoard.tsx`'s `document.elementFromPoint` hit-test always resolved to the dragged card itself (elevated via `whileDrag`'s `zIndex`), never the destination column beneath it — fixed by toggling `pointerEvents: 'none'` on the dragged card during the hit-test window (`EmailCard.tsx`), plus switching the source column's list wrapper from `overflow-y-auto` to `overflow-visible` while a card from it is mid-drag (it was implicitly clipping horizontally too, per the CSS overflow spec's visible/non-visible axis-pairing rule).

**Why it matters:**
A confident-sounding human rejection ("you need to understand the deeper idea") isn't automatically correct — re-verifying against the actual code and, when that still disagreed with the human's mental model, asking targeted runtime questions rather than either blindly complying or blindly re-asserting, resolved the disagreement with evidence instead of a second guess. The drag-and-drop bug was verified end-to-end via a temporary Playwright harness (real `BucketBoard`/`EmailCard` components, real pointer-drag simulation, real `elementFromPoint` hit-testing in a headless browser) rather than by reading the fix and assuming it worked, since the original bug itself was invisible to static review and only surfaced under an actual drag gesture.

### [Phase 9a, plan mode] — `docs/AGENTIC_CHAT_PLAN.md`'s `search_emails` spec assumed an unread field that doesn't exist — 2026-07-16
**What Claude Code generated first:**
`docs/AGENTIC_CHAT_PLAN.md` (written in an earlier session) specified `search_emails`'s filters as including `unread_only`, alongside keyword/bucket/sender/limit.

**What was wrong / the risk:**
The `emails` table has no read/unread field at all, and never had one — Gmail label sync was never built; only `messageCount`/`hasReplyFromUser` exist as an "unanswered" heuristic, which is a different signal (whether the user replied, not whether the thread is unread). Building `search_emails` to spec as written would have meant either silently no-op'ing the filter or faking it with the wrong signal.

**How it was caught:**
Manual review while planning Phase 9a — cross-checking the plan doc's tool spec against the actual Drizzle schema (`apps/server/src/db/schema.ts`) before writing any code, rather than trusting the plan doc as ground truth.

**The fix:**
Asked the human directly; they chose to add real Gmail unread sync rather than fake or drop the filter. Added a genuine `isUnread` boolean column (nullable, backfilled on next sync, same shape as the existing `messageCount`/`hasReplyFromUser` precedent), computed from Gmail's `UNREAD` label (`gmail-client.ts`, zero extra API calls since `labelIds` is already returned under `format: 'metadata'`), wired through `upsertEmail` and the `/api/inbox/sync` route, migrated via `drizzle-kit generate`/`migrate`, and only then built `search_emails`'s `is_unread` filter against the real column.

**Why it matters:**
A planning document is not automatically ground truth about the current codebase, even when it was itself the product of prior research — the same "read it, don't guess it" discipline that applies to reasoning about existing code (see the Phase 4 FK-cascade entry above) applies just as much to a spec document proposing new code. Verified against real data end-to-end afterward: re-synced the live Gmail account, confirmed a realistic unread/read split (57 unread / 143 read of 200), and exercised the filter through a live `search_emails` call ("Do I have any unread emails from Palantir?" correctly returned only the 4 real unread Palantir threads).

### [Phase 9c] — `onToolResult` callback tried to forward a `clarify` payload as a top-level SSE frame — 2026-07-16
**What Claude Code generated first:**
Adding the `ask_clarifying_question` tool, `stream-route.ts`'s existing `onToolResult` callback (`if (outcome.uiEvent) send(outcome.uiEvent)`) was left unchanged even though `ToolDispatchOutcome.uiEvent` was widened from a `draft`-only shape to a `draft | clarify` union.

**What was wrong / the risk:**
`clarify` was designed to surface only inside the final `done` frame (`done.clarify`), not as its own SSE event type — `AgentStreamEvent`'s discriminated union has no top-level `clarify` variant. The unchanged callback would have tried to `send({ type: 'clarify', ... })` as an intermediate frame the moment the tool was dispatched, which doesn't match the wire schema at all.

**How it was caught:**
Typecheck (`tsc`): `Type '{ type: "clarify"; ... }' is not assignable to parameter of type '{ type: "started" } | ... | { type: "error"; ... }'` — the widened union was no longer assignable to `send()`'s parameter type, since `send` is typed against `AgentStreamEvent`.

**The fix:**
Narrowed the callback to `if (outcome.uiEvent?.type === 'draft') send(outcome.uiEvent)` — only `draft` gets an intermediate frame ahead of `done`; `clarify` is read directly off `result.clarify` and spread into the single `done` frame once the turn actually ends (loop.ts's early-return path).

**Why it matters:**
A one-line type widening (`uiEvent`'s union) had a call site three files away that assumed the old, narrower shape — exactly the class of bug strict typechecking across workspace boundaries is meant to catch before it becomes a runtime protocol mismatch between server and client.

### [Phase 8, regression] — Bucket columns' flat `max-h-[70vh]` cap trapped email lists in a nested scrollbar — 2026-07-16
**What Claude Code generated first:**
Phase 8's `BucketBoard.tsx` capped each column's email list at `max-h-[70vh] overflow-y-auto`, sized against the *full* viewport height, to satisfy that phase's actual goal: a newly created bucket should land beside the others in the horizontal row, never wrap to a new row and push the page down.

**What was wrong / the risk:**
The header above the columns (title bar, view tabs, sync button, search input, create-bucket form, rule-suggestion banner, status line) grew across later phases (9a/9b added the chat tab, "Check for new emails" button, more status text). Once that header's real height plus a column's flat 70vh exceeded one screen, the outer page became scrollable (`min-h-screen` is a minimum, not a clip) — but each column's email list was still capped at the same fixed 70vh regardless of where it sat on the page. Scrolling the page no longer revealed more of a column's content; users had to separately scroll *inside* the column box to see the rest — a confusing nested-scroll trap the human reported as "content just capped" even though there was visibly more room on the page.

**How it was caught:**
Human report during manual use, initially attributed (reasonably) to the `<main className="min-h-screen">` wrapper. Investigated via `git log -p` blame on both `min-h-screen` (pre-existing since Phase 3, unrelated) and `max-h-[70vh]` (introduced in the actual Phase 8 commit, `908521c`) before proposing a fix; `AskUserQuestion` surfaced that the real Phase 8 intent was narrower than "the page must never scroll" — only new *buckets* must join the row, not new *content* height.

**The fix:**
Removed the per-column `max-h-[70vh]`/`overflow-y-auto` cap entirely in `BucketColumn` — columns now grow with their content and the whole page scrolls normally as one document, single scrollbar. That also made the `draggingEmailId`-driven `overflow-visible`/`overflow-y-auto` toggle (and the `onDragStart`/`onEmailDragStart` plumbing that fed it, spanning `BucketBoard.tsx` and `EmailCard.tsx`) fully dead code — the only thing that ever read `draggingEmailId` was the now-removed ternary — so removed that plumbing too rather than leave a write-only state variable behind. Verified with a temporary Playwright harness rendering `BucketBoard` directly with 25 fixture emails in one bucket (bypassing Google OAuth): before the fix the column stayed fixed at 70vh with its own scrollbar; after, the column's real height matched its content (2774px in a 700px-viewport test) and scrolling the page revealed the rest of the list, with zero console errors. Harness files were temporary and removed afterward.

**Why it matters:**
The horizontal-row constraint from Phase 8 was correct and is untouched; the vertical cap bolted onto the same commit was solving a problem — "never let the page scroll" — that was never actually the requirement, and it silently broke as soon as unrelated later phases grew the header. A fix's blast radius is worth checking for now-dead code (here, an entire drag-tracking mechanism) rather than just patching the one line that was reported broken.

### [Deploy] — Railway auto-detected two services for a monorepo that's actually one deploy unit — 2026-07-16
**What Claude Code generated first (not code — a first deploy attempt via Railway's "Deploy from GitHub repo" wizard):**
Nothing generated by Claude Code directly; Railway's own auto-detection created two separate services, `@inbox-concierge/web` and `@inbox-concierge/server`, each building only its own workspace (`npm run build --workspace=@inbox-concierge/<name>`).

**What was wrong / the risk:**
Two problems compounded. First, neither build command built `packages/shared` first, so both failed identically on `Cannot find module '@inbox-concierge/shared' or its corresponding type declarations'` — the same class of monorepo build-order gotcha as the Phase 5 stale-`dist` corrections-log entry, just surfacing in a build pipeline instead of a local typecheck. Second, and more fundamentally, this app was never designed as two deployable services: `apps/server/src/index.ts` already registers `@fastify/static` to serve `apps/web/dist` itself and falls back to `index.html` for non-`/api`/`/auth` routes, and `apps/web/src/api/client.ts` calls `fetch(path, ...)` with no base URL, assuming same-origin. Splitting it into two Railway services would have required adding CORS and cross-site (`SameSite=None; Secure`) cookies for the existing `@fastify/secure-session` auth — real new surface area, not a deploy-config tweak, and exactly the kind of thing this project's own build guide picked the single-service shape to avoid.

**How it was caught:**
Manual review — pulled the actual Railway build logs via the CLI (`railway logs --build --latest`) rather than guessing from the dashboard's red "Failed" badge, which showed the literal missing-module error and the auto-generated build command for each service.

**The fix:**
Deleted the redundant `@inbox-concierge/web` service (confirmed via user action in the dashboard, verified after via `railway service list --json`). For the remaining `@inbox-concierge/server` service, tried to set the correct build/start commands live via `railway environment edit --service-config ... build.buildCommand "..."` (dot-path form) and then the full JSON-patch form (`railway environment edit --json`) — both reported `{"committed":true}`, and the JSON-patch form even changed `railway environment config --json`'s displayed `source.branch`, but a subsequent fresh `railway up --ci` deploy still ran the old, unmodified `buildCommand`. Rather than keep fighting an apparently-unreliable live-patch path, committed a `railway.json` config-as-code file to the repo instead (`{"build":{"buildCommand":"npm run build -w packages/shared && npm run build -w apps/web && npm run build -w apps/server"},"deploy":{"startCommand":"npm run start -w apps/server"}}`) — Railpack picks this up directly from the repo, so it doesn't depend on the environment-edit API path at all.

**Why it matters:**
"The CLI/API said the mutation committed" was not sufficient evidence that it actually took effect — the only real verification was triggering an actual fresh deploy and reading what command it ran, the same "verify by exercising it, not by reading the success message" discipline as the Phase 2 `--confirm` flag-swallowing entry. Also a reminder that a platform's own auto-detection is a guess, not ground truth about the app's real architecture — the code itself (the static-file serving + same-origin fetch calls) was the actual source of truth for "how many services does this need," not what Railway inferred from seeing two `package.json` files.

### [Deploy] — Production sign-in failed (`?auth_error=failed`); `railway.json`'s `startCommand` never ran migrations — 2026-07-17
**What Claude Code generated first:**
The `railway.json` committed in the prior deploy entry set `deploy.startCommand` to `npm run start -w apps/server` only. No build step, start step, or Railway release phase ever ran `db:migrate` against the production Postgres instance.

**What was wrong / the risk:**
The human reported `/?auth_error=failed` on every real sign-in attempt (after separately hitting, and resolving, an unrelated Google "unverified app" 403 by adding the test-user account). The `/auth/google/callback` route's catch-all `catch (err) { request.log.error({ err }, 'Google OAuth callback failed'); ... }` only logged `err` as a structured Pino field, and Railway's log viewer (via the `mcp__railway__get_logs` tool) only surfaces the top-level `msg` string — `search` queries for `relation`, `invalid_grant`, `invalid_client`, etc. all returned zero hits even though the two real failures were confirmed in the logs by timestamp/message match. So the most likely root cause (production `users` table never migrated, since nothing in the deploy pipeline ever ran `drizzle-kit migrate`) could not be directly confirmed from logs, and a direct `psql` check against the production DB was blocked by the permission system.

**How it was caught:**
Human report of the live symptom, cross-referenced against `railway.json` (no migrate step anywhere in build/start) and `apps/server/package.json` (`db:migrate` script exists but is never invoked outside local dev).

**The fix:**
Changed `railway.json`'s `deploy.startCommand` to `npm run db:migrate -w apps/server && npm run start -w apps/server` (idempotent — drizzle-kit tracks applied migrations, safe on every deploy). Also changed the callback's catch block to fold `err.message` into the log line itself (`Google OAuth callback failed: ${message}`) so the next failure is diagnosable through the same log tool that couldn't see structured fields.

**Why it matters:**
A deploy pipeline that builds and starts the app but never migrates its database will pass every health check and still be completely broken for any code path that touches a table added after the first migration — exactly the kind of gap that's invisible until a real user hits it in production. Also a concrete case where the logging shape itself (structured-only, no plain-text summary) blocked diagnosis; structured fields are only useful if the tooling reading them actually surfaces them.

### [Deploy] — Production Gmail sync failing (generic "Could not reach Gmail" 502); underlying error hidden again — 2026-07-17
**What Claude Code generated first:**
`inbox.ts`'s sync route caught all non-reauth errors with `request.log.error({ err }, 'Inbox sync failed')` and returned a generic 502 to the client.

**What was wrong / the risk:**
Identical gap to the one already fixed in `auth.ts`'s OAuth callback (see the entry above, same day): Railway's log viewer (and the `mcp__railway__get_logs` tool) only surfaces the top-level `msg` string, dropping structured fields like `err`. That earlier fix was applied only to the callback route, not to the sync route — so when the human reported the generic "Could not reach Gmail" message from the deployed app, `get_logs` searches for `err`, `decrypt`, etc. all came up empty, exactly the same dead end as before.

**How it was caught:**
Human reported the generic error message from the deployed app; re-derived the same root cause via `docs/CORRECTIONS_LOG.md`'s own prior entry before re-discovering it by trial and error.

**The fix:**
Folded `err.message` into the log line in `inbox.ts` (`request.log.error({ err }, \`Inbox sync failed: ${message}\`)`), mirroring the callback route, and redeployed so the next failure is diagnosable.

**Why it matters:**
A fix scoped to "the one route the human happened to hit" instead of "the pattern" leaves the same landmine in every other catch block — this codebase now has at least two routes with broad try/catch-and-log-generic-message handlers around external calls (Gmail sync, OAuth callback); both needed the same treatment, and any new one should get it from the start.
