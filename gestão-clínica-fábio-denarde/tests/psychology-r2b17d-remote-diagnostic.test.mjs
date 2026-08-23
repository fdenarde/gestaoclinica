import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = { location: { origin: 'http://localhost' } };

const { default: diagnosticHandler } = await import('../api/psychology-delete-diagnostic.js');
const { logPsychologyDeleteDiagnostic } = await import('../src/features/psychology-persistence/repositories/api.ts');

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function diagnosticRequest(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function baseEvent(stage, correlationId) {
  return {
    DELETE_PATIENT_STAGE: stage,
    correlationId,
    method: 'DELETE',
    routeTemplate: '/api/psychology/patients/:id',
  };
}

test('R2B17D transports all five remote capture sequences through the sanitized server handler', async () => {
  const clientEvents = [];
  const serverEvents = [];
  const requests = [];
  const originalInfo = console.info;
  let insideServerHandler = false;
  console.info = (prefix, event) => {
    if (prefix !== '[PSYCHOLOGY DELETE DIAGNOSTIC]') return;
    (insideServerHandler ? serverEvents : clientEvents).push(event);
  };
  globalThis.fetch = (url, init = {}) => {
    requests.push({ url: String(url), init });
    const result = responseRecorder();
    insideServerHandler = true;
    try {
      diagnosticHandler({ ...diagnosticRequest(JSON.parse(init.body)), headers: init.headers }, result);
    } finally {
      insideServerHandler = false;
    }
    return Promise.resolve(new Response(null, { status: result.statusCode }));
  };

  const scenarios = [
    ['success', ['confirm_start', 'before_repository', 'before_token', 'token_ok', 'before_fetch', 'fetch_response']],
    ['auth-null', ['confirm_start', 'before_repository', 'before_token', 'token_error', 'catch']],
    ['token-error', ['confirm_start', 'before_repository', 'before_token', 'token_error', 'catch']],
    ['repository-error', ['confirm_start', 'before_repository', 'catch']],
    ['fetch-error', ['confirm_start', 'before_repository', 'before_token', 'token_ok', 'before_fetch', 'fetch_response', 'catch']],
  ];
  try {
    for (const [scenario, stages] of scenarios) {
      const correlationId = `r2b17d-${scenario}`;
      for (const stage of stages) {
        logPsychologyDeleteDiagnostic({
          ...baseEvent(stage, correlationId),
          ...(scenario === 'auth-null' && stage === 'before_token' ? { authUserPresent: 'NO' } : {}),
          ...(stage === 'before_fetch' ? { authorizationPresent: 'YES' } : {}),
          ...(stage === 'fetch_response' ? { httpStatus: scenario === 'fetch-error' ? 500 : 200 } : {}),
          ...(stage === 'token_error' ? { errorName: 'ApiPsychologyError', errorCode: 'psychology/missing-auth-token' } : {}),
        });
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally {
    console.info = originalInfo;
  }

  assert.equal(requests.length, clientEvents.length);
  assert.equal(serverEvents.length, clientEvents.length);
  assert.deepEqual(serverEvents.map(event => event.DELETE_PATIENT_STAGE), clientEvents.map(event => event.DELETE_PATIENT_STAGE));
  for (const { url, init } of requests) {
    assert.equal(url, '/api/psychology-delete-diagnostic');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.keepalive, true);
    assert.equal('Authorization' in init.headers, false);
    const body = JSON.parse(init.body);
    for (const key of ['token', 'email', 'phone', 'cookie', 'patientId', 'payload', 'name', 'uid']) assert.equal(key in body, false);
  }
  for (const event of serverEvents) {
    for (const key of ['token', 'email', 'phone', 'cookie', 'patientId', 'payload', 'name', 'uid']) assert.equal(key in event, false);
  }
});

test('R2B17D rejects sensitive or unrecognized diagnostic fields without logging them', async () => {
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args);
  const result = responseRecorder();
  try {
    await diagnosticHandler(diagnosticRequest({
      ...baseEvent('catch', 'r2b17d-invalid'),
      token: 'must-not-be-logged',
      patientId: 'must-not-be-logged',
    }), result);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(result.statusCode, 400);
  assert.equal(logs.length, 0);
});
