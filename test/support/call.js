// Convenience wrapper over mock.handle for tests: JSON in, JSON out.

const BASE = 'https://api.nappi.app';

function createCaller(mock, token) {
  function call(method, path, options) {
    const opts = options || {};
    const headers = Object.assign({}, token ? { Authorization: 'Bearer ' + token } : {}, opts.headers);
    let body;
    // The real API refuses a POST without a JSON Content-Type, even one with no body.
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    if (opts.body !== undefined) body = JSON.stringify(opts.body);
    const res = mock.handle({ method, url: BASE + path, headers, body });
    let json = null;
    if (res.body) {
      try { json = JSON.parse(res.body); } catch (e) { json = null; }
    }
    return { status: res.status, headers: res.headers, json, body: res.body };
  }
  return {
    get: (path, opts) => call('GET', path, opts),
    post: (path, body, opts) => call('POST', path, Object.assign({ body }, opts)),
  };
}

module.exports = { createCaller, BASE };
