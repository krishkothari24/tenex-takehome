import secureSession from '@fastify/secure-session';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export default fp(async function sessionPlugin(fastify: FastifyInstance) {
  await fastify.register(secureSession, {
    key: Buffer.from(env.SESSION_SECRET, 'base64'),
    cookieName: 'inbox_concierge_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
    },
    expiry: 7 * 24 * 60 * 60,
  });
});
