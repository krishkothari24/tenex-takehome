import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classificationBatchSchema, truncateSnippet, truncateSubject } from './validation.js';

const BUCKETS = ['Important', 'Can Wait', 'Newsletter', 'Promotions', 'Auto-archive'];

test('accepts a well-formed batch and defaults a missing secondaryBucket to null', () => {
  const schema = classificationBatchSchema(BUCKETS);
  const parsed = schema.parse({
    classifications: [
      { index: 1, bucket: 'Important', confidence: 0.9, justification: 'Mentions a Friday deadline.', secondaryBucket: null, hasDeadline: true, deadlineText: 'due Friday' },
      { index: 2, bucket: 'Newsletter', confidence: 0.8, justification: 'Weekly digest from a mailing list.', hasDeadline: false, deadlineText: null },
    ],
  });
  assert.equal(parsed.classifications.length, 2);
  assert.equal(parsed.classifications[1]!.secondaryBucket, null);
});

test('rejects a bucket outside the allowed set', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Spam', confidence: 0.9, justification: 'x', hasDeadline: false, deadlineText: null }],
    }),
  );
});

test('rejects a confidence outside [0,1]', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 1.4, justification: 'x', hasDeadline: false, deadlineText: null }],
    }),
  );
});

test('rejects an empty justification', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 0.9, justification: '   ', hasDeadline: false, deadlineText: null }],
    }),
  );
});

test('rejects hasDeadline/deadlineText inconsistency — never persist a mismatched pair', () => {
  const schema = classificationBatchSchema(BUCKETS);
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 0.9, justification: 'x', hasDeadline: true, deadlineText: null }],
    }),
  );
  assert.throws(() =>
    schema.parse({
      classifications: [{ index: 1, bucket: 'Important', confidence: 0.9, justification: 'x', hasDeadline: false, deadlineText: 'due Friday' }],
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
