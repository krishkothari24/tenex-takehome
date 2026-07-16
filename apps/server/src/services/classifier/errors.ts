import type { TokenUsage } from './types.js';

/** ANTHROPIC_API_KEY missing — thrown on use, so the server still boots without it. */
export class MissingAnthropicKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set — classification is unavailable. Add it to .env.');
    this.name = 'MissingAnthropicKeyError';
  }
}

export class EmptyBucketSetError extends Error {
  constructor() {
    super('Cannot classify with an empty bucket set.');
    this.name = 'EmptyBucketSetError';
  }
}

/** Cost guardrail: refuses to classify more than the per-run cap in one go. */
export class TooManyEmailsError extends Error {
  constructor(count: number, max: number) {
    super(
      `Refusing to classify ${count} emails in one run (cap ${max}) — cost guardrail. ` +
        'Split the run or raise MAX_EMAILS_PER_RUN deliberately.',
    );
    this.name = 'TooManyEmailsError';
  }
}

/** Cost guardrail: pre-flight worst-case estimate exceeded the ceiling. Nothing was spent. */
export class CostCeilingExceededError extends Error {
  readonly estimatedCostUsd: number;
  readonly ceilingUsd: number;
  constructor(estimatedCostUsd: number, ceilingUsd: number) {
    super(
      `Estimated worst-case cost $${estimatedCostUsd.toFixed(4)} exceeds the ceiling ` +
        `$${ceilingUsd.toFixed(2)}. Aborting before any API call. ` +
        'Set CLASSIFIER_COST_CEILING_USD to raise it.',
    );
    this.name = 'CostCeilingExceededError';
    this.estimatedCostUsd = estimatedCostUsd;
    this.ceilingUsd = ceilingUsd;
  }
}

/** Anthropic account has run out of prepaid API credits (no auto-reload configured). Distinct
 *  from a per-batch validation failure: every subsequent call fails identically until credits are
 *  added, so callers fail the whole run loud and fast instead of burning a corrective retry or
 *  grinding through every remaining batch for the same wall. No charge occurs when this fires. */
export class InsufficientCreditsError extends Error {
  constructor() {
    super(
      'Anthropic API credit balance is depleted — classification is paused. No charges are made ' +
        'automatically; add credits in the Anthropic Console billing settings, then retry.',
    );
    this.name = 'InsufficientCreditsError';
  }
}

/** A batch that failed validation even after its one corrective retry. Carries the tokens it
 *  did spend so the run can still account for them, and the ids to mark `unclassified`. */
export class BatchClassificationError extends Error {
  readonly emailIds: string[];
  readonly usage: TokenUsage;
  constructor(reason: string, emailIds: string[], usage: TokenUsage) {
    super(`Batch classification failed after corrective retry: ${reason}`);
    this.name = 'BatchClassificationError';
    this.emailIds = emailIds;
    this.usage = usage;
  }
}
