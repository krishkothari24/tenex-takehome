import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { isInsufficientCreditsError } from './anthropic.js';

function makeApiError(status: number, message: string, type?: string) {
  const err = new Anthropic.APIError(status, { error: { message } }, message, new Headers());
  if (type !== undefined) Object.assign(err, { type });
  return err;
}

test('billing_error type is recognized regardless of status code', () => {
  assert.equal(isInsufficientCreditsError(makeApiError(403, 'nope', 'billing_error')), true);
});

test('message mentioning credit balance is recognized as a fallback', () => {
  assert.equal(
    isInsufficientCreditsError(makeApiError(400, 'Your credit balance is too low to access the Claude API')),
    true,
  );
});

test('an unrelated permission error is not mistaken for insufficient credits', () => {
  assert.equal(isInsufficientCreditsError(makeApiError(403, 'API key lacks permission', 'permission_error')), false);
});

test('non-API errors are never treated as insufficient credits', () => {
  assert.equal(isInsufficientCreditsError(new Error('boom')), false);
  assert.equal(isInsufficientCreditsError('boom'), false);
});
