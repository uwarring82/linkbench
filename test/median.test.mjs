import test from 'node:test';
import assert from 'node:assert/strict';
import { median } from '../measure.js';

test('median of an odd number of values', () => {
  assert.equal(median([30, 2, 10]), 10);
});

test('median of an even number of values', () => {
  assert.equal(median([20, 2, 10, 4]), 7);
});

test('median of two values is their arithmetic mean', () => {
  assert.equal(median([9, 2]), 5.5);
});

test('median of a single value', () => {
  assert.equal(median([12]), 12);
});
