import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVipSenders } from './vip.js';

test('excludes senders below the 2-thread minimum — a single email is not a relationship pattern', () => {
  const result = computeVipSenders(
    [{ fromAddress: 'Jane <jane@x.com>', bucket: 'Important', hasReplyFromUser: true }],
    null,
  );
  assert.deepEqual(result, []);
});

test('ranks a frequent, replied-to, important sender above a frequent but ignored one', () => {
  const rows = [
    ...Array.from({ length: 5 }, () => ({
      fromAddress: 'Jane <jane@x.com>',
      bucket: 'Important',
      hasReplyFromUser: true,
    })),
    ...Array.from({ length: 5 }, () => ({
      fromAddress: 'Bulk <bulk@x.com>',
      bucket: 'Newsletter',
      hasReplyFromUser: false,
    })),
  ];
  const result = computeVipSenders(rows, null);
  assert.equal(result[0]!.emailAddress, 'jane@x.com');
  assert.ok(result[0]!.score > result[1]!.score);
});

test('excludes unknown reply status from the replyRate denominator rather than counting it as unreplied', () => {
  const rows = [
    { fromAddress: 'jane@x.com', bucket: 'Important', hasReplyFromUser: true },
    { fromAddress: 'jane@x.com', bucket: 'Important', hasReplyFromUser: null },
  ];
  const [sender] = computeVipSenders(rows, null);
  assert.equal(sender!.replyRate, 1);
});

test('excludes the signed-in user\'s own address (case-insensitive) so a self-sent thread never ranks as a VIP', () => {
  const rows = [
    { fromAddress: 'Me <ME@X.COM>', bucket: 'Important', hasReplyFromUser: null },
    { fromAddress: 'Me <ME@X.COM>', bucket: 'Important', hasReplyFromUser: null },
  ];
  const result = computeVipSenders(rows, 'me@x.com');
  assert.deepEqual(result, []);
});

test('caps results at 5 and sorts descending by score', () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 2 + i }, () => ({
      fromAddress: `sender${i}@x.com`,
      bucket: 'Important',
      hasReplyFromUser: true,
    })),
  ).flat();
  const result = computeVipSenders(rows, null);
  assert.equal(result.length, 5);
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1]!.score >= result[i]!.score);
  }
});
