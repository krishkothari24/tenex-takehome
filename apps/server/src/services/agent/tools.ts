import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MAX_SEARCH_RESULTS } from './config.js';

export const SEARCH_EMAILS_TOOL_NAME = 'search_emails';
export const DRAFT_REPLY_TOOL_NAME = 'draft_reply';
export const GET_THREAD_DETAIL_TOOL_NAME = 'get_thread_detail';
export const ASK_CLARIFYING_QUESTION_TOOL_NAME = 'ask_clarifying_question';

/**
 * `strict: true` + `additionalProperties: false` requires every property to appear in `required`,
 * even ones that are conceptually optional — the same "required but nullable" idiom
 * ../classifier/prompt.ts uses for `secondaryBucket`. Null means "no filter on this field", not
 * "unset"; the model must pass it explicitly rather than omitting a key.
 */
export function buildSearchEmailsTool(bucketNames: string[]): Anthropic.Tool {
  return {
    name: SEARCH_EMAILS_TOOL_NAME,
    description:
      "Search the user's already-classified inbox by keyword, sender, bucket, and/or unread status. " +
      'Returns metadata only (subject/sender/snippet/bucket) — never a full email body. ' +
      `Results are capped at ${MAX_SEARCH_RESULTS} even if a higher limit is requested.`,
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keyword: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Free-text match against subject/snippet, or null for no keyword filter.',
        },
        sender: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Match against the sender address/name, or null for no sender filter.',
        },
        bucket: {
          anyOf: [{ type: 'string', enum: bucketNames }, { type: 'null' }],
          description: "One of the user's bucket names, or null for no bucket filter.",
        },
        is_unread: {
          anyOf: [{ type: 'boolean' }, { type: 'null' }],
          description: 'true to match only unread threads, false for only read, null for either.',
        },
        limit: {
          anyOf: [{ type: 'integer' }, { type: 'null' }],
          description: `Max results to return (server caps at ${MAX_SEARCH_RESULTS}), or null for the default.`,
        },
      },
      required: ['keyword', 'sender', 'bucket', 'is_unread', 'limit'],
    },
  };
}

export const draftReplyTool: Anthropic.Tool = {
  name: DRAFT_REPLY_TOOL_NAME,
  description:
    'Draft a reply for one email thread, grounded only in that thread\'s subject/sender/snippet. ' +
    'Produces a draft for the human to review and send themselves — never claim it was sent.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      thread_id: {
        type: 'string',
        description: "The email's thread_id, as returned by search_emails. Never invent one.",
      },
      intent: {
        type: 'string',
        description: 'What the reply should say or accomplish, in the user\'s own words.',
      },
    },
    required: ['thread_id', 'intent'],
  },
};

export const getThreadDetailTool: Anthropic.Tool = {
  name: GET_THREAD_DETAIL_TOOL_NAME,
  description:
    "Get richer metadata for one email thread — bucket, secondary bucket, classifier confidence " +
    'and justification, deadline signal, message count, and whether the user has replied. ' +
    'Still metadata only, never a full email body. Use this when a search_emails snippet isn\'t ' +
    'enough to answer confidently, e.g. to explain why a thread was classified a certain way, ' +
    'check for a deadline, or see how many messages are in the thread.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      thread_id: {
        type: 'string',
        description: "The thread's thread_id, as returned by search_emails. Never invent one.",
      },
    },
    required: ['thread_id'],
  },
};

export const askClarifyingQuestionTool: Anthropic.Tool = {
  name: ASK_CLARIFYING_QUESTION_TOOL_NAME,
  description:
    'Ask the user a clarifying question with a small set of distinct choices, when a request could ' +
    'refer to more than one distinct person, sender, or thread and it is not clear which is meant ' +
    '(e.g. "email from John" matching two different Johns). Do not guess — call this instead of ' +
    'asking in plain text, so the user can pick from clickable options. Call it alone, not ' +
    'alongside another tool call in the same turn.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      question: { type: 'string', description: 'The clarifying question to show the user.' },
      // No minItems/maxItems here: Anthropic's `strict: true` custom tools only support 0 or 1 for
      // array minItems/maxItems (confirmed via a live 400 — "'minItems' values other than 0 or 1
      // are not supported"). The 2-6 bound is enforced by askClarifyingQuestionInputSchema (Zod)
      // at dispatch time instead — same "JSON-schema strict mode can't express this, so Zod
      // re-validates it" idiom this file already uses for confidence ranges elsewhere.
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exactly 2-6 distinct options the user can choose between, e.g. sender names/emails.',
      },
    },
    required: ['question', 'options'],
  },
};

/** Defense-in-depth validation of the model's tool-call input, same idiom as
 *  ../classifier/validation.ts's classificationBatchSchema — strict mode already constrains shape
 *  and the bucket enum at the API layer, this re-checks it and adds length guards JSON-schema
 *  strict mode can't express. */
export function searchEmailsInputSchema(bucketNames: string[]) {
  const bucketEnum = z.enum(bucketNames as [string, ...string[]]);
  return z.object({
    keyword: z.string().trim().min(1).max(200).nullable(),
    sender: z.string().trim().min(1).max(200).nullable(),
    bucket: bucketEnum.nullable(),
    is_unread: z.boolean().nullable(),
    limit: z.number().int().positive().nullable(),
  });
}

export type SearchEmailsInput = z.infer<ReturnType<typeof searchEmailsInputSchema>>;

export const draftReplyInputSchema = z.object({
  thread_id: z.string().trim().min(1),
  intent: z.string().trim().min(1).max(500),
});

export type DraftReplyInput = z.infer<typeof draftReplyInputSchema>;

export const getThreadDetailInputSchema = z.object({
  thread_id: z.string().trim().min(1),
});

export type GetThreadDetailInput = z.infer<typeof getThreadDetailInputSchema>;

/** Bounded independently of the JSON-schema `strict`/`minItems`/`maxItems` constraints above —
 *  same defense-in-depth idiom as searchEmailsInputSchema's length guards. Matters more here than
 *  for the other tools: this payload round-trips through the client-held conversation history on
 *  every subsequent turn (see agentMessageParamSchema in packages/shared), so an unbounded option
 *  list would inflate every future request, not just this one. */
export const askClarifyingQuestionInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
});

export type AskClarifyingQuestionInput = z.infer<typeof askClarifyingQuestionInputSchema>;
