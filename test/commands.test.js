const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jobsFor, BadCommand } = require('../src/pkjs/commands');
const P = require('../src/pkjs/protocol');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const ctx = { babyId: 'baby-1', bottleUnits: 'oz', pumpUnits: 'oz', now: NOW, offsetAt: () => -240 };

function one(dict, over) {
  const jobs = jobsFor(dict, Object.assign({}, ctx, over));
  assert.equal(jobs.length, 1);
  return jobs[0];
}

test('a diaper with no backdating omits time so the server uses "now"', () => {
  const job = one({ CMD: P.CMD.LOG_DIAPER, ARG1: P.DIAPER.POO, ARG2: 0 });
  assert.deepEqual(job, { kind: 'entry', babyId: 'baby-1', body: { type: 'diaper', diaper_type: 'poo' } });
});

test('a backdated diaper sends time as ISO with the phone offset', () => {
  const job = one({ CMD: P.CMD.LOG_DIAPER, ARG1: P.DIAPER.WET, ARG2: 15 });
  assert.equal(job.body.time, '2026-10-24T14:45:00-04:00');
});

test('every diaper enum maps to the API string', () => {
  P.DIAPER_TYPES.forEach((name, i) => {
    assert.equal(one({ CMD: P.CMD.LOG_DIAPER, ARG1: i, ARG2: 0 }).body.diaper_type, name);
  });
});

test('a bottle sends amount in the user units, with the unit named', () => {
  const job = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 40, ARG2: P.BOTTLE_TYPE.BREAST_MILK, ARG3: 0 });
  assert.deepEqual(job.body, { type: 'bottle', amount: 4, unit: 'oz', bottle_type: 'breast_milk' });
});

test('bottle amounts follow the ml setting and keep one decimal', () => {
  const job = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 1250, ARG2: P.BOTTLE_TYPE.FORMULA, ARG3: 0 }, { bottleUnits: 'ml' });
  assert.deepEqual(job.body, { type: 'bottle', amount: 125, unit: 'ml', bottle_type: 'formula' });
  assert.equal(one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 25, ARG2: 0, ARG3: 0 }).body.amount, 2.5);
});

test('a bottle is logged in the unit the watch sent, not the saved setting', () => {
  const oz = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 40, ARG2: 0, ARG3: 0, ARG4: P.UNITS.OZ }, { bottleUnits: 'ml' });
  assert.equal(oz.body.amount, 4);
  assert.equal(oz.body.unit, 'oz');
  const ml = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 1200, ARG2: 0, ARG3: 0, ARG4: P.UNITS.ML }, { bottleUnits: 'oz' });
  assert.equal(ml.body.amount, 120);
  assert.equal(ml.body.unit, 'ml');
});

test('a bottle with no or an invalid unit falls back to the bottle setting', () => {
  const absent = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 1200, ARG2: 0, ARG3: 0 }, { bottleUnits: 'ml' });
  assert.equal(absent.body.amount, 120);
  assert.equal(absent.body.unit, 'ml');
  const invalid = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 40, ARG2: 0, ARG3: 0, ARG4: 5 }, { bottleUnits: 'oz' });
  assert.equal(invalid.body.amount, 4);
  assert.equal(invalid.body.unit, 'oz');
});

test('a pump stop is logged in the unit the watch sent, not the saved setting', () => {
  const oz = one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 40, ARG4: P.UNITS.OZ }, { pumpUnits: 'ml' });
  assert.deepEqual(oz.body, { amount: 4, unit: 'oz' });
  const ml = one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 1200, ARG4: P.UNITS.ML }, { pumpUnits: 'oz' });
  assert.deepEqual(ml.body, { amount: 120, unit: 'ml' });
});

test('a pump stop with no or an invalid unit falls back to the pump setting', () => {
  const absent = one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 1200 }, { pumpUnits: 'ml' });
  assert.deepEqual(absent.body, { amount: 120, unit: 'ml' });
  const invalid = one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 40, ARG4: 5 }, { pumpUnits: 'oz' });
  assert.deepEqual(invalid.body, { amount: 4, unit: 'oz' });
});

test('a skipped pump amount sends no body whatever the unit', () => {
  assert.equal(one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 0, ARG4: P.UNITS.ML }).body, undefined);
});

test('a bottle uses the bottle units and a pump stop uses the pump units', () => {
  const bottle = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 40, ARG2: 0, ARG3: 0 }, { bottleUnits: 'oz', pumpUnits: 'ml' });
  assert.equal(bottle.body.amount, 4);
  assert.equal(bottle.body.unit, 'oz');
  const pump = one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 1200 }, { bottleUnits: 'oz', pumpUnits: 'ml' });
  assert.equal(pump.body.amount, 120);
  assert.equal(pump.body.unit, 'ml');
});

test('a backdated bottle carries time as well', () => {
  const job = one({ CMD: P.CMD.LOG_BOTTLE, ARG1: 40, ARG2: 0, ARG3: 30 });
  assert.equal(job.body.time, '2026-10-24T14:30:00-04:00');
});

test('potty maps its enum', () => {
  assert.equal(one({ CMD: P.CMD.LOG_POTTY, ARG1: P.POTTY.ACCIDENT, ARG2: 0 }).body.outcome, 'accident');
});

test('command 5 (the retired activity log) is unknown', () => {
  assert.throws(() => jobsFor({ CMD: 5, CMD_ID: 1, ARG1: 0 }, ctx), (err) => err instanceof BadCommand && err.message === 'unknown command: 5');
});

test('starting a sleep timer has no body; backdating sets start_time', () => {
  const plain = one({ CMD: P.CMD.TIMER_START, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 0 });
  assert.deepEqual(plain, { kind: 'timer_start', babyId: 'baby-1', timerType: 'sleep', body: undefined });
  const back = one({ CMD: P.CMD.TIMER_START, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 45 });
  assert.equal(back.body.start_time, '2026-10-24T14:15:00-04:00');
});

test('starting nursing sends the side, including both', () => {
  assert.deepEqual(one({ CMD: P.CMD.TIMER_START, ARG1: P.TIMER.NURSING, ARG2: P.SIDE.LEFT, ARG3: 0 }).body, { side: 'left' });
  assert.deepEqual(one({ CMD: P.CMD.TIMER_START, ARG1: P.TIMER.NURSING, ARG2: P.SIDE.BOTH, ARG3: 0 }).body, { side: 'both' });
});

test('a side is ignored on timers that have none', () => {
  assert.equal(one({ CMD: P.CMD.TIMER_START, ARG1: P.TIMER.PUMPING, ARG2: P.SIDE.LEFT, ARG3: 0 }).body, undefined);
});

test('stopping sends no body unless there is something to say', () => {
  const plain = one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.SLEEP, ARG2: 0, ARG3: 0 });
  assert.deepEqual(plain, { kind: 'timer_stop', babyId: 'baby-1', timerType: 'sleep', body: undefined });
});

test('stopping nursing can override the side; stopping pumping carries amount and unit', () => {
  assert.deepEqual(one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.NURSING, ARG2: P.SIDE.RIGHT, ARG3: 0 }).body, { side: 'right' });
  assert.deepEqual(one({ CMD: P.CMD.TIMER_STOP, ARG1: P.TIMER.PUMPING, ARG2: 0, ARG3: 45 }).body, { amount: 4.5, unit: 'oz' });
});

test('switching nursing sides is a stop followed by a start on the other side', () => {
  const jobs = jobsFor({ CMD: P.CMD.TIMER_SWITCH, ARG1: P.SIDE.RIGHT }, ctx);
  assert.deepEqual(jobs, [
    { kind: 'timer_stop', babyId: 'baby-1', timerType: 'nursing', body: undefined },
    { kind: 'timer_start', babyId: 'baby-1', timerType: 'nursing', body: { side: 'right' } },
  ]);
});

test('commands that are not writes produce no jobs', () => {
  assert.deepEqual(jobsFor({ CMD: P.CMD.REFRESH }, ctx), []);
  assert.deepEqual(jobsFor({ CMD: P.CMD.SWITCH_BABY, ARG1: 1 }, ctx), []);
});

test('bad arguments are rejected rather than sent to the API', () => {
  const bad = [
    { CMD: P.CMD.LOG_DIAPER, ARG1: 9, ARG2: 0 },
    { CMD: P.CMD.LOG_DIAPER, ARG1: 0, ARG2: -5 },
    { CMD: P.CMD.LOG_DIAPER, ARG1: 0, ARG2: 3000 },
    { CMD: P.CMD.LOG_BOTTLE, ARG1: 20000, ARG2: 0, ARG3: 0 },
    { CMD: P.CMD.LOG_POTTY, ARG1: 7, ARG2: 0 },
    { CMD: P.CMD.TIMER_START, ARG1: 5, ARG2: 0, ARG3: 0 },
    { CMD: P.CMD.TIMER_STOP, ARG1: 5, ARG2: 0, ARG3: 0 },
    { CMD: P.CMD.TIMER_SWITCH, ARG1: P.SIDE.NONE },
    { CMD: 77 },
    {},
  ];
  bad.forEach((dict) => assert.throws(() => jobsFor(dict, ctx), BadCommand, JSON.stringify(dict)));
});

test('backdating is capped at the API limit of 48 hours', () => {
  assert.ok(one({ CMD: P.CMD.LOG_DIAPER, ARG1: 0, ARG2: 2880 }).body.time);
  assert.throws(() => jobsFor({ CMD: P.CMD.LOG_DIAPER, ARG1: 0, ARG2: 2881 }, ctx), BadCommand);
});
