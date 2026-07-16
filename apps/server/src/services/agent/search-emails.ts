import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { buckets, classificationResults, emails } from '../../db/schema.js';
import { truncateSnippet, truncateSubject } from '../classifier/validation.js';
import { MAX_SEARCH_RESULTS } from './config.js';
import type { SearchEmailsInput } from './tools.js';

export interface NormalizedSearchFilters {
  keyword: string | null;
  sender: string | null;
  bucket: string | null;
  isUnread: boolean | null;
  limit: number;
}

/** Pure — the piece unit-tested without a DB (see search-emails.test.ts). Renames is_unread to
 *  isUnread and clamps the model's requested limit to MAX_SEARCH_RESULTS regardless of what it
 *  asked for; Zod (tools.ts's searchEmailsInputSchema) has already trimmed/validated the strings
 *  and confirmed limit is a positive integer by the time this runs. */
export function normalizeSearchFilters(input: SearchEmailsInput): NormalizedSearchFilters {
  return {
    keyword: input.keyword,
    sender: input.sender,
    bucket: input.bucket,
    isUnread: input.is_unread,
    limit: input.limit ? Math.min(input.limit, MAX_SEARCH_RESULTS) : MAX_SEARCH_RESULTS,
  };
}

export interface SearchEmailResult {
  threadId: string;
  subject: string;
  from: string | null;
  snippet: string;
  bucket: string | null;
  isUnread: boolean | null;
}

/**
 * New query (today's "search" elsewhere in the app is a client-side Array.filter, no backend
 * route) — scoped to the user always, metadata + snippet only, never a body. `threadId` (Gmail's
 * thread id, not the row's uuid) is what draft_reply keys on later, so it's surfaced here rather
 * than the internal email id.
 */
export async function searchEmails(
  userId: string,
  filters: NormalizedSearchFilters,
): Promise<SearchEmailResult[]> {
  const conditions = [eq(emails.userId, userId)];
  if (filters.keyword) {
    const pattern = `%${filters.keyword}%`;
    const keywordMatch = or(ilike(emails.subject, pattern), ilike(emails.snippet, pattern));
    if (keywordMatch) conditions.push(keywordMatch);
  }
  if (filters.sender) {
    conditions.push(ilike(emails.fromAddress, `%${filters.sender}%`));
  }
  if (filters.bucket) {
    conditions.push(eq(buckets.name, filters.bucket));
  }
  if (filters.isUnread !== null) {
    conditions.push(eq(emails.isUnread, filters.isUnread));
  }

  const rows = await db
    .select({
      threadId: emails.gmailThreadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      snippet: emails.snippet,
      bucket: buckets.name,
      isUnread: emails.isUnread,
    })
    .from(emails)
    .leftJoin(classificationResults, eq(classificationResults.emailId, emails.id))
    .leftJoin(buckets, eq(classificationResults.bucketId, buckets.id))
    .where(and(...conditions))
    .orderBy(desc(emails.internalDate))
    .limit(filters.limit);

  return rows.map((r) => ({
    threadId: r.threadId,
    subject: truncateSubject(r.subject),
    from: r.fromAddress,
    snippet: truncateSnippet(r.snippet),
    bucket: r.bucket,
    isUnread: r.isUnread,
  }));
}
