import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestSenderRules } from './sender-rules.js';

const rows = (fromAddress: string, toBucketId: string, count: number) =>
  Array.from({ length: count }, () => ({ fromAddress, toBucketId }));

test('suggests a sender once corrections to the same bucket cross the threshold', () => {
  const result = suggestSenderRules(rows('a@x.com', 'bucket-important', 3), new Set());
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { fromAddress: 'a@x.com', bucketId: 'bucket-important', correctionCount: 3 });
});

test('does not suggest a sender below the threshold', () => {
  const result = suggestSenderRules(rows('a@x.com', 'bucket-important', 2), new Set());
  assert.deepEqual(result, []);
});

test('a sender split across two buckets only surfaces the bucket that crosses the threshold', () => {
  const corrections = [...rows('a@x.com', 'bucket-important', 3), ...rows('a@x.com', 'bucket-newsletter', 1)];
  const result = suggestSenderRules(corrections, new Set());
  assert.equal(result.length, 1);
  assert.equal(result[0]!.bucketId, 'bucket-important');
});

test('excludes senders who already have an active rule', () => {
  const result = suggestSenderRules(rows('a@x.com', 'bucket-important', 5), new Set(['a@x.com']));
  assert.deepEqual(result, []);
});

test('ignores corrections with a null fromAddress (raw header the app could not parse)', () => {
  const corrections = Array.from({ length: 5 }, () => ({ fromAddress: null, toBucketId: 'bucket-important' }));
  const result = suggestSenderRules(corrections, new Set());
  assert.deepEqual(result, []);
});

test('sorts multiple suggestions by correction count, descending', () => {
  const corrections = [...rows('a@x.com', 'bucket-important', 3), ...rows('b@x.com', 'bucket-important', 5)];
  const result = suggestSenderRules(corrections, new Set());
  assert.deepEqual(
    result.map((s) => s.fromAddress),
    ['b@x.com', 'a@x.com'],
  );
});

test('respects a custom threshold', () => {
  const result = suggestSenderRules(rows('a@x.com', 'bucket-important', 2), new Set(), 2);
  assert.equal(result.length, 1);
});
