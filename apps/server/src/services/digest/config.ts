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

export const MAX_DIGEST_OUTPUT_TOKENS = 2048;

// Pre-flight worst-case cost ceiling (USD). A well-formed digest call costs a few cents; this
// exists to catch a genuine anomaly before any API call, same instinct as the classifier's ceiling.
export const DEFAULT_DIGEST_COST_CEILING_USD = 0.25;

export function digestCostCeilingUsd(): number {
  const parsed = Number(process.env.DIGEST_COST_CEILING_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DIGEST_COST_CEILING_USD;
}
