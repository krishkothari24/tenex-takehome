import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client.js';
import { classificationResults, emails } from '../schema.js';

export interface UpsertEmailInput {
  userId: string;
  gmailThreadId: string;
  gmailMessageId: string;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  internalDate: Date | null;
  rawHeaders?: Record<string, string>;
  messageCount: number | null;
  hasReplyFromUser: boolean | null;
}

/**
 * Idempotent — keyed on (userId, gmailThreadId), so re-running sync never duplicates rows. Also
 * how pre-migration rows get `messageCount`/`hasReplyFromUser` backfilled for free: a plain re-sync
 * runs this same `onConflictDoUpdate` path with the new fields populated.
 */
export async function upsertEmail(input: UpsertEmailInput) {
  await db
    .insert(emails)
    .values({
      userId: input.userId,
      gmailThreadId: input.gmailThreadId,
      gmailMessageId: input.gmailMessageId,
      subject: input.subject,
      fromAddress: input.fromAddress,
      snippet: input.snippet,
      internalDate: input.internalDate,
      rawHeaders: input.rawHeaders ?? null,
      messageCount: input.messageCount,
      hasReplyFromUser: input.hasReplyFromUser,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [emails.userId, emails.gmailThreadId],
      set: {
        gmailMessageId: input.gmailMessageId,
        subject: input.subject,
        fromAddress: input.fromAddress,
        snippet: input.snippet,
        internalDate: input.internalDate,
        rawHeaders: input.rawHeaders ?? null,
        messageCount: input.messageCount,
        hasReplyFromUser: input.hasReplyFromUser,
        updatedAt: new Date(),
      },
    });
}

export async function listRecentEmails(userId: string, limit = 20) {
  return db
    .select()
    .from(emails)
    .where(and(eq(emails.userId, userId)))
    .orderBy(desc(emails.internalDate))
    .limit(limit);
}

export async function countEmails(userId: string) {
  const rows = await db.select({ id: emails.id }).from(emails).where(eq(emails.userId, userId));
  return rows.length;
}

/** Ownership check + the fields a manual bucket move needs — null if the email doesn't exist or
 *  doesn't belong to this user (never trust a client-supplied emailId without this). */
export async function findEmailForUser(emailId: string, userId: string) {
  const [row] = await db
    .select({ id: emails.id, fromAddress: emails.fromAddress })
    .from(emails)
    .where(and(eq(emails.id, emailId), eq(emails.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Every email from a given sender for this user — used to apply an accepted sender rule to
 *  already-synced emails immediately, not just future reclassify runs. */
export async function listEmailIdsFromSender(userId: string, fromAddress: string) {
  return db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.userId, userId), eq(emails.fromAddress, fromAddress)));
}

/**
 * All of a user's emails, metadata + snippet only — the input shape the classifier expects.
 * Also carries `isManualOverride` and the existing deadline signal (left-joined, so `null` for a
 * never-classified email) — `runClassifyStreamRoute` uses these to split emails into "never
 * re-sent to Haiku" (manual override / sender rule) vs. the real batched-classify path, without a
 * second round-trip.
 */
export async function listEmailsForClassification(userId: string) {
  return db
    .select({
      id: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      snippet: emails.snippet,
      isManualOverride: classificationResults.isManualOverride,
      hasDeadline: classificationResults.hasDeadline,
      deadlineText: classificationResults.deadlineText,
    })
    .from(emails)
    .leftJoin(classificationResults, eq(classificationResults.emailId, emails.id))
    .where(eq(emails.userId, userId))
    .orderBy(desc(emails.internalDate));
}
