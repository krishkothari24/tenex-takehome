import { getThreadDetailForUser } from '../../db/queries/classifications.js';
import { truncateSnippet, truncateSubject } from '../classifier/validation.js';
import type { GetThreadDetailInput } from './tools.js';

export interface ThreadDetailResult {
  subject: string;
  from: string | null;
  snippet: string;
  internalDate: string | null;
  bucket: string | null;
  secondaryBucket: string | null;
  confidence: number | null;
  justification: string | null;
  status: string | null;
  hasDeadline: boolean | null;
  deadlineText: string | null;
  messageCount: number | null;
  hasReplyFromUser: boolean | null;
  isUnread: boolean | null;
}

/** Pure — the piece unit-tested without a DB (see get-thread-detail.test.ts). Shapes the raw
 *  joined row into the tool_result payload: truncates subject/snippet (same guards
 *  search-emails.ts applies) and projects internalDate down to an ISO string or null, since a raw
 *  Date isn't JSON-stable across the tool_result round trip. */
export function toThreadDetailResult(row: {
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  internalDate: Date | null;
  bucket: string | null;
  secondaryBucket: string | null;
  confidence: number | null;
  justification: string | null;
  status: string | null;
  hasDeadline: boolean | null;
  deadlineText: string | null;
  messageCount: number | null;
  hasReplyFromUser: boolean | null;
  isUnread: boolean | null;
}): ThreadDetailResult {
  return {
    subject: truncateSubject(row.subject),
    from: row.fromAddress,
    snippet: truncateSnippet(row.snippet),
    internalDate: row.internalDate ? row.internalDate.toISOString() : null,
    bucket: row.bucket,
    secondaryBucket: row.secondaryBucket,
    confidence: row.confidence,
    justification: row.justification,
    status: row.status,
    hasDeadline: row.hasDeadline,
    deadlineText: row.deadlineText,
    messageCount: row.messageCount,
    hasReplyFromUser: row.hasReplyFromUser,
    isUnread: row.isUnread,
  };
}

/**
 * New query for the agent (docs/AGENTIC_CHAT_PLAN.md phase 9c) — richer metadata than
 * search_emails' summary, still never a body, per CLAUDE.md's "metadata + snippet only" rule.
 * Scoped to the authenticated user via getThreadDetailForUser's own ownership check; returns null
 * if the thread doesn't exist or belongs to someone else, same as draft-reply.ts's lookup.
 */
export async function getThreadDetail(
  userId: string,
  input: GetThreadDetailInput,
): Promise<ThreadDetailResult | null> {
  const row = await getThreadDetailForUser(input.thread_id, userId);
  if (!row) return null;
  return toThreadDetailResult(row);
}
