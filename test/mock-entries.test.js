// Contract tests for the mock's entries endpoints, pinned to nappi's API docs (https://nappi.app/app/api/reference).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');
const { createCaller } = require('./support/call');

const NOW = Date.parse('2026-10-24T19:00:00Z');
const BABY = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe', timezone: 'America/New_York' };
const OTHER = { id: '0a2b3c4d-1111-4222-8333-444455556666', name: 'Oscar' };
const ENTRIES = `/v1/babies/${BABY.id}/entries`;
const LATEST = `/v1/babies/${BABY.id}/entries/latest`;

function setup() {
  const clock = { t: NOW };
  const mock = createMockNappi({ now: () => clock.t });
  mock.addToken('t');
  mock.addBaby(BABY);
  mock.addBaby(OTHER);
  return { mock, clock, api: createCaller(mock, 't') };
}

test('POST a diaper returns 201 with an id, and it becomes the latest diaper', () => {
  const { api } = setup();
  const res = api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' });
  assert.equal(res.status, 201);
  assert.equal(res.json.type, 'diaper');
  assert.equal(res.json.duplicate, false);
  assert.match(res.json.id, /^[0-9a-f-]{36}$/);
  const latest = api.get(LATEST).json.diaper;
  assert.equal(latest.id, res.json.id);
  assert.equal(latest.diaper_type, 'wet');
  assert.equal(latest.time, '2026-10-24T19:00:00Z');
});

test('an explicit time with an offset is stored as that instant', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'diaper', diaper_type: 'poo', time: '2026-10-24T10:00:00-04:00' });
  assert.equal(api.get(LATEST).json.diaper.time, '2026-10-24T14:00:00Z');
});

test('a time without an offset is rejected, so clients cannot send ambiguous local times', () => {
  const { api } = setup();
  const res = api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T10:00:00' });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_request');
});

test('invalid enum values and unknown types are 400', () => {
  const { api } = setup();
  assert.equal(api.post(ENTRIES, { type: 'diaper', diaper_type: 'sparkly' }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'diaper' }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'nonsense' }).status, 400);
  assert.equal(api.post(ENTRIES, {}).status, 400);
});

test('the same Idempotency-Key never logs twice', () => {
  const { api } = setup();
  const headers = { 'Idempotency-Key': 'abc-123' };
  const first = api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' }, { headers });
  const again = api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' }, { headers });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  assert.equal(again.json.id, first.json.id);
  assert.equal(api.get(LATEST).json.diaper.id, first.json.id);
});

test('an Idempotency-Key longer than 200 characters is rejected', () => {
  const { api } = setup();
  const res = api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' }, { headers: { 'Idempotency-Key': 'x'.repeat(201) } });
  assert.equal(res.status, 400);
});

test('bottle amounts default to ml and convert from oz in the latest view', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'bottle', amount: 120, bottle_type: 'formula' });
  assert.equal(api.get(LATEST).json.bottle.amount_ml, 120);
  assert.equal(api.get(LATEST).json.bottle.bottle_type, 'formula');
  api.post(ENTRIES, { type: 'bottle', amount: 4, unit: 'oz', time: '2026-10-24T19:30:00Z' });
  assert.equal(api.get(LATEST).json.bottle.amount_ml, 118.3);
});

test('bottle validation: amount must be >0 and <=1000, bottle_type from the enum', () => {
  const { api } = setup();
  assert.equal(api.post(ENTRIES, { type: 'bottle', amount: 0 }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'bottle', amount: 1001 }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'bottle', amount: 90, bottle_type: 'lava' }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'bottle', amount: 90, unit: 'cups' }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'bottle', amount: 90, bottle_type: 'breast_milk' }).status, 201);
  assert.equal(api.post(ENTRIES, { type: 'bottle' }).status, 201);
});

test('potty and activity entries appear in latest with their fields', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'potty', outcome: 'accident' });
  api.post(ENTRIES, { type: 'activity', activity_type: 'tummy_time', duration_minutes: 10 });
  const latest = api.get(LATEST).json;
  assert.equal(latest.potty.outcome, 'accident');
  assert.equal(latest.activity.activity_type, 'tummy_time');
  assert.equal(latest.activity.duration_minutes, 10);
  assert.equal(api.post(ENTRIES, { type: 'potty', outcome: 'oops' }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'activity', activity_type: 'skydiving' }).status, 400);
});

test('nursing minutes become seconds and a total duration in latest', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'nursing', left_minutes: 8, right_minutes: 5, side: 'right' });
  const n = api.get(LATEST).json.nursing;
  assert.equal(n.duration_minutes, 13);
  assert.equal(n.side, 'right');
  assert.equal(n.left_seconds, 480);
  assert.equal(n.right_seconds, 300);
});

test('pumping amounts are reported in ml', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'pumping', amount: 4, unit: 'oz', duration_minutes: 15 });
  const p = api.get(LATEST).json.pumping;
  assert.equal(p.total_amount_ml, 118.3);
  assert.equal(p.duration_minutes, 15);
});

test('sleep needs start and end, and end must follow start', () => {
  const { api } = setup();
  assert.equal(api.post(ENTRIES, { type: 'sleep', start_time: '2026-10-24T14:00:00Z' }).status, 400);
  assert.equal(api.post(ENTRIES, { type: 'sleep', start_time: '2026-10-24T16:00:00Z', end_time: '2026-10-24T14:00:00Z' }).status, 400);
  const ok = api.post(ENTRIES, { type: 'sleep', start_time: '2026-10-24T14:00:00Z', end_time: '2026-10-24T15:12:00Z', sleep_type: 'nap' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.sleep_type, 'nap');
  const s = api.get(LATEST).json.sleep;
  assert.equal(s.duration_minutes, 72);
  assert.equal(s.end_time, '2026-10-24T15:12:00Z');
});

test('growth entries are accepted and show a date', () => {
  const { api } = setup();
  assert.equal(api.post(ENTRIES, { type: 'growth', weight: 6.2 }).status, 201);
  assert.equal(api.get(LATEST).json.growth.weight_kg, 6.2);
  assert.equal(api.get(LATEST).json.growth.date, '2026-10-24');
});

test('an unknown baby is 404 and entries belong to one baby', () => {
  const { api } = setup();
  assert.equal(api.post('/v1/babies/nope/entries', { type: 'diaper', diaper_type: 'wet' }).status, 404);
  api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' });
  assert.equal(api.get(`/v1/babies/${OTHER.id}/entries/latest`).json.diaper, null);
});

test('latest returns every type, null when there is none', () => {
  const { api } = setup();
  const res = api.get(LATEST);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), [
    'activity', 'bottle', 'diaper', 'growth', 'medication', 'nursing', 'potty', 'pumping', 'sleep', 'solids',
  ]);
  Object.values(res.json).forEach((v) => assert.equal(v, null));
});

test('types limits the keys returned, and an unknown type is 400', () => {
  const { api } = setup();
  assert.deepEqual(Object.keys(api.get(LATEST + '?types=diaper,bottle').json).sort(), ['bottle', 'diaper']);
  assert.equal(api.get(LATEST + '?types=diaper,wat').status, 400);
});

test('latest is the newest by time, not by insertion order', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'diaper', diaper_type: 'dry', time: '2026-10-24T18:00:00Z' });
  api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet', time: '2026-10-24T12:00:00Z' });
  assert.equal(api.get(LATEST).json.diaper.diaper_type, 'dry');
});

test('latest/{type} returns just that type, and rejects unknown ones', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'diaper', diaper_type: 'mixed' });
  const one = api.get(LATEST + '/diaper');
  assert.equal(one.status, 200);
  assert.deepEqual(Object.keys(one.json), ['diaper']);
  assert.equal(one.json.diaper.diaper_type, 'mixed');
  assert.equal(api.get(LATEST + '/wat').status, 400);
});

test('latest carries an ETag and answers If-None-Match with 304 until something changes', () => {
  const { api } = setup();
  api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' });
  const first = api.get(LATEST);
  const etag = first.headers.etag;
  assert.ok(etag, 'ETag header');

  const same = api.get(LATEST, { headers: { 'If-None-Match': etag } });
  assert.equal(same.status, 304);
  assert.equal(same.body, '');

  api.post(ENTRIES, { type: 'diaper', diaper_type: 'poo', time: '2026-10-24T19:05:00Z' });
  const changed = api.get(LATEST, { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, etag);
});

test('the ETag differs between type subsets', () => {
  const { api } = setup();
  const a = api.get(LATEST + '?types=diaper').headers.etag;
  const b = api.get(LATEST + '?types=bottle').headers.etag;
  assert.notEqual(a, b);
});

test('the 31st write in a minute is rate limited; writes and reads are budgeted separately', () => {
  const { api } = setup();
  for (let i = 0; i < 30; i++) {
    assert.equal(api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' }).status, 201, 'write ' + (i + 1));
  }
  const limited = api.post(ENTRIES, { type: 'diaper', diaper_type: 'wet' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal(api.get(LATEST).status, 200);
});
