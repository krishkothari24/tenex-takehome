import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTimeCost } from './time-cost.js';

test('sums known per-email estimates and converts to hours', () => {
  const result = computeTimeCost([
    { bucket: 'Important', estimatedReadMinutes: 3 },
    { bucket: 'Important', estimatedReadMinutes: 5 },
    { bucket: 'Newsletter', estimatedReadMinutes: 2 },
  ]);
  assert.equal(result.totalMinutes, 10);
  assert.equal(result.totalHours, 10 / 60);
  assert.equal(result.unestimatedCount, 0);
});

test('excludes null estimates from the sum but counts them as unestimated', () => {
  const result = computeTimeCost([
    { bucket: 'Important', estimatedReadMinutes: 4 },
    { bucket: 'Important', estimatedReadMinutes: null },
    { bucket: 'Promotions', estimatedReadMinutes: null },
  ]);
  assert.equal(result.totalMinutes, 4);
  assert.equal(result.unestimatedCount, 2);
});

test('empty input returns all zeros', () => {
  const result = computeTimeCost([]);
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.totalHours, 0);
  assert.equal(result.unestimatedCount, 0);
  assert.deepEqual(result.byBucket, []);
});

test('per-bucket averages are computed correctly across mixed values', () => {
  const result = computeTimeCost([
    { bucket: 'Important', estimatedReadMinutes: 2 },
    { bucket: 'Important', estimatedReadMinutes: 4 },
    { bucket: 'Important', estimatedReadMinutes: 6 },
  ]);
  const important = result.byBucket.find((b) => b.bucket === 'Important');
  assert.equal(important?.emailCount, 3);
  assert.equal(important?.totalMinutes, 12);
  assert.equal(important?.minutesPerEmail, 4);
});
