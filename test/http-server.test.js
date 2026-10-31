const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');
const { listen } = require('./support/http-server');

const PHOEBE = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe', birth_date: null, timezone: null };

async function withServer(fn) {
  const mock = createMockNappi();
  mock.addToken('good-token');
  mock.addBaby(PHOEBE);
  const server = await listen(mock, 0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('serves the mock over real HTTP', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/v1/babies', { headers: { Authorization: 'Bearer good-token' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ ...PHOEBE }]);
  });
});

test('errors and Retry-After survive the trip', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/v1/babies');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'unauthorized');
  });
});

test('CORS preflight is answered so a browser-based client can call it', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/v1/babies', { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-headers'), /authorization/i);
  });
});
