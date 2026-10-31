// Persistent offline write queue. Each job gets an idempotency key when it
// is created, so a retry after a lost response can never log twice. Jobs go
// out strictly in order: the first one that cannot be delivered holds the
// rest back.
//
// flush(client) -> { sent, remaining, stop, dropped }
//   stop: null, or { kind: 'network' | 'rate_limited' | 'auth', retryAfter, error }
//   dropped: [{ job, error }] jobs the API rejected for good (400/404/...)

const { toIsoOffset } = require('./time');

const KEY = 'nappi-pebble.queue';
// A job delivered later than this is stamped with when it was queued. Prompt
// sends carry no time so the server's own clock decides, which avoids "start
// time in the future" rejections when the phone clock runs a little fast.
const STALE_MS = 30 * 1000;
const STAMP_FIELD = { entry: 'time', timer_start: 'start_time', timer_stop: 'end_time' };

function createQueue(deps) {
  const storage = deps.storage;
  const uuid = deps.uuid;
  const now = deps.now || Date.now;
  const offsetAt = deps.offsetAt || function () { return 0; };
  let jobs = load();
  let running = null;

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    storage.setItem(KEY, JSON.stringify(jobs));
  }

  // Delivered late (offline, rate limited): record when it really happened.
  function stamped(job) {
    const field = STAMP_FIELD[job.kind];
    if (!field || typeof job.queuedAt !== 'number' || now() - job.queuedAt < STALE_MS) return job;
    const body = Object.assign({}, job.body);
    if (body[field] === undefined) body[field] = toIsoOffset(job.queuedAt, offsetAt(job.queuedAt));
    return Object.assign({}, job, { body });
  }

  function execute(client, original) {
    const job = stamped(original);
    switch (job.kind) {
      case 'entry': return client.logEntry(job.babyId, job.body, job.key);
      case 'timer_start': return client.startTimer(job.babyId, job.timerType, job.body);
      case 'timer_stop': return client.stopTimer(job.babyId, job.timerType, job.body);
      default: return Promise.reject(new Error('unknown job kind ' + job.kind));
    }
  }

  function remove(job) {
    jobs = jobs.filter((j) => j.key !== job.key);
    save();
  }

  // 'done' | 'drop' | { kind, retryAfter }
  function classify(job, err) {
    const status = err && err.status;
    if (status === 429) return { kind: 'rate_limited', retryAfter: err.retryAfter, error: err };
    if (status === 401 || status === 403) return { kind: 'auth', retryAfter: null, error: err };
    if (status === 409 && job.kind === 'timer_stop' && err.code === 'timer_not_running') return 'done';
    if (status >= 400 && status < 500) return 'drop';
    return { kind: 'network', retryAfter: null, error: err };
  }

  function run(client) {
    const result = { sent: 0, remaining: 0, stop: null, dropped: [] };

    function next() {
      if (jobs.length === 0) return Promise.resolve();
      const job = jobs[0];
      return execute(client, job).then(
        () => {
          remove(job);
          result.sent += 1;
          return next();
        },
        (err) => {
          const verdict = classify(job, err);
          if (verdict === 'done') {
            remove(job);
            result.sent += 1;
            return next();
          }
          if (verdict === 'drop') {
            remove(job);
            result.dropped.push({ job, error: err });
            return next();
          }
          result.stop = verdict;
          return undefined;
        }
      );
    }

    return next().then(() => {
      result.remaining = jobs.length;
      return result;
    });
  }

  return {
    enqueue(job) {
      const queued = Object.assign({}, job, { key: uuid(), queuedAt: now() });
      jobs.push(queued);
      save();
      return queued;
    },
    length: () => jobs.length,
    all: () => jobs.slice(),
    clear() {
      jobs = [];
      save();
    },
    // One flush at a time: a second caller shares the running one.
    flush(client) {
      if (running) return running;
      const done = () => { running = null; };
      running = run(client).then(
        (res) => { done(); return res; },
        (err) => { done(); throw err; }
      );
      return running;
    }
  };
}

module.exports = { createQueue, STAMP_FIELD };
