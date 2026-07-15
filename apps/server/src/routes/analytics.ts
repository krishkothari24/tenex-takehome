import type { FastifyInstance } from 'fastify';
import { computeDashboardAnalytics } from '../services/analytics/index.js';

export default async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analytics', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    try {
      const analytics = await computeDashboardAnalytics(request.user.id);
      reply.send(analytics);
    } catch (err) {
      request.log.error({ err }, 'Analytics computation failed');
      reply.code(500).send({ error: 'ANALYTICS_FAILED', message: 'Could not compute your inbox analytics.' });
    }
  });
}
