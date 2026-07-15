/**
 * Central config + cost guardrails for the classification pipeline. Every tunable and every
 * spend-limiting constant lives here so a reviewer can see the cost posture in one place.
 */

// Cheapest capable model, pinned. Classification is a high-volume extraction task, not a
// reasoning one — Haiku is purpose-built and priced for it. Never silently upgrade to Sonnet/Opus.
export const CLASSIFIER_MODEL = 'claude-haiku-4-5';

// Haiku 4.5 list pricing, USD per 1M tokens (verified against the Anthropic pricing table).
export const HAIKU_PRICING = { inputPerMTok: 1, outputPerMTok: 5 } as const;

// Batching (§5.2): ~18/call — not 1-at-a-time (wasteful) nor 200-at-once (per-item accuracy
// degrades in a crowded context). Concurrency is a *bounded* pool so we never fire every batch
// at once and trip 429s.
export const BATCH_SIZE = 18;
export const CONCURRENCY = 5;

// Ambiguity tie-break (§5.5).
export const AMBIGUITY_THRESHOLD = 0.6;

// Token guards (§5.8): metadata + snippet only, truncated before batching so one giant email
// can't blow the context budget or the cost.
export const MAX_SUBJECT_CHARS = 200;
export const MAX_SNIPPET_CHARS = 500;

// Per-call output cap — bounds the expensive ($5/M) output side; the model physically cannot
// run away. 2048 comfortably fits ~18 compact structured items.
export const MAX_OUTPUT_TOKENS_PER_CALL = 2048;

// ---------------------------------------------------------------------------
// Cost guardrails
// ---------------------------------------------------------------------------

// Hard cap on emails classified in a single run. An accidentally huge inbox cannot balloon cost.
export const MAX_EMAILS_PER_RUN = 200;

// Pre-flight worst-case cost ceiling (USD). A normal 200-email run costs ~$0.08 and its
// pessimistic worst-case estimate is well under this; the ceiling exists to catch a genuine
// anomaly (misconfigured batch size, a model swap, a runaway loop) *before* any API call.
export const DEFAULT_COST_CEILING_USD = 1.0;

export function costCeilingUsd(): number {
  const parsed = Number(process.env.CLASSIFIER_COST_CEILING_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COST_CEILING_USD;
}

// Global kill switch: when set, the pipeline makes NO API calls and returns everything
// unclassified. Lets you exercise the plumbing (chunking, streaming seam, persistence) at $0.
export function isDryRun(): boolean {
  const v = process.env.CLASSIFIER_DRY_RUN;
  return v === 'true' || v === '1';
}
