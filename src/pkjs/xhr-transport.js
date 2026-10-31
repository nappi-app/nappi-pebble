// api.js transport backed by XMLHttpRequest, which PebbleKit JS provides.
// The constructor and timers are injectable so tests can drive them.
//
// Not every XHR reports failure the same way: the emulator's only signals a
// refused connection through readystatechange (readyState 4, status 0), and
// never fires onerror or ontimeout. So this listens to all of them, settles
// exactly once, and has its own watchdog so a request can never hang the
// sync engine no matter what the XHR does.

const TIMEOUT_MS = 20000;
const WATCHDOG_MS = TIMEOUT_MS + 5000;   // the XHR's own timeout gets the first say

function parseHeaders(raw) {
  const headers = {};
  raw.split(/\r?\n/).forEach((line) => {
    const colon = line.indexOf(':');
    if (colon < 1) return;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  });
  return headers;
}

function createXhrTransport(XHR, timers) {
  const Xhr = XHR || XMLHttpRequest;
  const clock = timers || {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle)
  };

  return function transport(req) {
    return new Promise((resolve, reject) => {
      const xhr = new Xhr();
      let settled = false;
      let watchdog = null;

      function settle(fn, value) {
        if (settled) return;
        settled = true;
        if (watchdog !== null) clock.clear(watchdog);
        fn(value);
      }

      function succeed() {
        settle(resolve, {
          status: xhr.status,
          headers: parseHeaders(xhr.getAllResponseHeaders() || ''),
          body: xhr.responseText
        });
      }

      function fail(message) {
        settle(reject, new Error(message));
      }

      xhr.open(req.method, req.url);
      Object.keys(req.headers || {}).forEach((name) => xhr.setRequestHeader(name, req.headers[name]));
      xhr.timeout = TIMEOUT_MS;
      xhr.onload = succeed;
      xhr.onerror = () => fail('Network error');
      xhr.ontimeout = () => fail('Request timed out');
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 0) fail('Network error');
        else succeed();
      };

      watchdog = clock.set(() => {
        fail('Request timed out');
        try {
          xhr.abort();
        } catch (e) {
          // nothing useful to do; the promise is already settled
        }
      }, WATCHDOG_MS);

      xhr.send(req.body === undefined ? null : req.body);
    });
  };
}

module.exports = { createXhrTransport };
