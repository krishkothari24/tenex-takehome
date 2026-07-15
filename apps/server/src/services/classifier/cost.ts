import { HAIKU_PRICING } from './config.js';
import type { TokenUsage } from './types.js';

/** Actual cost of measured token usage, USD. */
export function estimateCostUsd(usage: TokenUsage): number {
  return (
    (usage.inputTokens / 1_000_000) * HAIKU_PRICING.inputPerMTok +
    (usage.outputTokens / 1_000_000) * HAIKU_PRICING.outputPerMTok
  );
}

// Deliberately conservative char→token heuristic for the *pre-flight* guard only (real usage
// is measured from the API response). ~4 chars/token is a safe upper bound for English + JSON.
const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
