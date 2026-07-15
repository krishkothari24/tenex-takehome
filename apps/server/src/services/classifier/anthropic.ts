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
