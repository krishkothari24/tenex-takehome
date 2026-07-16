import { z } from 'zod';

/**
 * Wire format for one turn's conversation history (docs/AGENTIC_CHAT_PLAN.md: ephemeral,
 * client-held — no DB table, the client resends this array every turn). Deliberately NOT a mirror
 * of the full `@anthropic-ai/sdk` `MessageParam`/`ContentBlockParam` union — the agent loop
 * (apps/server/src/services/agent/loop.ts) only ever produces three block kinds (text, tool_use,
 * tool_result), so that's all this schema accepts. Mirroring the whole SDK union would be
 * permanent maintenance surface for block kinds (e.g. `image`) this app has no code path to handle
 * safely, and would accept them from an untrusted client. Bounded string/array lengths throughout
 * so a single request can't smuggle an oversized payload into a real, billable Anthropic call.
 */
const agentTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(4000),
});

const agentToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().max(200),
  name: z.string().max(100),
  // Re-validated by tools.ts's own Zod schemas at dispatch time — never trusted here.
  input: z.unknown(),
});

const agentToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().max(200),
  // Bounds a MAX_SEARCH_RESULTS-sized JSON blob (search_emails results) with headroom.
  content: z.string().max(8000),
  is_error: z.boolean().optional(),
});

const agentContentBlockSchema = z.discriminatedUnion('type', [
  agentTextBlockSchema,
  agentToolUseBlockSchema,
  agentToolResultBlockSchema,
]);

export const agentMessageParamSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string().max(4000), z.array(agentContentBlockSchema).max(20)]),
});
export type AgentMessageParam = z.infer<typeof agentMessageParamSchema>;

/**
 * `POST /api/agent/chat` request body. `history.max(40)` is a generous bound for real
 * conversations (MAX_TOOL_ITERATIONS is 5 per turn, and each turn adds at most a handful of
 * messages) while still rejecting a runaway or malicious payload before it reaches the loop.
 */
export const agentChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.array(agentMessageParamSchema).max(40),
});
export type AgentChatRequest = z.infer<typeof agentChatRequestSchema>;

/**
 * The SSE contract for `POST /api/agent/chat`. `started` fires immediately; `status` frames carry
 * human-readable tool activity ("Searching your inbox…") so the multi-step nature of the agent is
 * visible, not hidden behind a spinner; `draft` fires as soon as `draft_reply` produces a result,
 * ahead of the final `done` frame, so the UI can render the draft card as soon as it exists; exactly
 * one `done` or `error` frame closes the stream. `done.history` is the same wire schema as the
 * request — the server projects `Anthropic.MessageParam[]` down into it before sending, so the
 * client never needs its own copy of the SDK's types.
 */
export const agentStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started') }),
  z.object({ type: z.literal('status'), message: z.string() }),
  z.object({ type: z.literal('draft'), threadId: z.string(), draftText: z.string() }),
  z.object({
    type: z.literal('done'),
    reply: z.string(),
    history: z.array(agentMessageParamSchema),
    toolCalls: z.array(z.object({ name: z.string(), resultSummary: z.string() })),
    hitIterationCap: z.boolean(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;
