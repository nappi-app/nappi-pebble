const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createXhrTransport } = require('../src/pkjs/xhr-transport');

// Minimal XMLHttpRequest double. `script` decides how the "network" answers.
function fakeXhr(script) {
  const instances = [];
  class FakeXhr {
    constructor() {
      this.requestHeaders = {};
      instances.push(this);
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.requestHeaders[name] = value; }
    send(body) {
      this.body = body;
      Promise.resolve().then(() => script(this));
    }
    getAllResponseHeaders() { return this.rawHeaders || ''; }
  }
  return { FakeXhr, instances };
}

test('sends method, url, headers and body, then resolves with status, headers and text', async () => {
  const { FakeXhr, instances } = fakeXhr((x) => {
    x.status = 201;
    x.responseText = '{"id":"abc"}';
    x.rawHeaders = 'Content-Type: application/json\r\nRetry-After: 40\r\n';
    x.onload();
  });
  const transport = createXhrTransport(FakeXhr);

  const res = await transport({
    method: 'POST',
    url: 'https://api.nappi.app/v1/x',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: '{"a":1}',
  });

  const x = instances[0];
  assert.equal(x.method, 'POST');
  assert.equal(x.url, 'https://api.nappi.app/v1/x');
  assert.deepEqual(x.requestHeaders, { Authorization: 'Bearer t', 'Content-Type': 'application/json' });
  assert.equal(x.body, '{"a":1}');
  assert.equal(res.status, 201);
  assert.equal(res.body, '{"id":"abc"}');
  assert.deepEqual(res.headers, { 'content-type': 'application/json', 'retry-after': '40' });
});

test('a GET with no body sends null', async () => {
  const { FakeXhr, instances } = fakeXhr((x) => { x.status = 200; x.responseText = '[]'; x.onload(); });
  await createXhrTransport(FakeXhr)({ method: 'GET', url: 'https://api.nappi.app/v1/babies', headers: {} });
  assert.equal(instances[0].body, null);
});

test('rejects when the connection fails', async () => {
  const { FakeXhr } = fakeXhr((x) => x.onerror());
  await assert.rejects(
    createXhrTransport(FakeXhr)({ method: 'GET', url: 'https://x/', headers: {} }),
    /network/i,
  );
});

test('rejects on timeout, and sets a timeout so a dead phone link cannot hang forever', async () => {
  const { FakeXhr, instances } = fakeXhr((x) => x.ontimeout());
  await assert.rejects(
    createXhrTransport(FakeXhr)({ method: 'GET', url: 'https://x/', headers: {} }),
    /timed out/i,
  );
  assert.ok(instances[0].timeout > 0);
});

test('header lines without a colon are ignored', async () => {
  const { FakeXhr } = fakeXhr((x) => {
    x.status = 200; x.responseText = '[]'; x.rawHeaders = 'HTTP/1.1 200 OK\r\nETag: "v1"\r\n'; x.onload();
  });
  const res = await createXhrTransport(FakeXhr)({ method: 'GET', url: 'https://x/', headers: {} });
  assert.deepEqual(res.headers, { etag: '"v1"' });
});

// ---- robustness: XHR implementations that never fire onerror / ontimeout ----
// The emulator's XMLHttpRequest reports a refused connection only through
// readystatechange (readyState 4, status 0). A transport that waits for
// onerror hangs forever, and with it the whole sync engine.

function fakeTimers() {
  const t = { pending: [], cleared: [] };
  t.set = (fn, ms) => { const h = { fn, ms }; t.pending.push(h); return h; };
  t.clear = (h) => { t.cleared.push(h); t.pending = t.pending.filter((p) => p !== h); };
  t.fire = () => t.pending.splice(0).forEach((h) => h.fn());
  return t;
}

const REQ = { method: 'GET', url: 'https://x/', headers: {} };

test('a connection failure reported only via readystatechange (status 0) rejects', async () => {
  const { FakeXhr } = fakeXhr((x) => { x.readyState = 4; x.status = 0; x.onreadystatechange(); });
  await assert.rejects(createXhrTransport(FakeXhr, fakeTimers())(REQ), /network/i);
});

test('a response reported only via readystatechange resolves', async () => {
  const { FakeXhr } = fakeXhr((x) => {
    x.readyState = 4; x.status = 200; x.responseText = '[]'; x.rawHeaders = 'ETag: "a"\r\n'; x.onreadystatechange();
  });
  const res = await createXhrTransport(FakeXhr, fakeTimers())(REQ);
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers, { etag: '"a"' });
});

test('intermediate readystatechange events (readyState < 4) are ignored', async () => {
  const { FakeXhr } = fakeXhr((x) => {
    x.readyState = 2; x.status = 0; x.onreadystatechange();
    x.readyState = 4; x.status = 200; x.responseText = 'ok'; x.onreadystatechange();
  });
  const res = await createXhrTransport(FakeXhr, fakeTimers())(REQ);
  assert.equal(res.body, 'ok');
});

test('onload followed by readystatechange settles once, with the first result', async () => {
  const { FakeXhr } = fakeXhr((x) => {
    x.status = 201; x.responseText = 'first'; x.readyState = 4; x.onload();
    x.status = 0; x.onreadystatechange();
  });
  const res = await createXhrTransport(FakeXhr, fakeTimers())(REQ);
  assert.equal(res.status, 201);
  assert.equal(res.body, 'first');
});

test('a request that never answers is failed by the watchdog and aborted', async () => {
  const timers = fakeTimers();
  let aborted = false;
  const { FakeXhr } = fakeXhr(() => { /* the network never answers */ });
  FakeXhr.prototype.abort = function () { aborted = true; };
  const pending = createXhrTransport(FakeXhr, timers)(REQ);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers.pending.length, 1, 'watchdog armed');
  assert.ok(timers.pending[0].ms >= 20000, 'longer than the XHR timeout so the XHR gets the first say');
  timers.fire();
  await assert.rejects(pending, /timed out/i);
  assert.equal(aborted, true);
});

test('the watchdog is cleared once a response arrives', async () => {
  const timers = fakeTimers();
  const { FakeXhr } = fakeXhr((x) => { x.status = 200; x.responseText = '[]'; x.readyState = 4; x.onload(); });
  await createXhrTransport(FakeXhr, timers)(REQ);
  assert.equal(timers.pending.length, 0);
  assert.equal(timers.cleared.length, 1);
});
