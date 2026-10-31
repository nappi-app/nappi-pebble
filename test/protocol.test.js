const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STATUS, NAPPI_DOCS_URL, statusMessage, describeError } = require('../src/pkjs/protocol');
const { ApiError } = require('../src/pkjs/api');

test('status codes are distinct small integers (AppMessage-friendly)', () => {
  const values = Object.values(STATUS);
  assert.equal(new Set(values).size, values.length);
  values.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v < 256));
  assert.equal(STATUS.OK, 0);
});

test('API error codes map to watch statuses', () => {
  const cases = [
    [new ApiError('unauthorized', 'x', 401), STATUS.UNAUTHORIZED],
    [new ApiError('token_expired', 'x', 401), STATUS.TOKEN_EXPIRED],
    [new ApiError('premium_required', 'x', 403), STATUS.PREMIUM_REQUIRED],
    [new ApiError('network', 'x', 0), STATUS.NETWORK],
    [new ApiError('no_token', 'x', 0), STATUS.NO_TOKEN],
    [new ApiError('bad_response', 'x', 502), STATUS.ERROR],
    [new Error('something else'), STATUS.ERROR],
  ];
  cases.forEach(([err, expected]) => assert.equal(describeError(err).status, expected, err.code || err.message));
});

test('a 429 maps by status, not by the undocumented error code', () => {
  const err = new ApiError('some_code_we_never_saw', 'slow down', 429, 12);
  assert.deepEqual(describeError(err), { status: STATUS.RATE_LIMITED, retryAfter: 12, text: statusMessage(STATUS.RATE_LIMITED, 12) });
});

test('token problems link to nappi\'s own docs instead of explaining how to make a token', () => {
  for (const status of [STATUS.UNAUTHORIZED, STATUS.TOKEN_EXPIRED]) {
    assert.ok(statusMessage(status).includes(NAPPI_DOCS_URL));
  }
});

test('every status has a human sentence for the settings page', () => {
  Object.values(STATUS).forEach((s) => assert.equal(typeof statusMessage(s, 0), 'string'));
  assert.match(statusMessage(STATUS.UNAUTHORIZED), /not accepted/i);
  assert.match(statusMessage(STATUS.TOKEN_EXPIRED), /expired/i);
  assert.match(statusMessage(STATUS.PREMIUM_REQUIRED), /premium/i);
  assert.match(statusMessage(STATUS.RATE_LIMITED, 40), /40/);
});
