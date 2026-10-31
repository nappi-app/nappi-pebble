// RFC 4122 version 4 UUIDs for idempotency keys. PebbleKit JS has no
// crypto, so Math.random it is; keys only need to be unique, not secret.

function uuidv4(random) {
  const rnd = random || Math.random;
  const hex = (n) => {
    let out = '';
    for (let i = 0; i < n; i++) out += Math.floor(rnd() * 16).toString(16);
    return out;
  };
  const variant = (8 + Math.floor(rnd() * 4)).toString(16);
  return hex(8) + '-' + hex(4) + '-4' + hex(3) + '-' + variant + hex(3) + '-' + hex(12);
}

module.exports = { uuidv4 };
