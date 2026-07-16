import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toThreadDetailResult } from './get-thread-detail.js';

// toThreadDetailResult is the pure piece unit-tested here; getThreadDetail itself makes a real DB
// call and, matching this codebase's convention (no test anywhere touches the DB directly), is
// exercised by scripts/agent-dev.ts against real data instead.

const baseRow = {
  subject: 'Contract renewal',
  fromAddress: 'sarah@example.com',
  snippet: 'Following up on the  contract   renewal for next quarter.',
  internalDate: new Date('2026-07-10T12:00:00.000Z'),
  bucket: 'Important',
  secondaryBucket: null,
  confidence: 0.82,
  justification: 'Mentions a contract renewal deadline explicitly.',
  status: 'classified',
  hasDeadline: true,
  deadlineText: 'end of quarter',
  messageCount: 3,
  hasReplyFromUser: false,
  isUnread: true,
};

test('projects a fully-populated row through unchanged (aside from truncation/date formatting)', () => {
  const result = toThreadDetailResult(baseRow);
  assert.equal(result.subject, 'Contract renewal');
  assert.equal(result.from, 'sarah@example.com');
  assert.equal(result.bucket, 'Important');
  assert.equal(result.secondaryBucket, null);
  assert.equal(result.confidence, 0.82);
  assert.equal(result.justification, baseRow.justification);
  assert.equal(result.hasDeadline, true);
  assert.equal(result.deadlineText, 'end of quarter');
  assert.equal(result.messageCount, 3);
  assert.equal(result.hasReplyFromUser, false);
  assert.equal(result.isUnread, true);
  assert.equal(result.internalDate, '2026-07-10T12:00:00.000Z');
});

test('collapses internal whitespace in the snippet via truncateSnippet', () => {
  const result = toThreadDetailResult(baseRow);
  assert.equal(result.snippet, 'Following up on the contract renewal for next quarter.');
});

test('a null internalDate stays null rather than throwing on toISOString', () => {
  const result = toThreadDetailResult({ ...baseRow, internalDate: null });
  assert.equal(result.internalDate, null);
});

test('an unclassified thread carries null bucket/confidence/justification/deadline fields, not defaults', () => {
  const result = toThreadDetailResult({
    ...baseRow,
    bucket: null,
    secondaryBucket: null,
    confidence: null,
    justification: null,
    status: null,
    hasDeadline: null,
    deadlineText: null,
    messageCount: null,
    hasReplyFromUser: null,
    isUnread: null,
  });
  assert.equal(result.bucket, null);
  assert.equal(result.confidence, null);
  assert.equal(result.justification, null);
  assert.equal(result.status, null);
  assert.equal(result.hasDeadline, null);
  assert.equal(result.deadlineText, null);
  assert.equal(result.messageCount, null);
  assert.equal(result.hasReplyFromUser, null);
  assert.equal(result.isUnread, null);
});

test('a genuine secondary bucket is preserved (not dropped)', () => {
  const result = toThreadDetailResult({ ...baseRow, secondaryBucket: 'Newsletters' });
  assert.equal(result.secondaryBucket, 'Newsletters');
});

test('falls back for an empty/null subject the same way truncateSubject does elsewhere', () => {
  const result = toThreadDetailResult({ ...baseRow, subject: null });
  assert.ok(result.subject.length > 0);
});
