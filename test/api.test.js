const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');
const { createClient, ApiError } = require('../src/pkjs/api');

const BASE = 'https://api.nappi.app';
const PHOEBE = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe', birth_date: '2026-03-02', timezone: 'America/New_York' };

// A transport that forwards to the mock and records what the client sent.
function wire(mock) {
  const sent = [];
  const transport = (req) => {
    sent.push(req);
    return Promise.resolve(mock.handle(req));
  };
  return { transport, sent };
}

function setup(tokenFlags) {
  const mock = createMockNappi();
  mock.addToken('good-token', tokenFlags);
  mock.addBaby(PHOEBE);
  return mock;
}

test('listBabies sends an authenticated GET and returns the parsed babies', async () => {
  const { transport, sent } = wire(setup());
  const client = createClient({ baseUrl: BASE, token: 'good-token', transport });

  const babies = await client.listBabies();

  assert.deepEqual(babies, [PHOEBE]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'GET');
  assert.equal(sent[0].url, BASE + '/v1/babies');
  assert.equal(sent[0].headers.Authorization, 'Bearer good-token');
});

test('a trailing slash on the base URL does not double up', async () => {
  const { transport, sent } = wire(setup());
  await createClient({ baseUrl: BASE + '/', token: 'good-token', transport }).listBabies();
  assert.equal(sent[0].url, BASE + '/v1/babies');
});

test('without a token it fails fast and sends nothing', async () => {
  const { transport, sent } = wire(setup());
  const client = createClient({ baseUrl: BASE, token: '', transport });

  await assert.rejects(client.listBabies(), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'no_token');
    return true;
  });
  assert.equal(sent.length, 0);
});

test('a rejected token surfaces status and the API error code', async () => {
  const { transport } = wire(setup());
  const client = createClient({ baseUrl: BASE, token: 'wrong', transport });

  await assert.rejects(client.listBabies(), (err) => {
    assert.ok(err instanceof ApiError);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 401);
    assert.equal(err.code, 'unauthorized');
    assert.equal(typeof err.message, 'string');
    return true;
  });
});

test('an expired token keeps its token_expired code', async () => {
  const { transport } = wire(setup({ expired: true }));
  await assert.rejects(
    createClient({ baseUrl: BASE, token: 'good-token', transport }).listBabies(),
    (err) => err.status === 401 && err.code === 'token_expired',
  );
});

test('a non-Premium account surfaces premium_required', async () => {
  const { transport } = wire(setup({ premium: false }));
  await assert.rejects(
    createClient({ baseUrl: BASE, token: 'good-token', transport }).listBabies(),
    (err) => err.status === 403 && err.code === 'premium_required',
  );
});

test('a 429 exposes Retry-After as a number of seconds', async () => {
  let t = Date.parse('2026-10-24T12:00:00Z');
  const mock = createMockNappi({ now: () => t });
  mock.addToken('good-token');
  const { transport } = wire(mock);
  const client = createClient({ baseUrl: BASE, token: 'good-token', transport });
  for (let i = 0; i < 12; i++) await client.listBabies();
  t += 20 * 1000;

  await assert.rejects(client.listBabies(), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.retryAfter, 40);
    return true;
  });
});

test('Retry-After is found whatever case the transport reports it in', async () => {
  const transport = () => Promise.resolve({
    status: 429,
    headers: { 'Retry-After': '7' },
    body: JSON.stringify({ error: { code: 'whatever', message: 'slow down' } }),
  });
  await assert.rejects(
    createClient({ baseUrl: BASE, token: 't', transport }).listBabies(),
    (err) => err.status === 429 && err.retryAfter === 7,
  );
});

test('a transport failure becomes a network error with status 0', async () => {
  const transport = () => Promise.reject(new Error('socket hang up'));
  await assert.rejects(
    createClient({ baseUrl: BASE, token: 't', transport }).listBabies(),
    (err) => err instanceof ApiError && err.code === 'network' && err.status === 0,
  );
});

test('a non-JSON error body still yields an ApiError carrying the status', async () => {
  const transport = () => Promise.resolve({ status: 502, headers: {}, body: '<html>Bad gateway</html>' });
  await assert.rejects(
    createClient({ baseUrl: BASE, token: 't', transport }).listBabies(),
    (err) => err instanceof ApiError && err.status === 502 && err.code === 'bad_response',
  );
});

test('a 200 with a non-JSON body is a bad_response, not a crash', async () => {
  const transport = () => Promise.resolve({ status: 200, headers: {}, body: 'oops' });
  await assert.rejects(
    createClient({ baseUrl: BASE, token: 't', transport }).listBabies(),
    (err) => err instanceof ApiError && err.code === 'bad_response',
  );
});
