import { z } from 'zod';
import { bucketSchema } from './classification.js';

/** `POST /api/buckets` — name (required) plus an optional description, which is sent verbatim to
 *  the classifier's system prompt (see `buildSystemPrompt`) to ground what belongs in this
 *  bucket beyond just its name. Color is still server-assigned (build guide §6's "type a name,
 *  hit enter" custom-bucket flow). */
export const createBucketRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(280).optional(),
});
export type CreateBucketRequest = z.infer<typeof createBucketRequestSchema>;

export const createBucketResponseSchema = z.object({ bucket: bucketSchema });
export type CreateBucketResponse = z.infer<typeof createBucketResponseSchema>;

/** `PATCH /api/buckets/reorder` — the caller's full ordered list of bucket ids, as currently
 *  rendered on the board. Rewrites sortOrder to match array index. */
export const reorderBucketsRequestSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderBucketsRequest = z.infer<typeof reorderBucketsRequestSchema>;

/** `POST /api/buckets/defaults` — the opt-in bucket picker's bulk-create call. `names` must be a
 *  subset of DEFAULT_BUCKET_NAMES (validated in the route); each match is inserted with its
 *  canonical description/color/isDefault, not the name-only custom-bucket flow's assignment. */
export const createDefaultBucketsRequestSchema = z.object({
  names: z.array(z.string()).min(1),
});
export type CreateDefaultBucketsRequest = z.infer<typeof createDefaultBucketsRequestSchema>;
