import type { FastifyReply, FastifyRequest } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import {
  agentMessageParamSchema,
  type AgentChatRequest,
  type AgentMessageParam,
  type AgentStreamEvent,
} from '@inbox-concierge/shared';
import { InsufficientCreditsError } from '../classifier/errors.js';
import { runAgentTurn } from './loop.js';
import type { ToolDispatchOutcome } from './loop.js';
import {
  ASK_CLARIFYING_QUESTION_TOOL_NAME,
  DRAFT_REPLY_TOOL_NAME,
  GET_THREAD_DETAIL_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
} from './tools.js';

export interface RunAgentChatStreamRouteParams {
  request: FastifyRequest;
  reply: FastifyReply;
  userId: string;
  body: AgentChatRequest;
}

const STATUS_TEXT: Record<string, string> = {
  [SEARCH_EMAILS_TOOL_NAME]: 'Searching your inbox…',
  [DRAFT_REPLY_TOOL_NAME]: 'Preparing a draft…',
  [GET_THREAD_DETAIL_TOOL_NAME]: 'Looking up thread details…',
  [ASK_CLARIFYING_QUESTION_TOOL_NAME]: 'Checking which one you mean…',
};

/** The wire schema (agentMessageParamSchema) is a deliberately-narrowed, already-Zod-validated
 *  subset of Anthropic's `MessageParam`/`ContentBlockParam` union (see packages/shared's
 *  agent.ts) — this cast is the one place that structural compatibility is asserted for the
 *  inbound direction. Re-validating here would just re-check what the route's
 *  `agentChatRequestSchema.safeParse` already confirmed. */
function toSdkHistory(history: AgentMessageParam[]): Anthropic.MessageParam[] {
  return history as unknown as Anthropic.MessageParam[];
}

/** Outbound direction is real Zod validation, not just a cast: `result.history` comes from the
 *  Anthropic SDK, which could in principle include a content-block kind this app's wire schema
 *  doesn't model (e.g. if extended thinking or a built-in tool were ever turned on). Parsing here
 *  means that drift fails loudly as a caught, logged `error` SSE frame instead of silently
 *  shipping a shape the client's own schema would reject. */
function toWireHistory(history: Anthropic.MessageParam[]): AgentMessageParam[] {
  return agentMessageParamSchema.array().parse(history);
}

/**
 * SSE body for `POST /api/agent/chat` — same `reply.hijack()` + raw SSE write skeleton as
 * `../digest/stream-route.ts`. One deliberate deviation: unlike classify/digest (which persist to
 * Postgres regardless of whether anyone is still listening), a chat turn is never persisted, so a
 * client disconnect aborts the in-flight Anthropic call via `AbortController` rather than letting
 * it run to completion — continuing would just spend against the cost ceiling for a reply nobody
 * will ever see.
 */
export async function runAgentChatStreamRoute({ request, reply, userId, body }: RunAgentChatStreamRouteParams): Promise<void> {
  const controller = new AbortController();

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  request.raw.on('close', () => {
    request.log.debug('SSE client disconnected — aborting the in-flight agent turn');
    controller.abort();
  });

  const send = (event: AgentStreamEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      request.log.debug({ err }, 'SSE write failed (client likely disconnected)');
    }
  };

  send({ type: 'started' });

  try {
    const result = await runAgentTurn(
      userId,
      toSdkHistory(body.history),
      body.message,
      request.log,
      {
        onToolStart: (name) => {
          const message = STATUS_TEXT[name];
          if (message) send({ type: 'status', message });
        },
        onToolResult: (outcome: ToolDispatchOutcome) => {
          // Only `draft` gets its own intermediate frame, ahead of `done` — `clarify` has no
          // separate SSE event type; it's surfaced solely via `done.clarify` once the turn ends
          // (see the `send({ type: 'done', ... })` call below), since ending the turn IS what an
          // ask_clarifying_question dispatch does (see loop.ts's early-return on `clarify`).
          if (outcome.uiEvent?.type === 'draft') send(outcome.uiEvent);
        },
      },
      controller.signal,
    );

    send({
      type: 'done',
      reply: result.reply,
      history: toWireHistory(result.history),
      toolCalls: result.toolCalls.map((c) => ({ name: c.name, resultSummary: c.resultSummary })),
      hitIterationCap: result.hitIterationCap,
      ...(result.clarify ? { clarify: result.clarify } : {}),
    });
    request.log.info(
      { toolCalls: result.toolCalls.length, hitIterationCap: result.hitIterationCap },
      'Agent chat turn completed',
    );
  } catch (err) {
    if (controller.signal.aborted) {
      // Expected on disconnect — the client is gone, so send() below is a harmless no-op and this
      // isn't a real failure worth an error-level log line.
      request.log.debug('Agent chat turn aborted after client disconnect');
    } else {
      const { code, message } = describeAgentError(err);
      request.log.error({ err, code }, 'Agent chat turn failed');
      send({ type: 'error', code, message });
    }
  } finally {
    reply.raw.end();
  }
}

function describeAgentError(err: unknown): { code: string; message: string } {
  if (err instanceof InsufficientCreditsError) return { code: 'INSUFFICIENT_CREDITS', message: err.message };
  return {
    code: 'AGENT_CHAT_FAILED',
    message: err instanceof Error ? err.message : 'Agent chat turn failed unexpectedly.',
  };
}
