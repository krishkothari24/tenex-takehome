import { z } from 'zod';

/** A classification bucket. Seeded defaults + user-created customs both use this shape. */
export const bucketSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
});
export type Bucket = z.infer<typeof bucketSchema>;

export const bucketsResponseSchema = z.object({
  buckets: z.array(bucketSchema),
});
export type BucketsResponse = z.infer<typeof bucketsResponseSchema>;

/**
 * `classified` — the pipeline placed the email in a bucket.
 * `unclassified` — the email's batch failed even after a corrective retry; the row is
 * persisted in this visible state (never silently dropped) so the UI can surface + retry it.
 */
export const classificationStatusSchema = z.enum(['classified', 'unclassified']);
export type ClassificationStatus = z.infer<typeof classificationStatusSchema>;

/**
 * The final per-email classification result — the LLM's raw output plus the two derived
 * fields (`isAmbiguous`, `status`). Bucket names (not ids) so it's usable before the DB
 * round-trip (eval, CLI) and in the UI. `bucket` is null only when `status` is unclassified.
 */
export const emailClassificationSchema = z.object({
  emailId: z.string(),
  bucket: z.string().nullable(),
  secondaryBucket: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  justification: z.string().nullable(),
  isAmbiguous: z.boolean(),
  status: classificationStatusSchema,
  /**
   * Minutes a busy professional would spend reading + responding to this specific email, as
   * estimated by the classifier from its actual subject/snippet — not a fixed per-bucket average
   * (see build guide §6's dashboard time-cost tile). Null exactly when `status` is 'unclassified'.
   */
  estimatedReadMinutes: z.number().min(0).max(30).nullable(),
});
export type EmailClassification = z.infer<typeof emailClassificationSchema>;
