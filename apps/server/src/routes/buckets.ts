import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BucketsResponse, CreateBucketResponse } from '@inbox-concierge/shared';
import {
  createBucketRequestSchema,
  createDefaultBucketsRequestSchema,
  DEFAULT_BUCKET_NAMES,
  reorderBucketsRequestSchema,
} from '@inbox-concierge/shared';
import {
  createBucket,
  createDefaultBuckets,
  deleteBucket,
  findBucketForUser,
  listBuckets,
  reorderBuckets,
} from '../db/queries/buckets.js';
import { isDuplicateBucketName, nextCustomBucketColor } from '../services/custom-bucket.js';

interface BucketParams {
  id: string;
}

export default async function bucketsRoutes(fastify: FastifyInstance) {
  // No auto-seed here — a user with zero buckets gets an empty array and the frontend routes them
  // into an opt-in picker (`POST /api/buckets/defaults` below) instead of the five defaults
  // silently materializing.
  fastify.get('/api/buckets', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    const buckets = await listBuckets(request.user.id);
    const response: BucketsResponse = { buckets };
    reply.send(response);
  });

  // "Type a name, hit enter" custom-bucket flow (build guide §6), with an optional description —
  // when set, it's sent verbatim to the classifier's system prompt; when omitted, the prompt
  // already renders "Infer the meaning from the name." for a null description. Color is
  // auto-assigned from a validated palette slot so the new column has an immediate, distinct
  // color before any classification result arrives.
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
      description: parsed.data.description || null,
      color: nextCustomBucketColor(existingCustomCount),
    });

    const response: CreateBucketResponse = { bucket };
    reply.code(201).send(response);
  });

  // The opt-in bucket picker's bulk-create call — bulk rather than N calls to POST /api/buckets
  // above, because that route always assigns isDefault: false and an auto-cycled custom-palette
  // color; reusing it for picked defaults would silently strip their protected/canonical status.
  fastify.post('/api/buckets/defaults', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const userId = request.user.id;

    const parsed = createDefaultBucketsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'INVALID_DEFAULTS', message: 'Pick at least one bucket.' });
      return;
    }
    const unknown = parsed.data.names.filter((n) => !DEFAULT_BUCKET_NAMES.includes(n));
    if (unknown.length > 0) {
      reply.code(400).send({ error: 'UNKNOWN_DEFAULT_BUCKET', message: `Not a default bucket: ${unknown.join(', ')}` });
      return;
    }

    const existing = await listBuckets(userId);
    const namesToCreate = parsed.data.names.filter((n) => !isDuplicateBucketName(existing, n));
    const buckets = namesToCreate.length > 0 ? await createDefaultBuckets(userId, namesToCreate) : existing;
    const response: BucketsResponse = { buckets };
    reply.code(201).send(response);
  });

  fastify.patch('/api/buckets/reorder', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const userId = request.user.id;

    const parsed = reorderBucketsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply
        .code(400)
        .send({ error: 'INVALID_REORDER', message: 'orderedIds must be a non-empty array of bucket ids.' });
      return;
    }

    for (const id of parsed.data.orderedIds) {
      if (!(await findBucketForUser(id, userId))) {
        reply.code(404).send({ error: 'BUCKET_NOT_FOUND', message: 'One or more buckets could not be found.' });
        return;
      }
    }

    const buckets = await reorderBuckets(userId, parsed.data.orderedIds);
    const response: BucketsResponse = { buckets };
    reply.send(response);
  });

  fastify.delete(
    '/api/buckets/:id',
    { preHandler: fastify.requireAuth },
    async (request: FastifyRequest<{ Params: BucketParams }>, reply) => {
      if (!request.user) return;
      const userId = request.user.id;
      const { id } = request.params;

      const bucket = await findBucketForUser(id, userId);
      if (!bucket) {
        reply.code(404).send({ error: 'BUCKET_NOT_FOUND', message: 'No such bucket.' });
        return;
      }
      if (bucket.isDefault) {
        reply.code(400).send({ error: 'DEFAULT_BUCKET_UNDELETABLE', message: "Default buckets can't be deleted." });
        return;
      }

      await deleteBucket(id, userId);
      reply.code(204).send();
    },
  );
}
