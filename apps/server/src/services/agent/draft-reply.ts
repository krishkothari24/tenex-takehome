import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { findEmailByThreadForUser } from '../../db/queries/emails.js';
import { getAnthropicClient, isInsufficientCreditsError } from '../classifier/anthropic.js';
import { InsufficientCreditsError } from '../classifier/errors.js';
import { truncateSnippet, truncateSubject } from '../classifier/validation.js';
import { AGENT_MODEL, MAX_AGENT_OUTPUT_TOKENS } from './config.js';
import { DraftGenerationError } from './errors.js';
import { buildDraftSystemPrompt } from './prompt.js';
import type { DraftReplyInput } from './tools.js';

const RECORD_DRAFT_TOOL_NAME = 'record_draft';

const recordDraftTool: Anthropic.Tool = {
  name: RECORD_DRAFT_TOOL_NAME,
  description: 'Record the drafted reply text.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      draftText: { type: 'string', description: 'The drafted reply, 2-4 short sentences.' },
    },
    required: ['draftText'],
  },
};

const draftOutputSchema = z.object({
  draftText: z.string().trim().min(1).max(1000),
});

function buildDraftUserMessage(
  email: { subject: string | null; fromAddress: string | null; snippet: string | null },
  intent: string,
): string {
  return [
    `Thread subject: ${truncateSubject(email.subject)}`,
    `From: ${email.fromAddress ?? '(unknown sender)'}`,
    `Snippet: ${truncateSnippet(email.snippet) || '(no preview available)'}`,
    '',
    `The user's intent for the reply: ${intent}`,
    '',
    'Draft the reply now using the tool.',
  ].join('\n');
}

function extractToolInput(message: Anthropic.Message): unknown {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === RECORD_DRAFT_TOOL_NAME,
  );
  if (!block) throw new Error('model did not return the expected tool call');
  return block.input;
}

export type DraftReplyResult =
  | { ok: true; data: { draftText: string } }
  | { ok: false; error: string };

/**
 * One-shot forced tool-choice Sonnet call, same shape as ../digest/generate.ts — looks up
 * subject/sender/snippet by thread_id ONLY (never a body, per CLAUDE.md's "metadata + snippet
 * only" rule), scoped to the authenticated user, then drafts a grounded reply. Returns a
 * discriminated result rather than throwing for the "no such thread" case — that's a normal,
 * relayable outcome for the outer loop, not a crash; only DraftGenerationError (validation failed
 * twice) and InsufficientCreditsError propagate, both handled by loop.ts's dispatch try/catch.
 */
export async function draftReply(userId: string, input: DraftReplyInput): Promise<DraftReplyResult> {
  const email = await findEmailByThreadForUser(input.thread_id, userId);
  if (!email) {
    return { ok: false, error: 'No email found for that thread_id. Search first to find the right thread.' };
  }

  const client = getAnthropicClient();
  const system = buildDraftSystemPrompt();
  const baseUserMessage = buildDraftUserMessage(email, input.intent);

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const userMessage =
      attempt === 0
        ? baseUserMessage
        : `${baseUserMessage}\n\nYour previous attempt was rejected (${lastError}). Return a non-empty draftText.`;

    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_AGENT_OUTPUT_TOKENS,
        system,
        tools: [recordDraftTool],
        tool_choice: { type: 'tool', name: RECORD_DRAFT_TOOL_NAME, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      if (isInsufficientCreditsError(err)) throw new InsufficientCreditsError();
      throw err;
    }

    try {
      const parsed = draftOutputSchema.parse(extractToolInput(message));
      return { ok: true, data: { draftText: parsed.draftText } };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new DraftGenerationError(lastError);
}
