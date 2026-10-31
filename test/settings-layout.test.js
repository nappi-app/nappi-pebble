const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSettings, DEFAULTS } = require('../src/pkjs/settings');
const { buildConfig, settingsFromClayResponse, prefillFor, ACTION_ORDER } = require('../src/pkjs/config');

function memoryStorage() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

const byKey = (config, key) => {
  let found;
  (function walk(list) { list.forEach((i) => { if (i.messageKey === key) found = i; if (i.items) walk(i.items); }); })(config);
  return found;
};

test('new settings default to spec layout, formula, stay-open', () => {
  assert.deepEqual(DEFAULTS.layout, ['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'potty']);
  assert.equal(DEFAULTS.defaultBottleType, 'formula');
  assert.equal(DEFAULTS.exitAfterLog, false);
});

test('arrays in settings are copied on read so callers cannot corrupt the store', () => {
  const store = createSettings(memoryStorage());
  store.get().layout.push('hacked');
  assert.deepEqual(store.get().layout, DEFAULTS.layout);
});

test('layout persists', () => {
  const storage = memoryStorage();
  createSettings(storage).update({ layout: ['sleep', 'diaper'] });
  const s = createSettings(storage).get();
  assert.deepEqual(s.layout, ['sleep', 'diaper']);
});

test('the config page has a position picker per action, prefilled from the saved layout', () => {
  const config = buildConfig({ settings: Object.assign({}, DEFAULTS, { layout: ['sleep', 'diaper'] }), babies: [] });
  assert.deepEqual(ACTION_ORDER, ['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'potty']);
  ACTION_ORDER.forEach((a) => assert.equal(byKey(config, 'pos_' + a).type, 'select', a));
  assert.equal(byKey(config, 'pos_sleep').defaultValue, '1');
  assert.equal(byKey(config, 'pos_diaper').defaultValue, '2');
  assert.equal(byKey(config, 'pos_bottle').defaultValue, '0', 'hidden');
  const labels = byKey(config, 'pos_sleep').options.map((o) => o.label);
  assert.equal(labels[0], 'Hidden');
  assert.equal(labels.length, 7);
});

test('the config page has default bottle type and exit-after-log, and no presets', () => {
  const config = buildConfig({
    settings: Object.assign({}, DEFAULTS, { defaultBottleType: 'breast_milk', exitAfterLog: true }), babies: [],
  });
  assert.equal(byKey(config, 'bottlePresets'), undefined);
  assert.equal(byKey(config, 'defaultBottleType').defaultValue, 'breast_milk');
  assert.deepEqual(byKey(config, 'defaultBottleType').options.map((o) => o.value), ['formula', 'breast_milk']);
  assert.equal(byKey(config, 'exitAfterLog').type, 'toggle');
  assert.equal(byKey(config, 'exitAfterLog').defaultValue, true);
});

test('positions in the response become the ordered layout, hidden ones dropped', () => {
  const patch = settingsFromClayResponse({
    pos_diaper: { value: '3' }, pos_bottle: { value: '0' }, pos_nursing: { value: '1' }, pos_sleep: { value: '2' },
    pos_pump: { value: '0' }, pos_potty: { value: '4' },
  });
  assert.deepEqual(patch.layout, ['nursing', 'sleep', 'diaper', 'potty']);
});

test('activity is gone from the config page and from responses', () => {
  const config = buildConfig({ settings: Object.assign({}, DEFAULTS, { layout: ['diaper', 'activity'] }), babies: [] });
  assert.equal(byKey(config, 'pos_activity'), undefined);
  const patch = settingsFromClayResponse({ pos_diaper: { value: '1' }, pos_activity: { value: '1' } });
  assert.deepEqual(patch.layout, ['diaper']);
  assert.equal((settingsFromClayResponse({ pos_activity: { value: '1' } }).layout || []).includes('activity'), false);
});

test('equal positions fall back to the default order', () => {
  const patch = settingsFromClayResponse({ pos_diaper: { value: '1' }, pos_bottle: { value: '1' } });
  assert.deepEqual(patch.layout, ['bottle', 'diaper']);
});

test('hiding every action is ignored so the grid is never empty', () => {
  const patch = settingsFromClayResponse({ pos_diaper: { value: '0' }, pos_bottle: { value: '0' } });
  assert.equal('layout' in patch, false);
});

test('a response with no position fields leaves the layout alone', () => {
  assert.equal('layout' in settingsFromClayResponse({ token: { value: 't' } }), false);
});

test('a preset response field is ignored', () => {
  assert.equal('bottlePresets' in settingsFromClayResponse({ bottlePresets: { value: '2, 3' } }), false);
});

test('default bottle type and exit-after-log are validated and coerced', () => {
  assert.equal(settingsFromClayResponse({ defaultBottleType: { value: 'breast_milk' } }).defaultBottleType, 'breast_milk');
  assert.equal('defaultBottleType' in settingsFromClayResponse({ defaultBottleType: { value: 'lava' } }), false);
  assert.equal(settingsFromClayResponse({ exitAfterLog: { value: true } }).exitAfterLog, true);
  assert.equal(settingsFromClayResponse({ exitAfterLog: false }).exitAfterLog, false);
});

test('prefill covers the new fields', () => {
  const p = prefillFor(buildConfig({ settings: Object.assign({}, DEFAULTS, { layout: ['sleep'] }), babies: [] }));
  assert.equal(p.pos_sleep, '1');
  assert.equal(p.pos_diaper, '0');
  assert.equal(p.exitAfterLog, false);
  assert.equal('bottlePresets' in p, false);
});
