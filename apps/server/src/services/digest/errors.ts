/** A digest call that failed validation even after its one corrective retry. */
export class DigestGenerationError extends Error {
  constructor(reason: string) {
    super(`Digest generation failed after corrective retry: ${reason}`);
    this.name = 'DigestGenerationError';
  }
}

/** Cost guardrail: pre-flight worst-case estimate exceeded the ceiling. Nothing was spent. */
export class DigestCostCeilingExceededError extends Error {
  readonly estimatedCostUsd: number;
  readonly ceilingUsd: number;
  constructor(estimatedCostUsd: number, ceilingUsd: number) {
    super(
      `Estimated worst-case digest cost $${estimatedCostUsd.toFixed(4)} exceeds the ceiling ` +
        `$${ceilingUsd.toFixed(2)}. Aborting before any API call. Set DIGEST_COST_CEILING_USD to raise it.`,
    );
    this.name = 'DigestCostCeilingExceededError';
    this.estimatedCostUsd = estimatedCostUsd;
    this.ceilingUsd = ceilingUsd;
  }
}
