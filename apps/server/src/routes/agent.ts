import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { agentChatRequestSchema } from '@inbox-concierge/shared';
import { runAgentChatStreamRoute } from '../services/agent/stream-route.js';

/**
 * Per-user in-flight guard: this app's first genuinely conversational, spammable endpoint (every
 * other mutating route is a single click-triggered action). A plain in-process `Set` is enough
 * because this app targets a single Railway/Render instance (CLAUDE.md) — horizontal scaling would
 * need this moved to a shared store, same caveat the cost ceiling in ../services/agent/config.ts
 * already carries for its own in-memory-only tracking.
 */
const inFlightChatUsers = new Set<string>();

export default async function agentRoutes(fastify: FastifyInstance) {
  // Scoped to this plugin's encapsulation context only (global: false) — classify/digest/etc.
  // keep their existing, unrated posture unchanged.
  await fastify.register(rateLimit, { global: false });

  fastify.post(
    '/api/agent/chat',
    {
      preHandler: [
        fastify.requireAuth,
        fastify.rateLimit({
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.user?.id ?? request.ip,
        }),
      ],
    },
    async (request, reply) => {
      if (!request.user) return;

      const parsed = agentChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      }

      if (inFlightChatUsers.has(request.user.id)) {
        return reply.code(429).send({ error: 'TURN_IN_PROGRESS', message: 'A chat turn is already in progress.' });
      }

      inFlightChatUsers.add(request.user.id);
      try {
        await runAgentChatStreamRoute({ request, reply, userId: request.user.id, body: parsed.data });
      } finally {
        inFlightChatUsers.delete(request.user.id);
      }
    },
  );
}
