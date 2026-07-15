import type { FastifyInstance } from 'fastify';
import { runClassifyStreamRoute } from '../services/classifier/stream-route.js';

/**
 * `POST /api/reclassify` — re-runs classification after a custom bucket is created, streaming the
 * same SSE contract as `/api/classify`. Functionally, `/api/classify` already re-runs against the
 * user's full *current* bucket set every time it's called (`seedDefaultBuckets` +
 * `listEmailsForClassification` both read the live state) — this is a separate route for semantic
 * clarity and its own log label, matching the build guide's architecture diagram, not because the
 * pipeline needs it. See `services/classifier/stream-route.ts` for the shared implementation.
 */
export default async function reclassifyRoutes(fastify: FastifyInstance) {
  fastify.post('/api/reclassify', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    await runClassifyStreamRoute({ request, reply, userId: request.user.id, runLabel: 'Reclassification' });
  });
}
