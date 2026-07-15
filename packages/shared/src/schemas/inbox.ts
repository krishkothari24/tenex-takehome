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
