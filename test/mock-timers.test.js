// Contract tests for the mock's timer endpoints, pinned to nappi's API docs (https://nappi.app/app/api/reference).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');
const { createCaller } = require('./support/call');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const BABY = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe' };
const TIMERS = `/v1/babies/${BABY.id}/timers`;
const LATEST = `/v1/babies/${BABY.id}/entries/latest`;
const MIN = 60 * 1000;

function setup() {
  const clock = { t: NOW };
  const mock = createMockNappi({ now: () => clock.t });
  mock.addToken('t');
  mock.addBaby(BABY);
  return { mock, clock, api: createCaller(mock, 't') };
}

test('no timers running lists as an empty array', () => {
  const { api } = setup();
  const res = api.get(TIMERS);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, []);
});

test('a POST without a JSON Content-Type is 415, even with no body', () => {
  const { mock } = setup();
  ['start', 'stop'].forEach((action) => {
    const res = mock.handle({
      method: 'POST',
      url: `https://api.nappi.app${TIMERS}/sleep/${action}`,
      headers: { Authorization: 'Bearer t' },
    });
    assert.equal(res.status, 415);
    assert.equal(JSON.parse(res.body).error.message, 'Unsupported Media Type');
  });
});

test('starting a sleep timer returns 201 started and it shows in the list', () => {
  const { api } = setup();
  const res = api.post(TIMERS + '/sleep/start');
  assert.equal(res.status, 201);
  assert.equal(res.json.status, 'started');
  assert.deepEqual(
    { type: res.json.timer.type, paused: res.json.timer.paused, elapsed: res.json.timer.elapsed_seconds, at: res.json.timer.started_at },
    { type: 'sleep', paused: false, elapsed: 0, at: '2026-10-24T19:00:00Z' },
  );
  assert.equal(api.get(TIMERS).json.length, 1);
});

test('elapsed_seconds follows the clock while running', () => {
  const { api, clock } = setup();
  api.post(TIMERS + '/sleep/start');
  clock.t += 90 * 1000;
  assert.equal(api.get(TIMERS).json[0].elapsed_seconds, 90);
});

test('starting a running timer again is a 200 already_running and changes nothing', () => {
  const { api, clock } = setup();
  api.post(TIMERS + '/sleep/start');
  clock.t += 5 * MIN;
  const again = api.post(TIMERS + '/sleep/start');
  assert.equal(again.status, 200);
  assert.equal(again.json.status, 'already_running');
  assert.equal(again.json.timer.started_at, '2026-10-24T19:00:00Z');
  assert.equal(again.json.timer.elapsed_seconds, 300);
});

test('nursing starts on a side, and both is accepted', () => {
  const { api } = setup();
  const left = api.post(TIMERS + '/nursing/start', { side: 'left' });
  assert.equal(left.json.timer.side, 'left');
  const { api: api2 } = setup();
  assert.equal(api2.post(TIMERS + '/nursing/start', { side: 'both' }).status, 201);
  const { api: api3 } = setup();
  assert.equal(api3.post(TIMERS + '/nursing/start', { side: 'middle' }).status, 400);
});

test('start_time backdates the timer, up to 48 hours', () => {
  const { api } = setup();
  const res = api.post(TIMERS + '/sleep/start', { start_time: '2026-10-24T18:30:00Z' });
  assert.equal(res.status, 201);
  assert.equal(res.json.timer.elapsed_seconds, 1800);
  assert.equal(res.json.timer.started_at, '2026-10-24T18:30:00Z');

  const { api: far } = setup();
  assert.equal(far.post(TIMERS + '/sleep/start', { start_time: '2026-10-22T18:59:00Z' }).status, 400);
  assert.equal(far.post(TIMERS + '/sleep/start', { start_time: '2026-10-22T19:01:00Z' }).status, 201);
});

test('start_time in the future, or without an offset, is 400', () => {
  const { api } = setup();
  assert.equal(api.post(TIMERS + '/sleep/start', { start_time: '2026-10-24T20:00:00Z' }).status, 400);
  assert.equal(api.post(TIMERS + '/sleep/start', { start_time: '2026-10-24T18:00:00' }).status, 400);
});

test('an unknown timer type is 400 and an unknown baby is 404', () => {
  const { api } = setup();
  assert.equal(api.post(TIMERS + '/juggling/start').status, 400);
  assert.equal(api.get('/v1/babies/nope/timers').status, 404);
});

test('stopping a sleep timer saves a sleep entry and clears the timer', () => {
  const { api, clock } = setup();
  api.post(TIMERS + '/sleep/start');
  clock.t += 72 * MIN;
  const res = api.post(TIMERS + '/sleep/stop');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'stopped');
  assert.equal(res.json.entry.type, 'sleep');
  assert.equal(res.json.entry.duration_minutes, 72);
  assert.equal(res.json.entry.start_time, '2026-10-24T19:00:00Z');
  assert.equal(res.json.entry.end_time, '2026-10-24T20:12:00Z');
  assert.ok(['nap', 'night'].includes(res.json.entry.sleep_type));
  assert.deepEqual(api.get(TIMERS).json, []);
  assert.equal(api.get(LATEST).json.sleep.duration_minutes, 72);
});

test('stopping with nothing running is 409 timer_not_running', () => {
  const { api } = setup();
  const res = api.post(TIMERS + '/sleep/stop');
  assert.equal(res.status, 409);
  assert.equal(res.json.error.code, 'timer_not_running');
});

test('a second stop after a successful one is 409, which is how retries show up', () => {
  const { api } = setup();
  api.post(TIMERS + '/sleep/start');
  assert.equal(api.post(TIMERS + '/sleep/stop').status, 200);
  assert.equal(api.post(TIMERS + '/sleep/stop').status, 409);
});

test('stopping nursing records the timer side, or the override when given', () => {
  const { api, clock } = setup();
  api.post(TIMERS + '/nursing/start', { side: 'left' });
  clock.t += 10 * MIN;
  const stopped = api.post(TIMERS + '/nursing/stop');
  assert.equal(stopped.json.entry.side, 'left');
  assert.equal(stopped.json.entry.duration_minutes, 10);
  const n = api.get(LATEST).json.nursing;
  assert.equal(n.left_seconds, 600);
  assert.equal(n.side, 'left');

  api.post(TIMERS + '/nursing/start', { side: 'left' });
  clock.t += 6 * MIN;
  const over = api.post(TIMERS + '/nursing/stop', { side: 'right' });
  assert.equal(over.json.entry.side, 'right');
  assert.equal(api.get(LATEST).json.nursing.right_seconds, 360);
});

test('stopping pumping saves the amount, converting oz to ml', () => {
  const { api, clock } = setup();
  api.post(TIMERS + '/pumping/start');
  clock.t += 15 * MIN;
  const res = api.post(TIMERS + '/pumping/stop', { amount: 4, unit: 'oz' });
  assert.equal(res.status, 200);
  assert.equal(res.json.entry.type, 'pumping');
  const p = api.get(LATEST).json.pumping;
  assert.equal(p.total_amount_ml, 118.3);
  assert.equal(p.duration_minutes, 15);
});

test('end_time must not precede the start', () => {
  const { api } = setup();
  api.post(TIMERS + '/sleep/start');
  assert.equal(api.post(TIMERS + '/sleep/stop', { end_time: '2026-10-24T18:00:00Z' }).status, 400);
  assert.equal(api.get(TIMERS).json.length, 1, 'timer still running after a rejected stop');
});

test('timers of different types run side by side', () => {
  const { api } = setup();
  api.post(TIMERS + '/sleep/start');
  api.post(TIMERS + '/nursing/start', { side: 'right' });
  assert.deepEqual(api.get(TIMERS).json.map((t) => t.type).sort(), ['nursing', 'sleep']);
});

test('a paused timer (started elsewhere) stops accruing elapsed time', () => {
  const { mock, api, clock } = setup();
  api.post(TIMERS + '/sleep/start');
  clock.t += 10 * MIN;
  mock.pauseTimer(BABY.id, 'sleep');
  clock.t += 30 * MIN;
  const t = api.get(TIMERS).json[0];
  assert.equal(t.paused, true);
  assert.equal(t.elapsed_seconds, 600);
});

test('timer reads count against the read budget, starts and stops against writes', () => {
  const { api } = setup();
  for (let i = 0; i < 12; i++) assert.equal(api.get(TIMERS).status, 200);
  assert.equal(api.get(TIMERS).status, 429);
  assert.equal(api.post(TIMERS + '/sleep/start').status, 201);
});
