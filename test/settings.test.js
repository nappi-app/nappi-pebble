const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSettings, DEFAULTS, isAllowedBaseUrl } = require('../src/pkjs/settings');
const { resolveActiveBaby } = require('../src/pkjs/babies');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

const A = { id: 'a', name: 'Phoebe', birth_date: null, timezone: null };
const B = { id: 'b', name: 'Oscar', birth_date: null, timezone: null };

test('fresh settings use the agreed defaults: oz, no token, production API', () => {
  const s = createSettings(memoryStorage()).get();
  assert.equal(s.token, '');
  assert.equal(s.babyId, '');
  assert.equal(s.bottleUnits, 'oz');
  assert.equal(s.pumpUnits, 'oz');
  assert.equal(s.baseUrl, 'https://api.nappi.app');
  assert.deepEqual(s, DEFAULTS);
});

test('update persists and a new store over the same storage reads it back', () => {
  const storage = memoryStorage();
  createSettings(storage).update({ token: 'abc', babyId: 'a' });
  const s = createSettings(storage).get();
  assert.equal(s.token, 'abc');
  assert.equal(s.babyId, 'a');
  assert.equal(s.bottleUnits, 'oz');
});

test('update merges rather than replaces', () => {
  const store = createSettings(memoryStorage());
  store.update({ token: 'abc' });
  store.update({ bottleUnits: 'ml' });
  assert.deepEqual(
    [store.get().token, store.get().bottleUnits],
    ['abc', 'ml'],
  );
});

test('a stored legacy units value fills both per-screen units', () => {
  const storage = memoryStorage({ 'nappi-pebble.settings': JSON.stringify({ units: 'ml' }) });
  const s = createSettings(storage).get();
  assert.equal(s.bottleUnits, 'ml');
  assert.equal(s.pumpUnits, 'ml');
});

test('a stored per-screen value wins over the legacy units value', () => {
  const storage = memoryStorage({ 'nappi-pebble.settings': JSON.stringify({ units: 'ml', bottleUnits: 'oz' }) });
  const s = createSettings(storage).get();
  assert.equal(s.bottleUnits, 'oz');
  assert.equal(s.pumpUnits, 'ml');
});

test('empty storage gives oz for both, and no units or bottlePresets key exists', () => {
  const s = createSettings(memoryStorage()).get();
  assert.equal(s.bottleUnits, 'oz');
  assert.equal(s.pumpUnits, 'oz');
  assert.equal('units' in s, false);
  assert.equal('bottlePresets' in s, false);
});

test('corrupt stored JSON falls back to defaults instead of throwing', () => {
  const storage = memoryStorage({ 'nappi-pebble.settings': '{not json' });
  assert.deepEqual(createSettings(storage).get(), DEFAULTS);
});

test('get returns a copy so callers cannot mutate the store', () => {
  const store = createSettings(memoryStorage());
  store.get().token = 'sneaky';
  assert.equal(store.get().token, '');
});

test('unknown stored keys are dropped', () => {
  const storage = memoryStorage({ 'nappi-pebble.settings': JSON.stringify({ token: 't', junk: 1 }) });
  const s = createSettings(storage).get();
  assert.equal(s.token, 't');
  assert.equal('junk' in s, false);
});

test('no babies means no active baby', () => {
  assert.deepEqual(resolveActiveBaby([], ''), { baby: null, hasChoice: false });
});

test('a single baby is active and the switcher stays hidden', () => {
  assert.deepEqual(resolveActiveBaby([A], ''), { baby: A, hasChoice: false });
});

test('the saved baby stays active when there are several', () => {
  assert.deepEqual(resolveActiveBaby([A, B], 'b'), { baby: B, hasChoice: true });
});

test('with several babies and no saved choice the first is active', () => {
  assert.deepEqual(resolveActiveBaby([A, B], ''), { baby: A, hasChoice: true });
});

test('a saved baby that no longer exists falls back to the first', () => {
  assert.deepEqual(resolveActiveBaby([A, B], 'gone'), { baby: A, hasChoice: true });
});

test('isAllowedBaseUrl accepts https and local or private http', () => {
  [
    'https://api.nappi.app',
    'https://api.nappi.app/',
    'HTTPS://API.NAPPI.APP',
    'http://localhost:4010',
    'HTTP://LOCALHOST:4010',
    'http://127.0.0.1:4010',
    'http://127.255.0.1',
    'http://[::1]:4010',
    'http://[::1]',
    'http://192.168.1.5:4010',
    'http://10.0.0.2',
    'http://10.0.0.2/v1',
    'http://172.16.0.1',
    'http://172.31.255.1'
  ].forEach((url) => assert.equal(isAllowedBaseUrl(url), true, url));
});

test('isAllowedBaseUrl rejects remote http and look-alikes', () => {
  [
    'http://example.com',
    'http://localhost.evil.com',
    'http://10.0.0.1.evil.com',
    'http://172.32.0.1',
    'http://172.15.0.1',
    'http://192.169.0.1',
    'http://localhost@evil.com',
    'http://localhost:80@evil.com',
    'http://user:pw@localhost:4010',
    'http://localhost:80\\@evil.com',
    'http://localhost\\@evil.com',
    'http://localhost.',
    'http://localhost:abc',
    'http://010.0.0.1',
    'http://10.0.0.256',
    'http://10.0.0',
    'http://10.0.0.1.2',
    'http://[::2]',
    'http://[::1.evil.com]',
    'http://[::ffff:8.8.8.8]',
    'http://[0:0:0:0:0:0:0:1]',
    'http://::1',
    'http://',
    'ftp://x',
    'file://localhost/x',
    'javascript:alert(1)',
    'https:/api.nappi.app',
    'https://',
    ' http://evil.com',
    'http://evil.com ',
    ' http://localhost',
    'http://localhost ',
    ' https://api.nappi.app',
    'http://evil.com\t@localhost',
    'localhost:4010',
    'api.nappi.app',
    '',
    null,
    undefined,
    42
  ].forEach((url) => assert.equal(isAllowedBaseUrl(url), false, JSON.stringify(url)));
});

test('a saved remote http address falls back to the default at read time', () => {
  [
    'http://evil.example',
    'http://localhost.evil.com',
    ' http://evil.example',
    'HTTP://EVIL.EXAMPLE',
    'http://localhost:80@evil.example',
    '',
    42
  ].forEach((baseUrl) => {
    const storage = memoryStorage({ 'nappi-pebble.settings': JSON.stringify({ token: 't', baseUrl }) });
    const s = createSettings(storage).get();
    assert.equal(s.baseUrl, DEFAULTS.baseUrl, JSON.stringify(baseUrl));
    assert.equal(s.token, 't');
  });
});

test('a saved local or https address is kept at read time', () => {
  ['http://localhost:4010', 'https://my.proxy.example/api', 'http://192.168.1.5:4010'].forEach((baseUrl) => {
    const storage = memoryStorage({ 'nappi-pebble.settings': JSON.stringify({ baseUrl }) });
    assert.equal(createSettings(storage).get().baseUrl, baseUrl);
  });
});

test('update cannot persist a remote http address either', () => {
  const storage = memoryStorage();
  const s = createSettings(storage);
  s.update({ baseUrl: 'http://evil.example' });
  assert.equal(s.get().baseUrl, DEFAULTS.baseUrl);
  assert.ok(!storage.data['nappi-pebble.settings'].includes('evil'));
});
