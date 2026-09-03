import test from 'node:test';
import assert from 'node:assert/strict';

import accessHandler from '../api/access.js';
import psychologyHandler from '../api/psychology.js';
import {
  DOCTORALIA_STAGING_ALLOWED_READ_PATHS,
  STAGING_READ_ONLY_UPSTREAM_ORIGIN,
  handleDoctoraliaStagingReadOnlyGateway,
  isDoctoraliaStagingHostname,
} from '../api/_lib/stagingReadOnlyGateway.js';

const STAGING_HOST = 'gestaoclinica-psicologia-staging.vercel.app';
const PRODUCTION_HOST = 'gestaoclinica-solucoes.vercel.app';

function makeRequest({ host = STAGING_HOST, method = 'GET', url = '/api/access', headers = {}, query } = {}) {
  return {
    host,
    method,
    url,
    headers: { host, ...headers },
    ...(query ? { query } : {}),
  };
}

function makeResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end(body = '') {
      this.body = body;
      return this;
    },
  };
  return response;
}

function makeUpstreamResponse(status = 200, body = '{}', headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    status,
    headers: { get: name => normalizedHeaders[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

function makeFetch(response = makeUpstreamResponse()) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  return { calls, fetchImpl };
}

async function runGateway(requestOptions, fetchImpl) {
  const res = makeResponse();
  const result = await handleDoctoraliaStagingReadOnlyGateway(
    makeRequest(requestOptions),
    res,
    { fetchImpl },
  );
  return { handled: result !== false, res };
}

test('recognizes only the exact staging hostnames', () => {
  assert.equal(isDoctoraliaStagingHostname(makeRequest()), true);
  assert.equal(isDoctoraliaStagingHostname(makeRequest({ host: `${STAGING_HOST}:443` })), true);
  assert.equal(isDoctoraliaStagingHostname(makeRequest({ host: PRODUCTION_HOST })), false);
  assert.equal(isDoctoraliaStagingHostname(makeRequest({ host: 'evil.example' })), false);
});

test('forwards the allowed access GET with only the approved request headers', async () => {
  const { calls, fetchImpl } = makeFetch(makeUpstreamResponse(401, '{"error":"unauthenticated"}', { 'content-type': 'application/json' }));
  const { handled, res } = await runGateway({
    url: '/api/access?activeRole=professional',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer synthetic-token',
      cookie: 'synthetic-cookie',
      origin: 'https://evil.example',
      referer: 'https://evil.example/source',
    },
  }, fetchImpl);

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${STAGING_READ_ONLY_UPSTREAM_ORIGIN}/api/access?activeRole=professional`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.body, undefined);
  assert.deepEqual(calls[0].options.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer synthetic-token',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, '{"error":"unauthenticated"}');
});

test('forwards each of the ten allowlisted psychology reads to the fixed upstream', async () => {
  for (const resource of DOCTORALIA_STAGING_ALLOWED_READ_PATHS) {
    const { calls, fetchImpl } = makeFetch();
    const { handled, res } = await runGateway({ url: `/api/psychology/${resource}` }, fetchImpl);
    assert.equal(handled, true, resource);
    assert.equal(res.statusCode, 200, resource);
    assert.equal(calls.length, 1, resource);
    assert.equal(calls[0].url, `${STAGING_READ_ONLY_UPSTREAM_ORIGIN}/api/psychology/${resource}`, resource);
  }

  const { calls, fetchImpl } = makeFetch();
  await runGateway({ url: '/api/psychology?path=patients' }, fetchImpl);
  assert.equal(calls[0].url, `${STAGING_READ_ONLY_UPSTREAM_ORIGIN}/api/psychology/patients`);

  const routeMetadataFetch = makeFetch();
  await runGateway({
    url: '/api/psychology/patients?path=sessions&upstream=https%3A%2F%2Fevil.example',
  }, routeMetadataFetch.fetchImpl);
  assert.equal(routeMetadataFetch.calls[0].url, `${STAGING_READ_ONLY_UPSTREAM_ORIGIN}/api/psychology/patients`);
});

test('rejects non-allowlisted paths, IDs, duplicate/query proxy controls, and never calls upstream', async () => {
  for (const url of [
    '/api/psychology/not-allowlisted',
    '/api/psychology/patients/synthetic-id',
    '/api/psychology?path=not-allowlisted',
    '/api/psychology?path=patients&upstream=https%3A%2F%2Fevil.example',
    '/api/psychology?path=patients&resource=patients',
    '/api/psychology?path=patients&id=undefined',
  ]) {
    const { calls, fetchImpl } = makeFetch();
    const { res } = await runGateway({ url }, fetchImpl);
    assert.equal(res.statusCode, 403, url);
    assert.match(res.body, /STAGING_READ_ONLY/);
    assert.equal(calls.length, 0, url);
  }

  const { calls, fetchImpl } = makeFetch();
  const { handled, res } = await runGateway({ host: PRODUCTION_HOST, url: '/api/psychology/patients' }, fetchImpl);
  assert.equal(handled, false);
  assert.equal(res.body, undefined);
  assert.equal(calls.length, 0);
});

test('blocks every write method locally without reaching the upstream', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of ['/api/access', '/api/psychology/patients']) {
      const { calls, fetchImpl } = makeFetch();
      const { handled, res } = await runGateway({ method, url }, fetchImpl);
      assert.equal(handled, true, `${method} ${url}`);
      assert.equal(res.statusCode, 405, `${method} ${url}`);
      assert.match(res.body, /STAGING_READ_ONLY/, `${method} ${url}`);
      assert.equal(calls.length, 0, `${method} ${url}`);
    }
  }
});

test('handles OPTIONS locally and rejects unsupported access queries', async () => {
  const optionsFetch = makeFetch();
  const options = await runGateway({ method: 'OPTIONS', url: '/api/psychology/patients' }, optionsFetch.fetchImpl);
  assert.equal(options.handled, true);
  assert.equal(options.res.statusCode, 204);
  assert.equal(options.res.headers.Allow, 'GET, OPTIONS');
  assert.equal(optionsFetch.calls.length, 0);

  const queryFetch = makeFetch();
  const query = await runGateway({ url: '/api/access?mode=profile' }, queryFetch.fetchImpl);
  assert.equal(query.res.statusCode, 403);
  assert.equal(queryFetch.calls.length, 0);
});

test('does not forward cookies, origin, or referer and does not return upstream Set-Cookie', async () => {
  const { calls, fetchImpl } = makeFetch(makeUpstreamResponse(200, '{"ok":true}', {
    'content-type': 'application/json',
    'set-cookie': 'sensitive=not-forwarded',
  }));
  const { res } = await runGateway({
    url: '/api/psychology/patients',
    headers: {
      cookie: 'sensitive=client-cookie',
      origin: 'https://evil.example',
      referer: 'https://evil.example/source',
    },
  }, fetchImpl);
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[0].options.headers.Origin, undefined);
  assert.equal(calls[0].options.headers.Referer, undefined);
  assert.equal(res.headers['Set-Cookie'], undefined);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('fails safely on upstream redirects and timeouts', async () => {
  const redirect = await runGateway({ url: '/api/access' }, makeFetch(makeUpstreamResponse(302, '', { location: 'https://evil.example' })).fetchImpl);
  assert.equal(redirect.res.statusCode, 502);
  assert.match(redirect.res.body, /STAGING_UPSTREAM_REDIRECT_BLOCKED/);

  const timeoutFetch = async () => {
    const error = new Error('synthetic timeout');
    error.name = 'AbortError';
    throw error;
  };
  const timeout = await runGateway({ url: '/api/access' }, timeoutFetch);
  assert.equal(timeout.res.statusCode, 504);
  assert.match(timeout.res.body, /STAGING_UPSTREAM_TIMEOUT/);
});

test('does not log upstream response bodies', async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const calls = [];
  console.log = (...args) => calls.push(['log', args]);
  console.warn = (...args) => calls.push(['warn', args]);
  console.error = (...args) => calls.push(['error', args]);
  try {
    await runGateway({ url: '/api/psychology/patients' }, makeFetch(makeUpstreamResponse(200, '{"synthetic":"body-not-logged"}')).fetchImpl);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.deepEqual(calls, []);
});

test('intercepts staging before Firebase Admin initialization in both API handlers', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return makeUpstreamResponse(401, '{"error":"missing-auth-token"}', { 'content-type': 'application/json' });
  };
  try {
    const accessRes = makeResponse();
    await accessHandler(makeRequest({ url: '/api/access' }), accessRes);
    assert.equal(accessRes.statusCode, 401);

    const psychologyRes = makeResponse();
    await psychologyHandler(makeRequest({ url: '/api/psychology/patients' }), psychologyRes);
    assert.equal(psychologyRes.statusCode, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 2);
});
