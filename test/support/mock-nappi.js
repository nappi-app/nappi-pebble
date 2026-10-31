// In-memory stand-in for api.nappi.app, built from nappi's published OpenAPI spec
// (https://api.nappi.app/v1/openapi.json).
//
// handle({ method, url, headers, body }) -> { status, headers, body }
// `body` on the way out is a JSON string, as on the wire.
//
// ASSUMPTIONS, because the docs are silent. Clients must not depend on them:
//  - error codes `invalid_request` (400), `rate_limited` (429), `not_found` (404)
//  - a 304 still counts against the read budget
//  - latest/{type} returns an object holding only that type's key
//  - oz->ml uses 29.5735, rounded to one decimal; lb->kg and in->cm likewise
//  - nursing side "both" has side null on the timer
//  - a default sleep_type is "night" for starts between 19:00 and 07:00 local
//  - a POST without a JSON Content-Type is 415 `unsupported_media_type` (the status is
//    observed on timer stop; the error code is a guess)
// Codes the docs DO name: unauthorized, token_expired, premium_required,
// timer_not_running.

const crypto = require('node:crypto');

const READ_LIMIT = 12;
const WRITE_LIMIT = 30;
const WINDOW_MS = 60 * 1000;
const BACKDATE_LIMIT_MS = 48 * 60 * 60 * 1000;

const TYPES = ['sleep', 'nursing', 'bottle', 'diaper', 'potty', 'pumping', 'solids', 'activity', 'growth', 'medication'];
const TIMER_TYPES = ['sleep', 'nursing', 'pumping'];
const DIAPER_TYPES = ['wet', 'poo', 'mixed', 'dry'];
const POTTY_OUTCOMES = ['potty', 'accident', 'sat_dry'];
const BOTTLE_TYPES = ['breast_milk', 'formula', 'tube_feeding', 'cow_milk', 'goat_milk', 'soy_milk', 'other'];
const ACTIVITY_TYPES = [
  'bath', 'tummy_time', 'story_time', 'play', 'outdoor', 'screen_time', 'skin_to_skin', 'spit_up',
  'brush_teeth', 'skin_care', 'massage', 'reading', 'doctor_visit', 'hospitalization', 'mouth_exercises',
  'physical_therapy', 'nebulizer', 'stretches', 'digestive_discomfort',
];
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const round1 = (n) => Math.round(n * 10) / 10;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

class Invalid extends Error {}

function createMockNappi(options) {
  const now = (options && options.now) || Date.now;
  const tokens = new Map();
  const babies = [];
  const data = new Map(); // babyId -> { entries: {type: []}, timers: {type: timer|null}, overrides: {} }
  const hits = new Map(); // `${token}:${kind}` -> request timestamps in the window
  const idempotency = new Map(); // `${token}|${key}` -> created entry result
  let counter = 0;

  const nextId = () => {
    counter += 1;
    return '00000000-0000-4000-8000-' + String(counter).padStart(12, '0');
  };

  function respond(status, payload, headers) {
    return {
      status,
      headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers),
      body: payload === undefined ? '' : JSON.stringify(payload),
    };
  }
  const fail = (status, code, message, headers) => respond(status, { error: { code, message } }, headers);
  const invalid = (message) => fail(400, 'invalid_request', message);

  function headerOf(headers, name) {
    for (const key of Object.keys(headers || {})) {
      if (key.toLowerCase() === name) return headers[key];
    }
    return undefined;
  }

  function bearer(headers) {
    const m = /^Bearer (.+)$/.exec(headerOf(headers, 'authorization') || '');
    return m ? m[1] : null;
  }

  // Returns null when the request may proceed, else the 429 response.
  function rateLimit(token, kind) {
    const key = token + ':' + kind;
    const limit = kind === 'read' ? READ_LIMIT : WRITE_LIMIT;
    const t = now();
    const recent = (hits.get(key) || []).filter((at) => t - at < WINDOW_MS);
    if (recent.length >= limit) {
      hits.set(key, recent);
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - t) / 1000);
      return fail(429, 'rate_limited', 'Too many requests', { 'retry-after': String(retryAfter) });
    }
    recent.push(t);
    hits.set(key, recent);
    return null;
  }

  // ---- validation helpers (throw Invalid) ----

  function oneOf(value, list, field) {
    if (!list.includes(value)) throw new Invalid(field + ' must be one of ' + list.join(', '));
    return value;
  }

  function time(value, field) {
    if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value) || Number.isNaN(Date.parse(value))) {
      throw new Invalid(field + ' must be an ISO 8601 date-time with an offset');
    }
    return Date.parse(value);
  }

  function number(value, field, opts) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Invalid(field + ' must be a number');
    const o = opts || {};
    if (o.exclusiveMin !== undefined && !(value > o.exclusiveMin)) throw new Invalid(field + ' must be > ' + o.exclusiveMin);
    if (o.min !== undefined && value < o.min) throw new Invalid(field + ' must be >= ' + o.min);
    if (o.max !== undefined && value > o.max) throw new Invalid(field + ' must be <= ' + o.max);
    if (o.integer && !Number.isInteger(value)) throw new Invalid(field + ' must be an integer');
    return value;
  }

  const unitOf = (b) => (b.unit === undefined ? 'ml' : oneOf(b.unit, ['ml', 'oz'], 'unit'));
  const mlOf = (amount, unit) => (unit === 'oz' ? round1(amount * 29.5735) : amount);

  function localHour(ms, timezone) {
    try {
      const h = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', hour: 'numeric', hourCycle: 'h23' }).format(ms);
      return Number(h);
    } catch (e) {
      return new Date(ms).getUTCHours();
    }
  }

  function defaultSleepType(startMs, baby) {
    const h = localHour(startMs, baby.timezone);
    return h >= 19 || h < 7 ? 'night' : 'nap';
  }

  // ---- entries ----

  function buildEntry(body, baby) {
    if (!body || typeof body !== 'object') throw new Invalid('body must be an object');
    const type = oneOf(body.type, ['diaper', 'potty', 'bottle', 'nursing', 'pumping', 'sleep', 'activity', 'growth'], 'type');
    const at = body.time === undefined ? now() : time(body.time, 'time');
    const entry = { type, time: at, sortKey: at };

    switch (type) {
      case 'diaper':
        entry.diaper_type = oneOf(body.diaper_type, DIAPER_TYPES, 'diaper_type');
        break;
      case 'potty':
        entry.outcome = oneOf(body.outcome, POTTY_OUTCOMES, 'outcome');
        break;
      case 'bottle': {
        const unit = unitOf(body);
        entry.amount_ml = body.amount === undefined
          ? null : mlOf(number(body.amount, 'amount', { exclusiveMin: 0, max: 1000 }), unit);
        entry.bottle_type = body.bottle_type === undefined ? null : oneOf(body.bottle_type, BOTTLE_TYPES, 'bottle_type');
        break;
      }
      case 'nursing': {
        const mins = (k) => (body[k] === undefined ? null : number(body[k], k, { min: 0, max: 1440, integer: true }));
        const left = mins('left_minutes');
        const right = mins('right_minutes');
        const total = mins('duration_minutes');
        entry.side = body.side === undefined ? null : oneOf(body.side, ['left', 'right'], 'side');
        entry.left_seconds = left === null ? null : left * 60;
        entry.right_seconds = right === null ? null : right * 60;
        entry.duration_minutes = left !== null || right !== null ? (left || 0) + (right || 0) : total;
        break;
      }
      case 'pumping': {
        const unit = unitOf(body);
        const amt = (k, max) => (body[k] === undefined ? null : mlOf(number(body[k], k, { min: 0, max }), unit));
        entry.duration_minutes = body.duration_minutes === undefined
          ? null : number(body.duration_minutes, 'duration_minutes', { min: 0, max: 1440, integer: true });
        entry.total_amount_ml = amt('amount', 2000);
        entry.left_amount_ml = amt('left_amount', 1000);
        entry.right_amount_ml = amt('right_amount', 1000);
        break;
      }
      case 'sleep': {
        const start = time(body.start_time, 'start_time');
        const end = time(body.end_time, 'end_time');
        if (end <= start) throw new Invalid('end_time must be after start_time');
        entry.start = start;
        entry.end = end;
        entry.time = start;
        entry.sortKey = end;
        entry.sleep_type = body.sleep_type === undefined ? defaultSleepType(start, baby) : oneOf(body.sleep_type, ['nap', 'night'], 'sleep_type');
        entry.duration_minutes = Math.round((end - start) / 60000);
        break;
      }
      case 'activity':
        entry.activity_type = oneOf(body.activity_type, ACTIVITY_TYPES, 'activity_type');
        entry.duration_minutes = body.duration_minutes === undefined
          ? null : number(body.duration_minutes, 'duration_minutes', { min: 0, max: 1440, integer: true });
        break;
      case 'growth': {
        const wUnit = body.weight_unit === undefined ? 'kg' : oneOf(body.weight_unit, ['kg', 'lb'], 'weight_unit');
        const lUnit = body.length_unit === undefined ? 'cm' : oneOf(body.length_unit, ['cm', 'in'], 'length_unit');
        const w = body.weight === undefined ? null : number(body.weight, 'weight', { exclusiveMin: 0, max: 100 });
        const l = body.length === undefined ? null : number(body.length, 'length', { exclusiveMin: 0, max: 200 });
        const h = body.head === undefined ? null : number(body.head, 'head', { exclusiveMin: 0, max: 100 });
        entry.weight_kg = w === null ? null : round1(wUnit === 'lb' ? w * 0.45359237 : w) ;
        entry.height_cm = l === null ? null : round1(lUnit === 'in' ? l * 2.54 : l);
        entry.head_circumference_cm = h === null ? null : round1(lUnit === 'in' ? h * 2.54 : h);
        break;
      }
      default:
        break;
    }
    return entry;
  }

  function latestShape(type, e) {
    switch (type) {
      case 'sleep':
        return { id: e.id, start_time: iso(e.start), end_time: iso(e.end), duration_minutes: e.duration_minutes, sleep_type: e.sleep_type };
      case 'nursing':
        return { id: e.id, time: iso(e.time), duration_minutes: e.duration_minutes, side: e.side, left_seconds: e.left_seconds, right_seconds: e.right_seconds };
      case 'bottle':
        return { id: e.id, time: iso(e.time), amount_ml: e.amount_ml, bottle_type: e.bottle_type };
      case 'diaper':
        return { id: e.id, time: iso(e.time), diaper_type: e.diaper_type };
      case 'potty':
        return { id: e.id, time: iso(e.time), outcome: e.outcome };
      case 'pumping':
        return {
          id: e.id, time: iso(e.time), duration_minutes: e.duration_minutes,
          total_amount_ml: e.total_amount_ml, left_amount_ml: e.left_amount_ml, right_amount_ml: e.right_amount_ml,
        };
      case 'activity':
        return { id: e.id, time: iso(e.time), activity_type: e.activity_type, duration_minutes: e.duration_minutes };
      case 'growth':
        return {
          id: e.id, date: iso(e.time).slice(0, 10), weight_kg: e.weight_kg, height_cm: e.height_cm,
          head_circumference_cm: e.head_circumference_cm,
        };
      default:
        return e.raw;
    }
  }

  function latestOf(baby, type) {
    const list = data.get(baby.id).entries[type];
    if (list.length === 0) return null;
    const newest = list.reduce((best, e) => (e.sortKey > best.sortKey ? e : best));
    return latestShape(type, newest);
  }

  function store(baby, entry) {
    entry.id = nextId();
    data.get(baby.id).entries[entry.type].push(entry);
    return entry;
  }

  // ---- timers ----

  function elapsedSeconds(timer) {
    const end = timer.pausedAt === null ? now() : timer.pausedAt;
    return Math.max(0, Math.floor((end - timer.start - timer.pausedTotal) / 1000));
  }

  function timerJson(type, timer) {
    const out = {
      type,
      started_at: iso(timer.start),
      paused: timer.pausedAt !== null,
      elapsed_seconds: elapsedSeconds(timer),
    };
    if (type === 'nursing') {
      const e = out.elapsed_seconds;
      out.side = timer.side;
      out.left_seconds = timer.side === 'left' ? e : 0;
      out.right_seconds = timer.side === 'right' ? e : 0;
    }
    return out;
  }

  function bodyOf(req) {
    if (req.body === undefined || req.body === null || req.body === '') return {};
    let parsed;
    try {
      parsed = JSON.parse(req.body);
    } catch (e) {
      throw new Invalid('body is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Invalid('body must be an object');
    return parsed;
  }

  function startTimer(baby, type, body) {
    const d = data.get(baby.id);
    if (d.timers[type]) return respond(200, { status: 'already_running', timer: timerJson(type, d.timers[type]) });

    let start = now();
    if (body.start_time !== undefined) {
      start = time(body.start_time, 'start_time');
      if (start > now()) throw new Invalid('start_time cannot be in the future');
      if (now() - start > BACKDATE_LIMIT_MS) throw new Invalid('start_time cannot be more than 48 hours ago');
    }
    let side = null;
    if (type === 'nursing' && body.side !== undefined) {
      const given = oneOf(body.side, ['left', 'right', 'both'], 'side');
      side = given === 'both' ? null : given;
    }
    d.timers[type] = { start, side, pausedAt: null, pausedTotal: 0 };
    return respond(201, { status: 'started', timer: timerJson(type, d.timers[type]) });
  }

  function stopTimer(baby, type, body) {
    const d = data.get(baby.id);
    const timer = d.timers[type];
    if (!timer) return fail(409, 'timer_not_running', 'No ' + type + ' timer is running');

    const end = body.end_time === undefined ? now() : time(body.end_time, 'end_time');
    if (end < timer.start) throw new Invalid('end_time cannot be before the timer started');
    const unit = unitOf(body);
    const sideOverride = body.side === undefined ? null : oneOf(body.side, ['left', 'right'], 'side');
    const amount = (k, max) => (body[k] === undefined ? null : mlOf(number(body[k], k, { min: 0, max }), unit));
    const totalAmount = amount('amount', 2000);
    const leftAmount = amount('left_amount', 1000);
    const rightAmount = amount('right_amount', 1000);

    const seconds = Math.max(0, Math.floor((end - timer.start - timer.pausedTotal) / 1000));
    const minutes = Math.round(seconds / 60);
    let entry;
    let side = null;
    if (type === 'sleep') {
      entry = { type, time: timer.start, start: timer.start, end, sortKey: end, duration_minutes: minutes, sleep_type: defaultSleepType(timer.start, baby) };
    } else if (type === 'nursing') {
      side = sideOverride || timer.side;
      entry = {
        type, time: timer.start, sortKey: timer.start, duration_minutes: minutes, side,
        left_seconds: side === 'left' ? seconds : 0, right_seconds: side === 'right' ? seconds : 0,
      };
    } else {
      entry = {
        type: 'pumping', time: timer.start, sortKey: timer.start, duration_minutes: minutes,
        total_amount_ml: totalAmount, left_amount_ml: leftAmount, right_amount_ml: rightAmount,
      };
    }
    store(baby, entry);
    d.timers[type] = null;

    const out = { id: entry.id, type, start_time: iso(timer.start), end_time: iso(end), duration_minutes: minutes };
    if (type === 'sleep') out.sleep_type = entry.sleep_type;
    if (type === 'nursing') out.side = side;
    return respond(200, { status: 'stopped', entry: out });
  }

  // ---- routing ----

  const BABY = '\\/v1\\/babies\\/([^/]+)';
  const routes = [
    { method: 'GET', pattern: /^\/v1\/babies$/, kind: 'read', run: () => respond(200, babies) },
    {
      method: 'GET', pattern: new RegExp('^' + BABY + '\\/entries\\/latest$'), kind: 'read',
      run: (req, url, baby) => {
        let types = TYPES;
        const asked = url.searchParams.get('types');
        if (asked !== null) {
          types = asked.split(',').map((s) => s.trim()).filter(Boolean);
          types.forEach((t) => oneOf(t, TYPES, 'types'));
        }
        return withEtag(req, Object.fromEntries(types.map((t) => [t, latestOf(baby, t)])));
      },
    },
    {
      method: 'GET', pattern: new RegExp('^' + BABY + '\\/entries\\/latest\\/([^/]+)$'), kind: 'read',
      run: (req, url, baby, type) => withEtag(req, { [oneOf(type, TYPES, 'type')]: latestOf(baby, type) }),
    },
    {
      method: 'POST', pattern: new RegExp('^' + BABY + '\\/entries$'), kind: 'write',
      run: (req, url, baby, _x, token) => {
        const key = headerOf(req.headers, 'idempotency-key');
        if (key !== undefined && key.length > 200) throw new Invalid('Idempotency-Key must be at most 200 characters');
        const seen = key === undefined ? undefined : idempotency.get(token + '|' + key);
        if (seen) return respond(200, Object.assign({}, seen, { duplicate: true }));

        const entry = store(baby, buildEntry(bodyOf(req), baby));
        const created = { id: entry.id, type: entry.type, duplicate: false };
        if (entry.type === 'sleep') created.sleep_type = entry.sleep_type;
        if (key !== undefined) idempotency.set(token + '|' + key, created);
        return respond(201, created);
      },
    },
    {
      method: 'GET', pattern: new RegExp('^' + BABY + '\\/timers$'), kind: 'read',
      run: (req, url, baby) => {
        const d = data.get(baby.id);
        return respond(200, TIMER_TYPES.filter((t) => d.timers[t]).map((t) => timerJson(t, d.timers[t])));
      },
    },
    {
      method: 'POST', pattern: new RegExp('^' + BABY + '\\/timers\\/([^/]+)\\/(start|stop)$'), kind: 'write',
      run: (req, url, baby, type, token, action) => {
        oneOf(type, TIMER_TYPES, 'timerType');
        const body = bodyOf(req);
        return action === 'start' ? startTimer(baby, type, body) : stopTimer(baby, type, body);
      },
    },
  ];

  function withEtag(req, payload) {
    const text = JSON.stringify(payload);
    const etag = '"' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) + '"';
    if (headerOf(req.headers, 'if-none-match') === etag) {
      return { status: 304, headers: { etag }, body: '' };
    }
    return respond(200, payload, { etag });
  }

  function handle(req) {
    const url = new URL(req.url);
    const token = bearer(req.headers);
    const account = token && tokens.get(token);
    if (!account || account.revoked) {
      return fail(401, 'unauthorized', 'Missing, invalid or revoked token');
    }
    if (account.expired) {
      return fail(401, 'token_expired', 'This token has expired');
    }
    if (!account.premium) {
      return fail(403, 'premium_required', 'The nappi API requires nappi Premium');
    }

    let route = null;
    let match = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      match = r.pattern.exec(url.pathname);
      if (match) { route = r; break; }
    }
    if (!route) return fail(404, 'not_found', 'No such route');

    // Seen on the real API: a POST without a JSON Content-Type is refused, even when its body is optional.
    if (req.method === 'POST' && !/^application\/json/i.test(headerOf(req.headers, 'content-type') || '')) {
      return fail(415, 'unsupported_media_type', 'Unsupported Media Type');
    }

    const limited = rateLimit(token, route.kind);
    if (limited) return limited;

    let baby = null;
    if (match.length > 1) {
      baby = babies.find((b) => b.id === match[1]);
      if (!baby) return fail(404, 'not_found', 'Baby not found');
    }
    try {
      return route.run(req, url, baby, match[2], token, match[3]);
    } catch (e) {
      if (e instanceof Invalid) return invalid(e.message);
      throw e;
    }
  }

  return {
    handle,
    addToken(token, flags) {
      tokens.set(token, Object.assign({ premium: true, revoked: false, expired: false }, flags));
    },
    addBaby(baby) {
      const added = {
        id: baby.id,
        name: baby.name,
        birth_date: baby.birth_date === undefined ? null : baby.birth_date,
        timezone: baby.timezone === undefined ? null : baby.timezone,
      };
      babies.push(added);
      const entries = {};
      TYPES.forEach((t) => { entries[t] = []; });
      data.set(added.id, { entries, timers: { sleep: null, nursing: null, pumping: null } });
    },
    // Simulates another device pausing a timer (the public API has no pause).
    pauseTimer(babyId, type) {
      const timer = data.get(babyId).timers[type];
      if (timer && timer.pausedAt === null) timer.pausedAt = now();
    },
    // Plants a raw latest value for the read-only types (solids, medication).
    seedLatest(babyId, type, value) {
      data.get(babyId).entries[type].push({ id: value.id, type, sortKey: 0, raw: value });
    },
  };
}

module.exports = { createMockNappi, READ_LIMIT, WRITE_LIMIT, WINDOW_MS, TYPES, ACTIVITY_TYPES };
