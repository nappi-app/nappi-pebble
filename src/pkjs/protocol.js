// What the phone tells the watch, and how API failures become that.
// STATUS values travel as small ints in AppMessage; keep them stable.

const STATUS = Object.freeze({
  OK: 0,
  NO_TOKEN: 1,
  UNAUTHORIZED: 2,
  TOKEN_EXPIRED: 3,
  PREMIUM_REQUIRED: 4,
  NETWORK: 5,
  RATE_LIMITED: 6,
  NO_BABY: 7,
  ERROR: 8,
  // Only ever seen in an ACK_STATUS. ACK_ID 0 with REJECTED is the phone telling the
  // watch that nappi refused a write it had already confirmed.
  REJECTED: 9,
  WRONG_BABY: 10,
});

// Tile actions. The watch's layout is a list of these ids; STATUS is pinned last.
const ACTION = Object.freeze({
  DIAPER: 0,
  BOTTLE: 1,
  NURSING: 2,
  SLEEP: 3,
  PUMP: 4,
  POTTY: 5,
  STATUS: 6,
});

// Watch -> phone commands (CMD key, with ARG1..ARG4 and a CMD_ID echoed in the ACK).
// Every write also carries BABY_INDEX, the baby the watch is showing; the phone
// refuses it (ACK WRONG_BABY) if that is no longer the active baby.
//   LOG_DIAPER    ARG1 DIAPER_*, ARG2 minutes ago
//   LOG_BOTTLE    ARG1 amount x10, ARG2 BOTTLE_TYPE_*, ARG3 minutes ago,
//                 ARG4 UNITS_* the amount is in (absent or invalid: the saved bottle units)
//   LOG_POTTY     ARG1 POTTY_*, ARG2 minutes ago
//   TIMER_START   ARG1 TIMER_*, ARG2 SIDE_*, ARG3 minutes ago
//   TIMER_STOP    ARG1 TIMER_*, ARG2 SIDE_* override (0 none), ARG3 pumped amount x10 (0 none),
//                 ARG4 UNITS_* the amount is in (absent or invalid: the saved pump units)
//   TIMER_SWITCH  ARG1 new SIDE_* (stop the nursing timer, start the other side)
//   REFRESH       ARG1 1 to bypass the once-a-minute throttle (the Status sheet's button)
//   SWITCH_BABY   ARG1 baby index
//   SET_UNITS     ARG1 UNITS_SCREEN_*, ARG2 UNITS_* (the unit that screen shows and logs in)
const CMD = Object.freeze({
  REFRESH: 1,
  LOG_DIAPER: 2,
  LOG_BOTTLE: 3,
  LOG_POTTY: 4,
  // 5 was LOG_ACTIVITY, removed from the watch app; left unused.
  TIMER_START: 6,
  TIMER_STOP: 7,
  SWITCH_BABY: 8,
  TIMER_SWITCH: 9,
  SET_UNITS: 10,
});

const DIAPER = Object.freeze({ WET: 0, POO: 1, MIXED: 2, DRY: 3 });
const DIAPER_TYPES = ['wet', 'poo', 'mixed', 'dry'];

const BOTTLE_TYPE = Object.freeze({
  FORMULA: 0, BREAST_MILK: 1, TUBE_FEEDING: 2, COW_MILK: 3, GOAT_MILK: 4, SOY_MILK: 5, OTHER: 6,
});
const BOTTLE_TYPES = ['formula', 'breast_milk', 'tube_feeding', 'cow_milk', 'goat_milk', 'soy_milk', 'other'];

const POTTY = Object.freeze({ POTTY: 0, ACCIDENT: 1, SAT_DRY: 2 });
const POTTY_OUTCOMES = ['potty', 'accident', 'sat_dry'];

const TIMER = Object.freeze({ SLEEP: 0, NURSING: 1, PUMPING: 2 });
const TIMER_TYPES = ['sleep', 'nursing', 'pumping'];
const TIMER_STATE = Object.freeze({ NONE: 0, RUNNING: 1, PAUSED: 2 });

const SIDE = Object.freeze({ NONE: 0, LEFT: 1, RIGHT: 2, BOTH: 3 });
const UNITS = Object.freeze({ OZ: 0, ML: 1 });
const UNITS_SCREEN = Object.freeze({ BOTTLE: 0, PUMP: 1 });

// Canonical AppMessage key list; package.json must match (see protocol-sync test).
// "NAME[n]" declares n consecutive keys, MESSAGE_KEY_NAME + i on the watch.
const MESSAGE_KEYS = [
  'STATUS', 'BABY_NAME', 'RETRY_AFTER',
  'CMD', 'CMD_ID', 'ARG1', 'ARG2', 'ARG3', 'ARG4',
  'ACK_ID', 'ACK_STATUS',
  'BABY_COUNT', 'BABY_INDEX', 'BABY_NAMES', 'BABY_ACCENT', 'OTHER_TIMERS',
  'BOTTLE_UNITS', 'PUMP_UNITS', 'EXIT_AFTER_LOG', 'DEFAULT_BOTTLE',
  'LAYOUT',
  'LAST[' + Object.keys(ACTION).length + ']',
  'INFO[' + Object.keys(ACTION).length + ']',
  'TIMER_STATE[' + Object.keys(TIMER).length + ']',
  'TIMER_ELAPSED[' + Object.keys(TIMER).length + ']',
  'TIMER_SIDE[' + Object.keys(TIMER).length + ']',
  'TIMER_AT',
  'PENDING',
  'JS_READY',
];

// nappi's own API documentation, which says how to create a token. We link to it rather than restating it.
const NAPPI_DOCS_URL = 'https://nappi.app/app/api/reference';

function statusMessage(status, retryAfter) {
  switch (status) {
    case STATUS.OK: return 'Connected to nappi.';
    case STATUS.NO_TOKEN: return 'No API token yet.';
    case STATUS.UNAUTHORIZED: return 'That token was not accepted. See ' + NAPPI_DOCS_URL + ' to create a new one.';
    case STATUS.TOKEN_EXPIRED: return 'That token has expired. See ' + NAPPI_DOCS_URL + ' to create a new one.';
    case STATUS.PREMIUM_REQUIRED: return 'The nappi API needs nappi Premium on the token owner\'s account.';
    case STATUS.NETWORK: return 'Could not reach nappi. Check the phone\'s connection.';
    case STATUS.RATE_LIMITED: return 'nappi is rate limiting this token. Try again in ' + retryAfter + ' seconds.';
    case STATUS.NO_BABY: return 'This nappi household has no babies yet.';
    default: return 'nappi returned an unexpected response.';
  }
}

// Branch on the codes the docs name; 429 is recognised by status alone
// because the docs give it no code.
function describeError(err) {
  let status = STATUS.ERROR;
  let retryAfter = null;
  if (err && err.status === 429) {
    status = STATUS.RATE_LIMITED;
    retryAfter = err.retryAfter;
  } else if (err && err.code === 'unauthorized') status = STATUS.UNAUTHORIZED;
  else if (err && err.code === 'token_expired') status = STATUS.TOKEN_EXPIRED;
  else if (err && err.code === 'premium_required') status = STATUS.PREMIUM_REQUIRED;
  else if (err && err.code === 'network') status = STATUS.NETWORK;
  else if (err && err.code === 'no_token') status = STATUS.NO_TOKEN;
  return { status, retryAfter, text: statusMessage(status, retryAfter) };
}

module.exports = {
  STATUS, NAPPI_DOCS_URL, statusMessage, describeError,
  ACTION, CMD, DIAPER, DIAPER_TYPES, BOTTLE_TYPE, BOTTLE_TYPES, POTTY, POTTY_OUTCOMES,
  TIMER, TIMER_TYPES, TIMER_STATE, SIDE, UNITS, UNITS_SCREEN, MESSAGE_KEYS,
};
