// Contract tests for the mock nappi API. The mock stands in for api.nappi.app
// in every other test, so these pin it to what nappi's API docs (https://nappi.app/app/api/reference)
// say the real API does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');

const BASE = 'https://api.nappi.app';
const PHOEBE = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe', birth_date: '2026-03-02', timezone: 'America/New_York' };

function setup() {
  const mock = createMockNappi();
  mock.addToken('good-token');
  mock.addBaby(PHOEBE);
  return mock;
}

function get(mock, path, token) {
  return mock.handle({
    method: 'GET',
    url: BASE + path,
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
}

test('GET /v1/babies lists the household babies as JSON', () => {
  const res = get(setup(), '/v1/babies', 'good-token');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(res.body), [PHOEBE]);
});

test('a baby with no birth date or timezone serialises them as null', () => {
  const mock = createMockNappi();
  mock.addToken('t');
  mock.addBaby({ id: '11111111-1111-4111-8111-111111111111', name: 'Bean' });
  const [baby] = JSON.parse(get(mock, '/v1/babies', 't').body);
  assert.equal(baby.birth_date, null);
  assert.equal(baby.timezone, null);
});

test('a request without a token is unauthorized', () => {
  const res = get(setup(), '/v1/babies');
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.body).error.code, 'unauthorized');
  assert.equal(typeof JSON.parse(res.body).error.message, 'string');
});

test('an unknown token is unauthorized', () => {
  const res = get(setup(), '/v1/babies', 'nope');
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error.code, 'unauthorized');
});

test('a revoked token is unauthorized', () => {
  const mock = setup();
  mock.addToken('old', { revoked: true });
  const res = get(mock, '/v1/babies', 'old');
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error.code, 'unauthorized');
});

test('an expired token is reported as token_expired', () => {
  const mock = setup();
  mock.addToken('stale', { expired: true });
  const res = get(mock, '/v1/babies', 'stale');
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error.code, 'token_expired');
});

test('a token whose owner lacks Premium gets premium_required', () => {
  const mock = setup();
  mock.addToken('free', { premium: false });
  const res = get(mock, '/v1/babies', 'free');
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error.code, 'premium_required');
});

test('the 13th read inside a minute is rate limited with Retry-After', () => {
  let t = Date.parse('2026-10-24T12:00:00Z');
  const mock = createMockNappi({ now: () => t });
  mock.addToken('good-token');
  for (let i = 0; i < 12; i++) {
    assert.equal(get(mock, '/v1/babies', 'good-token').status, 200, 'read ' + (i + 1));
  }
  t += 20 * 1000;
  const res = get(mock, '/v1/babies', 'good-token');
  assert.equal(res.status, 429);
  assert.equal(JSON.parse(res.body).error.code, 'rate_limited');
  assert.equal(res.headers['retry-after'], '40');
});

test('the read allowance returns once a minute has passed', () => {
  let t = Date.parse('2026-10-24T12:00:00Z');
  const mock = createMockNappi({ now: () => t });
  mock.addToken('good-token');
  for (let i = 0; i < 13; i++) get(mock, '/v1/babies', 'good-token');
  t += 61 * 1000;
  assert.equal(get(mock, '/v1/babies', 'good-token').status, 200);
});

test('rate limits are per token', () => {
  const mock = setup();
  mock.addToken('other');
  for (let i = 0; i < 13; i++) get(mock, '/v1/babies', 'good-token');
  assert.equal(get(mock, '/v1/babies', 'other').status, 200);
});

test('unknown routes return 404', () => {
  const res = get(setup(), '/v1/nonsense', 'good-token');
  assert.equal(res.status, 404);
});
