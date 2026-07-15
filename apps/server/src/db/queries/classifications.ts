import { eq } from 'drizzle-orm';
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
  estimatedReadMinutes: number | null;
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
      estimatedReadMinutes: input.estimatedReadMinutes,
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
        estimatedReadMinutes: input.estimatedReadMinutes,
        updatedAt: new Date(),
      },
    });
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
      estimatedReadMinutes: null,
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
 * VIP-heuristic and time-cost columns too rather than duplicating this join elsewhere.
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
      estimatedReadMinutes: classificationResults.estimatedReadMinutes,
    })
    .from(emails)
    .leftJoin(classificationResults, eq(classificationResults.emailId, emails.id))
    .leftJoin(primaryBucket, eq(classificationResults.bucketId, primaryBucket.id))
    .leftJoin(secondaryBucket, eq(classificationResults.secondaryBucketId, secondaryBucket.id))
    .where(eq(emails.userId, userId));
}
