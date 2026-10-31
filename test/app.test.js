// The phone-side engine, end to end against the mock API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, NOW, PHOEBE, OSCAR, memoryStorage } = require('./support/harness');
const P = require('../src/pkjs/protocol');

const MIN = 60 * 1000;
const BABY_PATH = (b) => `/v1/babies/${b.id}`;

// ---------- startup ----------

test('with no token the watch is told so and no request is made', async () => {
  const h = harness({ token: '' });
  await h.app.start();
  assert.equal(h.state().STATUS, P.STATUS.NO_TOKEN);
  assert.equal(h.net.requests.length, 0);
  assert.equal('BABY_NAME' in h.state(), false);
});

test('start sends JS_READY before any state', async () => {
  const h = harness();
  await h.app.start();
  assert.deepEqual(h.toWatch[0], { JS_READY: 1 });
  assert.ok(h.toWatch.slice(1).some((d) => 'STATUS' in d));
});

test('start without a token still sends JS_READY first', async () => {
  const h = harness({ token: '' });
  await h.app.start();
  assert.deepEqual(h.toWatch[0], { JS_READY: 1 });
  assert.equal(h.toWatch[1].STATUS, P.STATUS.NO_TOKEN);
});

test('a first start reads babies, latest and timers, and sends the full state', async () => {
  const h = harness();
  await h.app.start();
  assert.equal(h.reads().length, 3);
  const s = h.state();
  assert.equal(s.STATUS, P.STATUS.OK);
  assert.equal(s.BABY_NAME, 'Phoebe');
  assert.equal(s.BABY_COUNT, 1);
  assert.equal(s.LAST.length, 7);
  assert.equal(h.settings.get().babyId, PHOEBE.id);
});

test('the latest request asks only for the types the tiles need', async () => {
  const h = harness();
  await h.app.start();
  const latest = h.reads().find((r) => r.url.includes('/entries/latest'));
  const types = new URL(latest.url).searchParams.get('types').split(',').sort();
  assert.deepEqual(types, ['bottle', 'diaper', 'nursing', 'potty', 'pumping', 'sleep']);
});

test('a second start uses the cached babies, so launch costs two reads', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  h.clock.t += 2 * MIN;
  await h.app.start();
  assert.equal(h.reads().length, 2);
});

test('existing entries and running timers show up in the state', async () => {
  const h = harness();
  h.api(`${BABY_PATH(PHOEBE)}/entries`, { type: 'diaper', diaper_type: 'poo', time: '2026-10-24T17:00:00Z' });
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/start`, {});
  h.clock.t += 10 * MIN;
  await h.app.start();
  const s = h.state();
  assert.equal(s.LAST[P.ACTION.DIAPER], Math.floor(Date.parse('2026-10-24T17:00:00Z') / 1000));
  assert.equal(s.INFO[P.ACTION.DIAPER], P.DIAPER.POO + 1);
  assert.equal(s.TIMER_STATE[P.TIMER.SLEEP], P.TIMER_STATE.RUNNING);
  assert.equal(s.TIMER_ELAPSED[P.TIMER.SLEEP], 600);
});

test('cached state is shown immediately on the next start, before the network answers', async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  first.api(`${BABY_PATH(PHOEBE)}/entries`, { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T17:00:00Z' });
  await first.app.start();

  const second = harness({ storage });
  second.net.offline = true;
  await second.app.start();
  const states = second.toWatch.filter((d) => 'STATUS' in d);
  assert.equal(states[0].BABY_NAME, 'Phoebe', 'first message is already the cached state');
  assert.ok(states[0].LAST[P.ACTION.DIAPER] > 0);
});

// ---------- errors ----------

[
  ['an unknown token', 'wrong', P.STATUS.UNAUTHORIZED],
  ['an expired token', 'expired-token', P.STATUS.TOKEN_EXPIRED],
  ['a non-Premium account', 'free-token', P.STATUS.PREMIUM_REQUIRED],
].forEach(([name, token, expected]) => {
  test(name + ' is reported as the matching status', async () => {
    const h = harness({ token });
    await h.app.start();
    assert.equal(h.state().STATUS, expected);
  });
});

test('offline with a cache: the cached state is kept and the status says NETWORK', async () => {
  const h = harness();
  await h.app.start();
  h.net.offline = true;
  h.clock.t += 2 * MIN;
  h.reset();
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  const s = h.state();
  assert.equal(s.STATUS, P.STATUS.NETWORK);
  assert.equal(s.BABY_NAME, 'Phoebe');
});

test('a 429 is reported with the wait, and reads stop until it has passed', async () => {
  const h = harness();
  for (let i = 0; i < 12; i++) h.api('/v1/babies');
  await h.app.start();
  const limited = h.state();
  assert.equal(limited.STATUS, P.STATUS.RATE_LIMITED);
  assert.ok(limited.RETRY_AFTER > 0);

  h.reset();
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.reads().length, 0, 'no requests while blocked');
  assert.equal(h.state().STATUS, P.STATUS.RATE_LIMITED);

  h.clock.t += (limited.RETRY_AFTER + 1) * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.ok(h.reads().length > 0, 'reads resume after Retry-After');
});

// ---------- refresh policy ----------

test('REFRESH inside a minute is served from cache with no requests', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  h.clock.t += 30 * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.net.requests.length, 0);
  assert.equal(h.state().BABY_NAME, 'Phoebe');
});

test('REFRESH after a minute re-reads with If-None-Match and takes the 304', async () => {
  const h = harness();
  h.api(`${BABY_PATH(PHOEBE)}/entries`, { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T17:00:00Z' });
  await h.app.start();
  h.reset();
  h.clock.t += 61 * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  const latest = h.reads().find((r) => r.url.includes('/entries/latest'));
  assert.ok(latest.headers['If-None-Match']);
  assert.equal(h.state().INFO[P.ACTION.DIAPER], P.DIAPER.WET + 1, 'cached data survives a 304');
});

test('a change made elsewhere is picked up on the next refresh', async () => {
  const h = harness();
  await h.app.start();
  assert.equal(h.state().LAST[P.ACTION.BOTTLE], 0);
  h.api(`${BABY_PATH(PHOEBE)}/entries`, { type: 'bottle', amount: 4, unit: 'oz', bottle_type: 'formula', time: '2026-10-24T18:30:00Z' });
  h.clock.t += 61 * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.ok(h.state().LAST[P.ACTION.BOTTLE] > 0);
  assert.equal(h.state().INFO[P.ACTION.BOTTLE], 40);
});

test('timers started or paused on another device are reconciled on refresh', async () => {
  const h = harness();
  await h.app.start();
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/start`, {});
  h.mock.pauseTimer(PHOEBE.id, 'sleep');
  h.clock.t += 61 * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.state().TIMER_STATE[P.TIMER.SLEEP], P.TIMER_STATE.PAUSED);
});

// ---------- writes ----------

const DIAPER_CMD = (id, type, ago) => ({ CMD: P.CMD.LOG_DIAPER, CMD_ID: id, ARG1: type, ARG2: ago || 0 });

test('logging a diaper acknowledges at once, shows it optimistically, then confirms with the server', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  await h.app.onMessage(DIAPER_CMD(7, P.DIAPER.WET));

  assert.deepEqual(h.acks(), [{ ACK_ID: 7, ACK_STATUS: P.STATUS.OK }]);
  const optimistic = h.toWatch.filter((d) => 'STATUS' in d)[0];
  assert.equal(optimistic.PENDING, 1);
  assert.equal(optimistic.LAST[P.ACTION.DIAPER], Math.floor(NOW / 1000));

  await h.app.idle();
  assert.equal(h.writes().length, 1);
  assert.equal(h.state().PENDING, 0);
  const server = JSON.parse(h.api(`${BABY_PATH(PHOEBE)}/entries/latest?types=diaper`).body);
  assert.equal(server.diaper.diaper_type, 'wet');
});

test('the write carries an Idempotency-Key and the active baby', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.POO));
  await h.app.idle();
  const w = h.writes()[0];
  assert.equal(w.headers['Idempotency-Key'], 'uuid-1');
  assert.ok(w.url.includes(PHOEBE.id));
});

test('a backdated log sends the time with the phone offset', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET, 15));
  await h.app.idle();
  assert.equal(JSON.parse(h.writes()[0].body).time, '2026-10-24T14:45:00-04:00');
});

test('after a write there is one debounced re-read; more writes push it back', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.onMessage(DIAPER_CMD(2, P.DIAPER.POO));
  await h.app.idle();
  const pending = h.tasks.filter((t) => !t.cancelled);
  assert.equal(pending.length, 1, 'earlier re-read was cancelled');
  assert.ok(pending[0].ms >= 3000);
  assert.equal(h.reads().length, 0, 'no reads yet');
  await h.runScheduled();
  assert.equal(h.reads().length, 2, 'latest + timers once');
});

test('offline writes are acknowledged, kept, and delivered once the phone is back online', async () => {
  const h = harness();
  await h.app.start();
  h.net.offline = true;
  await h.app.onMessage(DIAPER_CMD(3, P.DIAPER.MIXED));
  await h.app.idle();
  assert.deepEqual(h.acks()[0], { ACK_ID: 3, ACK_STATUS: P.STATUS.OK });
  assert.equal(h.state().PENDING, 1);
  assert.equal(h.state().STATUS, P.STATUS.NETWORK);

  h.net.offline = false;
  h.clock.t += 2 * MIN;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  await h.app.idle();
  assert.equal(h.state().PENDING, 0);
  assert.equal(h.state().STATUS, P.STATUS.OK);
  const server = JSON.parse(h.api(`${BABY_PATH(PHOEBE)}/entries/latest?types=diaper`).body);
  assert.equal(server.diaper.diaper_type, 'mixed');
});

test('an entry logged offline keeps the time of the tap, not the time it was finally delivered', async () => {
  const h = harness();
  await h.app.start();
  h.net.offline = true;
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.idle();
  h.net.offline = false;
  h.clock.t += 5 * MIN;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  await h.app.idle();
  const delivered = JSON.parse(h.writes().filter((r) => r.body && r.body.includes('wet')).pop().body);
  assert.equal(delivered.time, '2026-10-24T15:00:00-04:00');
  const server = JSON.parse(h.api(`${BABY_PATH(PHOEBE)}/entries/latest?types=diaper`).body);
  assert.equal(server.diaper.time, '2026-10-24T19:00:00Z');
});

test('offline writes survive an app restart', async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  await first.app.start();
  first.net.offline = true;
  await first.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await first.app.idle();

  const second = harness({ storage });
  await second.app.start();
  await second.app.idle();
  assert.equal(second.writes().length, 1);
  assert.equal(second.state().PENDING, 0);
});

test('a bad command is rejected with an error ack and nothing is queued', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  await h.app.onMessage({ CMD: P.CMD.LOG_DIAPER, CMD_ID: 9, ARG1: 42, ARG2: 0 });
  await h.app.idle();
  assert.deepEqual(h.acks(), [{ ACK_ID: 9, ACK_STATUS: P.STATUS.ERROR }]);
  assert.equal(h.writes().length, 0);
});

test('writing with no token acks NO_TOKEN', async () => {
  const h = harness({ token: '' });
  await h.app.start();
  await h.app.onMessage(DIAPER_CMD(4, P.DIAPER.WET));
  assert.deepEqual(h.acks(), [{ ACK_ID: 4, ACK_STATUS: P.STATUS.NO_TOKEN }]);
});

test('commands are never sent to the watch concurrently', async () => {
  const h = harness();
  await h.app.start();
  await Promise.all([
    h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET)),
    h.app.onMessage(DIAPER_CMD(2, P.DIAPER.POO)),
    h.app.onMessage(DIAPER_CMD(3, P.DIAPER.DRY)),
  ]);
  await h.app.idle();
  assert.equal(h.flight.max, 1);
  assert.deepEqual(h.acks().map((a) => a.ACK_ID), [1, 2, 3]);
});

test('every message to the watch uses only declared keys', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.idle();
  const declared = P.MESSAGE_KEYS.map((d) => d.replace(/\[\d+\]$/, ''));
  h.toWatch.forEach((msg) => Object.keys(msg).forEach((k) => assert.ok(declared.includes(k), k)));
});

// ---------- timers ----------

test('start then stop a sleep timer end to end', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.TIMER_START, CMD_ID: 1, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 0 });
  await h.app.idle();
  assert.equal(h.state().TIMER_STATE[P.TIMER.SLEEP], P.TIMER_STATE.RUNNING);

  h.clock.t += 72 * MIN;
  await h.app.onMessage({ CMD: P.CMD.TIMER_STOP, CMD_ID: 2, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 0 });
  await h.app.idle();
  assert.equal(h.state().TIMER_STATE[P.TIMER.SLEEP], P.TIMER_STATE.NONE);
  assert.equal(h.state().INFO[P.ACTION.SLEEP], 72);
  const server = JSON.parse(h.api(`${BABY_PATH(PHOEBE)}/entries/latest?types=sleep`).body);
  assert.equal(server.sleep.duration_minutes, 72);
});

test('starting a timer that is already running elsewhere is fine', async () => {
  const h = harness();
  await h.app.start();
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/start`, {});
  await h.app.onMessage({ CMD: P.CMD.TIMER_START, CMD_ID: 1, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 0 });
  await h.app.idle();
  assert.equal(h.state().PENDING, 0);
  assert.equal(h.state().STATUS, P.STATUS.OK);
});

test('stopping a timer someone else already stopped is treated as done', async () => {
  const h = harness();
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/start`, {});
  await h.app.start();
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/stop`, {});
  await h.app.onMessage({ CMD: P.CMD.TIMER_STOP, CMD_ID: 1, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 0 });
  await h.app.idle();
  assert.equal(h.state().PENDING, 0);
  assert.equal(h.state().STATUS, P.STATUS.OK);
});

test('nursing: start on the left, switch to the right logs the left feed and runs the right', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.TIMER_START, CMD_ID: 1, ARG1: P.TIMER.NURSING, ARG2: P.SIDE.LEFT, ARG3: 0 });
  await h.app.idle();
  h.clock.t += 8 * MIN;
  await h.app.onMessage({ CMD: P.CMD.TIMER_SWITCH, CMD_ID: 2, ARG1: P.SIDE.RIGHT });
  await h.app.idle();
  const s = h.state();
  assert.equal(s.TIMER_STATE[P.TIMER.NURSING], P.TIMER_STATE.RUNNING);
  assert.equal(s.TIMER_SIDE[P.TIMER.NURSING], P.SIDE.RIGHT);
  const server = JSON.parse(h.api(`${BABY_PATH(PHOEBE)}/entries/latest?types=nursing`).body);
  assert.equal(server.nursing.side, 'left');
  assert.equal(server.nursing.duration_minutes, 8);
});

test('pumping stop carries the amount in the chosen unit', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.TIMER_START, CMD_ID: 1, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 0 });
  await h.app.idle();
  h.clock.t += 15 * MIN;
  await h.app.onMessage({ CMD: P.CMD.TIMER_STOP, CMD_ID: 2, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 40 });
  await h.app.idle();
  assert.equal(JSON.parse(h.writes()[1].body).unit, 'oz');
  assert.equal(h.state().INFO[P.ACTION.PUMP], 40, '4 oz is 118.3 ml, shown back as 4.0 oz x10');
});

test('a backdated timer start sets start_time', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.TIMER_START, CMD_ID: 1, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 30 });
  assert.equal(h.state().TIMER_ELAPSED[P.TIMER.SLEEP], 1800, 'optimistic elapsed honours the backdate');
  await h.app.idle();
  assert.equal(JSON.parse(h.writes()[0].body).start_time, '2026-10-24T14:30:00-04:00');
});

// ---------- multiple babies ----------

test('two babies: names are sent and the saved one is active', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR], stored: { babyId: OSCAR.id } });
  await h.app.start();
  const s = h.state();
  assert.equal(s.BABY_NAME, 'Oscar');
  assert.equal(s.BABY_NAMES, 'Phoebe\nOscar');
  assert.equal(s.BABY_COUNT, 2);
  assert.equal(s.BABY_INDEX, 1);
});

test('two babies cost three reads per refresh: latest, timers, and the other baby\'s timers', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  h.reset();
  h.clock.t += 2 * MIN;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.reads().length, 3);
});

test('a running timer on the other baby lights the dot', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  h.api(`${BABY_PATH(OSCAR)}/timers/sleep/start`, {});
  await h.app.start();
  assert.equal(h.state().OTHER_TIMERS, 1);
  assert.equal(h.state().TIMER_STATE[P.TIMER.SLEEP], P.TIMER_STATE.NONE);
});

test('switching baby remembers the choice, shows their data, and logs go to them', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  h.api(`${BABY_PATH(OSCAR)}/entries`, { type: 'diaper', diaper_type: 'dry', time: '2026-10-24T17:30:00Z' });
  await h.app.start();
  assert.equal(h.state().LAST[P.ACTION.DIAPER], 0);

  await h.app.onMessage({ CMD: P.CMD.SWITCH_BABY, ARG1: 1 });
  await h.app.idle();
  assert.equal(h.settings.get().babyId, OSCAR.id);
  assert.equal(h.state().BABY_NAME, 'Oscar');
  assert.equal(h.state().INFO[P.ACTION.DIAPER], P.DIAPER.DRY + 1);

  h.reset();
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.WET));
  await h.app.idle();
  assert.ok(h.writes()[0].url.includes(OSCAR.id));
});

test('switching to a baby we already have fresh data for does not re-read', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.SWITCH_BABY, ARG1: 1 });
  await h.app.idle();
  h.reset();
  await h.app.onMessage({ CMD: P.CMD.SWITCH_BABY, ARG1: 0 });
  await h.app.idle();
  assert.equal(h.reads().length, 0);
  assert.equal(h.state().BABY_NAME, 'Phoebe');
});

test('an out-of-range baby index is ignored', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.SWITCH_BABY, ARG1: 5 });
  assert.equal(h.state().BABY_NAME, 'Phoebe');
});

test('a write queued for one baby still goes to that baby after switching', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  h.net.offline = true;
  await h.app.onMessage(DIAPER_CMD(1, P.DIAPER.POO));
  await h.app.idle();
  await h.app.onMessage({ CMD: P.CMD.SWITCH_BABY, ARG1: 1 });
  h.net.offline = false;
  h.clock.t += 2 * MIN;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  await h.app.idle();
  const w = h.writes().find((r) => r.body && r.body.includes('poo'));
  assert.ok(w.url.includes(PHOEBE.id));
});

// ---------- settings ----------

test('closing the settings page saves them, refreshes, and applies layout and units', async () => {
  const h = harness();
  await h.app.handleConfigClosed({
    token: { value: 'good-token' }, bottleUnits: { value: 'ml' },
    pos_sleep: { value: '1' }, pos_diaper: { value: '2' },
  });
  await h.app.idle();
  assert.equal(h.settings.get().bottleUnits, 'ml');
  const s = h.state();
  assert.equal(s.BOTTLE_UNITS, P.UNITS.ML);
  assert.deepEqual(s.LAYOUT, [P.ACTION.SLEEP, P.ACTION.DIAPER, P.ACTION.STATUS]);
});

test('closing the settings page with a rejected address keeps the old one and logs it', async () => {
  const h = harness({ stored: { baseUrl: 'http://localhost:4010' } });
  await h.app.handleConfigClosed({
    token: { value: 'good-token' }, bottleUnits: { value: 'ml' },
    baseUrl: { value: 'http://evil.example' },
  });
  await h.app.idle();
  assert.equal(h.settings.get().baseUrl, 'http://localhost:4010');
  assert.equal(h.settings.get().bottleUnits, 'ml', 'the other settings are still saved');
  assert.ok(h.logs.includes('API address ignored: must start with https://'));
  assert.ok(h.net.requests.every((r) => !r.url.includes('evil')));
});

test('the token is never sent to the watch', async () => {
  const h = harness();
  await h.app.handleConfigClosed({ token: { value: 'good-token' } });
  await h.app.idle();
  assert.ok(!JSON.stringify(h.toWatch).includes('good-token'));
});

test('changing the token forgets the old household\'s cache', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  assert.equal(h.state().BABY_COUNT, 2);
  await h.app.handleConfigClosed({ token: { value: 'free-token' } });
  await h.app.idle();
  assert.equal(h.state().STATUS, P.STATUS.PREMIUM_REQUIRED);
  assert.equal('BABY_NAME' in h.state(), false, 'no stale baby from the previous token');
});

test('re-saving the same token keeps the cache and does not re-read the babies', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  await h.app.start();
  h.reset();
  await h.app.handleConfigClosed({ token: { value: ' good-token ' } });
  await h.app.idle();
  assert.equal(h.reads().some((r) => r.url.endsWith('/v1/babies')), false);
  assert.equal(h.state().BABY_COUNT, 2);
});

test('a cached state resent later has its running timers rolled forward', async () => {
  const h = harness();
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/start`, {});
  await h.app.start();
  assert.equal(h.state().TIMER_ELAPSED[P.TIMER.SLEEP], 0);
  h.clock.t += 30 * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.state().TIMER_ELAPSED[P.TIMER.SLEEP], 30);
  assert.equal(h.state().TIMER_AT, Math.floor(h.clock.t / 1000));
});

test('paused timers are not rolled forward', async () => {
  const h = harness();
  h.api(`${BABY_PATH(PHOEBE)}/timers/sleep/start`, {});
  h.clock.t += 5 * MIN;
  h.mock.pauseTimer(PHOEBE.id, 'sleep');
  await h.app.start();
  h.clock.t += 30 * 1000;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  assert.equal(h.state().TIMER_ELAPSED[P.TIMER.SLEEP], 300);
});

test('prepareConfig without a token makes no request and offers no baby picker', async () => {
  const h = harness({ token: '' });
  const config = await h.app.prepareConfig();
  assert.equal(h.net.requests.length, 0);
  assert.ok(!JSON.stringify(config).includes('"babyId"'));
});

test('prepareConfig with a good token offers the babies', async () => {
  const h = harness({ babies: [PHOEBE, OSCAR] });
  const config = await h.app.prepareConfig();
  const picker = JSON.stringify(config);
  assert.ok(picker.includes('Phoebe') && picker.includes('Oscar'));
});

test('prepareConfig with a rejected token explains it on the page', async () => {
  const h = harness({ token: 'wrong' });
  const config = await h.app.prepareConfig();
  assert.match(JSON.stringify(config), /not accepted/i);
});

// ---------- SET_UNITS ----------

test('SET_UNITS saves the unit for one screen, acks, then sends the new state', async () => {
  const h = harness();
  await h.app.start();
  h.reset();
  await h.app.onMessage({ CMD: P.CMD.SET_UNITS, CMD_ID: 7, ARG1: P.UNITS_SCREEN.BOTTLE, ARG2: P.UNITS.ML });
  await h.app.idle();
  assert.equal(h.settings.get().bottleUnits, 'ml');
  assert.equal(h.settings.get().pumpUnits, 'oz');
  assert.deepEqual(h.acks()[0], { ACK_ID: 7, ACK_STATUS: P.STATUS.OK });
  const order = h.toWatch.map((d) => ('ACK_ID' in d ? 'ack' : 'state'));
  assert.deepEqual(order.slice(0, 2), ['ack', 'state']);
  assert.equal(h.state().BOTTLE_UNITS, P.UNITS.ML);
  assert.equal(h.state().PUMP_UNITS, P.UNITS.OZ);
});

test('SET_UNITS for the pump screen leaves the bottle unit alone', async () => {
  const h = harness();
  await h.app.start();
  await h.app.onMessage({ CMD: P.CMD.SET_UNITS, CMD_ID: 8, ARG1: P.UNITS_SCREEN.PUMP, ARG2: P.UNITS.ML });
  await h.app.idle();
  assert.equal(h.settings.get().pumpUnits, 'ml');
  assert.equal(h.settings.get().bottleUnits, 'oz');
  assert.equal(h.state().PUMP_UNITS, P.UNITS.ML);
});

[
  ['an unknown screen', { ARG1: 2, ARG2: 1 }],
  ['an unknown unit', { ARG1: 0, ARG2: 5 }],
  ['a missing screen', { ARG2: 1 }],
  ['a missing unit', { ARG1: 0 }],
].forEach(([name, args]) => {
  test('SET_UNITS with ' + name + ' acks ERROR and changes nothing', async () => {
    const h = harness();
    await h.app.start();
    const before = h.settings.get();
    h.reset();
    await h.app.onMessage(Object.assign({ CMD: P.CMD.SET_UNITS, CMD_ID: 9 }, args));
    await h.app.idle();
    assert.deepEqual(h.acks()[0], { ACK_ID: 9, ACK_STATUS: P.STATUS.ERROR });
    assert.deepEqual(h.settings.get(), before);
  });
});

test('a write keeps the unit it was logged in when units change before the queue flushes', async () => {
  const h = harness();
  await h.app.start();
  h.net.offline = true;
  await h.app.onMessage({ CMD: P.CMD.LOG_BOTTLE, CMD_ID: 1, ARG1: 40, ARG2: 0, ARG3: 0 });
  await h.app.idle();
  await h.app.onMessage({ CMD: P.CMD.SET_UNITS, CMD_ID: 2, ARG1: P.UNITS_SCREEN.BOTTLE, ARG2: P.UNITS.ML });
  await h.app.idle();
  assert.equal(h.settings.get().bottleUnits, 'ml');

  h.net.offline = false;
  h.net.requests.length = 0;
  h.clock.t += 2 * MIN;
  await h.app.onMessage({ CMD: P.CMD.REFRESH });
  await h.app.idle();
  assert.equal(h.state().PENDING, 0);
  const flushed = h.writes().filter((r) => r.body && r.body.includes('bottle'));
  assert.equal(flushed.length, 1);
  const sent = JSON.parse(flushed[0].body);
  assert.equal(sent.unit, 'oz');
  assert.equal(sent.amount, 4);
});
