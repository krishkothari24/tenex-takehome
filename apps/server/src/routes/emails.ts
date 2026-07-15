import type { FastifyInstance } from 'fastify';
import type { ClassificationStatus, EmailsResponse } from '@inbox-concierge/shared';
import { listEmailsWithClassification } from '../db/queries/classifications.js';

export default async function emailsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/emails', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    const rows = await listEmailsWithClassification(request.user.id);
    const response: EmailsResponse = {
      emails: rows.map((row) => ({
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
      })),
    };
    reply.send(response);
  });
}
