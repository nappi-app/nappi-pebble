// Persistent phone-side settings, kept as one JSON blob in localStorage.
// The token lives here and never goes to the watch.

const KEY = 'nappi-pebble.settings';

const DEFAULTS = Object.freeze({
  token: '',
  babyId: '',
  // Each amount screen has its own unit; the watch changes them with SET_UNITS.
  bottleUnits: 'oz',
  pumpUnits: 'oz',
  baseUrl: 'https://api.nappi.app',
  // Visible tiles in grid order (Status is always appended last by the state builder).
  layout: Object.freeze(['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'potty']),
  defaultBottleType: 'formula',
  exitAfterLog: false
});

function isUnit(value) {
  return value === 'oz' || value === 'ml';
}

// The API token is sent to this address, so it must be https, or plain http
// only to this phone or a private network. Anything unusual is refused: the
// check reads the text exactly as an HTTP client will, so it accepts nothing
// that a client could read as a different host (a `user@` prefix, a
// look-alike suffix, a backslash, surrounding whitespace, an octal octet).
const SCHEME_AND_REST = /^([a-z]+):\/\/(.*)$/i;
const AUTHORITY_END = /[\/?#]/;
const PORT = /^(?::\d{0,5})?$/;
const OCTET = /^(0|[1-9]\d{0,2})$/;

function isPrivateIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const n = [];
  for (let i = 0; i < 4; i += 1) {
    if (!OCTET.test(parts[i]) || Number(parts[i]) > 255) return false;
    n.push(Number(parts[i]));
  }
  return n[0] === 127 || n[0] === 10 ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168);
}

function isLocalHttpHost(host) {
  return host === 'localhost' || host === '[::1]' || isPrivateIPv4(host);
}

function isAllowedBaseUrl(url) {
  if (typeof url !== 'string') return false;
  const m = SCHEME_AND_REST.exec(url);
  if (!m) return false;
  const scheme = m[1].toLowerCase();
  if (scheme !== 'https' && scheme !== 'http') return false;
  const cut = m[2].search(AUTHORITY_END);
  const authority = (cut < 0 ? m[2] : m[2].slice(0, cut)).toLowerCase();
  if (!authority) return false;
  if (scheme === 'https') return !/[\s\\\u0000-\u001f]/.test(authority);
  // Whitespace, control characters, backslashes and `user@` all end here.
  if (!/^[a-z0-9.:\[\]-]+$/.test(authority)) return false;
  // The host is what comes before the port: the first `:`, except inside [..].
  let host;
  let rest;
  if (authority.charAt(0) === '[') {
    const close = authority.indexOf(']');
    if (close < 0) return false;
    host = authority.slice(0, close + 1);
    rest = authority.slice(close + 1);
  } else {
    const colon = authority.indexOf(':');
    host = colon < 0 ? authority : authority.slice(0, colon);
    rest = colon < 0 ? '' : authority.slice(colon);
  }
  return PORT.test(rest) && isLocalHttpHost(host);
}

function copy(value) {
  return Array.isArray(value) ? value.slice() : value;
}

function createSettings(storage) {
  function read() {
    let stored = {};
    try {
      stored = JSON.parse(storage.getItem(KEY)) || {};
    } catch (e) {
      stored = {};
    }
    const result = {};
    // The backstop: whatever an earlier install saved, a remote http address
    // never reaches the API client, so the token never goes there.
    if (!isAllowedBaseUrl(stored.baseUrl)) delete stored.baseUrl;
    Object.keys(DEFAULTS).forEach((name) => {
      result[name] = copy(name in stored ? stored[name] : DEFAULTS[name]);
    });
    // Older installs stored one `units` for everything.
    const legacy = isUnit(stored.units) ? stored.units : DEFAULTS.bottleUnits;
    result.bottleUnits = isUnit(stored.bottleUnits) ? stored.bottleUnits : legacy;
    result.pumpUnits = isUnit(stored.pumpUnits) ? stored.pumpUnits : legacy;
    return result;
  }

  return {
    get: read,
    update(patch) {
      const next = Object.assign(read(), patch);
      if (!isAllowedBaseUrl(next.baseUrl)) next.baseUrl = DEFAULTS.baseUrl;
      storage.setItem(KEY, JSON.stringify(next));
    }
  };
}

module.exports = { createSettings, isAllowedBaseUrl, DEFAULTS };
