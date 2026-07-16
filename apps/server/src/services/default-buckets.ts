/**
 * Re-export of the canonical default taxonomy — the data itself now lives in `@inbox-concierge/
 * shared` (packages/shared/src/data/default-buckets.ts) so the frontend's opt-in bucket picker
 * can import it directly with no network round trip and no duplicated copy. This shim exists so
 * existing server-side imports (`db/queries/buckets.ts`, `eval/run-eval.ts`,
 * `scripts/classify-dev.ts`) don't need to change their import path.
 */
export { DEFAULT_BUCKETS, DEFAULT_BUCKET_NAMES } from '@inbox-concierge/shared';
export type { DefaultBucketDef } from '@inbox-concierge/shared';
