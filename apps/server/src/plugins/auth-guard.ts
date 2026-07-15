import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findUserById } from '../db/queries/users.js';
import { getSessionValue } from './session-store.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authGuardPlugin(fastify: FastifyInstance) {
  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getSessionValue(request, 'userId');
    if (!userId) {
      await reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sign in required.' });
      return;
    }
    const user = await findUserById(userId);
    if (!user || user.revokedAt) {
      await reply
        .code(401)
        .send({ error: 'REAUTH_REQUIRED', message: 'Your Google access was revoked or expired — please sign in again.' });
      return;
    }
    request.user = { id: user.id, email: user.email };
  });
});
