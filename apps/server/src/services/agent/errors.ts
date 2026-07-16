/** Cost guardrail: cumulative spend this turn already exceeds the ceiling before another tool-use
 *  call would be made. The turn stops and degrades gracefully instead of throwing all the way out —
 *  callers of runAgentTurn never see this type; it's caught internally by loop.ts. */
export class AgentCostCeilingExceededError extends Error {
  readonly spentUsd: number;
  readonly ceilingUsd: number;
  constructor(spentUsd: number, ceilingUsd: number) {
    super(
      `Cumulative spend this turn ($${spentUsd.toFixed(4)}) has reached the ceiling ` +
        `($${ceilingUsd.toFixed(2)}). Stopping before another call. ` +
        'Set AGENT_COST_CEILING_USD to raise it.',
    );
    this.name = 'AgentCostCeilingExceededError';
    this.spentUsd = spentUsd;
    this.ceilingUsd = ceilingUsd;
  }
}

/** draft_reply's own one-shot Sonnet call failed validation even after its corrective retry —
 *  mirrors BatchClassificationError/DigestGenerationError's shape (../classifier/errors.ts,
 *  ../digest/errors.ts). Caught by the loop and relayed to the model as a tool_result error, never
 *  thrown out of runAgentTurn. */
export class DraftGenerationError extends Error {
  constructor(reason: string) {
    super(`Draft generation failed after corrective retry: ${reason}`);
    this.name = 'DraftGenerationError';
  }
}
