import type { Bucket } from '@inbox-concierge/shared';

/**
 * Validated (dataviz-skill `validate_palette.js`) categorical steps, dark-surface variants,
 * chosen to be distinct from the five DEFAULT_BUCKETS colors and from each other — the new slots
 * a user-created custom bucket gets, in fixed order, cycling if more than four are created.
 * Deliberately doesn't touch the existing default colors (no churn on Phase 2/3 work).
 */
export const CUSTOM_BUCKET_COLORS: readonly string[] = ['#008300', '#199e70', '#d95926', '#d55181'];

export function nextCustomBucketColor(existingCustomCount: number): string {
  return CUSTOM_BUCKET_COLORS[existingCustomCount % CUSTOM_BUCKET_COLORS.length]!;
}

/** Case-insensitive — guards the classifier's Zod bucket enum (keyed by name) from a collision. */
export function isDuplicateBucketName(existing: Bucket[], candidateName: string): boolean {
  const normalized = candidateName.trim().toLowerCase();
  return existing.some((b) => b.name.trim().toLowerCase() === normalized);
}
