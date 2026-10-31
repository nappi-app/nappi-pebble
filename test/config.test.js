const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConfig, settingsFromClayResponse, prefillFor, rejectedBaseUrl } = require('../src/pkjs/config');
const { DEFAULTS } = require('../src/pkjs/settings');

const A = { id: 'a', name: 'Phoebe', birth_date: null, timezone: null };
const B = { id: 'b', name: 'Oscar', birth_date: null, timezone: null };

function items(config) {
  const out = [];
  (function walk(list) {
    list.forEach((item) => {
      out.push(item);
      if (item.items) walk(item.items);
    });
  })(config);
  return out;
}

function byKey(config, key) {
  return items(config).find((i) => i.messageKey === key);
}

test('the token field is a password input prefilled from settings', () => {
  const config = buildConfig({ settings: { ...DEFAULTS, token: 'abc' }, babies: [] });
  const field = byKey(config, 'token');
  assert.equal(field.type, 'input');
  assert.equal(field.attributes.type, 'password');
  assert.equal(field.defaultValue, 'abc');
});

test('with babies loaded, a baby picker lists each by name', () => {
  const config = buildConfig({ settings: { ...DEFAULTS, token: 't' }, babies: [A, B] });
  const picker = byKey(config, 'babyId');
  assert.equal(picker.type, 'select');
  assert.deepEqual(picker.options, [
    { label: 'Phoebe', value: 'a' },
    { label: 'Oscar', value: 'b' },
  ]);
});

test('the picker preselects the saved baby, else the first', () => {
  const saved = buildConfig({ settings: { ...DEFAULTS, token: 't', babyId: 'b' }, babies: [A, B] });
  assert.equal(byKey(saved, 'babyId').defaultValue, 'b');
  const fresh = buildConfig({ settings: { ...DEFAULTS, token: 't' }, babies: [A, B] });
  assert.equal(byKey(fresh, 'babyId').defaultValue, 'a');
});

test('without babies there is no picker, and the page says why', () => {
  const config = buildConfig({ settings: DEFAULTS, babies: [] });
  assert.equal(byKey(config, 'babyId'), undefined);
  const note = items(config).find((i) => i.type === 'text');
  assert.match(note.defaultValue, /token/i);
});

test('a load error is shown instead of the generic hint', () => {
  const config = buildConfig({ settings: { ...DEFAULTS, token: 'bad' }, babies: [], error: 'The token was rejected' });
  const texts = items(config).filter((i) => i.type === 'text').map((i) => i.defaultValue);
  assert.ok(texts.some((t) => /rejected/.test(t)));
});

test('bottle and pump units each offer oz and ml and default to the saved choice', () => {
  const config = buildConfig({ settings: { ...DEFAULTS, bottleUnits: 'ml', pumpUnits: 'oz' }, babies: [] });
  const bottle = byKey(config, 'bottleUnits');
  const pump = byKey(config, 'pumpUnits');
  assert.equal(bottle.type, 'select');
  assert.equal(pump.type, 'select');
  assert.deepEqual(bottle.options.map((o) => o.value), ['oz', 'ml']);
  assert.deepEqual(pump.options.map((o) => o.value), ['oz', 'ml']);
  assert.equal(bottle.defaultValue, 'ml');
  assert.equal(pump.defaultValue, 'oz');
  assert.equal(byKey(config, 'units'), undefined);
  assert.equal(byKey(config, 'bottlePresets'), undefined);
});

test('the API address is tucked into a Developer section', () => {
  const config = buildConfig({ settings: { ...DEFAULTS, baseUrl: 'http://localhost:4010' }, babies: [] });
  const dev = config.find((i) => i.type === 'section' && /developer/i.test(i.items[0].defaultValue || ''));
  assert.ok(dev, 'Developer section');
  assert.equal(byKey(dev.items, 'baseUrl').defaultValue, 'http://localhost:4010');
});

test('the page ends with a save button and message keys are unique', () => {
  const config = buildConfig({ settings: DEFAULTS, babies: [A] });
  assert.equal(config[config.length - 1].type, 'submit');
  const keys = items(config).map((i) => i.messageKey).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
});

test('a Clay response is flattened to a settings patch', () => {
  const patch = settingsFromClayResponse({
    token: { value: '  abc  ' },
    babyId: { value: 'b' },
    bottleUnits: { value: 'ml' },
    pumpUnits: { value: 'oz' },
    baseUrl: { value: 'http://localhost:4010/' },
  });
  assert.deepEqual(patch, { token: 'abc', babyId: 'b', bottleUnits: 'ml', pumpUnits: 'oz', baseUrl: 'http://localhost:4010' });
});

test('plain (non-{value}) responses are accepted too', () => {
  assert.deepEqual(settingsFromClayResponse({ token: 'abc' }), { token: 'abc' });
});

test('a Clay response carries the two per-screen units', () => {
  assert.deepEqual(
    settingsFromClayResponse({ bottleUnits: { value: 'ml' }, pumpUnits: { value: 'oz' } }),
    { bottleUnits: 'ml', pumpUnits: 'oz' },
  );
});

test('an unknown unit is ignored rather than saved', () => {
  assert.deepEqual(settingsFromClayResponse({ bottleUnits: { value: 'stone' }, pumpUnits: { value: 'cup' }, units: { value: 'ml' } }), {});
});

test('a blank API address resets to the production default', () => {
  assert.deepEqual(settingsFromClayResponse({ baseUrl: { value: '   ' } }), { baseUrl: DEFAULTS.baseUrl });
});

test('keys the app does not own are dropped', () => {
  assert.deepEqual(settingsFromClayResponse({ token: { value: 't' }, evil: { value: 'x' } }), { token: 't' });
});

test('a response with no baby chosen leaves the saved baby alone', () => {
  assert.equal('babyId' in settingsFromClayResponse({ token: { value: 't' } }), false);
});

test('prefill maps each message key to the value the form should show', () => {
  const config = buildConfig({ settings: { ...DEFAULTS, token: 'abc', bottleUnits: 'ml' }, babies: [A, B] });
  const prefill = prefillFor(config);
  assert.equal(prefill.token, 'abc');
  assert.equal(prefill.babyId, 'a');
  assert.equal(prefill.bottleUnits, 'ml');
  assert.equal(prefill.pumpUnits, 'oz');
  assert.equal(prefill.baseUrl, DEFAULTS.baseUrl);
});

test('prefill leaves out keys the page does not show', () => {
  const config = buildConfig({ settings: DEFAULTS, babies: [] });
  assert.equal('babyId' in prefillFor(config), false);
});

test('a Clay response with a rejected address leaves baseUrl out of the patch', () => {
  const response = { token: { value: 'abc' }, baseUrl: { value: ' http://evil.example/ ' } };
  const patch = settingsFromClayResponse(response);
  assert.equal('baseUrl' in patch, false);
  assert.equal(patch.token, 'abc');
  assert.equal(rejectedBaseUrl(response), 'http://evil.example');
  assert.equal(rejectedBaseUrl({ baseUrl: 'http://localhost:80@evil.example' }), 'http://localhost:80@evil.example');
});

test('rejectedBaseUrl is null for an allowed, empty or missing address', () => {
  assert.equal(rejectedBaseUrl({ baseUrl: { value: 'https://api.nappi.app/' } }), null);
  assert.equal(rejectedBaseUrl({ baseUrl: { value: 'http://localhost:4010' } }), null);
  assert.equal(rejectedBaseUrl({ baseUrl: { value: '   ' } }), null);
  assert.equal(rejectedBaseUrl({ token: 'x' }), null);
  assert.equal(rejectedBaseUrl({}), null);
});

test('an allowed address is still saved without a trailing slash', () => {
  assert.equal(settingsFromClayResponse({ baseUrl: { value: ' HTTPS://Api.Example.com/// ' } }).baseUrl, 'HTTPS://Api.Example.com');
  assert.equal(settingsFromClayResponse({ baseUrl: { value: '' } }).baseUrl, DEFAULTS.baseUrl);
});

test('the API address field states the rule', () => {
  const field = items(buildConfig({ settings: DEFAULTS, babies: [A] })).find((i) => i.messageKey === 'baseUrl');
  assert.ok(field.description.includes('https://'));
});
