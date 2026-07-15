import type { FastifyInstance } from 'fastify';
import type { BucketsResponse, CreateBucketResponse } from '@inbox-concierge/shared';
import { createBucketRequestSchema } from '@inbox-concierge/shared';
import { createBucket, listBuckets, seedDefaultBuckets } from '../db/queries/buckets.js';
import { isDuplicateBucketName, nextCustomBucketColor } from '../services/custom-bucket.js';

export default async function bucketsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/buckets', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    // Idempotent — only inserts the default taxonomy the first time a user has zero buckets.
    const buckets = await seedDefaultBuckets(request.user.id);
    const response: BucketsResponse = { buckets };
    reply.send(response);
  });

  // Name-only — the "type a name, hit enter" custom-bucket flow (build guide §6). Description
  // stays null (the classifier prompt already renders "Infer the meaning from the name." for a
  // null description); color is auto-assigned from a validated palette slot so the new column has
  // an immediate, distinct color before any classification result arrives.
  fastify.post('/api/buckets', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const userId = request.user.id;

    const parsed = createBucketRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'INVALID_BUCKET_NAME', message: 'Give the bucket a name (1-60 characters).' });
      return;
    }

    const existing = await listBuckets(userId);
    if (isDuplicateBucketName(existing, parsed.data.name)) {
      reply
        .code(409)
        .send({ error: 'DUPLICATE_BUCKET_NAME', message: `You already have a bucket named "${parsed.data.name}".` });
      return;
    }

    const existingCustomCount = existing.filter((b) => !b.isDefault).length;
    const bucket = await createBucket(userId, {
      name: parsed.data.name,
      color: nextCustomBucketColor(existingCustomCount),
    });

    const response: CreateBucketResponse = { bucket };
    reply.code(201).send(response);
  });
}
