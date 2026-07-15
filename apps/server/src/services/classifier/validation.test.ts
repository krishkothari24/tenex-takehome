import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classificationBatchSchema, truncateSnippet, truncateSubject } from './validation.js';

const BUCKETS = ['Important', 'Can Wait', 'Newsletter', 'Promotions', 'Auto-archive'];

test('accepts a well-formed batch and defaults a missing secondaryBucket to null', () => {
  const schema = classificationBatchSchema(BUCKETS);
  const parsed = schema.parse({
    classifications: [
      { index: 1, bucket: 'Important', confidence: 0.9, justification: 'Mentions a Friday deadline.', secondaryBucket: null, estimatedReadMinutes: 3 },
      { index: 2, bucket: 'Newsletter', confidence: 0.8, justification: 'Weekly digest from a mailing list.', estimatedReadMinutes: 2.5 },
    ],
  });
  assert.equal(parsed.classifications.length, 2);
  assert.equal(parsed.classifications[1]!.secondaryBucket, null);
});

test('rejects a bucket outside the allowed set', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Spam', confidence: 0.9, justification: 'x', estimatedReadMinutes: 1 }],
    }),
  );
});

test('rejects a confidence outside [0,1]', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 1.4, justification: 'x', estimatedReadMinutes: 1 }],
    }),
  );
});

test('rejects an empty justification', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 0.9, justification: '   ', estimatedReadMinutes: 1 }],
    }),
  );
});

test('rejects an estimatedReadMinutes outside [0,30] — guards the time-cost aggregate from an outlier', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 0.9, justification: 'x', estimatedReadMinutes: 9999 }],
    }),
  );
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 0.9, justification: 'x', estimatedReadMinutes: -1 }],
    }),
  );
});

test('truncateSubject falls back for empty subjects and caps length', () => {
  assert.equal(truncateSubject(null), '(no subject)');
  assert.equal(truncateSubject('   '), '(no subject)');
  assert.ok(truncateSubject('a'.repeat(500)).length <= 201); // 200 chars + ellipsis
});

test('truncateSnippet collapses internal whitespace', () => {
  assert.equal(truncateSnippet('hello   \n  world'), 'hello world');
});
