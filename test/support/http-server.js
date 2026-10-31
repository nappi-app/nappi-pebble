// Serves a mock-nappi instance over real HTTP, for the emulator and for tests
// that want the genuine wire format.

const http = require('node:http');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key, If-None-Match',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'ETag, Retry-After',
};

function listen(mock, port, host) {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const out = mock.handle({
        method: req.method,
        url: 'http://' + req.headers.host + req.url,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined,
      });
      res.writeHead(out.status, Object.assign({}, CORS, out.headers));
      res.end(out.body);
    });
  });
  return new Promise((resolve) => server.listen(port, host || '127.0.0.1', () => resolve(server)));
}

module.exports = { listen };
