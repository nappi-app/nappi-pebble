const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildState, layoutIds } = require('../src/pkjs/state');
const { DEFAULTS } = require('../src/pkjs/settings');
const P = require('../src/pkjs/protocol');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const PHOEBE = { id: 'a', name: 'Phoebe', birth_date: null, timezone: null };
const OSCAR = { id: 'b', name: 'Oscar', birth_date: null, timezone: null };

function view(over) {
  return Object.assign({
    status: P.STATUS.OK,
    retryAfter: null,
    babies: [PHOEBE],
    activeIndex: 0,
    latest: {},
    timers: [],
    othersRunning: false,
    settings: DEFAULTS,
    pending: 0,
    now: NOW,
  }, over);
}

test('baby fields: single baby has count 1 and an accent', () => {
  const s = buildState(view());
  assert.equal(s.BABY_NAME, 'Phoebe');
  assert.equal(s.BABY_COUNT, 1);
  assert.equal(s.BABY_INDEX, 0);
  assert.equal(s.BABY_NAMES, 'Phoebe');
  assert.equal(s.OTHER_TIMERS, 0);
});

test('with two babies the names are newline-joined and the active index and accent follow', () => {
  const s = buildState(view({ babies: [PHOEBE, OSCAR], activeIndex: 1, othersRunning: true }));
  assert.equal(s.BABY_NAMES, 'Phoebe\nOscar');
  assert.equal(s.BABY_INDEX, 1);
  assert.equal(s.BABY_NAME, 'Oscar');
  assert.notEqual(s.BABY_ACCENT, buildState(view({ babies: [PHOEBE, OSCAR], activeIndex: 0 })).BABY_ACCENT);
  assert.equal(s.OTHER_TIMERS, 1);
});

test('status is always present, and RETRY_AFTER only when given', () => {
  assert.equal(buildState(view()).STATUS, P.STATUS.OK);
  assert.equal('RETRY_AFTER' in buildState(view()), false);
  assert.equal(buildState(view({ status: P.STATUS.RATE_LIMITED, retryAfter: 40 })).RETRY_AFTER, 40);
});

test('settings are echoed as small ints', () => {
  const s = buildState(view({ settings: Object.assign({}, DEFAULTS, { bottleUnits: 'ml', pumpUnits: 'oz', exitAfterLog: true, defaultBottleType: 'breast_milk' }) }));
  assert.equal(s.BOTTLE_UNITS, P.UNITS.ML);
  assert.equal(s.PUMP_UNITS, P.UNITS.OZ);
  assert.equal(s.EXIT_AFTER_LOG, 1);
  assert.equal(s.DEFAULT_BOTTLE, P.BOTTLE_TYPE.BREAST_MILK);
  assert.equal(buildState(view()).BOTTLE_UNITS, P.UNITS.OZ);
  assert.equal(buildState(view()).PUMP_UNITS, P.UNITS.OZ);
  assert.equal(buildState(view()).EXIT_AFTER_LOG, 0);
});

test('the default layout follows the nappi app with Status pinned last', () => {
  assert.deepEqual(buildState(view()).LAYOUT, [
    P.ACTION.SLEEP, P.ACTION.NURSING, P.ACTION.BOTTLE, P.ACTION.DIAPER, P.ACTION.PUMP, P.ACTION.POTTY, P.ACTION.STATUS,
  ]);
});

test('layoutIds honours order and visibility, drops unknown names and duplicates, pins Status last', () => {
  assert.deepEqual(layoutIds(['sleep', 'diaper', 'bogus', 'sleep']), [P.ACTION.SLEEP, P.ACTION.DIAPER, P.ACTION.STATUS]);
  assert.deepEqual(layoutIds(['diaper', 'activity', 'bottle']), [P.ACTION.DIAPER, P.ACTION.BOTTLE, P.ACTION.STATUS]);
  assert.deepEqual(layoutIds([]), [P.ACTION.STATUS]);
  assert.deepEqual(layoutIds(['status', 'diaper']), [P.ACTION.DIAPER, P.ACTION.STATUS]);
});

test('LAST holds epoch seconds per action, 0 when there is nothing', () => {
  const s = buildState(view({
    latest: {
      diaper: { id: '1', time: '2026-10-24T17:00:00Z', diaper_type: 'wet' },
      bottle: { id: '2', time: '2026-10-24T16:00:00Z', amount_ml: 118.3, bottle_type: 'formula' },
      sleep: { id: '3', start_time: '2026-10-24T14:00:00Z', end_time: '2026-10-24T15:12:00Z', duration_minutes: 72, sleep_type: 'nap' },
      nursing: null,
    },
  }));
  assert.equal(s.LAST.length, 7);
  assert.equal(P.ACTION.STATUS + 1, 7);
  assert.equal(s.LAST[P.ACTION.DIAPER], sec('2026-10-24T17:00:00Z'));
  assert.equal(s.LAST[P.ACTION.BOTTLE], sec('2026-10-24T16:00:00Z'));
  assert.equal(s.LAST[P.ACTION.SLEEP], sec('2026-10-24T15:12:00Z'), 'sleep uses the end time');
  assert.equal(s.LAST[P.ACTION.NURSING], 0);
  assert.equal(s.LAST[P.ACTION.POTTY], 0);
  assert.equal(s.LAST[P.ACTION.STATUS], 0);
});

test('INFO carries the small detail each tile shows', () => {
  const s = buildState(view({
    latest: {
      diaper: { id: '1', time: '2026-10-24T17:00:00Z', diaper_type: 'poo' },
      bottle: { id: '2', time: '2026-10-24T16:00:00Z', amount_ml: 118.3, bottle_type: 'formula' },
      nursing: { id: '3', time: '2026-10-24T18:00:00Z', duration_minutes: 12, side: 'right', left_seconds: 0, right_seconds: 720 },
      sleep: { id: '4', start_time: '2026-10-24T14:00:00Z', end_time: '2026-10-24T15:12:00Z', duration_minutes: 72, sleep_type: 'nap' },
      pumping: { id: '5', time: '2026-10-24T13:00:00Z', duration_minutes: 15, total_amount_ml: 88.7, left_amount_ml: null, right_amount_ml: null },
      potty: { id: '6', time: '2026-10-24T12:00:00Z', outcome: 'accident' },
    },
  }));
  assert.equal(s.INFO[P.ACTION.DIAPER], P.DIAPER.POO + 1);
  assert.equal(s.INFO[P.ACTION.BOTTLE], 40, 'oz x10');
  assert.equal(s.INFO[P.ACTION.NURSING], P.SIDE.RIGHT);
  assert.equal(s.INFO[P.ACTION.SLEEP], 72);
  assert.equal(s.INFO[P.ACTION.PUMP], 30);
  assert.equal(s.INFO[P.ACTION.POTTY], P.POTTY.ACCIDENT + 1);
  assert.equal(s.INFO.length, 7);
});

test('INFO bottle and pump amounts follow their own screen units', () => {
  const s = buildState(view({
    settings: Object.assign({}, DEFAULTS, { bottleUnits: 'oz', pumpUnits: 'ml' }),
    latest: {
      bottle: { id: '2', time: '2026-10-24T16:00:00Z', amount_ml: 118.3, bottle_type: 'formula' },
      pumping: { id: '5', time: '2026-10-24T13:00:00Z', duration_minutes: 15, total_amount_ml: 120, left_amount_ml: null, right_amount_ml: null },
    },
  }));
  assert.equal(s.INFO[P.ACTION.BOTTLE], 40);
  assert.equal(s.INFO[P.ACTION.PUMP], 1200);
  assert.equal(s.BOTTLE_UNITS, 0);
  assert.equal(s.PUMP_UNITS, 1);
  assert.equal('PRESET' in s, false);
  assert.equal('UNITS' in s, false);
});

test('timers: none running gives zeros', () => {
  const s = buildState(view());
  assert.deepEqual(s.TIMER_STATE, [0, 0, 0]);
  assert.deepEqual(s.TIMER_ELAPSED, [0, 0, 0]);
  assert.deepEqual(s.TIMER_SIDE, [0, 0, 0]);
  assert.equal(s.TIMER_AT, Math.floor(NOW / 1000));
});

test('timers: running, paused and sided timers map to their slots', () => {
  const s = buildState(view({
    timers: [
      { type: 'sleep', started_at: '2026-10-24T18:00:00Z', paused: false, elapsed_seconds: 3600 },
      { type: 'nursing', started_at: '2026-10-24T18:50:00Z', paused: true, elapsed_seconds: 240, side: 'left', left_seconds: 240, right_seconds: 0 },
    ],
  }));
  assert.deepEqual(s.TIMER_STATE, [P.TIMER_STATE.RUNNING, P.TIMER_STATE.PAUSED, P.TIMER_STATE.NONE]);
  assert.deepEqual(s.TIMER_ELAPSED, [3600, 240, 0]);
  assert.deepEqual(s.TIMER_SIDE, [P.SIDE.NONE, P.SIDE.LEFT, P.SIDE.NONE]);
});

test('PENDING reports the unsent write count', () => {
  assert.equal(buildState(view({ pending: 3 })).PENDING, 3);
});

test('with no baby known, only status and settings are sent', () => {
  const s = buildState(view({ status: P.STATUS.NO_TOKEN, babies: [], activeIndex: -1 }));
  assert.equal(s.STATUS, P.STATUS.NO_TOKEN);
  assert.equal('BABY_NAME' in s, false);
  assert.equal('LAST' in s, false);
  assert.equal(s.BOTTLE_UNITS, P.UNITS.OZ);
});

test('every key in a built state is a declared message key', () => {
  const declared = P.MESSAGE_KEYS.map((d) => d.replace(/\[\d+\]$/, ''));
  const s = buildState(view({ status: P.STATUS.RATE_LIMITED, retryAfter: 5 }));
  Object.keys(s).forEach((k) => assert.ok(declared.includes(k), k));
});
