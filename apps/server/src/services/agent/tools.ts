import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MAX_SEARCH_RESULTS } from './config.js';

export const SEARCH_EMAILS_TOOL_NAME = 'search_emails';
export const DRAFT_REPLY_TOOL_NAME = 'draft_reply';

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
