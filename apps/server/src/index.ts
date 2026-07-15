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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const fastify = Fastify({ logger: buildLoggerOptions() });

  await fastify.register(sessionPlugin);
  await fastify.register(authGuardPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(inboxRoutes);

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
