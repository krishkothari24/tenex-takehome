import pLimit from 'p-limit';
import type { EmailClassification } from '@inbox-concierge/shared';
import { classifyBatch } from './batch.js';
import {
  BATCH_SIZE,
  CONCURRENCY,
  costCeilingUsd,
  isDryRun,
  MAX_EMAILS_PER_RUN,
  MAX_OUTPUT_TOKENS_PER_CALL,
} from './config.js';
import { estimateCostUsd, estimateTokensFromChars } from './cost.js';
import {
  BatchClassificationError,
  CostCeilingExceededError,
  EmptyBucketSetError,
  TooManyEmailsError,
} from './errors.js';
import { buildBatchUserMessage, buildClassifyTool, buildSystemPrompt } from './prompt.js';
import type {
  BatchOutcome,
  BucketDef,
  ClassifierEmail,
  ClassifyOptions,
  ClassifyRunResult,
  CostEstimate,
  TokenUsage,
} from './types.js';

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };
const ZERO_ESTIMATE: CostEstimate = {
  estimatedInputTokens: 0,
  estimatedOutputTokens: 0,
  estimatedCostUsd: 0,
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pessimistic worst-case estimate for the pre-flight guardrail: assumes every batch uses its full
 * output cap AND makes its one corrective retry. Real spend is measured from API responses and is
 * far lower; this only needs to be a safe upper bound to abort genuine anomalies before spending.
 */
function estimateWorstCase(buckets: BucketDef[], batches: ClassifierEmail[][]): CostEstimate {
  const ATTEMPTS = 2; // initial + one corrective retry
  const bucketNames = buckets.map((b) => b.name);
  const overheadChars =
    buildSystemPrompt(buckets).length + JSON.stringify(buildClassifyTool(bucketNames)).length;
  let inputChars = 0;
  for (const batch of batches) inputChars += overheadChars + buildBatchUserMessage(batch).length;
  const estimatedInputTokens = estimateTokensFromChars(inputChars) * ATTEMPTS;
  const estimatedOutputTokens = batches.length * MAX_OUTPUT_TOKENS_PER_CALL * ATTEMPTS;
  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: estimateCostUsd({
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    }),
  };
}

/** Chunk + worst-case cost estimate without making any API call — powers the CLIs' dry-run display. */
export function estimateRun(
  emails: ClassifierEmail[],
  buckets: BucketDef[],
  options: { batchSize?: number } = {},
): { estimate: CostEstimate; batchCount: number; emailCount: number } {
  const batches = chunk(emails, options.batchSize ?? BATCH_SIZE);
  const estimate = emails.length === 0 ? ZERO_ESTIMATE : estimateWorstCase(buckets, batches);
  return { estimate, batchCount: batches.length, emailCount: emails.length };
}

/**
 * Classify a set of emails against a bucket set. Batched Haiku calls run under a bounded
 * concurrency pool (`p-limit`) with per-batch partial-failure isolation (`Promise.allSettled`).
 * Cost guardrails run before any API call. Results stream out via `options.onBatchComplete`.
 */
export async function classifyEmails(
  emails: ClassifierEmail[],
  buckets: BucketDef[],
  options: ClassifyOptions = {},
): Promise<ClassifyRunResult> {
  const start = Date.now();

  if (buckets.length === 0) throw new EmptyBucketSetError();
  // Guardrail: hard cap on emails per run.
  if (emails.length > MAX_EMAILS_PER_RUN) throw new TooManyEmailsError(emails.length, MAX_EMAILS_PER_RUN);

  // Degenerate input: empty inbox → no batches, no API calls.
  if (emails.length === 0) {
    return {
      classifications: [],
      unclassifiedEmailIds: [],
      batchCount: 0,
      usage: { ...ZERO_USAGE },
      actualCostUsd: 0,
      estimate: ZERO_ESTIMATE,
      durationMs: Date.now() - start,
      dryRun: isDryRun(),
    };
  }

  const batchSize = options.batchSize ?? BATCH_SIZE;
  const concurrency = options.concurrency ?? CONCURRENCY;
  const batches = chunk(emails, batchSize);

  // Guardrail: pre-flight worst-case cost ceiling. If this trips, nothing is spent.
  const estimate = estimateWorstCase(buckets, batches);
  const ceiling = costCeilingUsd();
  if (estimate.estimatedCostUsd > ceiling) {
    throw new CostCeilingExceededError(estimate.estimatedCostUsd, ceiling);
  }
  await options.onEstimate?.(estimate, batches.length);

  // Guardrail: global dry-run kill switch — skip ALL API calls, everything comes back unclassified.
  if (isDryRun()) {
    for (let i = 0; i < batches.length; i++) {
      await options.onBatchComplete?.({
        batchIndex: i,
        status: 'failed',
        classifications: [],
        unclassifiedEmailIds: batches[i]!.map((e) => e.id),
        usage: { ...ZERO_USAGE },
        error: 'dry-run (no API call made)',
      });
    }
    return {
      classifications: [],
      unclassifiedEmailIds: emails.map((e) => e.id),
      batchCount: batches.length,
      usage: { ...ZERO_USAGE },
      actualCostUsd: 0,
      estimate,
      durationMs: Date.now() - start,
      dryRun: true,
    };
  }

  const limit = pLimit(concurrency);
  const outcomes = await Promise.allSettled(
    batches.map((batch, batchIndex) =>
      limit(async (): Promise<BatchOutcome> => {
        try {
          const { classifications, usage } = await classifyBatch(batch, buckets);
          const outcome: BatchOutcome = {
            batchIndex,
            status: 'ok',
            classifications,
            unclassifiedEmailIds: [],
            usage,
          };
          await options.onBatchComplete?.(outcome);
          return outcome;
        } catch (err) {
          // Partial-failure isolation: one bad batch never fails the others.
          const usage = err instanceof BatchClassificationError ? err.usage : { ...ZERO_USAGE };
          const outcome: BatchOutcome = {
            batchIndex,
            status: 'failed',
            classifications: [],
            unclassifiedEmailIds: batch.map((e) => e.id),
            usage,
            error: err instanceof Error ? err.message : String(err),
          };
          await options.onBatchComplete?.(outcome);
          return outcome;
        }
      }),
    ),
  );

  const classifications: EmailClassification[] = [];
  const unclassifiedEmailIds: string[] = [];
  const usage: TokenUsage = { ...ZERO_USAGE };
  for (const settled of outcomes) {
    // The limited fn catches its own errors, so it always fulfills — the rejected branch is a guard.
    if (settled.status !== 'fulfilled') continue;
    const outcome = settled.value;
    classifications.push(...outcome.classifications);
    unclassifiedEmailIds.push(...outcome.unclassifiedEmailIds);
    usage.inputTokens += outcome.usage.inputTokens;
    usage.outputTokens += outcome.usage.outputTokens;
  }

  return {
    classifications,
    unclassifiedEmailIds,
    batchCount: batches.length,
    usage,
    actualCostUsd: estimateCostUsd(usage),
    estimate,
    durationMs: Date.now() - start,
    dryRun: false,
  };
}
