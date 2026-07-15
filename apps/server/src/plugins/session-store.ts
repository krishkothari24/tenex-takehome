import type { FastifyRequest } from 'fastify';

/**
 * @fastify/secure-session types request.session against its own internal
 * (unexported) SessionData default, so it can't be augmented via normal
 * declaration merging. This wrapper centralizes the one cast needed to get
 * a typed session shape instead of scattering `as any` across route handlers.
 */
export interface AppSession {
  userId?: string;
  oauthState?: string;
}

interface UntypedSessionSetter {
  set(key: string, value: unknown): void;
}

export function getSessionValue<Key extends keyof AppSession>(
  request: FastifyRequest,
  key: Key,
): AppSession[Key] | undefined {
  return request.session.get(key) as AppSession[Key] | undefined;
}

export function setSessionValue<Key extends keyof AppSession>(
  request: FastifyRequest,
  key: Key,
  value: AppSession[Key],
): void {
  (request.session as unknown as UntypedSessionSetter).set(key, value);
}

export function clearSessionValue(request: FastifyRequest, key: keyof AppSession): void {
  setSessionValue(request, key, undefined);
}
