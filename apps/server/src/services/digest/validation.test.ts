import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digestToolOutputSchema } from './validation.js';

const VALID_IDS = ['email-1', 'email-2', 'email-3'];

test('accepts a well-formed digest citing only shortlisted email ids', () => {
  const schema = digestToolOutputSchema(VALID_IDS);
  const parsed = schema.parse({
    headline: 'Two things need you this week.',
    actionItems: [
      { emailId: 'email-1', title: 'Reply to Jane', why: 'She asked for sign-off by Friday.', urgency: 'high' },
      { emailId: 'email-2', title: 'Confirm the invoice', why: 'Unanswered for a week.', urgency: 'medium' },
    ],
    fyiCount: 1,
  });
  assert.equal(parsed.actionItems.length, 2);
});

test('rejects an action item whose emailId is not in the shortlist — the anti-hallucination guard', () => {
  const schema = digestToolOutputSchema(VALID_IDS);
  assert.throws(() =>
    schema.parse({
      headline: 'One thing needs you.',
      actionItems: [
        { emailId: 'invented-id-not-in-shortlist', title: 'x', why: 'x', urgency: 'high' },
      ],
      fyiCount: 0,
    }),
  );
});

test('rejects an unknown urgency value', () => {
  const schema = digestToolOutputSchema(VALID_IDS);
  assert.throws(() =>
    schema.parse({
      headline: 'x',
      actionItems: [{ emailId: 'email-1', title: 'x', why: 'x', urgency: 'urgent' }],
      fyiCount: 0,
    }),
  );
});

test('rejects an empty headline', () => {
  const schema = digestToolOutputSchema(VALID_IDS);
  assert.throws(() =>
    schema.parse({ headline: '   ', actionItems: [], fyiCount: 0 }),
  );
});
