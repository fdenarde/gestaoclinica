// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPsychologyPersistenceScope,
  createPsychologyRemotePatientClient,
  resolvePsychologyRemoteBootstrap,
} from '../src/features/psychology-persistence/index';
import { createClosedPsychologyCapabilities } from '../src/features/psychology-persistence/capabilities';

const scope = createPsychologyPersistenceScope('professional-response-body-fixture', 'workspace-response-body-fixture');
const NOW = '2026-09-05T12:00:00.000Z';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function capabilities() {
  const value = createClosedPsychologyCapabilities();
  value.resources.patients = { available: true, view: true, create: false, edit: false, delete: false, export: false, load: 'bootstrap', source: 'fixture' };
  value.resources.sessions = { available: true, view: true, create: false, edit: false, delete: false, export: false, load: 'bootstrap', source: 'fixture' };
  return value;
}

function patient(index: number) {
  return {
    id: `patient-response-body-${index}`,
    workspaceId: scope.workspaceId,
    professionalId: scope.professionalId,
    context: scope.context,
    name: `Paciente sintético ${index}`,
    birthDate: '1990-01-01',
    phone: '27999990000',
    email: `fixture-${index}@synthetic.test`,
    preferredModality: index % 2 ? 'online' : 'presencial',
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function bodyFor(resource: string, patients = [patient(1)]): string {
  if (resource === 'patients') return JSON.stringify({ scope, capabilities: capabilities(), items: patients });
  if (resource === 'sessions') return JSON.stringify({ scope, items: [] });
  return JSON.stringify({ scope, settings: null });
}

test('response-body recebe orçamento próprio quando o transporte consumiu quase todo o limite', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const resource = String(input).split('/').pop() || 'unknown';
    const body = bodyFor(resource);
    await wait(55);
    return {
      ok: true,
      status: 200,
      text: async () => { await wait(45); return body; },
      json: async () => { await wait(45); return JSON.parse(body); },
    } as Response;
  }) as typeof fetch;
  const client = createPsychologyRemotePatientClient({
    scope: { ...scope },
    api: { fetchImpl, getToken: async () => 'synthetic-token', requestTimeoutMs: 80 },
  });

  const result = await resolvePsychologyRemoteBootstrap(client.load);

  assert.equal(result.error, '');
  assert.equal(result.store?.patients.length, 1);
});

test('fresh bootstrap consome integralmente bodies grandes em rodadas subsequentes', async () => {
  const patients = Array.from({ length: 384 }, (_, index) => patient(index + 1));
  let completedBodies = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const resource = String(input).split('/').pop() || 'unknown';
    const encoded = new TextEncoder().encode(bodyFor(resource, patients));
    const splitAt = Math.max(1, Math.floor(encoded.length / 2));
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        await wait(2);
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
        completedBodies += 1;
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const client = createPsychologyRemotePatientClient({
    scope: { ...scope },
    api: { fetchImpl, getToken: async () => 'synthetic-token', requestTimeoutMs: 500 },
  });

  const first = await resolvePsychologyRemoteBootstrap(client.load);
  const second = await resolvePsychologyRemoteBootstrap(client.load);

  assert.equal(first.error, '');
  assert.equal(second.error, '');
  assert.equal(first.store?.patients.length, 384);
  assert.equal(second.store?.patients.length, 384);
  assert.equal(completedBodies, 6);
});
