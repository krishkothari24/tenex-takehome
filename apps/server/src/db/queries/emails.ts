import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client.js';
import { emails } from '../schema.js';

export interface UpsertEmailInput {
  userId: string;
  gmailThreadId: string;
  gmailMessageId: string;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  internalDate: Date | null;
  rawHeaders?: Record<string, string>;
}

/** Idempotent — keyed on (userId, gmailThreadId), so re-running sync never duplicates rows. */
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

/** All of a user's emails, metadata + snippet only — the input shape the classifier expects. */
export async function listEmailsForClassification(userId: string) {
  return db
    .select({
      id: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      snippet: emails.snippet,
    })
    .from(emails)
    .where(eq(emails.userId, userId))
    .orderBy(desc(emails.internalDate));
}
