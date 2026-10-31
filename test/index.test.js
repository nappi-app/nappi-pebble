// Smoke test for src/pkjs/index.js: load the real entry point against fake
// Pebble globals and check the wiring (events in, AppMessage out, XHR, Clay).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { createMockNappi } = require('./support/mock-nappi');
const P = require('../src/pkjs/protocol');

const realSetTimeout = setTimeout;
const INDEX = path.join(__dirname, '..', 'src', 'pkjs', 'index.js');
const BABY = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe', birth_date: null, timezone: null };

function fakeKeyIds() {
  const ids = {};
  let next = 10000;
  P.MESSAGE_KEYS.forEach((decl) => {
    const m = /^([A-Z0-9_]+)(?:\[(\d+)\])?$/.exec(decl);
    ids[m[1]] = next;
    next += m[2] ? Number(m[2]) : 1;
  });
  return ids;
}

// Loads index.js fresh with fake globals; returns handles to drive and inspect it.
function boot(opts) {
  const o = Object.assign({ token: 'good-token', babies: [BABY] }, opts);
  const mock = createMockNappi();
  mock.addToken('good-token');
  o.babies.forEach((b) => mock.addBaby(b));

  const listeners = {};
  const sent = [];
  const opened = [];
  const requests = [];
  const store = {};
  if (o.token) store['nappi-pebble.settings'] = JSON.stringify({ token: o.token });

  const clayInstances = [];
  class FakeClay {
    constructor(config, fn, options) {
      this.config = config;
      this.options = options;
      this.settings = null;
      clayInstances.push(this);
    }
    setSettings(v) { this.settings = v; }
    generateUrl() { return 'clay://settings'; }
    getSettings(response) { return JSON.parse(response); }
  }

  class FakeXhr {
    constructor() { this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    getAllResponseHeaders() { return Object.keys(this.out.headers).map((k) => k + ': ' + this.out.headers[k]).join('\r\n'); }
    send(body) {
      requests.push({ method: this.method, url: this.url, headers: this.headers, body });
      this.out = mock.handle({ method: this.method, url: this.url, headers: this.headers, body: body === null ? undefined : body });
      this.status = this.out.status;
      this.responseText = this.out.body;
      setImmediate(() => this.onload());
    }
  }

  global.Pebble = {
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    sendAppMessage: (dict, ok) => { sent.push(dict); setImmediate(ok); },
    openURL: (url) => opened.push(url),
  };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  global.XMLHttpRequest = FakeXhr;

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'pebble-clay') return FakeClay;
    if (request === 'message_keys') return fakeKeyIds();
    return realLoad.call(this, request, parent, isMain);
  };
  // index.js schedules a debounced re-read; do not let it hold the test process open.
  global.setTimeout = (fn, ms) => { const t = realSetTimeout(fn, ms); if (t.unref) t.unref(); return t; };
  delete require.cache[INDEX];
  require(INDEX);
  global.setTimeout = realSetTimeout;
  Module._load = realLoad;

  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 20));
  return {
    mock, sent, opened, requests, store, clayInstances, settle,
    fire: (name, event) => (listeners[name] || []).forEach((fn) => fn(event)),
    has: (name) => (listeners[name] || []).length > 0,
    ids: fakeKeyIds(),
  };
}

test('registers the four Pebble events it needs', () => {
  const b = boot();
  ['ready', 'appmessage', 'showConfiguration', 'webviewclosed'].forEach((name) => assert.ok(b.has(name), name));
});

test('on ready it syncs and sends the state to the watch using wire keys', async () => {
  const b = boot();
  b.fire('ready', {});
  await b.settle();
  const state = b.sent.find((d) => 'STATUS' in d);
  assert.equal(state.STATUS, P.STATUS.OK);
  assert.equal(state.BABY_NAME, 'Phoebe');
  assert.deepEqual(state.LAYOUT.slice(-1), [P.ACTION.STATUS]);
  assert.equal(state[b.ids.LAST], 0, 'array keys are spread to numeric ids');
  assert.equal('LAST' in state, false);
  assert.equal(state.BOTTLE_UNITS, P.UNITS.OZ);
  assert.equal(state.PUMP_UNITS, P.UNITS.OZ);
});

test('on ready the first message to the watch is JS_READY', async () => {
  const b = boot();
  b.fire('ready', {});
  await b.settle();
  assert.deepEqual(b.sent[0], { JS_READY: 1 });
});

test('with no token on ready it reports NO_TOKEN and makes no HTTP request', async () => {
  const b = boot({ token: '' });
  b.fire('ready', {});
  await b.settle();
  assert.equal(b.sent.find((d) => 'STATUS' in d).STATUS, P.STATUS.NO_TOKEN);
  assert.equal(b.requests.length, 0);
});

test('an appmessage from the watch becomes an acknowledged, delivered write', async () => {
  const b = boot();
  b.fire('ready', {});
  await b.settle();
  b.fire('appmessage', { payload: { CMD: P.CMD.LOG_DIAPER, CMD_ID: 5, ARG1: P.DIAPER.WET, ARG2: 0 } });
  await b.settle();
  assert.ok(b.sent.some((d) => d.ACK_ID === 5 && d.ACK_STATUS === P.STATUS.OK));
  const post = b.requests.find((r) => r.method === 'POST');
  assert.ok(post.url.endsWith(`/v1/babies/${BABY.id}/entries`));
  assert.equal(JSON.parse(post.body).diaper_type, 'wet');
  assert.ok(post.headers['Idempotency-Key'].match(/^[0-9a-f-]{36}$/));
});

test('a malformed appmessage does not throw', async () => {
  const b = boot();
  b.fire('ready', {});
  await b.settle();
  assert.doesNotThrow(() => b.fire('appmessage', { payload: undefined }));
  assert.doesNotThrow(() => b.fire('appmessage', {}));
  await b.settle();
});

test('showConfiguration opens the Clay page with the babies and prefilled values', async () => {
  const b = boot();
  b.fire('showConfiguration', {});
  await b.settle();
  assert.deepEqual(b.opened, ['clay://settings']);
  const clay = b.clayInstances[b.clayInstances.length - 1];
  assert.equal(clay.options.autoHandleEvents, false);
  assert.ok(JSON.stringify(clay.config).includes('Phoebe'));
  assert.equal(clay.settings.token, 'good-token');
  assert.equal(clay.settings.bottleUnits, 'oz');
  assert.equal(clay.settings.pumpUnits, 'oz');
});

test('webviewclosed saves the settings and syncs again', async () => {
  const b = boot({ token: '' });
  b.fire('ready', {});
  await b.settle();
  b.fire('webviewclosed', { response: JSON.stringify({ token: { value: 'good-token' }, bottleUnits: { value: 'ml' } }) });
  await b.settle();
  assert.equal(JSON.parse(b.store['nappi-pebble.settings']).bottleUnits, 'ml');
  const last = b.sent.filter((d) => 'STATUS' in d).pop();
  assert.equal(last.STATUS, P.STATUS.OK);
  assert.equal(last.BOTTLE_UNITS, P.UNITS.ML);
  assert.ok(!JSON.stringify(b.sent).includes('good-token'), 'token never reaches the watch');
});

test('a webviewclosed with no response (cancelled) is ignored', async () => {
  const b = boot();
  assert.doesNotThrow(() => b.fire('webviewclosed', {}));
  assert.doesNotThrow(() => b.fire('webviewclosed', { response: '' }));
  await b.settle();
  assert.equal(b.requests.length, 0);
});
