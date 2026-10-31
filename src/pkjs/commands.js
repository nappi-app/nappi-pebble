// Watch command -> API write jobs. Pure: no I/O, so every mapping is testable.
// Jobs are what the offline queue stores and replays.

const P = require('./protocol');
const { toIsoOffset, minutesAgo } = require('./time');

const MAX_BACKDATE_MINUTES = 48 * 60;
const MAX_AMOUNT_X10 = 10000;

class BadCommand extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadCommand';
  }
}

function int(dict, key, fallback) {
  const v = dict[key];
  if (v === undefined) {
    if (fallback === undefined) throw new BadCommand('missing ' + key);
    return fallback;
  }
  if (!Number.isInteger(v)) throw new BadCommand(key + ' must be an integer');
  return v;
}

function pick(list, index, what) {
  if (index < 0 || index >= list.length) throw new BadCommand(what + ' out of range: ' + index);
  return list[index];
}

function minutes(dict, key) {
  const m = int(dict, key, 0);
  if (m < 0 || m > MAX_BACKDATE_MINUTES) throw new BadCommand('minutes ago out of range: ' + m);
  return m;
}

function amountX10(dict, key) {
  const a = int(dict, key, 0);
  if (a < 0 || a > MAX_AMOUNT_X10) throw new BadCommand('amount out of range: ' + a);
  return a / 10;
}

// The unit the watch logged the amount in (ARG4), else the screen's saved setting.
function unitName(dict, saved) {
  if (dict.ARG4 === P.UNITS.OZ) return 'oz';
  if (dict.ARG4 === P.UNITS.ML) return 'ml';
  return saved;
}

function sideName(side) {
  if (side === P.SIDE.LEFT) return 'left';
  if (side === P.SIDE.RIGHT) return 'right';
  if (side === P.SIDE.BOTH) return 'both';
  return null;
}

function jobsFor(dict, ctx) {
  const timeAgo = (m) => {
    const at = minutesAgo(ctx.now, m);
    return toIsoOffset(at, ctx.offsetAt(at));
  };
  const withTime = (body, m) => {
    if (m > 0) body.time = timeAgo(m);
    return body;
  };
  const entry = (body) => ({ kind: 'entry', babyId: ctx.babyId, body });
  const timerJob = (kind, type, body) => ({ kind, babyId: ctx.babyId, timerType: type, body });
  const timerType = (index) => pick(P.TIMER_TYPES, index, 'timer type');

  switch (dict.CMD) {
    case P.CMD.REFRESH:
    case P.CMD.SWITCH_BABY:
      return [];

    case P.CMD.LOG_DIAPER:
      return [entry(withTime({
        type: 'diaper', diaper_type: pick(P.DIAPER_TYPES, int(dict, 'ARG1'), 'diaper type')
      }, minutes(dict, 'ARG2')))];

    case P.CMD.LOG_BOTTLE: {
      const body = { type: 'bottle' };
      const amount = amountX10(dict, 'ARG1');
      if (amount > 0) {
        body.amount = amount;
        body.unit = unitName(dict, ctx.bottleUnits);
      }
      body.bottle_type = pick(P.BOTTLE_TYPES, int(dict, 'ARG2', 0), 'bottle type');
      return [entry(withTime(body, minutes(dict, 'ARG3')))];
    }

    case P.CMD.LOG_POTTY:
      return [entry(withTime({
        type: 'potty', outcome: pick(P.POTTY_OUTCOMES, int(dict, 'ARG1'), 'potty outcome')
      }, minutes(dict, 'ARG2')))];

    case P.CMD.TIMER_START: {
      const type = timerType(int(dict, 'ARG1'));
      const body = {};
      const side = sideName(int(dict, 'ARG2', 0));
      if (type === 'nursing' && side) body.side = side;
      const m = minutes(dict, 'ARG3');
      if (m > 0) body.start_time = timeAgo(m);
      return [timerJob('timer_start', type, Object.keys(body).length ? body : undefined)];
    }

    case P.CMD.TIMER_STOP: {
      const type = timerType(int(dict, 'ARG1'));
      const body = {};
      const override = int(dict, 'ARG2', 0);
      if (type === 'nursing' && override !== P.SIDE.NONE) {
        if (override !== P.SIDE.LEFT && override !== P.SIDE.RIGHT) throw new BadCommand('side override must be left or right');
        body.side = sideName(override);
      }
      const amount = amountX10(dict, 'ARG3');
      if (type === 'pumping' && amount > 0) {
        body.amount = amount;
        body.unit = unitName(dict, ctx.pumpUnits);
      }
      return [timerJob('timer_stop', type, Object.keys(body).length ? body : undefined)];
    }

    case P.CMD.TIMER_SWITCH: {
      const side = int(dict, 'ARG1');
      if (side !== P.SIDE.LEFT && side !== P.SIDE.RIGHT) throw new BadCommand('switch needs left or right');
      return [
        timerJob('timer_stop', 'nursing', undefined),
        timerJob('timer_start', 'nursing', { side: sideName(side) })
      ];
    }

    default:
      throw new BadCommand('unknown command: ' + dict.CMD);
  }
}

module.exports = { jobsFor, BadCommand, MAX_BACKDATE_MINUTES };
