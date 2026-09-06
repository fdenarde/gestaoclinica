// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPsychologyPersistenceScope,
  createPsychologyRemotePatientClient,
  resolvePsychologyRemoteBootstrap,
} from '../src/features/psychology-persistence/index';
import { createClosedPsychologyCapabilities } from '../src/features/psychology-persistence/capabilities';

const scope = createPsychologyPersistenceScope('professional-loading-fixture', 'workspace-loading-fixture');
const NOW = '2026-09-04T12:00:00.000Z';

function payload(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function capabilities() {
  const result = createClosedPsychologyCapabilities();
  result.resources.patients = { available: true, view: true, create: false, edit: false, delete: false, export: false, load: 'bootstrap', source: 'fixture' };
  result.resources.sessions = { available: true, view: true, create: false, edit: false, delete: false, export: false, load: 'bootstrap', source: 'fixture' };
  // Clinical records remain on-demand and must not gate the patient bootstrap.
  result.resources.clinicalNotes = { available: false, view: false, create: false, edit: false, delete: false, export: false, load: 'unavailable', source: 'fixture' };
  return result;
}

function patient() {
  return {
    id: 'patient-loading-fixture',
    workspaceId: scope.workspaceId,
    professionalId: scope.professionalId,
    context: scope.context,
    name: 'Paciente de fixture',
    birthDate: '1990-01-01',
    phone: '27999990000',
    preferredModality: 'online',
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function remoteFixture(fetchImpl: typeof fetch, requestTimeoutMs = 50) {
  return createPsychologyRemotePatientClient({
    scope: { ...scope },
    api: { fetchImpl, getToken: async () => 'synthetic-token', requestTimeoutMs },
  });
}

function successfulFetch(calls: string[], patients = [patient()]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/patients')) return payload({ scope, capabilities: capabilities(), items: patients });
    if (url.endsWith('/sessions')) return payload({ scope, items: [] });
    if (url.endsWith('/settings')) return payload({ scope, settings: null });
    if (url.endsWith('/session-records')) return payload({ scope, items: [] });
    throw new Error(`Unexpected fixture endpoint: ${url}`);
  }) as typeof fetch;
}

test('remote bootstrap ends loading with authenticated patients and does not preload clinical records', async () => {
  const calls: string[] = [];
  const client = remoteFixture(successfulFetch(calls));

  const result = await resolvePsychologyRemoteBootstrap(client.load);

  assert.equal(result.error, '');
  assert.equal(result.store?.patients.length, 1);
  assert.deepEqual(calls.map(url => new URL(url, 'http://fixture').pathname).sort(), [
    '/api/psychology/patients',
    '/api/psychology/sessions',
    '/api/psychology/settings',
  ]);
  assert.equal(client.getCapabilities().resources.clinicalNotes.available, false);
  assert.equal(calls.some(url => url.includes('/session-records')), false);

  await client.loadClinicalRecords();
  assert.equal(calls.some(url => url.includes('/session-records')), true);
});

test('a valid empty remote list is a successful terminal bootstrap state', async () => {
  const client = remoteFixture(successfulFetch([], []));
  const result = await resolvePsychologyRemoteBootstrap(client.load);
  assert.equal(result.error, '');
  assert.deepEqual(result.store?.patients, []);
});

for (const status of [401, 403, 500]) {
  test(`remote bootstrap turns HTTP ${status} into a controlled terminal error`, async () => {
    const client = remoteFixture((async () => payload({ error: { code: `fixture/${status}`, message: `Fixture HTTP ${status}` } }, status)) as typeof fetch);
    const result = await resolvePsychologyRemoteBootstrap(client.load);
    assert.equal(result.store, null);
    assert.match(result.error, new RegExp(`Fixture HTTP ${status}`));
  });
}

test('a rejected remote promise becomes a controlled terminal error', async () => {
  const client = remoteFixture((async () => { throw new Error('Fixture network rejection'); }) as typeof fetch);
  const result = await resolvePsychologyRemoteBootstrap(client.load);
  assert.equal(result.store, null);
  assert.match(result.error, /fonte autenticada da Psicologia/i);
});

test('a pending remote transport times out instead of preserving loading forever', async () => {
  const client = remoteFixture(((input: RequestInfo | URL) => String(input).endsWith('/sessions')
    ? new Promise<Response>(() => {})
    : Promise.resolve(String(input).endsWith('/patients')
      ? payload({ scope, capabilities: capabilities(), items: [] })
      : payload({ scope, settings: null }))) as typeof fetch, 10);
  const result = await resolvePsychologyRemoteBootstrap(client.load);
  assert.equal(result.store, null);
  assert.match(result.error, /demorou além do limite/i);
  assert.match(result.error, /recurso sessions, etapa transport/i);
});

test('a pending response body is covered by the same terminal timeout', async () => {
  const responseWithPendingBody = {
    ok: true,
    status: 200,
    text: () => new Promise<never>(() => {}),
  } as Response;
  const client = remoteFixture((async () => responseWithPendingBody) as typeof fetch, 10);
  const result = await Promise.race([
    resolvePsychologyRemoteBootstrap(client.load),
    new Promise<'watchdog'>(resolve => setTimeout(() => resolve('watchdog'), 80)),
  ]);
  assert.notEqual(result, 'watchdog', 'response.json() remained outside the request timeout');
  assert.equal(result.store, null);
  assert.match(result.error, /demorou além do limite/i);
  assert.match(result.error, /recurso (patients|sessions|settings), etapa response-body/i);
});

test('token and every bootstrap resource complete inside one measured latency budget', async () => {
  const calls: Array<{ resource: string; durationMs: number }> = [];
  let tokenCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const resource = String(input).split('/').pop() || 'unknown';
    const started = performance.now();
    const delay = resource === 'patients' ? 8 : resource === 'sessions' ? 12 : 4;
    await new Promise(resolve => setTimeout(resolve, delay));
    calls.push({ resource, durationMs: performance.now() - started });
    if (resource === 'patients') return payload({ scope, capabilities: capabilities(), items: [patient()] });
    if (resource === 'sessions') return payload({ scope, items: [] });
    return payload({ scope, settings: null });
  }) as typeof fetch;
  const client = createPsychologyRemotePatientClient({
    scope: { ...scope },
    api: {
      requestTimeoutMs: 100,
      fetchImpl,
      getToken: async () => {
        tokenCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 3));
        return 'synthetic-token';
      },
    },
  });

  const started = performance.now();
  const result = await resolvePsychologyRemoteBootstrap(client.load);
  const totalMs = performance.now() - started;

  assert.equal(result.error, '');
  assert.equal(result.store?.patients.length, 1);
  assert.equal(tokenCalls, 3);
  assert.deepEqual(calls.map(call => call.resource).sort(), ['patients', 'sessions', 'settings']);
  assert.ok(calls.every(call => call.durationMs < 100));
  assert.ok(totalMs < 100);
});
