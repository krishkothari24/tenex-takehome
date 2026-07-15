import { z } from 'zod';
import { emailWithClassificationSchema } from './inbox.js';

/** `PATCH /api/emails/:emailId/bucket` — the manual "move this email" request/response pair. */
export const moveEmailBucketRequestSchema = z.object({
  bucketId: z.string().min(1),
});
export type MoveEmailBucketRequest = z.infer<typeof moveEmailBucketRequestSchema>;

export const moveEmailBucketResponseSchema = z.object({
  email: emailWithClassificationSchema,
});
export type MoveEmailBucketResponse = z.infer<typeof moveEmailBucketResponseSchema>;

/**
 * A suggested standing rule ("always put mail from this sender in this bucket"), derived from
 * repeated manual corrections (build guide §5.7's feedback-loop framing) — not persisted until
 * the user accepts it via `POST /api/rules`.
 */
export const senderRuleSuggestionSchema = z.object({
  fromAddress: z.string(),
  bucketId: z.string(),
  bucketName: z.string(),
  correctionCount: z.number().int().nonnegative(),
});
export type SenderRuleSuggestion = z.infer<typeof senderRuleSuggestionSchema>;

export const ruleSuggestionsResponseSchema = z.object({
  suggestions: z.array(senderRuleSuggestionSchema),
});
export type RuleSuggestionsResponse = z.infer<typeof ruleSuggestionsResponseSchema>;

export const createRuleRequestSchema = z.object({
  fromAddress: z.string().min(1),
  bucketId: z.string().min(1),
});
export type CreateRuleRequest = z.infer<typeof createRuleRequestSchema>;

export const senderRuleSchema = z.object({
  id: z.string(),
  fromAddress: z.string(),
  bucketId: z.string(),
  bucketName: z.string(),
  appliedToCount: z.number().int().nonnegative(),
});
export type SenderRule = z.infer<typeof senderRuleSchema>;

export const createRuleResponseSchema = z.object({
  rule: senderRuleSchema,
});
export type CreateRuleResponse = z.infer<typeof createRuleResponseSchema>;
