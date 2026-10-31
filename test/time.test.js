const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toIsoOffset, minutesAgo } = require('../src/pkjs/time');

const T = Date.parse('2026-10-24T19:00:00Z');

test('formats an instant with a negative offset', () => {
  assert.equal(toIsoOffset(T, -240), '2026-10-24T15:00:00-04:00');
});

test('formats with a positive and a half-hour offset', () => {
  assert.equal(toIsoOffset(T, 330), '2026-10-25T00:30:00+05:30');
});

test('zero offset is written as +00:00, which the API accepts as an offset', () => {
  assert.equal(toIsoOffset(T, 0), '2026-10-24T19:00:00+00:00');
});

test('seconds and the date roll correctly across midnight', () => {
  assert.equal(toIsoOffset(Date.parse('2026-12-31T23:59:59Z'), 60), '2027-01-01T00:59:59+01:00');
});

test('the result parses back to the same instant', () => {
  [-720, -240, 0, 60, 330, 840].forEach((off) => {
    assert.equal(Date.parse(toIsoOffset(T, off)), T, 'offset ' + off);
  });
});

test('minutesAgo subtracts whole minutes', () => {
  assert.equal(minutesAgo(T, 15), T - 15 * 60000);
  assert.equal(minutesAgo(T, 0), T);
});
