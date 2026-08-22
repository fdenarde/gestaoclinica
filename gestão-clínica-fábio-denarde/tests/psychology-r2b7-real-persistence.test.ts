import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { readRealPsychologyStore, REAL_PSYCHOLOGY_TARGET } from '../src/features/psychology-persistence/realRead';

const scope = {
  workspaceId: REAL_PSYCHOLOGY_TARGET.workspaceId,
  tenantId: REAL_PSYCHOLOGY_TARGET.tenantId,
  professionalId: REAL_PSYCHOLOGY_TARGET.professionalId,
  context: REAL_PSYCHOLOGY_TARGET.context,
  bindingMode: 'EXPLICIT_BINDING',
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetchFactory(overrides: Record<string, unknown[]> = {}) {
  const calls: Array<{ path: string; method: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const path = url.slice(url.indexOf('/api/psychology') + '/api/psychology'.length) || '/';
    calls.push({ path, method: init?.method || 'GET' });
    const resource = path.split('/').filter(Boolean)[0] || '';
    return response({ scope, items: overrides[resource] || [] });
  };
  return { fetchImpl, calls };
}

function fixtureData() {
  return {
    patients: [{
      id: 'patient-group-c', ...scope, name: 'Grupo C Sintético', dateOfBirth: '', birthDate: '', phone: '550000000003',
      preferredModality: 'presencial', active: false, migrationReview: { required: true, reason: 'NO_APPOINTMENTS_FOUND' },
      createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    }],
    sessions: [
      { id: 'session-scheduled', ...scope, patientId: 'patient-group-c', date: '2025-01-02', time: '09:00', durationMinutes: 50, modality: 'presencial', status: 'agendada', canonicalStatus: 'SCHEDULED', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' },
      { id: 'session-cancelled', ...scope, patientId: 'patient-group-c', date: '2025-01-03', time: '10:00', durationMinutes: 50, modality: 'presencial', status: 'cancelada', canonicalStatus: 'CANCELLED', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' },
    ],
    services: [{ id: 'service-real', ...scope, name: 'Serviço real', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', active: true, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    locations: [{ id: 'location-real', ...scope, type: 'PRIMARY_OFFICE', displayName: 'Local real', fullAddress: '', city: 'Cariacica', state: 'ES', googleMapsUrl: '', active: true, isPrimary: true, color: '#7C3AED', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
  };
}

test('R2B7 lê Patients, Sessions, Services e Locations do adapter real com escopo completo', async () => {
  const { fetchImpl, calls } = fakeFetchFactory(fixtureData());
  const result = await readRealPsychologyStore({ fetchImpl, getToken: async () => 'synthetic-test-token' });

  assert.deepEqual(result.persistenceScope, {
    workspaceId: REAL_PSYCHOLOGY_TARGET.workspaceId,
    tenantId: REAL_PSYCHOLOGY_TARGET.tenantId,
    professionalId: REAL_PSYCHOLOGY_TARGET.professionalId,
    context: 'PSICOLOGIA',
  });
  assert.deepEqual(result.counts, { patients: 1, sessions: 2, services: 1, locations: 1 });
  assert.equal(result.store.patients[0]?.migrationReview?.reason, 'NO_APPOINTMENTS_FOUND');
  assert.deepEqual(result.store.sessions.map(session => session.status), ['agendada', 'cancelada']);
  assert.equal(result.store.services[0]?.name, 'Serviço real');
  assert.equal(result.store.locations[0]?.displayName, 'Local real');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'GET', 'GET']);
  assert.deepEqual(calls.map(call => call.path), ['/patients', '/sessions', '/services', '/locations']);
});

test('R2B7 não usa defaults locais quando o Firestore real retorna vazio', async () => {
  const { fetchImpl } = fakeFetchFactory({ patients: [], sessions: [], services: [], locations: [] });
  const result = await readRealPsychologyStore({ fetchImpl, getToken: async () => 'synthetic-test-token' });

  assert.deepEqual(result.counts, { patients: 0, sessions: 0, services: 0, locations: 0 });
  assert.equal(result.store.patients.length, 0);
  assert.equal(result.store.sessions.length, 0);
  assert.equal(result.store.services.length, 0);
  assert.equal(result.store.locations.length, 0);
});

test('R2B7 bloqueia resposta de API fora do workspace/profissional/contexto selecionado', async () => {
  const { fetchImpl } = fakeFetchFactory();
  const mismatchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await fetchImpl(input, init);
    return response({ scope: { ...scope, professionalId: 'professional-outro' }, items: [] });
  };
  await assert.rejects(
    () => readRealPsychologyStore({ fetchImpl: mismatchedFetch, getToken: async () => 'synthetic-test-token' }),
    /escopo Psicologia selecionado/,
  );
});

test('R2B7 mantém a rota pública e o fallback local fora do caminho real', () => {
  const pilot = fs.readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  const api = fs.readFileSync('api/psychology.js', 'utf8');
  const realRead = fs.readFileSync('src/features/psychology-persistence/realRead.ts', 'utf8');

  assert.match(pilot, /VITE_PSYCHOLOGY_PERSISTENCE_MODE/);
  assert.match(pilot, /readRealPsychologyStore/);
  assert.match(pilot, /A tela não usará dados locais como fallback/);
  assert.match(pilot, /!isLocalPersistence \|\| typeof window === 'undefined'/);
  assert.match(api, /resource === 'services' \|\| resource === 'locations'/);
  assert.match(api, /requiredPermissions: \['settings\.clinic\.manage'\]/);
  for (const expected of Object.values(REAL_PSYCHOLOGY_TARGET)) assert.match(realRead, new RegExp(String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(realRead, /localStorage|setItem\(/);
});
