import type { FastifyInstance } from 'fastify';
import type { DigestResponse } from '@inbox-concierge/shared';
import { digestActionItemSchema } from '@inbox-concierge/shared';
import { getLatestDigest } from '../db/queries/digests.js';
import { runDigestStreamRoute } from '../services/digest/stream-route.js';

export default async function digestRoutes(fastify: FastifyInstance) {
  /** Last persisted digest, if any — powers "reopen the app, see last week's digest instantly." */
  fastify.get('/api/digest', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const row = await getLatestDigest(request.user.id);
    const response: DigestResponse = {
      digest: row
        ? {
            id: row.id,
            headline: row.headline,
            actionItems: digestActionItemSchema.array().parse(row.actionItems),
            fyiCount: row.fyiCount,
            inputEmailCount: row.inputEmailCount,
            costUsd: row.costUsd,
            generatedAt: row.createdAt.toISOString(),
          }
        : null,
    };
    reply.send(response);
  });

  /** SSE — triggers a real, billable Sonnet call. Only ever fired by an explicit user action. */
  fastify.post('/api/digest', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    await runDigestStreamRoute({ request, reply, userId: request.user.id });
  });
}
