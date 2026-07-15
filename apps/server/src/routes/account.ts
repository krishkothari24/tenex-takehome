import type { FastifyInstance } from 'fastify';
import { deleteUser, findUserById } from '../db/queries/users.js';
import { decryptSecret } from '../services/crypto.js';
import { revokeGoogleAccess } from '../services/google-oauth.js';

/**
 * "Disconnect Google & delete my data" (build guide §8's named production gap: "a
 * data-retention/deletion policy for a tool that reads someone's inbox"). Revoking Google access
 * is best-effort — a Google-side failure must never block deleting the user's own data, which is
 * this app's actual promise.
 */
export default async function accountRoutes(fastify: FastifyInstance) {
  fastify.post('/api/account/disconnect', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    const user = await findUserById(request.user.id);
    if (user) {
      try {
        await revokeGoogleAccess(decryptSecret(user.encryptedAccessToken));
      } catch (err) {
        request.log.warn({ err }, 'Google token revocation failed — proceeding with local data deletion anyway');
      }
      await deleteUser(user.id);
    }

    request.session.delete();
    reply.code(204).send();
  });
}
