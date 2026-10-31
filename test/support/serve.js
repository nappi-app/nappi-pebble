// `npm run mock`: a local fake of api.nappi.app for the emulator.
// In the app's settings, set Developer > API address to http://localhost:4010
// and use one of the tokens below.
//
//   PORT=4010 HOST=127.0.0.1 TWO_BABIES=1 npm run mock

const { createMockNappi } = require('./mock-nappi');
const { listen } = require('./http-server');

const port = Number(process.env.PORT || 4010);
const host = process.env.HOST || '127.0.0.1';

const mock = createMockNappi();
mock.addToken('dev-token');
mock.addToken('expired-token', { expired: true });
mock.addToken('revoked-token', { revoked: true });
mock.addToken('free-token', { premium: false });
mock.addBaby({ id: '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01', name: 'Alex', birth_date: '2026-03-02', timezone: 'America/New_York' });
if (process.env.TWO_BABIES) {
  mock.addBaby({ id: '0a2b3c4d-1111-4222-8333-444455556666', name: 'Sam', birth_date: '2024-01-09', timezone: 'America/New_York' });
}

// SEED=1 plants a little history for the first baby, relative to now, so the
// home tiles have something to show: diaper 2h ago, bottle 3h ago, nursing
// 1h ago, a nap that ended 45m ago, and a potty and activity entry.
if (process.env.SEED) {
  const id = '6f1c1d52-3b8e-4c43-9a55-0d5d8f6a1a01';
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const post = (body) => mock.handle({
    method: 'POST',
    url: `http://x/v1/babies/${id}/entries`,
    headers: { Authorization: 'Bearer dev-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  post({ type: 'diaper', diaper_type: 'poo', time: ago(125) });
  post({ type: 'bottle', amount: 4, unit: 'oz', bottle_type: 'formula', time: ago(180) });
  post({ type: 'nursing', left_minutes: 12, right_minutes: 0, side: 'left', time: ago(60) });
  post({ type: 'sleep', start_time: ago(120), end_time: ago(45), sleep_type: 'nap' });
  post({ type: 'potty', outcome: 'sat_dry', time: ago(300) });
  post({ type: 'activity', activity_type: 'tummy_time', duration_minutes: 10, time: ago(240) });
}

listen(mock, port, host).then(() => {
  console.log(`mock nappi API on http://${host}:${port}`);
  console.log('tokens: dev-token | expired-token | revoked-token | free-token');
});
