const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');
const { createClient } = require('../src/pkjs/api');
const { createQueue } = require('../src/pkjs/queue');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const BABY = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe' };

function memoryStorage() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

function setup(opts) {
  const o = opts || {};
  const clock = { t: NOW };
  const mock = createMockNappi({ now: () => clock.t });
  mock.addToken('t');
  mock.addBaby(BABY);
  const state = { down: false, sent: [] };
  const transport = (req) => {
    state.sent.push(req);
    if (state.down) return Promise.reject(new Error('offline'));
    return Promise.resolve(mock.handle(req));
  };
  const client = createClient({ baseUrl: 'https://api.nappi.app', token: 't', transport });
  const storage = o.storage || memoryStorage();
  let n = 0;
  const queue = createQueue({ storage, uuid: () => 'key-' + (++n), now: () => clock.t, offsetAt: () => -240 });
  return { clock, mock, state, client, storage, queue };
}

const diaper = (type) => ({ kind: 'entry', babyId: BABY.id, body: { type: 'diaper', diaper_type: type || 'wet' } });
const latest = (h) => h.client.latest(BABY.id).then((r) => r.data);

test('enqueue assigns an idempotency key and persists the job', () => {
  const h = setup();
  const job = h.queue.enqueue(diaper());
  assert.equal(job.key, 'key-1');
  assert.equal(h.queue.length(), 1);
  assert.equal(JSON.parse(h.storage.data['nappi-pebble.queue']).length, 1);
});

test('a new queue over the same storage sees the pending jobs (survives restart)', () => {
  const h = setup();
  h.queue.enqueue(diaper());
  const again = createQueue({ storage: h.storage, uuid: () => 'x' });
  assert.equal(again.length(), 1);
});

test('corrupt stored queue is treated as empty', () => {
  const storage = memoryStorage();
  storage.setItem('nappi-pebble.queue', '{nope');
  assert.equal(createQueue({ storage, uuid: () => 'x' }).length(), 0);
});

test('flush sends jobs in order and empties the queue', async () => {
  const h = setup();
  h.queue.enqueue(diaper('wet'));
  h.queue.enqueue({ kind: 'timer_start', babyId: BABY.id, timerType: 'sleep', body: undefined });
  const res = await h.queue.flush(h.client);
  assert.deepEqual({ sent: res.sent, remaining: res.remaining, stop: res.stop }, { sent: 2, remaining: 0, stop: null });
  assert.equal((await latest(h)).diaper.diaper_type, 'wet');
  assert.equal((await h.client.timers(BABY.id)).length, 1);
  assert.equal(h.queue.length(), 0);
});

test('offline: jobs stay queued, nothing is lost, and a later flush delivers them', async () => {
  const h = setup();
  h.state.down = true;
  h.queue.enqueue(diaper('poo'));
  const failed = await h.queue.flush(h.client);
  assert.equal(failed.sent, 0);
  assert.equal(failed.remaining, 1);
  assert.equal(failed.stop.kind, 'network');
  h.state.down = false;
  const ok = await h.queue.flush(h.client);
  assert.equal(ok.sent, 1);
  assert.equal((await latest(h)).diaper.diaper_type, 'poo');
});

test('a retry after a lost response reuses the idempotency key, so nothing double-logs', async () => {
  const h = setup();
  const job = h.queue.enqueue(diaper('wet'));
  // The server receives the write, but the response never makes it back.
  const lost = (req) => { h.mock.handle(req); return Promise.reject(new Error('response lost')); };
  const flaky = createClient({ baseUrl: 'https://api.nappi.app', token: 't', transport: lost });
  await h.queue.flush(flaky);
  assert.equal(h.queue.length(), 1);
  await h.queue.flush(h.client);
  const sent = h.state.sent.filter((r) => r.method === 'POST');
  assert.equal(sent[0].headers['Idempotency-Key'], job.key);
  assert.equal(h.queue.length(), 0);
  const entries = h.mock.handle({
    method: 'GET', url: `https://api.nappi.app/v1/babies/${BABY.id}/entries/latest?types=diaper`, headers: { Authorization: 'Bearer t' },
  });
  assert.equal(JSON.parse(entries.body).diaper.id.length, 36);
});

test('the first failing job blocks the ones behind it so order is preserved', async () => {
  const h = setup();
  h.state.down = true;
  h.queue.enqueue(diaper('wet'));
  h.queue.enqueue(diaper('poo'));
  const res = await h.queue.flush(h.client);
  assert.equal(h.state.sent.length, 1);
  assert.equal(res.remaining, 2);
});

test('a timer stop that finds no timer (409) counts as done', async () => {
  const h = setup();
  h.queue.enqueue({ kind: 'timer_stop', babyId: BABY.id, timerType: 'sleep', body: undefined });
  const res = await h.queue.flush(h.client);
  assert.equal(res.sent, 1);
  assert.equal(res.remaining, 0);
});

test('starting a timer that is already running counts as done', async () => {
  const h = setup();
  await h.client.startTimer(BABY.id, 'sleep');
  h.queue.enqueue({ kind: 'timer_start', babyId: BABY.id, timerType: 'sleep', body: undefined });
  const res = await h.queue.flush(h.client);
  assert.equal(res.remaining, 0);
});

test('a job the API rejects as invalid (400) is dropped and reported, not retried forever', async () => {
  const h = setup();
  h.queue.enqueue({ kind: 'entry', babyId: BABY.id, body: { type: 'diaper', diaper_type: 'sparkly' } });
  h.queue.enqueue(diaper('wet'));
  const res = await h.queue.flush(h.client);
  assert.equal(res.dropped.length, 1);
  assert.equal(res.dropped[0].error.status, 400);
  assert.equal(res.sent, 1, 'the good job behind it still goes');
  assert.equal(res.remaining, 0);
});

test('a job for a baby that no longer exists (404) is dropped', async () => {
  const h = setup();
  h.queue.enqueue({ kind: 'entry', babyId: 'gone', body: { type: 'diaper', diaper_type: 'wet' } });
  const res = await h.queue.flush(h.client);
  assert.equal(res.dropped.length, 1);
  assert.equal(res.remaining, 0);
});

test('a rate limit stops the flush, keeps the jobs, and reports the wait', async () => {
  const h = setup();
  for (let i = 0; i < 30; i++) await h.client.logEntry(BABY.id, { type: 'diaper', diaper_type: 'wet' }, 'pre-' + i);
  h.queue.enqueue(diaper('poo'));
  const res = await h.queue.flush(h.client);
  assert.equal(res.stop.kind, 'rate_limited');
  assert.ok(res.stop.retryAfter > 0);
  assert.equal(res.remaining, 1);
});

test('auth failures stop the flush but keep the jobs for when the token is fixed', async () => {
  const h = setup();
  const bad = createClient({ baseUrl: 'https://api.nappi.app', token: 'wrong', transport: (r) => Promise.resolve(h.mock.handle(r)) });
  h.queue.enqueue(diaper('wet'));
  const res = await h.queue.flush(bad);
  assert.equal(res.stop.kind, 'auth');
  assert.equal(res.remaining, 1);
});

test('a server error (5xx) is treated like being offline', async () => {
  const h = setup();
  const broken = createClient({
    baseUrl: 'https://api.nappi.app', token: 't',
    transport: () => Promise.resolve({ status: 503, headers: {}, body: '<html>unavailable</html>' }),
  });
  h.queue.enqueue(diaper('wet'));
  const res = await h.queue.flush(broken);
  assert.equal(res.stop.kind, 'network');
  assert.equal(res.remaining, 1);
});

test('concurrent flushes do not double-send', async () => {
  const h = setup();
  h.queue.enqueue(diaper('wet'));
  const [a, b] = await Promise.all([h.queue.flush(h.client), h.queue.flush(h.client)]);
  assert.equal(h.state.sent.filter((r) => r.method === 'POST').length, 1);
  assert.equal(a.sent + b.sent >= 1, true);
});

test('jobs enqueued while a flush is running are picked up by it or the next one', async () => {
  const h = setup();
  h.queue.enqueue(diaper('wet'));
  const first = h.queue.flush(h.client);
  h.queue.enqueue(diaper('poo'));
  await first;
  await h.queue.flush(h.client);
  assert.equal(h.queue.length(), 0);
  const posts = h.state.sent.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body).diaper_type);
  assert.deepEqual(posts, ['wet', 'poo']);
});

test('clear empties the queue', () => {
  const h = setup();
  h.queue.enqueue(diaper());
  h.queue.clear();
  assert.equal(h.queue.length(), 0);
  assert.equal(createQueue({ storage: h.storage, uuid: () => 'x' }).length(), 0);
});

// ---- jobs delivered late are stamped with when they were queued ----

const MIN = 60 * 1000;
const bodyOfPost = (h, i) => JSON.parse(h.state.sent.filter((r) => r.method === 'POST')[i || 0].body || 'null');

test('a job delivered promptly carries no time, so the server uses its own clock', async () => {
  const h = setup();
  h.queue.enqueue(diaper('wet'));
  h.clock.t += 10 * 1000;
  await h.queue.flush(h.client);
  assert.equal('time' in bodyOfPost(h), false);
});

test('an entry delivered late is stamped with the moment it was queued', async () => {
  const h = setup();
  h.state.down = true;
  h.queue.enqueue(diaper('wet'));
  await h.queue.flush(h.client);
  h.state.down = false;
  h.clock.t += 5 * MIN;
  await h.queue.flush(h.client);
  const sent = bodyOfPost(h, 1);
  assert.equal(sent.time, '2026-10-24T15:00:00-04:00', 'the tap time, not the delivery time');
});

test('an explicit time (a backdated entry) is never overwritten', async () => {
  const h = setup();
  h.queue.enqueue({ kind: 'entry', babyId: BABY.id, body: { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T14:30:00-04:00' } });
  h.clock.t += 5 * MIN;
  await h.queue.flush(h.client);
  assert.equal(bodyOfPost(h).time, '2026-10-24T14:30:00-04:00');
});

test('a late timer start is stamped as start_time and a late stop as end_time', async () => {
  const h = setup();
  h.queue.enqueue({ kind: 'timer_start', babyId: BABY.id, timerType: 'sleep', body: undefined });
  h.clock.t += 20 * MIN;
  h.queue.enqueue({ kind: 'timer_stop', babyId: BABY.id, timerType: 'sleep', body: undefined });
  h.clock.t += 40 * MIN;
  const res = await h.queue.flush(h.client);
  assert.equal(res.sent, 2);
  assert.equal(bodyOfPost(h, 0).start_time, '2026-10-24T15:00:00-04:00');
  assert.equal(bodyOfPost(h, 1).end_time, '2026-10-24T15:20:00-04:00');
  const latest = await h.client.latest(BABY.id, { types: ['sleep'] });
  assert.equal(latest.data.sleep.duration_minutes, 20, 'the sleep lasted from tap to tap, not to delivery');
});

test('an explicit start_time on a late timer start is kept', async () => {
  const h = setup();
  h.queue.enqueue({ kind: 'timer_start', babyId: BABY.id, timerType: 'sleep', body: { start_time: '2026-10-24T14:00:00-04:00' } });
  h.clock.t += 10 * MIN;
  await h.queue.flush(h.client);
  assert.equal(bodyOfPost(h).start_time, '2026-10-24T14:00:00-04:00');
});

test('other body fields survive stamping, and the stored job is not altered', async () => {
  const h = setup();
  h.state.down = true;
  h.queue.enqueue({ kind: 'timer_start', babyId: BABY.id, timerType: 'nursing', body: { side: 'left' } });
  await h.queue.flush(h.client);
  h.state.down = false;
  h.clock.t += 5 * MIN;
  await h.queue.flush(h.client);
  const sent = bodyOfPost(h, 1);
  assert.equal(sent.side, 'left');
  assert.ok(sent.start_time);
});

test('the stale threshold is 30 seconds', async () => {
  const h = setup();
  h.queue.enqueue(diaper('wet'));
  h.clock.t += 29 * 1000;
  await h.queue.flush(h.client);
  assert.equal('time' in bodyOfPost(h), false);
  const h2 = setup();
  h2.queue.enqueue(diaper('wet'));
  h2.clock.t += 31 * 1000;
  await h2.queue.flush(h2.client);
  assert.ok(bodyOfPost(h2).time);
});

test('jobs persisted before this field existed still flush (no queuedAt)', async () => {
  const h = setup();
  h.storage.setItem('nappi-pebble.queue', JSON.stringify([{ kind: 'entry', babyId: BABY.id, body: { type: 'diaper', diaper_type: 'wet' }, key: 'old-1' }]));
  const q = createQueue({ storage: h.storage, uuid: () => 'x', now: () => h.clock.t, offsetAt: () => 0 });
  const res = await q.flush(h.client);
  assert.equal(res.sent, 1);
});
