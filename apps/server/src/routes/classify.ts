import type { FastifyInstance } from 'fastify';
import { runClassifyStreamRoute } from '../services/classifier/stream-route.js';

/**
 * `POST /api/classify` — streams an SSE `ClassifyStreamEvent` per completed batch.
 *
 * Deliberately not `EventSource`-based on the client: `EventSource` is GET-only, and this is a
 * mutating, side-effecting action (it persists classification_results rows), so the client
 * consumes this via `fetch()` + a manual `ReadableStream` reader instead.
 *
 * The actual streaming/pipeline body is shared with `POST /api/reclassify` — see
 * `services/classifier/stream-route.ts`'s doc comment for why they're still two routes.
 */
export default async function classifyRoutes(fastify: FastifyInstance) {
  fastify.post('/api/classify', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    await runClassifyStreamRoute({ request, reply, userId: request.user.id, runLabel: 'Classification' });
  });
}
