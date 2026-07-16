import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { MissingAnthropicKeyError } from './errors.js';

let client: Anthropic | null = null;

/**
 * Lazily-constructed Anthropic client. Throws MissingAnthropicKeyError (not at import time) so
 * the server boots fine without a key and only fails when classification is actually attempted.
 * `maxRetries: 2` gives the SDK's built-in exponential-backoff-with-jitter retry on 429/5xx/
 * overloaded — the transport-level half of our rate-limit handling (the bounded concurrency pool
 * in the pipeline is the other half: we avoid triggering 429s rather than only reacting to them).
 */
export function getAnthropicClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new MissingAnthropicKeyError();
  if (!client) {
    client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  return client;
}

/**
 * True when an Anthropic API error means the account is out of prepaid credits (no auto-reload
 * configured). Checked via the SDK's `.type` field first (`billing_error`, distinct from
 * `permission_error` even though both surface as HTTP 403) and falls back to a message match since
 * `.type` isn't part of the SDK's exhaustively-typed error surface. This is not retryable — the
 * SDK's own `maxRetries` already gave up before this reaches caller code, and the wall doesn't move
 * until a human adds credits.
 */
export function isInsufficientCreditsError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if ((err as { type?: string }).type === 'billing_error') return true;
  return /credit balance/i.test(err.message);
}
