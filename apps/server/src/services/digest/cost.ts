import { SONNET_PRICING } from './config.js';

/** Actual cost of measured token usage, USD. */
export function estimateDigestCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  return (
    (usage.inputTokens / 1_000_000) * SONNET_PRICING.inputPerMTok +
    (usage.outputTokens / 1_000_000) * SONNET_PRICING.outputPerMTok
  );
}
