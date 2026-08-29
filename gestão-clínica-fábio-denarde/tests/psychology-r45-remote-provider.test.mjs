import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyRemotePatientClient } from '../src/features/psychology-persistence/remotePatientClient.ts';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope.ts';
import { isPsychologyRemoteClientEnabled } from '../src/features/psychology-persistence/remoteCanary.ts';

const psychologyApiSource = await readFile(new URL('../api/psychology.js', import.meta.url), 'utf8');
const pilotSource = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const remoteClientSource = await readFile(new URL('../src/features/psychology-persistence/remotePatientClient.ts', import.meta.url), 'utf8');

const scope = createPsychologyPersistenceScope('synthetic-professional', 'synthetic-workspace');
const resolvedScope = createPsychologyPersistenceScope('resolved-professional', 'resolved-workspace');
const patient = {
  id: 'synthetic-patient',
  name: 'Paciente Sintético',
  phone: '27999990000',
  preferredModality: 'presencial',
  active: true,
  ...resolvedScope,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function responseRecorder() {
  const response = {
    statusCode: 200,
    payload: undefined,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    end() {
      return this;
    },
  };
  return response;
}

function fakeSnapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function fakePsychologyDb(records) {
  return {
    collection(path) {
      const aggregate = path.split('/').at(-1);
      const values = records[aggregate] || [];
      return {
        async get() {
          return { docs: values.map(value => fakeSnapshot(value.id, value)) };
        },
        doc(id) {
          return {
            async get() {
              return fakeSnapshot(id, values.find(value => value.id === id));
            },
          };
        },
      };
    },
  };
}

test('R45 — Settings de leitura usa escopo de agenda ou gestão e mutação permanece administrativa', () => {
  assert.match(
    psychologyApiSource,
    /resource === 'settings'[\s\S]*?req\.method === 'GET'[\s\S]*?requiredAnyPermissions: \['agenda\.own\.view', 'settings\.clinic\.manage'\]/,
  );
  assert.match(
    psychologyApiSource,
    /resource === 'settings'[\s\S]*?req\.method === 'PUT'[\s\S]*?requiredPermissions: \['settings\.clinic\.manage'\]/,
  );
});

test('R45 — os três agregados autenticados retornam 200 com escopo profissional', async () => {
  const runtimeScope = {
    authUid: 'synthetic-auth',
    workspaceId: 'resolved-workspace',
    tenantId: 'resolved-workspace',
    professionalId: 'resolved-professional',
    context: 'PSICOLOGIA',
    role: 'professional',
    permissions: {
      'patients.list': true,
      'agenda.own.view': true,
      'settings.clinic.view': true,
    },
    bindingMode: 'LEGACY_ONE_TO_ONE',
  };
  const db = fakePsychologyDb({
    patients: [{ id: 'synthetic-patient', ...runtimeScope, name: 'Paciente Sintético', phone: '27999990000', preferredModality: 'presencial', active: true }],
    sessions: [],
    settings: [{ id: 'settings', ...runtimeScope, settings: { professionalProfile: { displayName: 'Profissional Sintético' } } }],
  });
  const requiredPermissions = [];
  const requiredAnyPermissions = [];
  const handler = createPsychologyApiHandler({
    getDb: () => db,
    resolveAccess: async (_req, options) => {
      if (options.requiredPermissions) requiredPermissions.push(options.requiredPermissions[0]);
      if (options.requiredAnyPermissions) requiredAnyPermissions.push(options.requiredAnyPermissions);
      return runtimeScope;
    },
    auditLogger: () => {},
  });

  const responses = [];
  for (const resource of ['patients', 'sessions', 'settings']) {
    const response = responseRecorder();
    await handler({ method: 'GET', url: `/api/psychology/${resource}`, headers: { authorization: 'Bearer synthetic-token' } }, response);
    responses.push(response);
  }

  assert.deepEqual(responses.map(response => response.statusCode), [200, 200, 200]);
  assert.equal(responses[0].payload.items.length > 0, true);
  assert.deepEqual(requiredPermissions, ['patients.list', 'agenda.own.view']);
  assert.deepEqual(requiredAnyPermissions, [['agenda.own.view', 'settings.clinic.manage']]);
});

test('R45 — authenticated remote carrega patients, sessions e settings separadamente com dados não vazios', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url), 'http://localhost').pathname;
    calls.push({ path, method: init.method || 'GET', authorization: Boolean(init.headers?.Authorization) });
    if (path === '/api/psychology/patients' && (init.method || 'GET') === 'GET') return jsonResponse({ scope: resolvedScope, items: [patient] });
    if (path === '/api/psychology/sessions' && (init.method || 'GET') === 'GET') return jsonResponse({ scope: resolvedScope, items: [] });
    if (path === '/api/psychology/personal-appointments' && (init.method || 'GET') === 'GET') return jsonResponse({ scope: resolvedScope, items: [] });
    if (['/api/psychology/charges', '/api/psychology/payments', '/api/psychology/expenses'].includes(path) && (init.method || 'GET') === 'GET') return jsonResponse({ scope: resolvedScope, items: [] });
    if (path === '/api/psychology/settings' && (init.method || 'GET') === 'GET') {
      return jsonResponse({
        scope: resolvedScope,
        settings: {
          professionalProfile: { displayName: 'Profissional Sintético' },
          services: [{ id: 'service-1', name: 'Serviço Sintético', active: true, defaultDurationMinutes: 50 }],
          locations: [{ id: 'location-1', displayName: 'Local Sintético', active: true, type: 'PRIMARY_OFFICE' }],
        },
      });
    }
    if (path === '/api/psychology/patients' && init.method === 'POST') {
      return jsonResponse({ scope: resolvedScope, patient: { ...patient, name: 'Paciente Sintético Atualizado' } });
    }
    throw new Error(`Rota sintética inesperada: ${init.method || 'GET'} ${path}`);
  };

  const client = createPsychologyRemotePatientClient({
    scope,
    api: { fetchImpl, getToken: async () => 'synthetic-token' },
  });
  const store = await client.load();

  assert.equal(isPsychologyRemoteClientEnabled('authenticated-remote'), true);
  assert.equal(isPsychologyRemoteClientEnabled('pilot-local'), false);
  assert.equal(store.patients.length > 0, true);
  assert.equal(store.patients[0].id, patient.id);
  assert.equal(client.scope.professionalId, resolvedScope.professionalId);
  assert.equal(client.scope.workspaceId, resolvedScope.workspaceId);
  assert.deepEqual(
    calls.map(call => call.path).sort(),
    ['/api/psychology/charges', '/api/psychology/expenses', '/api/psychology/patients', '/api/psychology/payments', '/api/psychology/personal-appointments', '/api/psychology/sessions', '/api/psychology/settings'],
  );
  assert.ok(calls.every(call => call.method === 'GET' && call.authorization));

  const updated = await client.updatePatient({ ...patient, name: 'Paciente Sintético Atualizado' });
  assert.equal(updated.name, 'Paciente Sintético Atualizado');
  assert.equal(calls.at(-1).path, '/api/psychology/patients');
  assert.equal(calls.at(-1).method, 'POST');
});

test('R45 — UI diferencia carregamento/erro de zero real e bloqueia fallback local durante falha', () => {
  assert.match(pilotSource, /Carregando dados da Psicologia\.\.\./);
  assert.match(pilotSource, /Não foi possível carregar os dados da Psicologia\./);
  assert.match(pilotSource, /remoteConfiguration\.enabled && \(remoteLoading \|\| remoteError\)/);
  assert.match(pilotSource, /Nenhum dado local será usado como fallback/);
  assert.match(pilotSource, /if \(!remoteClient \|\| remoteLoading \|\| remoteError\)/);
  assert.match(pilotSource, /remoteClient\.updatePatient\(nextPatient\)/);
  assert.doesNotMatch(pilotSource, /remoteError\s*\?\s*[^:]+\s*:\s*localStore/);
  assert.match(remoteClientSource, /const \[patients, sessions, personalAppointments, charges, payments, expenses, settings\] = await Promise\.all/);
});
