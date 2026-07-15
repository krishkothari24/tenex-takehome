import { z } from 'zod';
import { emailClassificationSchema } from './classification.js';

export const costEstimateSchema = z.object({
  estimatedInputTokens: z.number().int().nonnegative(),
  estimatedOutputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type CostEstimateDto = z.infer<typeof costEstimateSchema>;

/**
 * The SSE contract for `POST /api/classify` (and Phase 4's `/api/reclassify`, same shape).
 * One `estimate` frame up front, one `batch` frame per completed batch (completion order, not
 * submission order — batches run under a bounded concurrency pool), then exactly one `done` or
 * `error` frame closing the stream. Discriminated union so client and server share one contract
 * instead of the client guessing the server's `BatchOutcome`/`CostEstimate` shapes.
 */
export const classifyStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('estimate'),
    estimate: costEstimateSchema,
    batchCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('batch'),
    batchIndex: z.number().int().nonnegative(),
    batchCount: z.number().int().nonnegative(),
    status: z.enum(['ok', 'failed']),
    classifications: z.array(emailClassificationSchema),
    unclassifiedEmailIds: z.array(z.string()),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    totalClassified: z.number().int().nonnegative(),
    totalUnclassified: z.number().int().nonnegative(),
    actualCostUsd: z.number().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    dryRun: z.boolean(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ClassifyStreamEvent = z.infer<typeof classifyStreamEventSchema>;
