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
import { buildAgentSystemPrompt } from './prompt.js';
import { normalizeSearchFilters, searchEmails } from './search-emails.js';
import {
  buildSearchEmailsTool,
  draftReplyInputSchema,
  draftReplyTool,
  DRAFT_REPLY_TOOL_NAME,
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

interface ToolDispatchOutcome {
  toolResultBlock: Anthropic.ToolResultBlockParam;
  logEntry: { name: string; input: unknown; resultSummary: string };
}

/**
 * Dispatches one tool_use block. Never throws except InsufficientCreditsError (draft_reply's own
 * internal Sonnet call can hit this, and it must abort the whole turn, not just this one call —
 * every subsequent call would fail identically). Everything else — bad input, a not-found thread,
 * an unexpected DB error — becomes a relayable tool_result error, matching CLAUDE.md's "a failed
 * batch degrades gracefully" rule applied to a single tool call within a turn.
 */
async function dispatchToolCall(
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
      };
    }

    // Unreachable in practice — the tools array only ever offers these two names — but a
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
}

const CAP_REACHED_REPLY = "I wasn't able to fully answer that within the allotted steps — could you narrow the request?";
const COST_CEILING_REPLY = "I've done as much as I can within this turn's budget — could you ask again more narrowly?";
const UNRECOGNIZED_REPLY = "I wasn't able to fully answer that — could you rephrase or narrow the request?";

/**
 * The orchestrator: seeds `messages` with history + the new user message, then loops up to
 * MAX_TOOL_ITERATIONS turns of `tool_choice: auto`, dispatching any tool_use blocks and feeding
 * their results back in, until the model reaches `end_turn` or a guardrail (iteration cap, cost
 * ceiling) trips. This is a genuinely new pattern for the codebase — every other Anthropic call
 * site (classifier/batch.ts, digest/generate.ts) forces a single tool call for one-shot structured
 * extraction; this is model-driven and multi-turn.
 */
export async function runAgentTurn(
  userId: string,
  history: Anthropic.MessageParam[],
  userMessage: string,
  logger: AgentLogger = consoleAgentLogger,
): Promise<AgentTurnResult> {
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: userMessage }];
  const toolCalls: AgentTurnResult['toolCalls'] = [];

  if (isDryRun()) {
    return { reply: 'Dry run — no API call made.', history: messages, toolCalls: [], hitIterationCap: false };
  }

  const bucketNames = (await listBuckets(userId)).map((b) => b.name);
  const system = buildAgentSystemPrompt();
  const tools: Anthropic.Tool[] = [buildSearchEmailsTool(bucketNames), draftReplyTool];
  const client = getAnthropicClient();
  const ceiling = agentCostCeilingUsd();
  let spentUsd = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (spentUsd > ceiling) {
      logger.info({ spentUsd, ceiling }, 'agent turn stopped — cost ceiling reached');
      return { reply: COST_CEILING_REPLY, history: messages, toolCalls, hitIterationCap: true };
    }

    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_AGENT_OUTPUT_TOKENS,
        system,
        tools,
        tool_choice: { type: 'auto' },
        messages,
      });
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
    for (const call of step.calls) {
      const outcome = await dispatchToolCall(call, userId, bucketNames);
      resultBlocks.push(outcome.toolResultBlock);
      toolCalls.push(outcome.logEntry);
      logger.info(
        { tool: outcome.logEntry.name, input: outcome.logEntry.input, resultSummary: outcome.logEntry.resultSummary },
        'agent tool call',
      );
    }
    messages.push({ role: 'user', content: resultBlocks });
  }

  logger.info({ iterations: MAX_TOOL_ITERATIONS }, 'agent turn stopped — iteration cap reached');
  return { reply: CAP_REACHED_REPLY, history: messages, toolCalls, hitIterationCap: true };
}
