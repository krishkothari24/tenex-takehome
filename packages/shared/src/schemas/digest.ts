import { z } from 'zod';

export const digestUrgencySchema = z.enum(['high', 'medium', 'low']);
export type DigestUrgency = z.infer<typeof digestUrgencySchema>;

/**
 * One digest action item — always cites a real `emailId` from the shortlist that produced it
 * (enforced at the tool-schema layer server-side, see apps/server digest/prompt.ts), the same
 * grounding discipline as the classifier's `justification` field.
 */
export const digestActionItemSchema = z.object({
  emailId: z.string(),
  title: z.string(),
  why: z.string(),
  urgency: digestUrgencySchema,
});
export type DigestActionItem = z.infer<typeof digestActionItemSchema>;

/**
 * "This week" proactive briefing (build guide §6 stretch) — the one deliberate use of Sonnet 5 in
 * this app. Persisted so reopening the app shows the last digest instantly without re-paying.
 */
export const digestSchema = z.object({
  id: z.string(),
  headline: z.string(),
  actionItems: z.array(digestActionItemSchema),
  fyiCount: z.number().int().nonnegative(),
  inputEmailCount: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  generatedAt: z.string(),
});
export type Digest = z.infer<typeof digestSchema>;

export const digestResponseSchema = z.object({
  digest: digestSchema.nullable(),
});
export type DigestResponse = z.infer<typeof digestResponseSchema>;

/**
 * The SSE contract for `POST /api/digest`. `started` fires immediately (so the UI can say
 * "Reading N shortlisted emails…" rather than a blank spinner, per build guide §7); exactly one
 * `done` or `error` frame closes the stream — there's no per-batch progress since this is a
 * single Sonnet call, not a batched Haiku run.
 */
export const digestStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), inputEmailCount: z.number().int().nonnegative() }),
  z.object({ type: z.literal('done'), digest: digestSchema }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type DigestStreamEvent = z.infer<typeof digestStreamEventSchema>;
