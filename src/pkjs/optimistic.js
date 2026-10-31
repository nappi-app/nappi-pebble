// Predicts what a queued write will look like on the server, so the watch can
// show it at once. The next successful refresh replaces these guesses with
// the real data. Pure: returns a new view, never mutates the one it is given.
//
// view: { latest: { diaper: {...}, ... }, timers: [...] }  (API shapes)
// ctx:  { now (epoch ms) }  (amounts carry their own unit in the job body)

const { toIsoZ } = require('./time');

const PENDING = 'pending';

function round1(n) {
  return Math.round(n * 10) / 10;
}

function toMl(amount, unit) {
  return unit === 'oz' ? round1(amount * 29.5735) : amount;
}

function stamp(latestEntry) {
  if (!latestEntry) return -Infinity;
  return Date.parse(latestEntry.end_time || latestEntry.time);
}

function putLatest(view, type, entry) {
  const at = Date.parse(entry.end_time || entry.time);
  if (at >= stamp(view.latest[type])) view.latest[type] = entry;
}

function applyEntry(view, body, ctx) {
  const at = body.time ? Date.parse(body.time) : ctx.now;
  const time = toIsoZ(at);
  const value = (v) => (v === undefined ? null : v);
  switch (body.type) {
    case 'diaper':
      putLatest(view, 'diaper', { id: PENDING, time, diaper_type: body.diaper_type });
      break;
    case 'bottle':
      putLatest(view, 'bottle', {
        id: PENDING,
        time,
        amount_ml: body.amount === undefined ? null : toMl(body.amount, body.unit || 'ml'),
        bottle_type: value(body.bottle_type)
      });
      break;
    case 'potty':
      putLatest(view, 'potty', { id: PENDING, time, outcome: body.outcome });
      break;
    default:
      break;
  }
}

function startTimer(view, job, ctx) {
  if (view.timers.some((t) => t.type === job.timerType)) return;
  const body = job.body || {};
  const start = body.start_time ? Date.parse(body.start_time) : ctx.now;
  const timer = {
    type: job.timerType,
    started_at: toIsoZ(start),
    paused: false,
    elapsed_seconds: Math.max(0, Math.floor((ctx.now - start) / 1000))
  };
  if (job.timerType === 'nursing') {
    timer.side = body.side === 'left' || body.side === 'right' ? body.side : null;
  }
  view.timers.push(timer);
}

function stopTimer(view, job, ctx) {
  const timer = view.timers.find((t) => t.type === job.timerType);
  if (!timer) return;
  const body = job.body || {};
  view.timers = view.timers.filter((t) => t !== timer);

  const seconds = timer.paused
    ? timer.elapsed_seconds
    : Math.max(0, Math.floor((ctx.now - Date.parse(timer.started_at)) / 1000));
  const minutes = Math.round(seconds / 60);

  if (job.timerType === 'sleep') {
    putLatest(view, 'sleep', {
      id: PENDING, start_time: timer.started_at, end_time: toIsoZ(ctx.now), duration_minutes: minutes, sleep_type: 'nap'
    });
  } else if (job.timerType === 'nursing') {
    const side = body.side || timer.side || null;
    putLatest(view, 'nursing', {
      id: PENDING,
      time: timer.started_at,
      duration_minutes: minutes,
      side,
      left_seconds: side === 'left' ? seconds : 0,
      right_seconds: side === 'right' ? seconds : 0
    });
  } else {
    putLatest(view, 'pumping', {
      id: PENDING,
      time: timer.started_at,
      duration_minutes: minutes,
      total_amount_ml: body.amount === undefined ? null : toMl(body.amount, body.unit || 'ml'),
      left_amount_ml: null,
      right_amount_ml: null
    });
  }
}

function applyJob(view, job, ctx) {
  const next = { latest: Object.assign({}, view.latest), timers: view.timers.slice() };
  if (job.kind === 'entry') applyEntry(next, job.body, ctx);
  else if (job.kind === 'timer_start') startTimer(next, job, ctx);
  else if (job.kind === 'timer_stop') stopTimer(next, job, ctx);
  return next;
}

module.exports = { applyJob, PENDING };
