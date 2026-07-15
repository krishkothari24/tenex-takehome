import type { SessionUser } from '@inbox-concierge/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}
