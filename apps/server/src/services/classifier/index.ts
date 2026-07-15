export { classifyEmails, estimateRun } from './pipeline.js';
export { estimateCostUsd } from './cost.js';
export {
  CLASSIFIER_MODEL,
  BATCH_SIZE,
  CONCURRENCY,
  AMBIGUITY_THRESHOLD,
  MAX_EMAILS_PER_RUN,
  DEFAULT_COST_CEILING_USD,
  costCeilingUsd,
  isDryRun,
} from './config.js';
export {
  MissingAnthropicKeyError,
  EmptyBucketSetError,
  TooManyEmailsError,
  CostCeilingExceededError,
  BatchClassificationError,
} from './errors.js';
export { classificationBatchSchema, truncateSubject, truncateSnippet } from './validation.js';
export { deriveAmbiguity } from './derive.js';
export type {
  ClassifierEmail,
  BucketDef,
  TokenUsage,
  BatchOutcome,
  CostEstimate,
  ClassifyRunResult,
  ClassifyOptions,
} from './types.js';
