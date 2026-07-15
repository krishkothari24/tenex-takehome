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
