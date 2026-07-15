import { z } from 'zod';

/**
 * Zod schema for the model's tool output, given the shortlist's valid email ids. The tool's
 * `strict: true` + enum already constrains `emailId` at the API layer (see prompt.ts); this is
 * defense-in-depth, same relationship the classifier's `classificationBatchSchema` has to its
 * tool schema.
 */
export function digestToolOutputSchema(validEmailIds: string[]) {
  const emailIdEnum = z.enum(validEmailIds as [string, ...string[]]);
  const actionItem = z
    .object({
      emailId: emailIdEnum,
      title: z.string().trim().min(1).max(120),
      why: z.string().trim().min(1).max(240),
      urgency: z.enum(['high', 'medium', 'low']),
      draftReply: z.string().trim().min(1).max(500).nullable(),
    })
    // Same "reject and retry" instinct as the classifier's hasDeadline/deadlineText guard — a
    // model that writes a draft for a "medium"/"low" item, or forgets one for a "high" item, is a
    // correctness bug worth rejecting rather than silently persisting an inconsistent pair.
    .refine((v) => (v.urgency === 'high') === (v.draftReply !== null), {
      message: 'draftReply must be non-null exactly when urgency is "high"',
    });
  return z.object({
    headline: z.string().trim().min(1).max(200),
    actionItems: z.array(actionItem),
    fyiCount: z.number().int().nonnegative(),
  });
}

export type ParsedDigest = z.infer<ReturnType<typeof digestToolOutputSchema>>;
