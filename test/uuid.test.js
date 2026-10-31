const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uuidv4 } = require('../src/pkjs/uuid');

test('looks like a v4 UUID', () => {
  assert.match(uuidv4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('is unique across many calls', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(uuidv4());
  assert.equal(seen.size, 5000);
});

test('takes its randomness from the injected source so it can be tested', () => {
  assert.equal(uuidv4(() => 0), '00000000-0000-4000-8000-000000000000');
  assert.match(uuidv4(() => 0.999999), /^ffffffff-ffff-4fff-bfff-ffffffffffff$/);
});
