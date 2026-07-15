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

/**
 * Read-path counterpart to `deriveAmbiguity`, for rows already persisted in `classification_results`
 * (`GET /api/emails`). `confidence`/`secondaryBucketId` are already the tie-broken values written by
 * the pipeline (a duplicate secondary was already dropped at write time), so this only needs to
 * re-apply the threshold — kept as a separate exported function (rather than storing a redundant
 * `is_ambiguous` column) so the derivation has one source of truth if `AMBIGUITY_THRESHOLD` changes.
 * `null` confidence (email not yet classified, or classification failed) is never ambiguous.
 */
export function isAmbiguousFromPersisted(confidence: number | null, hasSecondaryBucket: boolean): boolean {
  if (confidence === null) return false;
  return confidence < AMBIGUITY_THRESHOLD || hasSecondaryBucket;
}
