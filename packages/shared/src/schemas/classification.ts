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
   * Whether the email mentions a date, deadline, or explicit time-sensitive ask — extracted from
   * the same batched call, not a separate pass (build guide §6 stretch: deadline/urgency
   * detection). `false`/`null` exactly when `status` is 'unclassified'.
   */
  hasDeadline: z.boolean().nullable(),
  /**
   * A short phrase quoted/paraphrased from the email's own content (e.g. "reply by Friday") —
   * deliberately not a resolved calendar date, since the model can't reliably anchor a relative
   * date ("Friday") without knowing today's date; asserting one would be an ungrounded guess.
   * Null whenever `hasDeadline` is false/null.
   */
  deadlineText: z.string().max(160).nullable(),
});
export type EmailClassification = z.infer<typeof emailClassificationSchema>;
