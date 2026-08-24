import assert from 'node:assert/strict';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../api/_lib/accessPermissions.js';

class FakeDocument {
  constructor(store, path, id) { this.store = store; this.path = path; this.id = id; }
  async get() { const value = this.store.get(`${this.path}/${this.id}`); return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined }; }
  async set(value) { this.store.set(`${this.path}/${this.id}`, structuredClone(value)); }
  async delete() { this.store.delete(`${this.path}/${this.id}`); }
}

class FakeQuery {
  constructor(store, path, field, value) { this.store = store; this.path = path; this.field = field; this.value = value; this.maxResults = Infinity; }
  limit(value) { this.maxResults = value; return this; }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) }))
      .filter(documentSnapshot => documentSnapshot.data()?.[this.field] === this.value)
      .slice(0, this.maxResults);
    return { docs };
  }
}

class FakeCollection {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new FakeDocument(this.store, this.path, id); }
  where(field, _operator, value) { return new FakeQuery(this.store, this.path, field, value); }
  async get() {
    const prefix = `${this.path}/`;
    return { docs: [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })) };
  }
}

class FakeDb {
  constructor() { this.store = new Map(); }
  collection(path) { return new FakeCollection(this.store, path); }
}

const NOW = '2026-08-22T06:00:00.000Z';
const WORKSPACE = 'workspace-r2b13-synthetic';
const scopes = {
  professionalA: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b13-a', context: 'PSICOLOGIA', role: 'professional', authUid: 'auth-r2b13-a', permissions: ['patients.list', 'patients.create', 'patients.edit', 'patients.delete', 'agenda.own.view', 'agenda.edit', 'settings.clinic.view', 'settings.clinic.edit'] },
  professionalB: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b13-b', context: 'PSICOLOGIA', role: 'professional', authUid: 'auth-r2b13-b', permissions: ['patients.list', 'patients.create', 'patients.edit', 'patients.delete', 'agenda.own.view', 'agenda.edit', 'settings.clinic.view', 'settings.clinic.edit'] },
  responsible: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b13-a', context: 'PSICOLOGIA', role: 'responsible', authUid: 'auth-r2b13-responsible', permissions: ['patients.list', 'agenda.own.view'] },
  monitoring: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b13-a', context: 'PSICOLOGIA', role: 'monitoring', authUid: 'auth-r2b13-monitoring', permissions: ['patients.list', 'agenda.own.view'] },
};

function scopeForToken(token) {
  if (token === 'a') return scopes.professionalA;
  if (token === 'b') return scopes.professionalB;
  if (token === 'responsible') return scopes.responsible;
  if (token === 'monitoring') return scopes.monitoring;
  throw Object.assign(new Error('Sessão não identificada.'), { code: 'access/missing-auth-token', statusCode: 401 });
}

function createHandler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (req, options = {}) => {
      const scope = scopeForToken(String(req.headers?.authorization || '').replace(/^Bearer\s+/i, ''));
      for (const permission of options.requiredPermissions || []) {
        if (!scope.permissions.includes(permission)) throw Object.assign(new Error('Permissão negada.'), { code: 'access/permission-denied', statusCode: 403 });
      }
      return Object.freeze(scope);
    },
    auditLogger: () => {},
  });
}

function capture() {
  return { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}

async function call(handler, method, path, token, body) {
  const req = { method, url: `/api/psychology/${path}`, headers: { authorization: `Bearer ${token}` }, body, query: {} };
  const res = capture();
  await handler(req, res);
  return res;
}

test('R2B13 operacional — fluxo sintético read/write, isolamento e limpeza segura', async () => {
  const db = new FakeDb();
  const handler = createHandler(db);
  const patientId = 'r2b13-patient';
  const sessionId = 'r2b13-session';

  const createdPatient = await call(handler, 'POST', 'patients', 'a', { id: patientId, name: 'TESTE R2B13 NAO REAL', birthDate: '1990-01-01', phone: '27999990013', preferredModality: 'online' });
  assert.equal(createdPatient.statusCode, 201);
  assert.equal((await call(handler, 'GET', `patients/${patientId}`, 'a')).body.items[0].name, 'TESTE R2B13 NAO REAL');
  assert.deepEqual((await call(handler, 'GET', `patients/${patientId}`, 'b')).body.items, []);

  const updatedPatient = await call(handler, 'PATCH', `patients/${patientId}`, 'a', { name: 'TESTE R2B13 NAO REAL EDITADO', active: true });
  assert.equal(updatedPatient.statusCode, 200);
  assert.equal(updatedPatient.body.patient.name, 'TESTE R2B13 NAO REAL EDITADO');
  assert.equal((await call(handler, 'PATCH', `patients/${patientId}`, 'b', { name: 'FORA DO ESCOPO' })).statusCode, 404);
  for (const [key, value] of [['professionalId', 'professional-r2b13-b'], ['workspaceId', 'workspace-fora'], ['tenantId', 'tenant-fora'], ['context', 'NEUROPSICOPEDAGOGIA']]) {
    assert.equal((await call(handler, 'POST', 'patients', 'a', { name: 'TESTE R2B13 NAO REAL', birthDate: '1990-01-01', phone: '27999990014', preferredModality: 'online', [key]: value })).statusCode, 422);
  }
  assert.equal((await call(handler, 'POST', 'patients', 'responsible', { name: 'NÃO ESCREVER', birthDate: '1990-01-01', phone: '27999990015', preferredModality: 'online' })).statusCode, 403);
  assert.equal((await call(handler, 'POST', 'patients', 'monitoring', { name: 'NÃO ESCREVER', birthDate: '1990-01-01', phone: '27999990016', preferredModality: 'online' })).statusCode, 403);

  const service = await call(handler, 'POST', 'services', 'a', { id: 'r2b13-service', name: 'TESTE R2B13', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', active: true });
  assert.equal(service.statusCode, 201);
  assert.equal((await call(handler, 'PATCH', 'services/r2b13-service', 'a', { name: 'TESTE R2B13 EDITADO' })).body.service.name, 'TESTE R2B13 EDITADO');
  const location = await call(handler, 'POST', 'locations', 'a', { id: 'r2b13-location', type: 'OTHER', displayName: 'TESTE R2B13', active: true, isPrimary: false, color: '#7C3AED' });
  assert.equal(location.statusCode, 201);
  assert.equal((await call(handler, 'PATCH', 'locations/r2b13-location', 'a', { displayName: 'TESTE R2B13 EDITADO' })).body.location.displayName, 'TESTE R2B13 EDITADO');
  const settings = await call(handler, 'PUT', 'settings', 'a', { professionalProfile: { displayName: 'Profissional R2B13' }, reminders: { enabled: true, advanceMinutes: 15 } });
  assert.equal(settings.statusCode, 200);
  assert.equal((await call(handler, 'GET', 'settings', 'a')).body.settings.settings.professionalProfile.displayName, 'Profissional R2B13');

  const createdSession = await call(handler, 'POST', 'sessions', 'a', { id: sessionId, patientId, date: '2026-08-23', time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada', administrativeNote: 'TESTE R2B13' });
  assert.equal(createdSession.statusCode, 201);
  const rescheduled = await call(handler, 'PATCH', `sessions/${sessionId}`, 'a', { date: '2026-08-24', time: '10:00' });
  assert.equal(rescheduled.body.session.date, '2026-08-24');
  assert.equal((await call(handler, 'PATCH', `sessions/${sessionId}`, 'a', { status: 'cancelada' })).body.session.status, 'cancelada');
  assert.equal((await call(handler, 'GET', 'sessions', 'b')).body.items.length, 0);

  const personal = await call(handler, 'POST', 'personal-appointments', 'a', { id: 'r2b13-personal', date: '2026-08-25', time: '13:00', durationMinutes: 30, type: 'Outro', note: 'TESTE R2B13', recurrence: 'Não repetir', alarmEnabled: true, alarmAdvance: '15 min' });
  assert.equal(personal.statusCode, 201);
  assert.equal((await call(handler, 'PATCH', 'personal-appointments/r2b13-personal', 'a', { time: '14:00' })).body.personalAppointment.time, '14:00');
  assert.equal((await call(handler, 'GET', 'personal-appointments', 'a')).body.items.length, 1);

  const inactivated = await call(handler, 'DELETE', `patients/${patientId}`, 'a');
  assert.equal(inactivated.statusCode, 200);
  assert.equal(inactivated.body.inactivated, true);
  assert.equal((await call(handler, 'GET', `patients/${patientId}`, 'a')).body.items[0].active, false);
  assert.equal((await call(handler, 'DELETE', `sessions/${sessionId}`, 'a')).statusCode, 200);
  assert.equal((await call(handler, 'DELETE', `patients/${patientId}`, 'a')).body.deleted, true);
  assert.deepEqual((await call(handler, 'GET', `patients/${patientId}`, 'a')).body.items, []);
  assert.equal((await call(handler, 'DELETE', 'personal-appointments/r2b13-personal', 'a')).body.deleted, true);
  assert.equal((await call(handler, 'DELETE', 'services/r2b13-service', 'a')).body.deleted, true);
  assert.equal((await call(handler, 'DELETE', 'locations/r2b13-location', 'a')).body.deleted, true);
});

test('R2B13 permissões — profissional pode operar, sem receber gestão administrativa', () => {
  assert.equal(DEFAULT_ROLE_PERMISSIONS.professional['settings.clinic.edit'], true);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.professional['settings.clinic.manage'], false);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.responsible['settings.clinic.edit'], false);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.monitoring['settings.clinic.edit'], false);
});
