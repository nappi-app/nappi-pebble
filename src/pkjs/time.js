// Timestamp helpers. The API wants ISO 8601 with an offset.

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

// offsetMinutes is east of UTC, i.e. -new Date().getTimezoneOffset().
function toIsoOffset(epochMs, offsetMinutes) {
  const d = new Date(epochMs + offsetMinutes * 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

function toIsoZ(epochMs) {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

function minutesAgo(epochMs, minutes) {
  return epochMs - minutes * 60000;
}

module.exports = { toIsoOffset, toIsoZ, minutesAgo };
