import type { FastifyInstance } from 'fastify';
import type { BucketsResponse } from '@inbox-concierge/shared';
import { seedDefaultBuckets } from '../db/queries/buckets.js';

export default async function bucketsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/buckets', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    // Idempotent — only inserts the default taxonomy the first time a user has zero buckets.
    const buckets = await seedDefaultBuckets(request.user.id);
    const response: BucketsResponse = { buckets };
    reply.send(response);
  });
}
