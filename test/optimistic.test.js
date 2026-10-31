const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyJob } = require('../src/pkjs/optimistic');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const ctx = { now: NOW, units: 'oz' };
const empty = () => ({ latest: {}, timers: [] });
const BABY = 'b1';

test('a diaper job becomes the latest diaper at "now"', () => {
  const view = applyJob(empty(), { kind: 'entry', babyId: BABY, body: { type: 'diaper', diaper_type: 'poo' } }, ctx);
  assert.equal(view.latest.diaper.diaper_type, 'poo');
  assert.equal(view.latest.diaper.time, '2026-10-24T19:00:00Z');
});

test('a backdated entry uses its own time', () => {
  const view = applyJob(empty(), { kind: 'entry', babyId: BABY, body: { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T14:45:00-04:00' } }, ctx);
  assert.equal(view.latest.diaper.time, '2026-10-24T18:45:00Z');
});

test('an older backdated entry does not displace a newer latest one', () => {
  const start = { latest: { diaper: { id: 'x', time: '2026-10-24T18:50:00Z', diaper_type: 'dry' } }, timers: [] };
  const view = applyJob(start, { kind: 'entry', babyId: BABY, body: { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T14:45:00-04:00' } }, ctx);
  assert.equal(view.latest.diaper.diaper_type, 'dry');
});

test('a bottle converts to ml the way the API reports it', () => {
  const view = applyJob(empty(), { kind: 'entry', babyId: BABY, body: { type: 'bottle', amount: 4, unit: 'oz', bottle_type: 'formula' } }, ctx);
  assert.equal(view.latest.bottle.amount_ml, 118.3);
  assert.equal(view.latest.bottle.bottle_type, 'formula');
});

test('potty entries are reflected', () => {
  let view = applyJob(empty(), { kind: 'entry', babyId: BABY, body: { type: 'potty', outcome: 'sat_dry' } }, ctx);
  assert.equal(view.latest.potty.outcome, 'sat_dry');
});

test('starting a timer adds it, honouring a backdated start', () => {
  const view = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'sleep', body: { start_time: '2026-10-24T14:30:00-04:00' } }, ctx);
  assert.equal(view.timers.length, 1);
  assert.equal(view.timers[0].type, 'sleep');
  assert.equal(view.timers[0].started_at, '2026-10-24T18:30:00Z');
  assert.equal(view.timers[0].elapsed_seconds, 1800);
  assert.equal(view.timers[0].paused, false);
});

test('starting nursing records the side; both leaves it unset', () => {
  const left = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'nursing', body: { side: 'left' } }, ctx);
  assert.equal(left.timers[0].side, 'left');
  const both = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'nursing', body: { side: 'both' } }, ctx);
  assert.equal(both.timers[0].side, null);
});

test('starting a timer that is already shown running changes nothing', () => {
  const once = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'sleep', body: undefined }, ctx);
  const twice = applyJob(once, { kind: 'timer_start', babyId: BABY, timerType: 'sleep', body: undefined }, Object.assign({}, ctx, { now: NOW + 60000 }));
  assert.equal(twice.timers.length, 1);
  assert.equal(twice.timers[0].started_at, '2026-10-24T19:00:00Z');
});

test('stopping a sleep timer clears it and shows the finished sleep', () => {
  const running = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'sleep', body: undefined }, ctx);
  const stopped = applyJob(running, { kind: 'timer_stop', babyId: BABY, timerType: 'sleep', body: undefined }, Object.assign({}, ctx, { now: NOW + 72 * 60000 }));
  assert.deepEqual(stopped.timers, []);
  assert.equal(stopped.latest.sleep.duration_minutes, 72);
  assert.equal(stopped.latest.sleep.end_time, '2026-10-24T20:12:00Z');
});

test('stopping nursing records the timer side, or the override', () => {
  const running = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'nursing', body: { side: 'left' } }, ctx);
  const later = Object.assign({}, ctx, { now: NOW + 10 * 60000 });
  const plain = applyJob(running, { kind: 'timer_stop', babyId: BABY, timerType: 'nursing', body: undefined }, later);
  assert.equal(plain.latest.nursing.side, 'left');
  assert.equal(plain.latest.nursing.duration_minutes, 10);
  const over = applyJob(running, { kind: 'timer_stop', babyId: BABY, timerType: 'nursing', body: { side: 'right' } }, later);
  assert.equal(over.latest.nursing.side, 'right');
});

test('stopping pumping keeps the amount in ml', () => {
  const running = applyJob(empty(), { kind: 'timer_start', babyId: BABY, timerType: 'pumping', body: undefined }, ctx);
  const done = applyJob(running, { kind: 'timer_stop', babyId: BABY, timerType: 'pumping', body: { amount: 4, unit: 'oz' } }, Object.assign({}, ctx, { now: NOW + 15 * 60000 }));
  assert.equal(done.latest.pumping.total_amount_ml, 118.3);
});

test('stopping a timer that is not shown running leaves the view alone', () => {
  const view = applyJob(empty(), { kind: 'timer_stop', babyId: BABY, timerType: 'sleep', body: undefined }, ctx);
  assert.deepEqual(view, empty());
});

test('applyJob does not mutate the view it was given', () => {
  const start = empty();
  applyJob(start, { kind: 'entry', babyId: BABY, body: { type: 'diaper', diaper_type: 'wet' } }, ctx);
  applyJob(start, { kind: 'timer_start', babyId: BABY, timerType: 'sleep', body: undefined }, ctx);
  assert.deepEqual(start, empty());
});
