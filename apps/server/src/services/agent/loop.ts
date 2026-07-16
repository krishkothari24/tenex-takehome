import type Anthropic from '@anthropic-ai/sdk';
import { listBuckets } from '../../db/queries/buckets.js';
import { getAnthropicClient, isInsufficientCreditsError } from '../classifier/anthropic.js';
import { isDryRun } from '../classifier/config.js';
import { InsufficientCreditsError } from '../classifier/errors.js';
// Sonnet-priced cost math — genuinely reused, not duplicated (the digest feature is the other
// Sonnet call site; see ../digest/config.ts's SONNET_PRICING).
import { estimateDigestCostUsd } from '../digest/cost.js';
import { AGENT_MODEL, MAX_AGENT_OUTPUT_TOKENS, MAX_TOOL_ITERATIONS, agentCostCeilingUsd } from './config.js';
import { draftReply } from './draft-reply.js';
import { getThreadDetail } from './get-thread-detail.js';
import { buildAgentSystemPrompt } from './prompt.js';
import { normalizeSearchFilters, searchEmails } from './search-emails.js';
import {
  askClarifyingQuestionInputSchema,
  buildSearchEmailsTool,
  draftReplyInputSchema,
  draftReplyTool,
  getThreadDetailInputSchema,
  getThreadDetailTool,
  askClarifyingQuestionTool,
  ASK_CLARIFYING_QUESTION_TOOL_NAME,
  DRAFT_REPLY_TOOL_NAME,
  GET_THREAD_DETAIL_TOOL_NAME,
  searchEmailsInputSchema,
  SEARCH_EMAILS_TOOL_NAME,
} from './tools.js';

export interface AgentLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Default for the dev script (no Fastify request in scope yet) — 9b can pass `request.log`
 *  directly instead, since its `info`/`error` shape matches. */
export const consoleAgentLogger: AgentLogger = {
  info: (obj, msg) => console.log(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export type NextStep =
  | { type: 'end_turn'; text: string }
  | { type: 'tool_use'; calls: Anthropic.ToolUseBlock[] }
  | { type: 'unrecognized' };

/**
 * Pure — unit-tested by constructing plain Message-shaped objects directly (decide.test.ts),
 * mirroring how ../classifier/anthropic.test.ts constructs a real Anthropic.APIError instead of
 * mocking the network call. No mocking library anywhere in this codebase; this keeps that.
 */
export function decideNextStep(message: Anthropic.Message): NextStep {
  if (message.stop_reason === 'end_turn') {
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { type: 'end_turn', text };
  }
  if (message.stop_reason === 'tool_use') {
    const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (calls.length === 0) return { type: 'unrecognized' };
    return { type: 'tool_use', calls };
  }
  // e.g. `max_tokens`/`stop_sequence`/`refusal` — none of these are actionable here; treat as a
  // graceful stop rather than crashing on an unhandled stop_reason.
  return { type: 'unrecognized' };
}

export interface ToolDispatchOutcome {
  toolResultBlock: Anthropic.ToolResultBlockParam;
  logEntry: { name: string; input: unknown; resultSummary: string };
  /** Set for a successful draft_reply dispatch (the UI renders it as its own distinct frame, see
   *  AgentTurnCallbacks.onToolResult) or an ask_clarifying_question dispatch (the loop below uses
   *  this to end the turn early and hand the question to the caller as structured data, never
   *  scraped from prose). Keeping both shapes here — where the typed inputs/results are already in
   *  scope — avoids the caller re-parsing resultSummary strings. */
  uiEvent?:
    | { type: 'draft'; threadId: string; draftText: string }
    | { type: 'clarify'; question: string; options: string[] };
}

/**
 * Dispatches one tool_use block. Never throws except InsufficientCreditsError (draft_reply's own
 * internal Sonnet call can hit this, and it must abort the whole turn, not just this one call —
 * every subsequent call would fail identically). Everything else — bad input, a not-found thread,
 * an unexpected DB error — becomes a relayable tool_result error, matching CLAUDE.md's "a failed
 * batch degrades gracefully" rule applied to a single tool call within a turn.
 *
 * Exported for dispatch-clarify.test.ts's direct unit tests of the ask_clarifying_question branch
 * (pure — no DB/API call) — same "construct the real shape directly" convention as
 * decide.test.ts, not a mock. The search_emails/draft_reply/get_thread_detail branches remain
 * verified against real data via scripts/agent-dev.ts, since they do touch the DB.
 */
export async function dispatchToolCall(
  call: Anthropic.ToolUseBlock,
  userId: string,
  bucketNames: string[],
): Promise<ToolDispatchOutcome> {
  try {
    if (call.name === SEARCH_EMAILS_TOOL_NAME) {
      const input = searchEmailsInputSchema(bucketNames).parse(call.input);
      const filters = normalizeSearchFilters(input);
      const results = await searchEmails(userId, filters);
      return {
        toolResultBlock: {
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify({ count: results.length, results }),
        },
        logEntry: { name: call.name, input, resultSummary: `${results.length} result(s)` },
      };
    }

    if (call.name === DRAFT_REPLY_TOOL_NAME) {
      const input = draftReplyInputSchema.parse(call.input);
      const result = await draftReply(userId, input);
      return {
        toolResultBlock: {
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        },
        logEntry: {
          name: call.name,
          input,
          resultSummary: result.ok ? 'draft produced' : `error: ${result.error}`,
        },
        ...(result.ok
          ? { uiEvent: { type: 'draft' as const, threadId: input.thread_id, draftText: result.data.draftText } }
          : {}),
      };
    }

    if (call.name === GET_THREAD_DETAIL_TOOL_NAME) {
      const input = getThreadDetailInputSchema.parse(call.input);
      const detail = await getThreadDetail(userId, input);
      return {
        toolResultBlock: {
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(detail ? { found: true, thread: detail } : { found: false }),
        },
        logEntry: { name: call.name, input, resultSummary: detail ? 'found' : 'not found' },
      };
    }

    if (call.name === ASK_CLARIFYING_QUESTION_TOOL_NAME) {
      const input = askClarifyingQuestionInputSchema.parse(call.input);
      return {
        toolResultBlock: {
          // No DB/API call — this tool's only job is surfacing structured choices to the user.
          // Still return a real tool_result so the next turn's history replay keeps every
          // tool_use paired, exactly as Anthropic's API requires.
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify({ presented: true }),
        },
        logEntry: { name: call.name, input, resultSummary: `asked: "${input.question}"` },
        uiEvent: { type: 'clarify', question: input.question, options: input.options },
      };
    }

    // Unreachable in practice — the tools array only ever offers these known names — but a
    // model response should never crash the loop even if it somehow names something else.
    return {
      toolResultBlock: {
        type: 'tool_result',
        tool_use_id: call.id,
        content: `Unknown tool: ${call.name}`,
        is_error: true,
      },
      logEntry: { name: call.name, input: call.input, resultSummary: 'unknown tool' },
    };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolResultBlock: {
        type: 'tool_result',
        tool_use_id: call.id,
        content: `Error: ${message}`,
        is_error: true,
      },
      logEntry: { name: call.name, input: call.input, resultSummary: `error: ${message}` },
    };
  }
}

export interface AgentTurnResult {
  reply: string;
  /** Pass this back in as `history` on the next call — ephemeral, client-held, per
   *  docs/AGENTIC_CHAT_PLAN.md's scope decision (no new DB tables for conversation state). */
  history: Anthropic.MessageParam[];
  toolCalls: Array<{ name: string; input: unknown; resultSummary: string }>;
  hitIterationCap: boolean;
  /** Set when this turn ended on an ask_clarifying_question call rather than a normal end_turn —
   *  structured question + options for the UI to render as clickable choices (phase 9c). `reply`
   *  is still populated (the question text) so a caller that ignores this field degrades to a
   *  plain-text question instead of showing nothing. */
  clarify?: { question: string; options: string[] };
}

/** Optional progress hooks for a caller that wants to surface activity as it happens (9b's SSE
 *  route) rather than only see the final result — purely additive, so callers that don't pass
 *  these (agent-dev.ts, the existing tests) see no behavior change. */
export interface AgentTurnCallbacks {
  /** Fired right before a tool_use block is dispatched. */
  onToolStart?: (toolName: string) => void;
  /** Fired right after dispatch resolves — already-computed outcome, just relayed. */
  onToolResult?: (outcome: ToolDispatchOutcome) => void;
}

const CAP_REACHED_REPLY = "I wasn't able to fully answer that within the allotted steps — could you narrow the request?";
const COST_CEILING_REPLY = "I've done as much as I can within this turn's budget — could you ask again more narrowly?";
const UNRECOGNIZED_REPLY = "I wasn't able to fully answer that — could you rephrase or narrow the request?";
const ABORTED_REPLY = 'This turn was cancelled.';

/**
 * The orchestrator: seeds `messages` with history + the new user message, then loops up to
 * MAX_TOOL_ITERATIONS turns of `tool_choice: auto`, dispatching any tool_use blocks and feeding
 * their results back in, until the model reaches `end_turn` or a guardrail (iteration cap, cost
 * ceiling) trips. This is a genuinely new pattern for the codebase — every other Anthropic call
 * site (classifier/batch.ts, digest/generate.ts) forces a single tool call for one-shot structured
 * extraction; this is model-driven and multi-turn.
 *
 * `signal`, if given, is forwarded to every `client.messages.create` call (the Anthropic SDK
 * aborts an in-flight request when it fires) and also checked at the top of each iteration, so a
 * client disconnect stops the turn before starting another billable call — unlike
 * classifier/digest, a chat turn is never persisted, so nothing is gained by finishing a turn
 * nobody is listening to.
 */
export async function runAgentTurn(
  userId: string,
  history: Anthropic.MessageParam[],
  userMessage: string,
  logger: AgentLogger = consoleAgentLogger,
  callbacks: AgentTurnCallbacks = {},
  signal?: AbortSignal,
): Promise<AgentTurnResult> {
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: userMessage }];
  const toolCalls: AgentTurnResult['toolCalls'] = [];

  if (isDryRun()) {
    return { reply: 'Dry run — no API call made.', history: messages, toolCalls: [], hitIterationCap: false };
  }

  const bucketNames = (await listBuckets(userId)).map((b) => b.name);
  const system = buildAgentSystemPrompt();
  const tools: Anthropic.Tool[] = [
    buildSearchEmailsTool(bucketNames),
    draftReplyTool,
    getThreadDetailTool,
    askClarifyingQuestionTool,
  ];
  const client = getAnthropicClient();
  const ceiling = agentCostCeilingUsd();
  let spentUsd = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      logger.info({}, 'agent turn stopped — client disconnected');
      return { reply: ABORTED_REPLY, history: messages, toolCalls, hitIterationCap: false };
    }

    if (spentUsd > ceiling) {
      logger.info({ spentUsd, ceiling }, 'agent turn stopped — cost ceiling reached');
      return { reply: COST_CEILING_REPLY, history: messages, toolCalls, hitIterationCap: true };
    }

    let message: Anthropic.Message;
    try {
      message = await client.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: MAX_AGENT_OUTPUT_TOKENS,
          system,
          tools,
          tool_choice: { type: 'auto' },
          messages,
        },
        { signal },
      );
    } catch (err) {
      if (isInsufficientCreditsError(err)) throw new InsufficientCreditsError();
      throw err;
    }
    spentUsd += estimateDigestCostUsd({
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    });
    // Anthropic's own documented multi-turn tool-use pattern: a Message's content blocks feed
    // straight back in as the next request's assistant turn.
    messages.push({ role: 'assistant', content: message.content as unknown as Anthropic.ContentBlockParam[] });

    const step = decideNextStep(message);

    if (step.type === 'end_turn') {
      return { reply: step.text, history: messages, toolCalls, hitIterationCap: false };
    }

    if (step.type === 'unrecognized') {
      logger.info({ stopReason: message.stop_reason }, 'agent turn stopped — unrecognized stop reason');
      return { reply: UNRECOGNIZED_REPLY, history: messages, toolCalls, hitIterationCap: false };
    }

    const resultBlocks: Anthropic.ToolResultBlockParam[] = [];
    let clarify: { question: string; options: string[] } | undefined;
    for (const call of step.calls) {
      callbacks.onToolStart?.(call.name);
      const outcome = await dispatchToolCall(call, userId, bucketNames);
      resultBlocks.push(outcome.toolResultBlock);
      toolCalls.push(outcome.logEntry);
      logger.info(
        { tool: outcome.logEntry.name, input: outcome.logEntry.input, resultSummary: outcome.logEntry.resultSummary },
        'agent tool call',
      );
      callbacks.onToolResult?.(outcome);
      if (outcome.uiEvent?.type === 'clarify') clarify = outcome.uiEvent;
    }
    messages.push({ role: 'user', content: resultBlocks });

    // A clarifying question ends the turn immediately, same as end_turn — there is nothing more
    // to do until the user picks an option, and calling the model again now would just spend
    // another billable call on a question it already asked. The tool_result pushed above keeps
    // every tool_use paired for the next turn's history replay even though we stop here.
    if (clarify) {
      return { reply: clarify.question, history: messages, toolCalls, hitIterationCap: false, clarify };
    }
  }

  logger.info({ iterations: MAX_TOOL_ITERATIONS }, 'agent turn stopped — iteration cap reached');
  return { reply: CAP_REACHED_REPLY, history: messages, toolCalls, hitIterationCap: true };
}
