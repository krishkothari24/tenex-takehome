import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ClassificationStatus } from '@inbox-concierge/shared';
import { db } from '../client.js';
import { buckets, classificationResults, emails } from '../schema.js';

export interface UpsertClassificationInput {
  emailId: string;
  bucketId: string | null;
  secondaryBucketId: string | null;
  confidence: number | null;
  justification: string | null;
  status: ClassificationStatus;
  hasDeadline: boolean | null;
  deadlineText: string | null;
}

/** Idempotent — keyed on emailId, so a full re-run replaces rather than duplicates. */
export async function upsertClassification(input: UpsertClassificationInput): Promise<void> {
  await db
    .insert(classificationResults)
    .values({
      emailId: input.emailId,
      bucketId: input.bucketId,
      secondaryBucketId: input.secondaryBucketId,
      confidence: input.confidence,
      justification: input.justification,
      status: input.status,
      hasDeadline: input.hasDeadline,
      deadlineText: input.deadlineText,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: classificationResults.emailId,
      set: {
        bucketId: input.bucketId,
        secondaryBucketId: input.secondaryBucketId,
        confidence: input.confidence,
        justification: input.justification,
        status: input.status,
        hasDeadline: input.hasDeadline,
        deadlineText: input.deadlineText,
        updatedAt: new Date(),
      },
    });
}

export interface SetManualBucketInput {
  emailId: string;
  bucketId: string;
}

/**
 * A human-authored bucket assignment (a direct manual move, or a sender rule applying to a
 * matching email) — flags `isManualOverride` so the reclassify pipeline skips this row entirely
 * (see stream-route.ts) rather than letting the next full re-run silently clobber it. No model
 * reasoning behind a manual pick, so `justification`/`confidence`/`secondaryBucket` are cleared;
 * `hasDeadline`/`deadlineText` are left untouched — those are still real model-derived facts
 * about the email's content, unrelated to which bucket a human chose.
 */
export async function setManualBucket(input: SetManualBucketInput): Promise<void> {
  await db
    .insert(classificationResults)
    .values({
      emailId: input.emailId,
      bucketId: input.bucketId,
      secondaryBucketId: null,
      confidence: null,
      justification: null,
      status: 'classified',
      isManualOverride: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: classificationResults.emailId,
      set: {
        bucketId: input.bucketId,
        secondaryBucketId: null,
        confidence: null,
        justification: null,
        status: 'classified',
        isManualOverride: true,
        updatedAt: new Date(),
      },
    });
}

/** The email's current bucket, if classified yet — used to record `fromBucketId` on a correction. */
export async function getCurrentBucketId(emailId: string): Promise<string | null> {
  const [row] = await db
    .select({ bucketId: classificationResults.bucketId })
    .from(classificationResults)
    .where(eq(classificationResults.emailId, emailId))
    .limit(1);
  return row?.bucketId ?? null;
}

/** Persist a failed batch's emails as visibly `unclassified` (bucketId null) — never a silent drop. */
export async function markEmailsUnclassified(emailIds: string[]): Promise<void> {
  for (const emailId of emailIds) {
    await upsertClassification({
      emailId,
      bucketId: null,
      secondaryBucketId: null,
      confidence: null,
      justification: null,
      status: 'unclassified',
      hasDeadline: null,
      deadlineText: null,
    });
  }
}

const primaryBucket = alias(buckets, 'primary_bucket');
const secondaryBucket = alias(buckets, 'secondary_bucket');

/** Joined view of a user's current classifications (bucket names resolved) — for the CLI + Phase 3. */
export async function listClassificationsForUser(userId: string) {
  return db
    .select({
      emailId: classificationResults.emailId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      snippet: emails.snippet,
      bucket: primaryBucket.name,
      secondaryBucket: secondaryBucket.name,
      confidence: classificationResults.confidence,
      justification: classificationResults.justification,
      status: classificationResults.status,
    })
    .from(classificationResults)
    .innerJoin(emails, eq(classificationResults.emailId, emails.id))
    .leftJoin(primaryBucket, eq(classificationResults.bucketId, primaryBucket.id))
    .leftJoin(secondaryBucket, eq(classificationResults.secondaryBucketId, secondaryBucket.id))
    .where(eq(emails.userId, userId));
}

/**
 * All of a user's synced emails, left-joined with their classification if one exists yet.
 * Unlike `listClassificationsForUser` (inner join, only already-classified rows), this includes
 * emails with no classification_results row at all — `GET /api/emails`'s "render from Postgres"
 * query, and how the frontend detects "some emails still need a classify run" on load. Also the
 * one join the analytics service needs (email + classification + bucket name), so it selects the
 * VIP-heuristic columns too rather than duplicating this join elsewhere.
 */
export async function listEmailsWithClassification(userId: string) {
  return db
    .select({
      emailId: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      snippet: emails.snippet,
      messageCount: emails.messageCount,
      hasReplyFromUser: emails.hasReplyFromUser,
      bucket: primaryBucket.name,
      bucketColor: primaryBucket.color,
      secondaryBucket: secondaryBucket.name,
      confidence: classificationResults.confidence,
      justification: classificationResults.justification,
      status: classificationResults.status,
      hasDeadline: classificationResults.hasDeadline,
      deadlineText: classificationResults.deadlineText,
    })
    .from(emails)
    .leftJoin(classificationResults, eq(classificationResults.emailId, emails.id))
    .leftJoin(primaryBucket, eq(classificationResults.bucketId, primaryBucket.id))
    .leftJoin(secondaryBucket, eq(classificationResults.secondaryBucketId, secondaryBucket.id))
    .where(eq(emails.userId, userId));
}

/** Single-row variant of `listEmailsWithClassification` — the response shape for a manual move,
 *  without re-fetching the whole board just to return one updated card. */
export async function getEmailWithClassification(emailId: string, userId: string) {
  const [row] = await db
    .select({
      emailId: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      snippet: emails.snippet,
      messageCount: emails.messageCount,
      hasReplyFromUser: emails.hasReplyFromUser,
      bucket: primaryBucket.name,
      bucketColor: primaryBucket.color,
      secondaryBucket: secondaryBucket.name,
      confidence: classificationResults.confidence,
      justification: classificationResults.justification,
      status: classificationResults.status,
      hasDeadline: classificationResults.hasDeadline,
      deadlineText: classificationResults.deadlineText,
    })
    .from(emails)
    .leftJoin(classificationResults, eq(classificationResults.emailId, emails.id))
    .leftJoin(primaryBucket, eq(classificationResults.bucketId, primaryBucket.id))
    .leftJoin(secondaryBucket, eq(classificationResults.secondaryBucketId, secondaryBucket.id))
    .where(and(eq(emails.userId, userId), eq(emails.id, emailId)))
    .limit(1);
  return row ?? null;
}
