import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { upsertUser } from '../db/queries/users.js';
import { encryptSecret } from '../services/crypto.js';
import { buildConsentUrl, exchangeCodeForTokens, fetchGoogleUserInfo } from '../services/google-oauth.js';
import { env } from '../config/env.js';
import { clearSessionValue, getSessionValue, setSessionValue } from '../plugins/session-store.js';

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/auth/google', async (request, reply) => {
    const state = randomBytes(16).toString('hex');
    setSessionValue(request, 'oauthState', state);
    reply.redirect(buildConsentUrl(state));
  });

  fastify.get(
    '/auth/google/callback',
    async (request: FastifyRequest<{ Querystring: CallbackQuery }>, reply) => {
      const { code, state, error } = request.query;

      if (error) {
        request.log.warn({ error }, 'Google OAuth consent was denied or errored');
        return reply.redirect(`${env.FRONTEND_URL}/?auth_error=denied`);
      }

      const expectedState = getSessionValue(request, 'oauthState');
      clearSessionValue(request, 'oauthState');
      if (!code || !state || !expectedState || state !== expectedState) {
        request.log.warn('OAuth callback failed state validation');
        return reply.code(400).send({ error: 'INVALID_STATE', message: 'OAuth state mismatch — possible CSRF.' });
      }

      try {
        const tokens = await exchangeCodeForTokens(code);
        const userInfo = await fetchGoogleUserInfo(tokens.accessToken);

        const user = await upsertUser({
          googleId: userInfo.googleId,
          email: userInfo.email,
          encryptedAccessToken: encryptSecret(tokens.accessToken),
          encryptedRefreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          tokenExpiry: new Date(tokens.expiryDate),
        });

        setSessionValue(request, 'userId', user.id);
        reply.redirect(env.FRONTEND_URL);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, `Google OAuth callback failed: ${message}`);
        reply.redirect(`${env.FRONTEND_URL}/?auth_error=failed`);
      }
    },
  );

  fastify.get('/auth/me', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return; // requireAuth already replied
    reply.send(request.user);
  });

  fastify.post('/auth/logout', async (request, reply) => {
    request.session.delete();
    reply.code(204).send();
  });
}
