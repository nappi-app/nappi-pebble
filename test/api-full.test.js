const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMockNappi } = require('./support/mock-nappi');
const { createClient, ApiError } = require('../src/pkjs/api');

const BASE = 'https://api.nappi.app';
const NOW = Date.parse('2026-10-24T19:00:00Z');
const BABY = { id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Phoebe' };

function setup() {
  const clock = { t: NOW };
  const mock = createMockNappi({ now: () => clock.t });
  mock.addToken('t');
  mock.addBaby(BABY);
  const sent = [];
  const transport = (req) => { sent.push(req); return Promise.resolve(mock.handle(req)); };
  return { clock, mock, sent, client: createClient({ baseUrl: BASE, token: 't', transport }) };
}

test('latest asks for the given types and returns data with its ETag', async () => {
  const { client, sent } = setup();
  const res = await client.latest(BABY.id, { types: ['diaper', 'sleep'] });
  assert.equal(res.notModified, false);
  assert.deepEqual(Object.keys(res.data).sort(), ['diaper', 'sleep']);
  assert.ok(res.etag);
  assert.equal(sent[0].url, `${BASE}/v1/babies/${BABY.id}/entries/latest?types=diaper,sleep`);
});

test('latest with no types asks for everything', async () => {
  const { client, sent } = setup();
  await client.latest(BABY.id);
  assert.equal(sent[0].url, `${BASE}/v1/babies/${BABY.id}/entries/latest`);
});

test('latest sends If-None-Match and reports a 304 as notModified', async () => {
  const { client, sent } = setup();
  const first = await client.latest(BABY.id, { types: ['diaper'] });
  const second = await client.latest(BABY.id, { types: ['diaper'], etag: first.etag });
  assert.equal(sent[1].headers['If-None-Match'], first.etag);
  assert.deepEqual(second, { notModified: true, data: null, etag: first.etag });
});

test('latest returns fresh data when the ETag no longer matches', async () => {
  const { client } = setup();
  const first = await client.latest(BABY.id, { types: ['diaper'] });
  await client.logEntry(BABY.id, { type: 'diaper', diaper_type: 'wet' }, 'k1');
  const next = await client.latest(BABY.id, { types: ['diaper'], etag: first.etag });
  assert.equal(next.notModified, false);
  assert.equal(next.data.diaper.diaper_type, 'wet');
});

test('timers returns the running list', async () => {
  const { client } = setup();
  assert.deepEqual(await client.timers(BABY.id), []);
  await client.startTimer(BABY.id, 'sleep');
  const list = await client.timers(BABY.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'sleep');
});

test('logEntry posts JSON with an Idempotency-Key and returns the created entry', async () => {
  const { client, sent } = setup();
  const res = await client.logEntry(BABY.id, { type: 'diaper', diaper_type: 'poo' }, 'key-1');
  assert.equal(res.duplicate, false);
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].headers['Idempotency-Key'], 'key-1');
  assert.equal(sent[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(sent[0].body), { type: 'diaper', diaper_type: 'poo' });
});

test('retrying logEntry with the same key reports duplicate instead of logging twice', async () => {
  const { client } = setup();
  await client.logEntry(BABY.id, { type: 'diaper', diaper_type: 'wet' }, 'same');
  const again = await client.logEntry(BABY.id, { type: 'diaper', diaper_type: 'wet' }, 'same');
  assert.equal(again.duplicate, true);
});

test('a rejected body surfaces as ApiError 400', async () => {
  const { client } = setup();
  await assert.rejects(
    client.logEntry(BABY.id, { type: 'diaper', diaper_type: 'sparkly' }, 'k'),
    (e) => e instanceof ApiError && e.status === 400
  );
});

test('startTimer posts the optional body and distinguishes already_running', async () => {
  const { client, sent } = setup();
  const first = await client.startTimer(BABY.id, 'nursing', { side: 'left' });
  assert.equal(first.status, 'started');
  assert.equal(sent[0].url, `${BASE}/v1/babies/${BABY.id}/timers/nursing/start`);
  assert.deepEqual(JSON.parse(sent[0].body), { side: 'left' });
  const again = await client.startTimer(BABY.id, 'nursing', { side: 'left' });
  assert.equal(again.status, 'already_running');
});

test('a timer start or stop with no options still posts an empty JSON object', async () => {
  const { client, sent } = setup();
  await client.startTimer(BABY.id, 'sleep');
  await client.stopTimer(BABY.id, 'sleep');
  assert.equal(sent.length, 2);
  sent.forEach((req) => {
    assert.equal(req.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(req.body), {});
  });
});

test('every timer type can be started and stopped without a body', async () => {
  const { client } = setup();
  for (const type of ['sleep', 'nursing', 'pumping']) {
    assert.equal((await client.startTimer(BABY.id, type)).status, 'started');
    assert.equal((await client.stopTimer(BABY.id, type)).status, 'stopped');
  }
});

test('stopTimer returns the saved entry; stopping again is ApiError timer_not_running', async () => {
  const { client, clock } = setup();
  await client.startTimer(BABY.id, 'sleep');
  clock.t += 30 * 60 * 1000;
  const stopped = await client.stopTimer(BABY.id, 'sleep');
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.entry.duration_minutes, 30);
  await assert.rejects(client.stopTimer(BABY.id, 'sleep'), (e) => e.status === 409 && e.code === 'timer_not_running');
});

test('baby ids are URL-encoded into the path', async () => {
  const { client, sent } = setup();
  await client.timers('a b/c').catch(() => {});
  assert.equal(sent[0].url, `${BASE}/v1/babies/a%20b%2Fc/timers`);
});

test('a 304 never reaches callers as an error', async () => {
  const transport = () => Promise.resolve({ status: 304, headers: { etag: '"x"' }, body: '' });
  const client = createClient({ baseUrl: BASE, token: 't', transport });
  const res = await client.latest(BABY.id, { etag: '"x"' });
  assert.equal(res.notModified, true);
});
