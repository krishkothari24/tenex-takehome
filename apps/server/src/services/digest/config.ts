/**
 * Central config for the weekly-digest feature — the one deliberate use of Sonnet 5 in this
 * codebase (classification stays on Haiku; see ../classifier/config.ts). Sonnet is reasoning-tier
 * and materially pricier than Haiku, so this module keeps the same cost-guardrail discipline.
 */

// Reasoning-tier model, pinned — the digest synthesizes a shortlist into a grounded briefing,
// the exact "reasoning quality matters" case the build guide reserves Sonnet for.
export const DIGEST_MODEL = 'claude-sonnet-5';

// Sonnet 5 intro pricing (in effect through 2026-08-31), USD per 1M tokens.
export const SONNET_PRICING = { inputPerMTok: 2, outputPerMTok: 10 } as const;

// Cap on how many shortlisted emails feed one digest call — keeps it a digest (not a re-listing
// of the inbox) and keeps the single Sonnet call small and cheap.
export const MAX_DIGEST_INPUT_EMAILS = 40;

// 2048 was too tight: a shortlist with several "high" urgency items (each needing a title + why +
// a 2-4 sentence draftReply, up to ~900 chars of JSON apiece) can legitimately need more room than
// that, and running out mid-call truncates the tool call before `actionItems`/`fyiCount` are even
// started — a validation failure the corrective retry can't reason about without stop_reason
// handling (see generate.ts). Doubled with headroom to spare under the cost ceiling.
export const MAX_DIGEST_OUTPUT_TOKENS = 4096;

// Pre-flight worst-case cost ceiling (USD). A well-formed digest call costs a few cents; this
// exists to catch a genuine anomaly before any API call, same instinct as the classifier's ceiling.
export const DEFAULT_DIGEST_COST_CEILING_USD = 0.25;

export function digestCostCeilingUsd(): number {
  const parsed = Number(process.env.DIGEST_COST_CEILING_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DIGEST_COST_CEILING_USD;
}
