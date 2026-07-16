import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ClassificationStatus, EmailsResponse, MoveEmailBucketResponse } from '@inbox-concierge/shared';
import { moveEmailBucketRequestSchema } from '@inbox-concierge/shared';
import {
  getCurrentBucketId,
  getEmailWithClassification,
  listEmailsWithClassification,
  setManualBucket,
} from '../db/queries/classifications.js';
import { findBucketForUser } from '../db/queries/buckets.js';
import { findEmailForUser } from '../db/queries/emails.js';
import { insertCorrection } from '../db/queries/corrections.js';
import { isAmbiguousFromPersisted } from '../services/classifier/index.js';

function toEmailWithClassification(row: Awaited<ReturnType<typeof getEmailWithClassification>>) {
  if (!row) return null;
  return {
    emailId: row.emailId,
    subject: row.subject,
    fromAddress: row.fromAddress,
    snippet: row.snippet,
    bucket: row.bucket,
    bucketColor: row.bucketColor,
    secondaryBucket: row.secondaryBucket,
    confidence: row.confidence,
    justification: row.justification,
    status: row.status as ClassificationStatus | null,
    isAmbiguous: row.status === null ? null : isAmbiguousFromPersisted(row.confidence, row.secondaryBucket !== null),
    hasDeadline: row.hasDeadline,
    deadlineText: row.deadlineText,
  };
}

interface MoveBucketParams {
  emailId: string;
}

export default async function emailsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/emails', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    const rows = await listEmailsWithClassification(request.user.id);
    const response: EmailsResponse = {
      emails: rows.map((row) => toEmailWithClassification(row)!),
    };
    reply.send(response);
  });

  /**
   * The manual "move this email" correction (build guide §5.7's feedback-loop seed). Flags the
   * row `isManualOverride` so the next reclassify run skips it (see classifier/stream-route.ts)
   * instead of silently clobbering the user's own decision, and records a `bucketCorrections` row
   * — both the audit trail and the input to sender-rule suggestion.
   */
  fastify.patch(
    '/api/emails/:emailId/bucket',
    { preHandler: fastify.requireAuth },
    async (request: FastifyRequest<{ Params: MoveBucketParams }>, reply) => {
      if (!request.user) return;
      const userId = request.user.id;
      const { emailId } = request.params;

      const parsed = moveEmailBucketRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: 'INVALID_BUCKET_ID', message: 'A target bucketId is required.' });
        return;
      }

      const email = await findEmailForUser(emailId, userId);
      if (!email) {
        reply.code(404).send({ error: 'EMAIL_NOT_FOUND', message: 'No such email.' });
        return;
      }

      const bucket = await findBucketForUser(parsed.data.bucketId, userId);
      if (!bucket) {
        reply.code(404).send({ error: 'BUCKET_NOT_FOUND', message: 'No such bucket.' });
        return;
      }

      const fromBucketId = await getCurrentBucketId(emailId);
      await setManualBucket({ emailId, bucketId: bucket.id });
      await insertCorrection({
        userId,
        emailId,
        fromAddress: email.fromAddress,
        fromBucketId,
        toBucketId: bucket.id,
      });

      const updated = await getEmailWithClassification(emailId, userId);
      const response: MoveEmailBucketResponse = { email: toEmailWithClassification(updated)! };
      reply.send(response);
    },
  );
}
