// Turns the logical state dict into what Pebble.sendAppMessage takes.
//
// Array-declared keys ("LAST[7]" in package.json) are consecutive numeric
// keys, so an array value for one is spread out as ids[NAME] + i. Anything
// else passes through by name; a plain array (LAYOUT) goes as a byte array.
// `ids` is require('message_keys') on the phone, a fake in tests.

const { MESSAGE_KEYS } = require('./protocol');

const DECLARED = {};
MESSAGE_KEYS.forEach((decl) => {
  const m = /^([A-Z0-9_]+)(?:\[(\d+)\])?$/.exec(decl);
  DECLARED[m[1]] = m[2] ? Number(m[2]) : 0;
});

function toWire(dict, ids) {
  const out = {};
  Object.keys(dict).forEach((key) => {
    const value = dict[key];
    if (value === undefined || value === null) return;
    if (!(key in DECLARED)) throw new Error('unknown message key ' + key);

    const slots = DECLARED[key];
    if (slots === 0) {
      out[key] = value;
      return;
    }
    if (!Array.isArray(value)) throw new Error(key + ' must be an array');
    if (value.length > slots) throw new Error(key + ' holds ' + slots + ' values, got ' + value.length);
    value.forEach((v, i) => { out[ids[key] + i] = v; });
  });
  return out;
}

module.exports = { toWire };
