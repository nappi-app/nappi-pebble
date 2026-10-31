// The phone (JS) and watch (C) must agree on every enum and message key.
// protocol.js is the source of truth; these tests fail if either side drifts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/pkjs/protocol');

const ROOT = path.join(__dirname, '..');
const header = fs.readFileSync(path.join(ROOT, 'src', 'c', 'logic', 'protocol.h'), 'utf8');

function defines() {
  const out = {};
  header.split('\n').forEach((line) => {
    const m = /^#define\s+([A-Z0-9_]+)\s+(-?\d+)\s*(?:\/\/.*)?$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  });
  return out;
}

const GROUPS = {
  STATUS: P.STATUS,
  ACTION: P.ACTION,
  CMD: P.CMD,
  DIAPER: P.DIAPER,
  BOTTLE_TYPE: P.BOTTLE_TYPE,
  POTTY: P.POTTY,
  TIMER: P.TIMER,
  SIDE: P.SIDE,
  TIMER_STATE: P.TIMER_STATE,
  UNITS: P.UNITS,
  UNITS_SCREEN: P.UNITS_SCREEN,
};

Object.keys(GROUPS).forEach((group) => {
  test('protocol.h matches protocol.js for ' + group, () => {
    const c = defines();
    const expected = {};
    Object.keys(GROUPS[group]).forEach((name) => { expected[group + '_' + name] = GROUPS[group][name]; });
    const actual = {};
    // *_COUNT sizes are checked in their own test below.
    Object.keys(c).filter((k) => k.startsWith(group + '_') && !k.endsWith('_COUNT')).forEach((k) => { actual[k] = c[k]; });
    // TIMER_ is a prefix of TIMER_STATE_, so drop the longer group's names.
    if (group === 'TIMER') Object.keys(actual).filter((k) => k.startsWith('TIMER_STATE_')).forEach((k) => delete actual[k]);
    // Likewise UNITS_ is a prefix of UNITS_SCREEN_.
    if (group === 'UNITS') Object.keys(actual).filter((k) => k.startsWith('UNITS_SCREEN_')).forEach((k) => delete actual[k]);
    assert.deepEqual(actual, expected);
  });
});

test('protocol.h counts match the array sizes in the message keys', () => {
  const c = defines();
  assert.equal('PRESET_COUNT' in c, false);
  assert.equal('PRESET_COUNT' in P, false);
  assert.equal(c.ACTION_COUNT, Object.keys(P.ACTION).length);
  assert.equal(c.TIMER_COUNT, Object.keys(P.TIMER).length);
});

test('package.json messageKeys are exactly the protocol key list', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.pebble.messageKeys, P.MESSAGE_KEYS);
});

test('array message keys carry their length, matching the protocol constants', () => {
  assert.ok(!P.MESSAGE_KEYS.some((k) => k.startsWith('PRESET')));
  assert.ok(P.MESSAGE_KEYS.includes('LAST[' + Object.keys(P.ACTION).length + ']'));
  assert.ok(P.MESSAGE_KEYS.includes('INFO[' + Object.keys(P.ACTION).length + ']'));
  assert.ok(P.MESSAGE_KEYS.includes('TIMER_STATE[' + Object.keys(P.TIMER).length + ']'));
});

test('every enum value fits the small ints AppMessage carries', () => {
  Object.values(GROUPS).forEach((group) => Object.values(group).forEach((v) => {
    assert.ok(Number.isInteger(v) && v >= 0 && v < 256);
  }));
});
