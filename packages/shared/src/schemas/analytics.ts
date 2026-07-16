import { z } from 'zod';

/**
 * The dashboard's tiles (build guide §6): attention/unanswered, volume breakdown, sender
 * frequency. `attention` carries an honest "unknown reply status" count alongside its headline
 * number — rows synced/classified before a relevant migration shipped degrade to null rather than
 * being silently counted as zero.
 */
export const dashboardAnalyticsSchema = z.object({
  totalEmails: z.number().int().nonnegative(),
  attention: z.object({
    importantTotal: z.number().int().nonnegative(),
    unansweredCount: z.number().int().nonnegative(),
    unknownReplyStatusCount: z.number().int().nonnegative(),
  }),
  volumeByBucket: z.array(
    z.object({
      bucket: z.string(),
      color: z.string().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  topSenders: z.array(
    z.object({
      senderLabel: z.string(),
      emailAddress: z.string().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /**
   * Relationship-strength ranking (build guide §6 stretch), deterministic — not LLM-derived.
   * Scoped to the current sync snapshot only (see services/analytics/vip.ts); requires at least
   * 2 threads from a sender before calling them "VIP" — one email isn't a relationship pattern.
   */
  vipSenders: z.array(
    z.object({
      senderLabel: z.string(),
      emailAddress: z.string().nullable(),
      threadCount: z.number().int().nonnegative(),
      importantCount: z.number().int().nonnegative(),
      replyRate: z.number().min(0).max(1),
      score: z.number().nonnegative(),
    }),
  ),
});
export type DashboardAnalytics = z.infer<typeof dashboardAnalyticsSchema>;
