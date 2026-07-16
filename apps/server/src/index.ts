import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { env } from './config/env.js';
import { buildLoggerOptions } from './plugins/logger.js';
import sessionPlugin from './plugins/session.js';
import authGuardPlugin from './plugins/auth-guard.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import inboxRoutes from './routes/inbox.js';
import bucketsRoutes from './routes/buckets.js';
import emailsRoutes from './routes/emails.js';
import classifyRoutes from './routes/classify.js';
import reclassifyRoutes from './routes/reclassify.js';
import analyticsRoutes from './routes/analytics.js';
import digestRoutes from './routes/digest.js';
import accountRoutes from './routes/account.js';
import rulesRoutes from './routes/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const fastify = Fastify({ logger: buildLoggerOptions() });

  await fastify.register(sessionPlugin);
  await fastify.register(authGuardPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(inboxRoutes);
  await fastify.register(bucketsRoutes);
  await fastify.register(emailsRoutes);
  await fastify.register(classifyRoutes);
  await fastify.register(reclassifyRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(digestRoutes);
  await fastify.register(accountRoutes);
  await fastify.register(rulesRoutes);

  if (env.NODE_ENV === 'production') {
    await fastify.register(fastifyStatic, {
      root: path.join(__dirname, '../../web/dist'),
    });
    fastify.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api') || request.raw.url?.startsWith('/auth')) {
        reply.code(404).send({ error: 'NOT_FOUND' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal error during server startup:', err);
  process.exit(1);
});
