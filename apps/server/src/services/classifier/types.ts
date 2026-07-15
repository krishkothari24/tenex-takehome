import type { EmailClassification } from '@inbox-concierge/shared';

/** Minimal email shape the classifier needs — metadata + snippet only, never a body. */
export interface ClassifierEmail {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
}

/** A bucket as the classifier sees it: a name + the description that grounds the model. */
export interface BucketDef {
  name: string;
  description: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Emitted as each batch settles (completion order) — the streaming seam for Phase 3's SSE route. */
export interface BatchOutcome {
  batchIndex: number;
  status: 'ok' | 'failed';
  classifications: EmailClassification[];
  unclassifiedEmailIds: string[];
  usage: TokenUsage;
  error?: string;
}

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface ClassifyRunResult {
  classifications: EmailClassification[];
  unclassifiedEmailIds: string[];
  batchCount: number;
  usage: TokenUsage;
  actualCostUsd: number;
  estimate: CostEstimate;
  durationMs: number;
  dryRun: boolean;
}

export interface ClassifyOptions {
  batchSize?: number;
  concurrency?: number;
  /** Fired as each batch settles (completion order) — Phase 3 SSE writes one event per call. */
  onBatchComplete?: (outcome: BatchOutcome) => void | Promise<void>;
  /** Fired once after the pre-flight cost check passes, before any API call. */
  onEstimate?: (estimate: CostEstimate, batchCount: number) => void | Promise<void>;
}
