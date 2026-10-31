// Shared test rig for the phone-side engine: a mock API with a controllable
// clock and network, a recording "watch", and a fake scheduler.

const { createMockNappi } = require('./mock-nappi');
const { createSettings } = require('../../src/pkjs/settings');
const { createClient } = require('../../src/pkjs/api');
const { createApp } = require('../../src/pkjs/app');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const PHOEBE = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe', birth_date: '2026-03-02', timezone: 'America/New_York' };
const OSCAR = { id: '0a2b3c4d-1111-4222-8333-444455556666', name: 'Oscar', birth_date: '2024-01-09', timezone: 'America/New_York' };

function memoryStorage() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

function harness(opts) {
  const o = Object.assign({ babies: [PHOEBE], token: 'good-token', stored: {}, storage: null }, opts);
  const clock = { t: NOW };
  const mock = createMockNappi({ now: () => clock.t });
  mock.addToken('good-token');
  mock.addToken('expired-token', { expired: true });
  mock.addToken('free-token', { premium: false });
  o.babies.forEach((b) => mock.addBaby(b));

  const net = { offline: false, requests: [] };
  const storage = o.storage || memoryStorage();
  const settings = createSettings(storage);
  settings.update(Object.assign({ token: o.token }, o.stored));

  const toWatch = [];
  const flight = { now: 0, max: 0 };
  const tasks = [];
  const logs = [];
  let uuidCounter = 0;

  const app = createApp({
    settings,
    storage,
    now: () => clock.t,
    offsetAt: () => -240,
    uuid: () => 'uuid-' + (++uuidCounter),
    makeClient: (s) => createClient({
      baseUrl: s.baseUrl,
      token: s.token,
      transport: (req) => {
        net.requests.push(req);
        if (net.offline) return Promise.reject(new Error('offline'));
        return Promise.resolve(mock.handle(req));
      },
    }),
    sendToWatch: (dict) => {
      flight.now += 1;
      flight.max = Math.max(flight.max, flight.now);
      toWatch.push(dict);
      return new Promise((resolve) => setImmediate(() => { flight.now -= 1; resolve(); }));
    },
    schedule: (fn, ms) => { const t = { fn, ms, cancelled: false }; tasks.push(t); return t; },
    cancel: (t) => { t.cancelled = true; },
    log: (m) => { logs.push(m); },
  });

  return {
    app, mock, clock, net, settings, storage, toWatch, flight, tasks, logs,
    reads: () => net.requests.filter((r) => r.method === 'GET'),
    writes: () => net.requests.filter((r) => r.method === 'POST'),
    // The most recent STATE message (ACKs carry no STATUS).
    state: () => toWatch.filter((d) => 'STATUS' in d).slice(-1)[0],
    acks: () => toWatch.filter((d) => 'ACK_ID' in d),
    api: (path, body, key) => mock.handle({
      method: body ? 'POST' : 'GET',
      url: 'https://api.nappi.app' + path,
      headers: Object.assign(
        { Authorization: 'Bearer good-token' },
        body ? { 'Content-Type': 'application/json' } : {},
        key ? { 'Idempotency-Key': key } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    }),
    // Run scheduled callbacks that have not been cancelled, then let the engine settle.
    async runScheduled() {
      const due = tasks.splice(0).filter((t) => !t.cancelled);
      for (const t of due) await t.fn();
      await app.idle();
    },
    reset() { net.requests.length = 0; toWatch.length = 0; },
  };
}

module.exports = { harness, NOW, PHOEBE, OSCAR, memoryStorage };
