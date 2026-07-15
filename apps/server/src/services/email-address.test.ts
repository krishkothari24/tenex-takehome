import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDisplayName, extractEmailAddress } from './email-address.js';

test('extracts the address from a display-name-quoted header', () => {
  assert.equal(extractEmailAddress('"Jane Doe" <jane@x.com>'), 'jane@x.com');
});

test('returns a bare address as-is', () => {
  assert.equal(extractEmailAddress('jane@x.com'), 'jane@x.com');
});

test('returns null for malformed/no-angle-bracket garbage', () => {
  assert.equal(extractEmailAddress('not an email'), null);
  assert.equal(extractEmailAddress('<>'), null);
});

test('returns null for null input', () => {
  assert.equal(extractEmailAddress(null), null);
});

test('extractDisplayName pulls the name out of a quoted header', () => {
  assert.equal(extractDisplayName('"Jane Doe" <jane@x.com>'), 'Jane Doe');
});

test('extractDisplayName returns null for a bare address (no name part)', () => {
  assert.equal(extractDisplayName('jane@x.com'), null);
});

test('extractDisplayName returns null for null input', () => {
  assert.equal(extractDisplayName(null), null);
});
