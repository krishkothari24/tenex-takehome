import { z } from 'zod';

export const syncedEmailSummarySchema = z.object({
  id: z.string(),
  gmailThreadId: z.string(),
  subject: z.string().nullable(),
  fromAddress: z.string().nullable(),
  snippet: z.string().nullable(),
  internalDate: z.string().nullable(),
});
export type SyncedEmailSummary = z.infer<typeof syncedEmailSummarySchema>;

export const inboxSyncResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  sample: z.array(syncedEmailSummarySchema),
  failed: z.array(z.string()),
});
export type InboxSyncResponse = z.infer<typeof inboxSyncResponseSchema>;

/**
 * A synced email left-joined with its current classification, if any. Unlike
 * `EmailClassification`, `status`/`bucket` are null here for `null` meaning "not classified yet"
 * (no classification_results row) rather than the pipeline's "classified vs unclassified"
 * distinction — this is `GET /api/emails`'s "render from Postgres" shape for Phase 3.
 */
export const emailWithClassificationSchema = z.object({
  emailId: z.string(),
  subject: z.string().nullable(),
  fromAddress: z.string().nullable(),
  snippet: z.string().nullable(),
  bucket: z.string().nullable(),
  bucketColor: z.string().nullable(),
  secondaryBucket: z.string().nullable(),
  confidence: z.number().nullable(),
  justification: z.string().nullable(),
  status: z.enum(['classified', 'unclassified']).nullable(),
  isAmbiguous: z.boolean().nullable(),
  hasDeadline: z.boolean().nullable(),
  deadlineText: z.string().nullable(),
});
export type EmailWithClassification = z.infer<typeof emailWithClassificationSchema>;

export const emailsResponseSchema = z.object({
  emails: z.array(emailWithClassificationSchema),
});
export type EmailsResponse = z.infer<typeof emailsResponseSchema>;
