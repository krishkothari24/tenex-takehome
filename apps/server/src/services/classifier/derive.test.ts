import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveAmbiguity } from './derive.js';

test('confident with no secondary → not ambiguous', () => {
  const r = deriveAmbiguity({ bucket: 'Important', confidence: 0.95, secondaryBucket: null });
  assert.equal(r.isAmbiguous, false);
  assert.equal(r.secondaryBucket, null);
});

test('low confidence → ambiguous even without a secondary', () => {
  const r = deriveAmbiguity({ bucket: 'Can Wait', confidence: 0.4, secondaryBucket: null });
  assert.equal(r.isAmbiguous, true);
});

test('confidence exactly at the 0.6 threshold is NOT ambiguous', () => {
  const r = deriveAmbiguity({ bucket: 'Can Wait', confidence: 0.6, secondaryBucket: null });
  assert.equal(r.isAmbiguous, false);
});

test('a genuine secondary bucket makes it ambiguous even when confident', () => {
  const r = deriveAmbiguity({ bucket: 'Newsletter', confidence: 0.9, secondaryBucket: 'Promotions' });
  assert.equal(r.isAmbiguous, true);
  assert.equal(r.secondaryBucket, 'Promotions');
});

test('a secondary equal to the primary is dropped and does not force ambiguity', () => {
  const r = deriveAmbiguity({ bucket: 'Important', confidence: 0.9, secondaryBucket: 'Important' });
  assert.equal(r.secondaryBucket, null);
  assert.equal(r.isAmbiguous, false);
});
