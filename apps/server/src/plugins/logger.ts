import type { FastifyServerOptions } from 'fastify';
import { env } from '../config/env.js';

/** Fastify's built-in logger is pino — this just tunes it per environment (structured JSON in prod, pretty in dev). */
export function buildLoggerOptions(): NonNullable<FastifyServerOptions['logger']> {
  if (env.NODE_ENV === 'production') {
    return { level: 'info' };
  }
  return {
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  };
}
