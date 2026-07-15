import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectDigestInput, type DigestCandidateEmail } from './select-input.js';

function email(overrides: Partial<DigestCandidateEmail>): DigestCandidateEmail {
  return {
    emailId: 'e1',
    subject: 'Subject',
    fromAddress: 'a@x.com',
    snippet: 'snippet',
    bucket: 'Newsletter',
    justification: null,
    hasDeadline: false,
    deadlineText: null,
    isUnansweredImportant: false,
    isVipSender: false,
    ...overrides,
  };
}

test('excludes emails with no deadline/unanswered-important/VIP signal', () => {
  const result = selectDigestInput([email({ emailId: 'e1' })]);
  assert.deepEqual(result, []);
});

test('includes an email with any one qualifying signal', () => {
  assert.equal(selectDigestInput([email({ emailId: 'a', hasDeadline: true })]).length, 1);
  assert.equal(selectDigestInput([email({ emailId: 'b', isUnansweredImportant: true })]).length, 1);
  assert.equal(selectDigestInput([email({ emailId: 'c', isVipSender: true })]).length, 1);
});

test('ranks an email with overlapping signals above one with a single signal', () => {
  const strong = email({ emailId: 'strong', hasDeadline: true, isUnansweredImportant: true });
  const weak = email({ emailId: 'weak', isVipSender: true });
  const result = selectDigestInput([weak, strong]);
  assert.equal(result[0]!.emailId, 'strong');
  assert.equal(result[1]!.emailId, 'weak');
});

test('caps output at MAX_DIGEST_INPUT_EMAILS (40), keeping the highest-scored candidates', () => {
  const candidates = Array.from({ length: 45 }, (_, i) =>
    email({ emailId: `e${i}`, hasDeadline: i < 45, isUnansweredImportant: i < 5 }),
  );
  const result = selectDigestInput(candidates);
  assert.equal(result.length, 40);
  // The 5 highest-scored (deadline + unanswered-important) must all survive the cap.
  for (let i = 0; i < 5; i++) {
    assert.ok(result.some((c) => c.emailId === `e${i}`));
  }
});
