import type Anthropic from '@anthropic-ai/sdk';
import type { BucketDef, ClassifierEmail } from './types.js';
import { truncateSnippet, truncateSubject } from './validation.js';

export const TOOL_NAME = 'record_classifications';

export function buildSystemPrompt(buckets: BucketDef[]): string {
  const bucketList = buckets
    .map((b) => `- "${b.name}": ${b.description ?? 'Infer the meaning from the name.'}`)
    .join('\n');
  return [
    "You are an expert email-triage assistant. You sort a user's inbox into buckets.",
    '',
    'Available buckets:',
    bucketList,
    '',
    'Rules:',
    '- Classify EVERY email into exactly one primary bucket, chosen ONLY from the list above.',
    '- Decide from the sender, subject, and snippet provided — nothing else.',
    '- Give a confidence from 0 to 1 for the primary bucket.',
    '- Justification: ONE short sentence grounded in something concrete (a phrase, the sender type, a deadline) — not a generic restatement of the bucket name.',
    '- If a second bucket is a genuinely close call, set secondaryBucket to it; otherwise null. Never make secondaryBucket the same as the primary bucket.',
    '- Also set `hasDeadline`: true only if the email mentions a specific date, deadline, or explicit time-sensitive ask (e.g. "sign by Friday", "renewal due March 3", "please respond today"). If true, set `deadlineText` to a short phrase quoted or closely paraphrased from the email itself — never invent or resolve a date the email does not state. If false, `deadlineText` must be null.',
    '- Record all results in a single call to the provided tool: one entry per email, referencing the email by its `index` number. Do not skip or duplicate any index.',
  ].join('\n');
}

export function buildBatchUserMessage(emails: ClassifierEmail[]): string {
  const items = emails
    .map((e, i) =>
      [
        `Email index ${i + 1}:`,
        `  from: ${e.fromAddress ?? '(unknown sender)'}`,
        `  subject: ${truncateSubject(e.subject)}`,
        `  snippet: ${truncateSnippet(e.snippet) || '(no preview available)'}`,
      ].join('\n'),
    )
    .join('\n\n');
  return `Classify these ${emails.length} emails and record one entry per email (by index) using the tool.\n\n${items}`;
}

/**
 * The forced tool. `strict: true` + `additionalProperties: false` + every field `required`
 * guarantees the parsed input matches this schema by construction, and the `bucket` enum means
 * the model *cannot* emit a bucket outside the user's set — a correctness property, not a hope.
 */
export function buildClassifyTool(bucketNames: string[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: 'Record the bucket classification for every email in the batch.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        classifications: {
          type: 'array',
          description: 'One entry per email in the batch.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: {
                type: 'integer',
                description: 'The email\'s 1-based index from the list.',
              },
              bucket: {
                type: 'string',
                enum: bucketNames,
                description: 'Primary bucket — must be one of the listed names.',
              },
              confidence: {
                type: 'number',
                description: 'Confidence from 0 to 1 for the primary bucket.',
              },
              justification: {
                type: 'string',
                description: 'One short sentence grounded in the email.',
              },
              secondaryBucket: {
                description: 'A close-second bucket, or null when there is no close call.',
                anyOf: [{ type: 'string', enum: bucketNames }, { type: 'null' }],
              },
              hasDeadline: {
                type: 'boolean',
                description: 'True only if the email states a specific date, deadline, or explicit time-sensitive ask.',
              },
              deadlineText: {
                description:
                  'A short phrase quoted/paraphrased from the email when hasDeadline is true; null when hasDeadline is false. Never a resolved calendar date the email did not state.',
                anyOf: [{ type: 'string' }, { type: 'null' }],
              },
            },
            required: [
              'index',
              'bucket',
              'confidence',
              'justification',
              'secondaryBucket',
              'hasDeadline',
              'deadlineText',
            ],
          },
        },
      },
      required: ['classifications'],
    },
  };
}
