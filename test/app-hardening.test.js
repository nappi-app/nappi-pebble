// Engine behaviour the code review asked for: wrong-baby guard, rejected-write
// notice, separate read and write limits, queue replay over reads, read budget.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, NOW, PHOEBE, OSCAR, memoryStorage } = require('./support/harness');
const { WRITE_LIMIT } = require('./support/mock-nappi');
const { createClient } = require('../src/pkjs/api');
const P = require('../src/pkjs/protocol');

const MIN = 60 * 1000;
const DIAPER_CMD = (id, type, extra) => Object.assign({ CMD: P.CMD.LOG_DIAPER, CMD_ID: id, ARG1: type, ARG2: 0 }, extra);

// ---------- which baby ----------

test('a write for a baby the watch is no longer showing is refused, not logged to the other baby', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  h.reset();
  await h.app.onMessage(DIAPER_CMD(5, P.DIAPER.WET, { BABY_INDEX: 1 })); // watch thinks Oscar; phone has Phoebe
  await h.app.idle();
  assert.deepEqual(h.acks(), [{ ACK_ID: 5, ACK_STATUS: P.STATUS.WRONG_BABY }]);
  assert.equal(h.writes().length, 0);
  assert.equal(h.state().BABY_NAME, 'Phoebe', 'the watch is sent the real state so it can correct itself');
});

test('a write for the baby the watch is showing goes through', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  h.reset();
  await h.app.onMessage(DIAPER_CMD(6, P.DIAPER.WET, { BABY_INDEX: 0 }));
  await h.app.idle();
  assert.deepEqual(h.acks(), [{ ACK_ID: 6, ACK_STATUS: P.STATUS.OK }]);
  assert.equal(h.writes().length, 1);
});

test('a write with no BABY_INDEX (a watch with no data yet) is not checked', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  h.reset();
  await h.app.onMessage(DIAPER_CMD(7, P.DIAPER.WET));
  assert.deepEqual(h.acks(), [{ ACK_ID: 7, ACK_STATUS: P.STATUS.OK }]);
});

// ---------- rejected writes ----------

test('a write the API refuses for good is reported to the watch, which had already confirmed it', async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  await first.app.start();
  first.net.offline = true;
  await first.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await first.app.idle();
  const queue = JSON.parse(storage.data['nappi-pebble.queue']);
  queue[0].babyId = 'no-such-baby'; // the API answers 404
  storage.data['nappi-pebble.queue'] = JSON.stringify(queue);

  const second = harness({ storage });
  await second.app.start();
  await second.app.idle();
  assert.equal(second.state().PENDING, 0, 'dropped, not retried forever');
  assert.ok(
    second.acks().some((a) => a.ACK_ID === 0 && a.ACK_STATUS === P.STATUS.REJECTED),
    'the watch is told'
  );
});

// ---------- read and write limits are separate ----------

function exhaustWrites(h) {
  for (let i = 0; i < WRITE_LIMIT; i++) h.api(`/v1/babies/${PHOEBE.id}/entries`, { type: 'diaper', diaper_type: 'dry' });
}

test('a write 429 does not block reads, is not hidden by a read, and the queued write stays on the watch', async () => {
  const h = harness();
  await h.app.start();
  exhaustWrites(h);
  h.reset();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.POO));
  await h.app.idle();
  assert.equal(h.state().STATUS, P.STATUS.RATE_LIMITED);
  assert.equal(h.state().PENDING, 1);

  h.reset();
  await h.app.onMessage({ CMD: P.CMD.REFRESH, ARG1: 1 });
  await h.app.idle();
  assert.ok(h.reads().length > 0, 'reads still go out');
  assert.equal(h.state().STATUS, P.STATUS.RATE_LIMITED, 'a good read does not hide the stuck write');
  assert.equal(h.state().PENDING, 1);
  assert.equal(h.state().LAST[P.ACTION.DIAPER], Math.floor(NOW / 1000), 'the queued entry is laid back over the server data');
  assert.equal(h.state().INFO[P.ACTION.DIAPER], P.DIAPER.POO + 1);
});

test('after a write 429 the engine retries by itself once the wait has passed', async () => {
  const h = harness();
  await h.app.start();
  exhaustWrites(h);
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.POO));
  await h.app.idle();
  assert.equal(h.state().PENDING, 1);

  h.clock.t += 2 * MIN;
  h.reset();
  await h.runScheduled();
  assert.equal(h.state().PENDING, 0);
  assert.equal(h.state().STATUS, P.STATUS.OK);
  assert.equal(h.writes().length, 1);
});

test('inside the refresh throttle the queue is still flushed', async () => {
  const h = harness();
  await h.app.start();
  h.net.offline = true;
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.idle();
  h.net.offline = false;
  h.reset();
  h.clock.t += 20 * 1000; // inside MIN_REFRESH_MS
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  await h.app.idle();
  assert.equal(h.reads().length, 0, 'throttled: no reads');
  assert.equal(h.writes().length, 1, 'but the pending write goes out');
  assert.equal(h.state().PENDING, 0);
});

// ---------- refresh behaviour ----------

test('REFRESH with ARG1 1 bypasses the once-a-minute throttle', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.reads().length, 0);
  await h.app.onMessage({ CMD: P.CMD.REFRESH, ARG1: 1 });
  assert.ok(h.reads().length > 0);
});

test('a forced refresh asked for while one is running runs again afterwards, so it cannot miss a write', async () => {
  const h = harness();
  const starting = h.app.start();
  const forced = h.app.onMessage({ CMD: P.CMD.REFRESH, ARG1: 1 });
  await Promise.all([starting, forced]);
  await h.app.idle();
  // babies + latest + timers, then latest + timers again.
  assert.equal(h.reads().length, 5);
});

test('a re-read after a write is skipped when the read budget is nearly spent', async () => {
  const h = harness();
  await h.app.start(); // 3 reads
  for (let i = 0; i < 4; i++) await h.app.onMessage({ CMD: P.CMD.REFRESH, ARG1: 1 }); // 8 more
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.idle();
  const shown = h.state();
  h.reset();
  await h.runScheduled();
  assert.equal(h.reads().length, 0, 'no re-read with fewer than 4 reads left');
  assert.equal(shown.LAST[P.ACTION.DIAPER], Math.floor(NOW / 1000), 'the optimistic entry is what the watch was last shown');
});

test('a re-read after a write does not read the other babies\' timers', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.idle();
  h.reset();
  await h.runScheduled();
  assert.equal(h.reads().length, 2, 'latest + timers for the active baby only');
});

// ---------- Retry-After ----------

test('Retry-After as an HTTP date is understood', async () => {
  const when = new Date(Date.now() + 30 * 1000).toUTCString();
  const client = createClient({
    baseUrl: 'https://api.nappi.app',
    token: 't',
    transport: () => Promise.resolve({
      status: 429,
      headers: { 'Retry-After': when },
      body: JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } })
    })
  });
  await assert.rejects(client.listBabies(), (err) => {
    assert.ok(err.retryAfter >= 28 && err.retryAfter <= 31, 'about 30 s, got ' + err.retryAfter);
    return true;
  });
});

test('Retry-After in seconds still works, and a garbage value is ignored', async () => {
  const make = (value) => createClient({
    baseUrl: 'https://api.nappi.app',
    token: 't',
    transport: () => Promise.resolve({
      status: 429,
      headers: { 'Retry-After': value },
      body: JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } })
    })
  });
  await assert.rejects(make('17').listBabies(), (err) => err.retryAfter === 17);
  await assert.rejects(make('soon').listBabies(), (err) => err.retryAfter === null);
});
