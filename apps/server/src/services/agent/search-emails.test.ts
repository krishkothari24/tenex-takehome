import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SEARCH_RESULTS } from './config.js';
import { normalizeSearchFilters } from './search-emails.js';

// normalizeSearchFilters is the pure piece unit-tested here; searchEmails itself makes a real DB
// call and, matching this codebase's convention (no test anywhere touches the DB directly), is
// exercised by scripts/agent-dev.ts against real data instead.

test('passes through explicit filters unchanged', () => {
  const filters = normalizeSearchFilters({
    keyword: 'contract',
    sender: 'sarah@example.com',
    bucket: 'Important',
    is_unread: true,
    limit: 5,
  });
  assert.deepEqual(filters, {
    keyword: 'contract',
    sender: 'sarah@example.com',
    bucket: 'Important',
    isUnread: true,
    limit: 5,
  });
});

test('null filters stay null (no filter on that field)', () => {
  const filters = normalizeSearchFilters({
    keyword: null,
    sender: null,
    bucket: null,
    is_unread: null,
    limit: null,
  });
  assert.equal(filters.keyword, null);
  assert.equal(filters.sender, null);
  assert.equal(filters.bucket, null);
  assert.equal(filters.isUnread, null);
});

test('a null limit defaults to MAX_SEARCH_RESULTS', () => {
  const filters = normalizeSearchFilters({ keyword: null, sender: null, bucket: null, is_unread: null, limit: null });
  assert.equal(filters.limit, MAX_SEARCH_RESULTS);
});

test('a requested limit above MAX_SEARCH_RESULTS is clamped down', () => {
  const filters = normalizeSearchFilters({
    keyword: null,
    sender: null,
    bucket: null,
    is_unread: null,
    limit: MAX_SEARCH_RESULTS + 100,
  });
  assert.equal(filters.limit, MAX_SEARCH_RESULTS);
});

test('a requested limit below MAX_SEARCH_RESULTS is left alone', () => {
  const filters = normalizeSearchFilters({ keyword: null, sender: null, bucket: null, is_unread: null, limit: 3 });
  assert.equal(filters.limit, 3);
});

test('is_unread: false is preserved, not treated as "no filter" (must not collapse to null)', () => {
  const filters = normalizeSearchFilters({ keyword: null, sender: null, bucket: null, is_unread: false, limit: null });
  assert.equal(filters.isUnread, false);
});
