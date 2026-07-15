import { AMBIGUITY_THRESHOLD } from './config.js';

export interface AmbiguityInput {
  bucket: string;
  confidence: number;
  secondaryBucket: string | null;
}

export interface AmbiguityResult {
  secondaryBucket: string | null;
  isAmbiguous: boolean;
}

/**
 * Pure ambiguity tie-break (§5.5). Drops a secondary bucket that duplicates the primary, then
 * flags the email ambiguous if the top confidence is below threshold OR a real secondary remains.
 * Kept as its own function so it's unit-testable without hitting the API.
 */
export function deriveAmbiguity(input: AmbiguityInput): AmbiguityResult {
  const secondaryBucket =
    input.secondaryBucket && input.secondaryBucket !== input.bucket ? input.secondaryBucket : null;
  const isAmbiguous = input.confidence < AMBIGUITY_THRESHOLD || secondaryBucket !== null;
  return { secondaryBucket, isAmbiguous };
}
