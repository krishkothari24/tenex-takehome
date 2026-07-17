import type Anthropic from '@anthropic-ai/sdk';
import { truncateSnippet, truncateSubject } from '../classifier/validation.js';
import type { DigestCandidateEmail } from './select-input.js';

export const DIGEST_TOOL_NAME = 'record_digest';

export function buildDigestSystemPrompt(): string {
  return [
    "You are an executive assistant briefing a busy professional on what genuinely needs their attention this week, from a pre-filtered shortlist of their most salient emails (unanswered important threads, emails with an explicit deadline or time-sensitive ask, and messages from people they interact with often).",
    '',
    'Rules:',
    '- Write a one-sentence `headline` naming roughly how many things need the user this week (200 characters or fewer).',
    '- Not every email in the shortlist needs an action item — some may already be effectively handled or are informational; count those toward `fyiCount` instead of forcing an entry.',
    "- Each action item's `emailId` MUST be exactly one of the ids given below. Never invent an id, and never reference an email not in the list.",
    '- `title`: a short, actionable phrase (under 12 words, 120 characters or fewer), e.g. "Reply to Sarah about the signed contract."',
    '- `why`: ONE sentence grounded in something concrete from that specific email (its deadline text, subject, or classifier note) — not a generic restatement. 240 characters or fewer.',
    '- `urgency`: "high" for an explicit deadline or a repeatedly-unanswered important thread, "medium" for other important/frequent-sender items, "low" otherwise.',
    '- For "high" urgency items ONLY, also write `draftReply`: a short (2-4 sentence, 500 characters or fewer) professional reply the user could send as-is or edit. Ground it ONLY in the subject/snippet/classifier note given below — never invent names, dates, numbers, or commitments not present in that content. This is a draft for the user to review and send themselves; never imply it has already been sent. For "medium"/"low" urgency items, `draftReply` MUST be null.',
    '- Record everything in a single call to the provided tool.',
  ].join('\n');
}

export function buildDigestUserMessage(emails: DigestCandidateEmail[]): string {
  const items = emails
    .map((e) =>
      [
        `Email id ${e.emailId}:`,
        `  from: ${e.fromAddress ?? '(unknown sender)'}`,
        `  subject: ${truncateSubject(e.subject)}`,
        `  snippet: ${truncateSnippet(e.snippet) || '(no preview available)'}`,
        `  bucket: ${e.bucket ?? '(unsorted)'}`,
        e.justification ? `  classifier note: ${e.justification}` : null,
        e.hasDeadline ? `  deadline: ${e.deadlineText ?? '(unspecified)'}` : null,
        e.isUnansweredImportant ? '  status: important, no reply sent yet' : null,
        e.isVipSender ? '  sender: frequent, high-engagement contact' : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    )
    .join('\n\n');
  return `Here are ${emails.length} shortlisted emails. Decide which genuinely need action this week and record the digest using the tool.\n\n${items}`;
}

/**
 * `emailId` is constrained to the exact shortlist via a JSON-schema enum — the same
 * correctness-by-construction guarantee `prompt.ts`'s `bucket` enum gives the classifier: the
 * model *cannot* cite an email outside the given set, not "is asked not to."
 *
 * `maxLength` on the string fields below must stay in sync with the `.max()` caps in
 * `validation.ts`'s `digestToolOutputSchema` — stating the same number in both places (schema
 * hint to the model here, hard enforcement there) is what keeps the model from writing an
 * oversized field the corrective retry then has to catch.
 */
export function buildDigestTool(validEmailIds: string[]): Anthropic.Tool {
  return {
    name: DIGEST_TOOL_NAME,
    description: 'Record the weekly digest: a headline and a ranked list of action items grounded in the given emails.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        headline: {
          type: 'string',
          maxLength: 200,
          description: 'One sentence summarizing this week at a glance. 200 characters or fewer.',
        },
        actionItems: {
          type: 'array',
          description: 'Ranked action items — omit emails that need no action.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              emailId: { type: 'string', enum: validEmailIds, description: "Must be one of the shortlist's email ids." },
              title: { type: 'string', maxLength: 120, description: 'Short actionable phrase. 120 characters or fewer.' },
              why: {
                type: 'string',
                maxLength: 240,
                description: 'One sentence grounded in the email itself. 240 characters or fewer.',
              },
              urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
              draftReply: {
                description:
                  'A short reply draft grounded only in the given content, present only when urgency is "high"; null for "medium"/"low". 500 characters or fewer.',
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
              },
            },
            required: ['emailId', 'title', 'why', 'urgency', 'draftReply'],
          },
        },
        fyiCount: {
          type: 'integer',
          description: 'Count of shortlisted emails that needed no action item (already handled / informational).',
        },
      },
      required: ['headline', 'actionItems', 'fyiCount'],
    },
  };
}
