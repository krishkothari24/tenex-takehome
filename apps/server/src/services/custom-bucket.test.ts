import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicateBucketName, nextCustomBucketColor, CUSTOM_BUCKET_COLORS } from './custom-bucket.js';
import type { Bucket } from '@inbox-concierge/shared';

const bucket = (name: string): Bucket => ({
  id: name,
  name,
  description: null,
  color: null,
  sortOrder: 0,
  isDefault: false,
});

test('isDuplicateBucketName matches case-insensitively', () => {
  assert.equal(isDuplicateBucketName([bucket('Important')], 'important'), true);
  assert.equal(isDuplicateBucketName([bucket('Important')], '  IMPORTANT  '), true);
});

test('isDuplicateBucketName returns false for a genuinely new name', () => {
  assert.equal(isDuplicateBucketName([bucket('Important')], 'Needs my signature'), false);
});

test('isDuplicateBucketName returns false for an empty existing list', () => {
  assert.equal(isDuplicateBucketName([], 'Anything'), false);
});

test('nextCustomBucketColor cycles through the fixed palette in order', () => {
  assert.equal(nextCustomBucketColor(0), CUSTOM_BUCKET_COLORS[0]);
  assert.equal(nextCustomBucketColor(1), CUSTOM_BUCKET_COLORS[1]);
  assert.equal(nextCustomBucketColor(CUSTOM_BUCKET_COLORS.length), CUSTOM_BUCKET_COLORS[0]);
});
