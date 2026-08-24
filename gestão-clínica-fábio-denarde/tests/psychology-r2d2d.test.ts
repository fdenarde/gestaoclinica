// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { resolvePsychologyAccessContext } from '../api/_lib/psychologyAccess.js';
import { createPsychologyServerRepository } from '../api/_lib/psychologyRepository.js';
import { buildPsychologyAuditEvent } from '../api/_lib/psychologyObservability.js';
import {
  createMemoryStorage,
  createPsychologyPersistenceProvider,
  createPsychologyPersistenceScope,
  isPsychologyRemoteCanaryEnabled,
} from '../src/features/psychology-persistence/index';
import { createApiPsychologyRepositories } from '../src/features/psychology-persistence/repositories/api';

class FakeDocument {
  constructor(store, path, id) {
    this.store = store;
    this.path = path;
    this.id = id;
  }

  async get() {
    const value = this.store.get(`${this.path}/${this.id}`);
    return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined };
  }

  async set(value) {
    this.store.set(`${this.path}/${this.id}`, structuredClone(value));
  }

  async delete() {
    this.store.delete(`${this.path}/${this.id}`);
  }
}

class FakeQuery {
  constructor(store, path, field, value) {
    this.store = store;
    this.path = path;
    this.field = field;
    this.value = value;
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) }))
      .filter(documentSnapshot => documentSnapshot.data()?.[this.field] === this.value);
    return { docs };
  }
}

class FakeCollection {
  constructor(store, path) {
    this.store = store;
    this.path = path;
  }

  doc(id) { return new FakeDocument(this.store, this.path, id); }
  where(field, _operator, value) { return new FakeQuery(this.store, this.path, field, value); }
  async get() {
    const prefix = `${this.path}/`;
    return {
      docs: [...this.store.entries()]
        .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
        .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })),
    };
  }
}

class FakeDb {
  constructor(seed = []) { this.store = new Map(seed.map(([path, value]) => [path, structuredClone(value)])); }
  collection(path) { return new FakeCollection(this.store, path); }
  value(path) { return this.store.get(path); }
}

const NOW = '2026-08-14T18:00:00.000Z';
const WORKSPACE = 'tenant-synthetic-a';
const scopeA = { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-a', context: 'PSICOLOGIA', role: 'professional', permissions: ['patients.list', 'patients.create', 'patients.delete', 'settings.clinic.manage', 'agenda.own.view', 'agenda.edit'], authUid: 'auth-a' };
const scopeB = { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-b', context: 'PSICOLOGIA', role: 'professional', permissions: ['patients.list', 'patients.create', 'patients.delete', 'settings.clinic.manage', 'agenda.own.view', 'agenda.edit'], authUid: 'auth-b' };
const baseByToken = {
  a: { userId: 'auth-a', workspaceId: WORKSPACE, role: 'professional', actorName: 'Profissional A', permissions: { 'patients.list': true, 'patients.create': true, 'patients.delete': true, 'settings.clinic.manage': true, 'agenda.own.view': true, 'agenda.edit': true } },
  b: { userId: 'auth-b', workspaceId: WORKSPACE, role: 'professional', actorName: 'Profissional B', permissions: { 'patients.list': true, 'patients.create': true, 'patients.delete': true, 'settings.clinic.manage': true, 'agenda.own.view': true, 'agenda.edit': true } },
  finance: { userId: 'auth-finance', workspaceId: WORKSPACE, role: 'admin', actorName: 'Financeiro', permissions: { 'finance.manage': true } },
  clinical: { userId: 'auth-clinical', workspaceId: WORKSPACE, role: 'professional', actorName: 'Clínico', permissions: { 'patients.clinical_notes.view': true, 'patients.list': true } },
  limited: { userId: 'auth-limited', workspaceId: WORKSPACE, role: 'professional', actorName: 'Limitado', permissions: { 'agenda.own.view': true } },
  neuro: { userId: 'auth-neuro', workspaceId: WORKSPACE, role: 'professional', actorName: 'Neuro', permissions: { 'patients.list': true } },
};

function patient(scope, id, name) {
  return { id, ...scope, name, birthDate: '1990-01-01', phone: '27999990000', email: `${id}@synthetic.test`, preferredModality: 'online', administrativeNote: 'fixture', active: true, createdAt: NOW, updatedAt: NOW };
}

function createDb() {
  return new FakeDb([
    ['accessProfiles/auth-a', { uid: 'auth-a', status: 'approved', role: 'professional', workspaceId: WORKSPACE, linkedProfessionalIds: ['professional-a'] }],
    ['accessProfiles/auth-b', { uid: 'auth-b', status: 'approved', role: 'professional', workspaceId: WORKSPACE, linkedProfessionalIds: ['professional-b'] }],
    ['accessProfiles/auth-finance', { uid: 'auth-finance', status: 'approved', role: 'admin', workspaceId: WORKSPACE, linkedProfessionalIds: ['professional-a'] }],
    ['accessProfiles/auth-clinical', { uid: 'auth-clinical', status: 'approved', role: 'professional', workspaceId: WORKSPACE, linkedProfessionalIds: ['professional-a'] }],
    ['accessProfiles/auth-limited', { uid: 'auth-limited', status: 'approved', role: 'professional', workspaceId: WORKSPACE, linkedProfessionalIds: ['professional-a'] }],
    ['accessProfiles/auth-neuro', { uid: 'auth-neuro', status: 'approved', role: 'professional', workspaceId: WORKSPACE, linkedProfessionalIds: ['professional-neuro'] }],
    ['professionals/professional-a', { professionalId: 'professional-a', authUid: 'auth-a', tenantId: WORKSPACE, active: true }],
    ['professionals/professional-b', { professionalId: 'professional-b', authUid: 'auth-b', tenantId: WORKSPACE, active: true }],
    ['professionals/professional-finance', { professionalId: 'professional-a', authUid: 'auth-finance', tenantId: WORKSPACE, active: true }],
    ['professionals/professional-clinical', { professionalId: 'professional-a', authUid: 'auth-clinical', tenantId: WORKSPACE, active: true }],
    ['professionals/professional-limited', { professionalId: 'professional-a', authUid: 'auth-limited', tenantId: WORKSPACE, active: true }],
    ['professionals/professional-neuro', { professionalId: 'professional-neuro', authUid: 'auth-neuro', tenantId: WORKSPACE, active: true }],
    ['professionalContexts/context-a', { professionalId: 'professional-a', tenantId: WORKSPACE, context: 'PSICOLOGIA', active: true }],
    ['professionalContexts/context-b', { professionalId: 'professional-b', tenantId: WORKSPACE, context: 'PSICOLOGIA', active: true }],
    ['professionalContexts/context-neuro', { professionalId: 'professional-neuro', tenantId: WORKSPACE, context: 'NEUROPSICOPEDAGOGIA', active: true }],
    ['workspaces/tenant-synthetic-a/professionals/professional-a/contexts/PSICOLOGIA/patients/patient-a', patient(scopeA, 'patient-a', 'Ana A')],
    ['workspaces/tenant-synthetic-a/professionals/professional-b/contexts/PSICOLOGIA/patients/patient-b', patient(scopeB, 'patient-b', 'Bruno B')],
    ['workspaces/tenant-synthetic-a/professionals/professional-a/contexts/PSICOLOGIA/sessions/session-a', { id: 'session-a', ...scopeA, patientId: 'patient-a', date: '2026-08-14', time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada', content: 'NÃO DEVE APARECER NA SESSÃO' }],
    ['workspaces/tenant-synthetic-a/professionals/professional-a/contexts/PSICOLOGIA/sessionRecords/record-a', { id: 'record-a', ...scopeA, patientId: 'patient-a', sessionId: 'session-a', content: 'REGISTRO CLÍNICO SINTÉTICO', authorProfessionalId: 'professional-a', date: '2026-08-14', createdAt: NOW, updatedAt: NOW }],
  ]);
}

function baseResolver(req) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !baseByToken[token]) throw Object.assign(new Error('Sessão não identificada.'), { code: 'access/missing-auth-token', statusCode: 401 });
  return baseByToken[token];
}

function createHandler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: (req, options) => resolvePsychologyAccessContext(req, { ...options, db, resolveBaseAccessContext: baseResolver }),
  });
}

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

async function call(handler, method, url, token, body, extraHeaders = {}) {
  const req = { method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body, query: {} };
  const res = responseCapture();
  await handler(req, res);
  return res;
}

test('R2D2D resolver — Auth A resolve Professional A e contexto Psicologia', async () => {
  const db = createDb();
  const result = await resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' } }, { db, resolveBaseAccessContext: baseResolver });
  assert.deepEqual({ authUid: result.authUid, professionalId: result.professionalId, context: result.context, tenantId: result.tenantId }, { authUid: 'auth-a', professionalId: 'professional-a', context: 'PSICOLOGIA', tenantId: WORKSPACE });
  assert.equal(result.bindingMode, 'LEGACY_ONE_TO_ONE');
});

test('R2D2E binding — vínculo explícito retorna escopo e modo canônico', async () => {
  const db = createDb();
  db.store.set(`workspaceTenantBindings/${WORKSPACE}`, { workspaceId: WORKSPACE, tenantId: WORKSPACE, active: true });
  const result = await resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' } }, { db, resolveBaseAccessContext: baseResolver });
  assert.deepEqual({ workspaceId: result.workspaceId, tenantId: result.tenantId, bindingMode: result.bindingMode }, { workspaceId: WORKSPACE, tenantId: WORKSPACE, bindingMode: 'EXPLICIT_BINDING' });
});

test('R2D2D resolver — Auth B não herda Professional A', async () => {
  const db = createDb();
  const result = await resolvePsychologyAccessContext({ headers: { authorization: 'Bearer b' } }, { db, resolveBaseAccessContext: baseResolver });
  assert.equal(result.professionalId, 'professional-b');
  await assert.rejects(() => resolvePsychologyAccessContext({ headers: { authorization: 'Bearer b' }, query: { professionalId: 'professional-a' } }, { db, resolveBaseAccessContext: baseResolver }), /profissional autorizado|não foi possível resolver/);
});

test('R2D2D resolver — ProfessionalContext ausente/inativo, Neuro e mismatch falham fechado', async () => {
  const db = createDb();
  db.store.set('professionalContexts/context-a', { professionalId: 'professional-a', tenantId: WORKSPACE, context: 'PSICOLOGIA', active: false });
  await assert.rejects(() => resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' } }, { db, resolveBaseAccessContext: baseResolver }), /contexto Psicologia/);
  const neuroDb = createDb();
  await assert.rejects(() => resolvePsychologyAccessContext({ headers: { authorization: 'Bearer neuro' } }, { db: neuroDb, resolveBaseAccessContext: baseResolver }), /contexto Psicologia/);
  const mismatchDb = createDb();
  mismatchDb.store.set('professionals/professional-a', { professionalId: 'professional-a', authUid: 'auth-a', tenantId: 'tenant-different', active: true });
  await assert.rejects(() => resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' } }, { db: mismatchDb, resolveBaseAccessContext: baseResolver }), /workspace\/tenant/);
});

test('R2D2D resolver — inativo, ambíguo e displayName não alteram ou liberam scope', async () => {
  const db = createDb();
  db.store.set('professionals/professional-a', { professionalId: 'professional-a', authUid: 'auth-a', tenantId: WORKSPACE, active: false });
  await assert.rejects(() => resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' } }, { db, resolveBaseAccessContext: baseResolver }), /profissional autorizado/);
  const ambiguousDb = createDb();
  ambiguousDb.store.set('professionals/professional-a-2', { professionalId: 'professional-a-2', authUid: 'auth-a', tenantId: WORKSPACE, active: true });
  ambiguousDb.store.set('professionalContexts/context-a-2', { professionalId: 'professional-a-2', tenantId: WORKSPACE, context: 'PSICOLOGIA', active: true });
  ambiguousDb.store.set('accessProfiles/auth-a', { uid: 'auth-a', status: 'approved', role: 'professional', workspaceId: WORKSPACE, linkedProfessionalIds: [] });
  await assert.rejects(() => resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' } }, { db: ambiguousDb, resolveBaseAccessContext: baseResolver }), /mais de um profissional/);
  const result = await resolvePsychologyAccessContext({ headers: { authorization: 'Bearer a' }, query: { displayName: 'Professional A adulterado' } }, { db: createDb(), resolveBaseAccessContext: baseResolver });
  assert.equal(result.professionalId, 'professional-a');
});

test('R2D2D API — pacientes administrativos, scope server-side e isolamento A/B', async () => {
  const db = createDb();
  const handler = createHandler(db);
  const listedA = await call(handler, 'GET', '/api/psychology/patients', 'a');
  assert.equal(listedA.statusCode, 200);
  assert.deepEqual(listedA.body.items.map(item => item.id), ['patient-a']);
  assert.equal('content' in listedA.body.items[0], false);
  assert.equal('clinicalNote' in listedA.body.items[0], false);
  const listedB = await call(handler, 'GET', '/api/psychology/patients', 'b');
  assert.deepEqual(listedB.body.items.map(item => item.id), ['patient-b']);
  const attemptedCrossRead = await call(handler, 'GET', '/api/psychology/patients/patient-a', 'b');
  assert.deepEqual(attemptedCrossRead.body.items, []);
  const created = await call(handler, 'POST', '/api/psychology/patients', 'a', { name: 'Paciente Sintético', birthDate: '2000-01-01', phone: '27999990001', preferredModality: 'online', professionalId: 'professional-b' });
  assert.equal(created.statusCode, 422);
  const valid = await call(handler, 'POST', '/api/psychology/patients', 'a', { name: 'Paciente Sintético', birthDate: '2000-01-01', phone: '27999990001', preferredModality: 'online' });
  assert.equal(valid.statusCode, 201);
  assert.equal(valid.body.patient.professionalId, 'professional-a');
  assert.equal(valid.body.patient.context, 'PSICOLOGIA');
  assert.equal(db.value(`workspaces/${WORKSPACE}/professionals/professional-a/contexts/PSICOLOGIA/patients/${valid.body.patient.id}`).professionalId, 'professional-a');
});

test('R2D2D API — 401, 403, settings imutáveis e profile editável', async () => {
  const db = createDb();
  const handler = createHandler(db);
  assert.equal((await call(handler, 'GET', '/api/psychology/patients', '')).statusCode, 401);
  assert.equal((await call(handler, 'GET', '/api/psychology/patients', 'limited')).statusCode, 403);
  const update = await call(handler, 'PUT', '/api/psychology/settings', 'a', { professionalProfile: { displayName: 'Leila Sintética', professionalTitle: 'Psicóloga' } });
  assert.equal(update.statusCode, 200);
  assert.equal(update.body.settings.settings.professionalProfile.displayName, 'Leila Sintética');
  assert.equal(update.body.settings.professionalId, 'professional-a');
  const technicalUpdate = await call(handler, 'PUT', '/api/psychology/settings', 'a', { workspaceId: 'outro-workspace', professionalProfile: { displayName: 'Não aplicar' } });
  assert.equal(technicalUpdate.statusCode, 422);
});

test('R2B13X API — mesma operação não grava duas vezes e controles operacionais têm CRUD', async () => {
  const db = createDb();
  const handler = createHandler(db);
  const idempotencyKey = { 'x-idempotency-key': 'patients:synthetic-one:2026-08-14T18:00:00.000Z' };
  const payload = { id: 'patient-r2b13x-one', name: 'Paciente Operacional Sintético', birthDate: '2000-01-01', phone: '27999990001', preferredModality: 'online' };
  const first = await call(handler, 'POST', '/api/psychology/patients', 'a', payload, idempotencyKey);
  const path = `workspaces/${WORKSPACE}/professionals/professional-a/contexts/PSICOLOGIA/patients/patient-r2b13x-one`;
  const firstRequestId = db.value(path).audit.requestId;
  const second = await call(handler, 'POST', '/api/psychology/patients', 'a', payload, idempotencyKey);
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(db.value(path).audit.requestId, firstRequestId);
  const deletedPatient = await call(handler, 'DELETE', '/api/psychology/patients/patient-r2b13x-one', 'a');
  assert.equal(deletedPatient.statusCode, 200);
  assert.equal(db.value(path), undefined);

  const service = { id: 'service-r2b13x', name: 'Serviço operacional sintético', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', active: true, createdAt: NOW, updatedAt: NOW };
  const createdService = await call(handler, 'POST', '/api/psychology/services', 'a', service);
  assert.equal(createdService.statusCode, 201);
  const listedService = await call(handler, 'GET', '/api/psychology/services', 'a');
  assert.deepEqual(listedService.body.items.map(item => item.id), ['service-r2b13x']);
  const updatedService = await call(handler, 'PATCH', '/api/psychology/services/service-r2b13x', 'a', { name: 'Serviço operacional atualizado' });
  assert.equal(updatedService.statusCode, 200);
  const deletedService = await call(handler, 'DELETE', '/api/psychology/services/service-r2b13x', 'a');
  assert.equal(deletedService.statusCode, 200);
  assert.deepEqual((await call(handler, 'GET', '/api/psychology/services', 'a')).body.items, []);

  const location = { id: 'location-r2b13x', type: 'PRIMARY_OFFICE', displayName: 'Local operacional sintético', address: '', active: true, isPrimary: true, color: '#6D28D9', createdAt: NOW, updatedAt: NOW };
  const personal = { id: 'personal-r2b13x', date: '2026-08-14', time: '12:00', durationMinutes: 30, type: 'Compromisso pessoal', title: 'Compromisso operacional sintético', note: '', recurrence: 'Não repetir', alarmEnabled: false, isDone: false, createdAt: NOW, updatedAt: NOW };
  for (const [resource, item] of [['locations', location], ['personal-appointments', personal]]) {
    const created = await call(handler, 'POST', `/api/psychology/${resource}`, 'a', item);
    assert.equal(created.statusCode, 201);
    assert.equal((await call(handler, 'GET', `/api/psychology/${resource}`, 'a')).body.items.length, 1);
    assert.equal((await call(handler, 'DELETE', `/api/psychology/${resource}/${item.id}`, 'a')).statusCode, 200);
    assert.deepEqual((await call(handler, 'GET', `/api/psychology/${resource}`, 'a')).body.items, []);
  }
});

test('R2D2D API — sessions administrativas não vazam clínico e session-records têm permissão separada', async () => {
  const db = createDb();
  const handler = createHandler(db);
  const sessions = await call(handler, 'GET', '/api/psychology/sessions', 'a');
  assert.equal(sessions.statusCode, 200);
  assert.equal('content' in sessions.body.items[0], false);
  const financial = await call(handler, 'GET', '/api/psychology/session-records', 'finance');
  assert.equal(financial.statusCode, 403);
  const clinical = await call(handler, 'GET', '/api/psychology/session-records', 'clinical');
  assert.equal(clinical.statusCode, 200);
  assert.equal(clinical.body.items[0].content, 'REGISTRO CLÍNICO SINTÉTICO');
});

test('R2D2G-B API — POST session é canônico, sem Financeiro/efeitos externos, e DELETE é por escopo', async () => {
  const db = createDb();
  const handler = createHandler(db);
  const beforeKeys = new Set(db.store.keys());
  const created = await call(handler, 'POST', '/api/psychology/sessions', 'a', {
    id: 'session-staging-synthetic',
    patientId: 'patient-a',
    date: '2026-08-15',
    time: '10:00',
    durationMinutes: 50,
    modality: 'presencial',
    locationType: 'PRIMARY_OFFICE',
    administrativeNote: 'fixture R2D2G-B',
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.session.professionalId, 'professional-a');
  assert.equal(created.body.session.context, 'PSICOLOGIA');
  assert.equal('content' in created.body.session, false);
  assert.equal([...db.store.keys()].filter(key => !beforeKeys.has(key)).every(key => key.includes('/sessions/')), true);

  const crossScope = await call(handler, 'POST', '/api/psychology/sessions', 'b', {
    patientId: 'patient-a', date: '2026-08-15', time: '11:00', durationMinutes: 50, modality: 'online',
  });
  assert.equal(crossScope.statusCode, 422);

  const crossDelete = await call(handler, 'DELETE', '/api/psychology/sessions/session-staging-synthetic', 'b');
  assert.equal(crossDelete.statusCode, 404);
  const deleted = await call(handler, 'DELETE', '/api/psychology/sessions/session-staging-synthetic', 'a');
  assert.equal(deleted.statusCode, 200);
  assert.equal(db.value(`workspaces/${WORKSPACE}/professionals/professional-a/contexts/PSICOLOGIA/sessions/session-staging-synthetic`), undefined);
});

test('R2D2D server repository — Admin-compatible fake injeta scope e audit metadata', async () => {
  const db = createDb();
  const repo = createPsychologyServerRepository({ db, runtimeScope: scopeA, now: () => NOW });
  const saved = await repo.patients.upsert(patient(scopeA, 'patient-repository', 'Repository Sintético'));
  assert.equal(saved.professionalId, 'professional-a');
  assert.equal(db.value(`workspaces/${WORKSPACE}/professionals/professional-a/contexts/PSICOLOGIA/patients/patient-repository`).audit.actorUid, 'auth-a');
  assert.equal(db.value(`workspaces/${WORKSPACE}/professionals/professional-a/contexts/PSICOLOGIA/patients/patient-repository`).audit.status, 'success');
  assert.equal(db.value(`workspaces/${WORKSPACE}/professionals/professional-a/contexts/PSICOLOGIA/patients/patient-repository`).audit.operation, 'create:patients');
  await assert.rejects(() => repo.patients.upsert(patient({ ...scopeA, professionalId: 'professional-b' }, 'cross', 'Cross')), /escopo/);
});

test('R2D2D provider — LOCAL default, REMOTE explícito e Admin SDK não chega à UI', async () => {
  const scope = createPsychologyPersistenceScope('professional-local', 'workspace-local');
  const local = createPsychologyPersistenceProvider({ scope, storage: createMemoryStorage() });
  assert.equal(local.backend, 'local');
  assert.throws(() => createPsychologyPersistenceProvider({ scope, backend: 'remote' }), /configuração explícita/);
  assert.equal(isPsychologyRemoteCanaryEnabled(false), false);
  assert.equal(isPsychologyRemoteCanaryEnabled('false'), false);
  const remote = createPsychologyPersistenceProvider({
    scope,
    backend: 'remote',
    api: {
      getToken: async () => 'synthetic-token',
      fetchImpl: async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    },
    remoteCanaryEnabled: true,
  });
  assert.equal(remote.backend, 'remote');
  assert.equal(remote.productionEnabled, false);
  await assert.rejects(() => remote.repositories.financial.listCharges(scope), /agregado remoto/);
});

test('R2D2D frontend API repository — envia token, não envia scope como autoridade e preserva interfaces', async () => {
  const scope = createPsychologyPersistenceScope('professional-api', 'workspace-api');
  const calls = [];
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-api-token',
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).endsWith('/patients')) {
        return new Response(JSON.stringify({ items: [patient({ ...scope, tenantId: scope.workspaceId }, 'patient-api', 'API Sintética')] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ settings: { workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: 'PSICOLOGIA', id: 'settings', settings: { professionalProfile: { displayName: 'API' } }, updatedAt: NOW } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const items = await repositories.patients.list(scope);
  assert.equal(items[0].professionalId, 'professional-api');
  assert.match(calls[0].init.headers.Authorization, /synthetic-api-token/);
  await repositories.settings.upsert(scope, { id: 'settings', workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: 'PSICOLOGIA', settings: { professionalProfile: { displayName: 'API' } }, createdAt: NOW, updatedAt: NOW });
  const settingsBody = JSON.parse(calls[1].init.body);
  assert.deepEqual(Object.keys(settingsBody), ['settings']);
});

test('R2D2D canary local — create/read próprio, cross-access e clinical isolation', async () => {
  const db = createDb();
  const handler = createHandler(db);
  const create = await call(handler, 'POST', '/api/psychology/patients', 'a', { name: 'TESTE-R2D2-CANARIO', birthDate: '2001-01-01', phone: '27999990002', preferredModality: 'online' });
  assert.equal(create.statusCode, 201);
  const own = await call(handler, 'GET', `/api/psychology/patients/${create.body.patient.id}`, 'a');
  assert.equal(own.body.items.length, 1);
  const cross = await call(handler, 'GET', `/api/psychology/patients/${create.body.patient.id}`, 'b');
  assert.equal(cross.body.items.length, 0);
  const finance = await call(handler, 'GET', '/api/psychology/session-records', 'finance');
  assert.equal(finance.statusCode, 403);
});

test('R2D2E observability — evento mínimo não contém dado clínico ou do paciente', () => {
  const event = buildPsychologyAuditEvent({ requestId: 'r2d2e-synthetic', runtimeScope: scopeA, operation: 'POST:patients', status: 'success', timestamp: NOW });
  assert.deepEqual(Object.keys(event).sort(), ['actorUid', 'context', 'operation', 'professionalId', 'requestId', 'status', 'timestamp', 'workspaceId'].sort());
  assert.equal(JSON.stringify(event).includes('Paciente Sintético'), false);
  assert.equal(JSON.stringify(event).includes('phone'), false);
  assert.equal(JSON.stringify(event).includes('content'), false);
});
