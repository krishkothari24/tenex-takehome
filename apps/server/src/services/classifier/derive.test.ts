import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveAmbiguity, isAmbiguousFromPersisted } from './derive.js';

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

test('isAmbiguousFromPersisted: null confidence (not yet classified / failed) is never ambiguous', () => {
  assert.equal(isAmbiguousFromPersisted(null, false), false);
  assert.equal(isAmbiguousFromPersisted(null, true), false);
});

test('isAmbiguousFromPersisted: below-threshold confidence is ambiguous even without a secondary', () => {
  assert.equal(isAmbiguousFromPersisted(0.4, false), true);
});

test('isAmbiguousFromPersisted: confidence exactly at the 0.6 threshold is NOT ambiguous', () => {
  assert.equal(isAmbiguousFromPersisted(0.6, false), false);
});

test('isAmbiguousFromPersisted: a persisted secondary bucket makes it ambiguous even when confident', () => {
  assert.equal(isAmbiguousFromPersisted(0.9, true), true);
});

test('isAmbiguousFromPersisted: confident with no secondary is not ambiguous', () => {
  assert.equal(isAmbiguousFromPersisted(0.95, false), false);
});
