// nappi API client. See https://nappi.app/app/api/reference.
//
// `transport(req) -> Promise<{ status, headers, body }>` does the actual HTTP
// (XHR on the phone, the mock in tests). `body` is the raw response text.

class ApiError extends Error {
  constructor(code, message, status, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter === undefined ? null : retryAfter;
  }
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

// Retry-After is delay-seconds or an HTTP-date (RFC 9110). undefined when absent or unreadable.
function parseRetryAfter(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false };
  }
}

function createClient(options) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const token = options.token;
  const transport = options.transport;

  // Resolves to { status, headers, value } for 2xx (and 304 when allowed).
  function request(method, path, opts) {
    const o = opts || {};
    if (!token) {
      return Promise.reject(new ApiError('no_token', 'No API token configured', 0));
    }
    const req = {
      method,
      url: baseUrl + path,
      headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/json' }, o.headers),
    };
    // nappi answers 415 to a POST without a JSON Content-Type, even where the body is optional
    // (a timer stop with no options), so an absent body goes out as {}.
    if (o.body !== undefined || method === 'POST') {
      req.headers['Content-Type'] = 'application/json';
      req.body = JSON.stringify(o.body === undefined ? {} : o.body);
    }
    return transport(req).then(
      (res) => parseResponse(res, o.allowNotModified),
      (err) => { throw new ApiError('network', (err && err.message) || 'Network error', 0); }
    );
  }

  function parseResponse(res, allowNotModified) {
    if (res.status === 304 && allowNotModified) {
      return { status: 304, headers: res.headers, value: null };
    }
    const parsed = parseJson(res.body);
    if (res.status >= 200 && res.status < 300) {
      if (!parsed.ok) throw new ApiError('bad_response', 'Response was not valid JSON', res.status);
      return { status: res.status, headers: res.headers, value: parsed.value };
    }
    const retryAfter = parseRetryAfter(header(res.headers, 'retry-after'));
    const detail = parsed.ok && parsed.value && parsed.value.error;
    if (!detail || typeof detail.code !== 'string') {
      throw new ApiError('bad_response', 'HTTP ' + res.status, res.status, retryAfter);
    }
    throw new ApiError(detail.code, detail.message, res.status, retryAfter);
  }

  const baby = (id) => '/v1/babies/' + encodeURIComponent(id);
  const value = (res) => res.value;

  return {
    listBabies() {
      return request('GET', '/v1/babies').then(value);
    },

    // -> { notModified, data, etag }. Pass the previous etag to get a cheap 304.
    latest(babyId, opts) {
      const o = opts || {};
      const query = o.types && o.types.length ? '?types=' + o.types.join(',') : '';
      const headers = o.etag ? { 'If-None-Match': o.etag } : undefined;
      return request('GET', baby(babyId) + '/entries/latest' + query, { headers, allowNotModified: true }).then((res) => (
        res.status === 304
          ? { notModified: true, data: null, etag: o.etag }
          : { notModified: false, data: res.value, etag: header(res.headers, 'etag') }
      ));
    },

    timers(babyId) {
      return request('GET', baby(babyId) + '/timers').then(value);
    },

    logEntry(babyId, body, idempotencyKey) {
      return request('POST', baby(babyId) + '/entries', {
        body,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
      }).then(value);
    },

    startTimer(babyId, type, body) {
      return request('POST', baby(babyId) + '/timers/' + type + '/start', { body }).then(value);
    },

    stopTimer(babyId, type, body) {
      return request('POST', baby(babyId) + '/timers/' + type + '/stop', { body }).then(value);
    }
  };
}

module.exports = { createClient, ApiError, header };
