/**
 * Central config for the agentic chat loop (docs/AGENTIC_CHAT_PLAN.md phase 9a) — the same
 * one-file-of-tunables discipline as ../classifier/config.ts and ../digest/config.ts.
 */

// Reasoning tier, pinned — same call as the digest feature (../digest/config.ts): ambiguity
// handling, grounding, and drafting all need reasoning quality, not high-volume extraction.
export const AGENT_MODEL = 'claude-sonnet-5';

// Per-call output cap. Conversational turns are short by nature; this is a hard ceiling on any
// single call, not a target.
export const MAX_AGENT_OUTPUT_TOKENS = 1024;

// Hard cap on tool-use round trips within one user turn (docs/AGENTIC_CHAT_PLAN.md's own number).
// Exists so an agent that can't converge (bad tool results, a confused model) fails gracefully
// after a bounded number of calls instead of looping indefinitely.
export const MAX_TOOL_ITERATIONS = 5;

// Cap on rows search_emails returns to the model, regardless of what limit it asks for — keeps
// context small and bounds the cost of even a single overly-broad search.
export const MAX_SEARCH_RESULTS = 20;

// Cost guardrail for one user turn (up to MAX_TOOL_ITERATIONS calls plus draft_reply's own call).
// Unlike the classifier/digest ceilings, this can't be checked pre-flight — tool-result sizes
// aren't known before a turn starts — so it's enforced as a running-total check before each
// iteration's call (see loop.ts): if spend so far this turn already exceeds the ceiling, stop and
// degrade gracefully instead of making another call.
export const DEFAULT_AGENT_COST_CEILING_USD = 0.5;

export function agentCostCeilingUsd(): number {
  const parsed = Number(process.env.AGENT_COST_CEILING_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_COST_CEILING_USD;
}
