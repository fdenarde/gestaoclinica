import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createPsychologyApiHandler } from '../api/psychology.js';

class FakeDocument {
  constructor(store, path, id) { this.store = store; this.path = path; this.id = id; }
  async get() {
    const value = this.store.get(`${this.path}/${this.id}`);
    return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined };
  }
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
    return {
      docs: [...this.store.entries()]
        .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
        .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })),
    };
  }
}

class FakeDb {
  constructor() { this.store = new Map(); }
  collection(path) { return new FakeCollection(this.store, path); }
}

const NOW = '2026-08-23T00:00:00.000Z';
const WORKSPACE = 'workspace-r2b19-synthetic';
const sharedPermissions = ['patients.list', 'patients.create', 'agenda.own.view', 'agenda.edit'];
const scopes = {
  editOnly: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b19-a', context: 'PSICOLOGIA', role: 'professional', authUid: 'auth-r2b19-a', permissions: [...sharedPermissions, 'patients.edit'] },
  noEdit: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b19-a', context: 'PSICOLOGIA', role: 'professional', authUid: 'auth-r2b19-no-edit', permissions: [...sharedPermissions] },
  otherProfessional: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b19-b', context: 'PSICOLOGIA', role: 'professional', authUid: 'auth-r2b19-b', permissions: [...sharedPermissions, 'patients.edit'] },
  wrongWorkspace: { workspaceId: 'workspace-r2b19-other', tenantId: 'workspace-r2b19-other', professionalId: 'professional-r2b19-a', context: 'PSICOLOGIA', role: 'professional', authUid: 'auth-r2b19-other-workspace', permissions: [...sharedPermissions, 'patients.edit'] },
  wrongContext: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r2b19-a', context: 'NEUROPSICOPEDAGOGIA', role: 'professional', authUid: 'auth-r2b19-wrong-context', permissions: [...sharedPermissions, 'patients.edit'] },
};

function scopeForToken(token) {
  if (token === 'edit-only') return scopes.editOnly;
  if (token === 'no-edit') return scopes.noEdit;
  if (token === 'other-professional') return scopes.otherProfessional;
  if (token === 'wrong-workspace') return scopes.wrongWorkspace;
  if (token === 'wrong-context') return scopes.wrongContext;
  throw Object.assign(new Error('Sessão sintética não identificada.'), { code: 'access/missing-auth-token', statusCode: 401 });
}

function capture() {
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

function createSyntheticHandler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (req, options = {}) => {
      const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      const scope = scopeForToken(token);
      for (const permission of options.requiredPermissions || []) {
        if (!scope.permissions.includes(permission)) {
          throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
        }
      }
      return Object.freeze(scope);
    },
    auditLogger: () => {},
  });
}

async function call(handler, method, path, token, body) {
  const req = {
    method,
    url: `/api/psychology?path=${encodeURIComponent(path)}`,
    query: { path },
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body }),
  };
  const res = capture();
  await handler(req, res);
  return res;
}

function patient(id, name = id) {
  return { id, name, birthDate: '1990-01-01', phone: '27999990019', preferredModality: 'online' };
}

test('R2B19 DELETE Psicologia aceita patients.edit sem conceder patients.delete global', async () => {
  const source = fs.readFileSync(new URL('../api/psychology.js', import.meta.url), 'utf8');
  assert.match(source, /resource === 'patients' && req\.method === 'DELETE' && id[\s\S]*requiredPermissions: \['patients\.edit'\]/);
  assert.doesNotMatch(source, /resource === 'patients' && req\.method === 'DELETE' && id[\s\S]*requiredPermissions: \['patients\.delete'\]/);

  const handler = createSyntheticHandler(new FakeDb());
  const created = await call(handler, 'POST', 'patients', 'edit-only', patient('r2b19-edit-only', 'R2B19 EDIT ONLY'));
  assert.equal(created.statusCode, 201);
  const deleted = await call(handler, 'DELETE', 'patients/r2b19-edit-only', 'edit-only');
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.id, 'r2b19-edit-only');
});

test('R2B19 DELETE sem patients.edit permanece negado', async () => {
  const db = new FakeDb();
  const handler = createSyntheticHandler(db);
  assert.equal((await call(handler, 'POST', 'patients', 'edit-only', patient('r2b19-no-edit', 'R2B19 NO EDIT'))).statusCode, 201);
  const denied = await call(handler, 'DELETE', 'patients/r2b19-no-edit', 'no-edit');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.code, 'access/permission-denied');
});

test('R2B19 DELETE mantém proteção de escopo entre profissionais', async () => {
  const db = new FakeDb();
  const handler = createSyntheticHandler(db);
  assert.equal((await call(handler, 'POST', 'patients', 'edit-only', patient('r2b19-cross-scope', 'R2B19 CROSS SCOPE'))).statusCode, 201);
  const denied = await call(handler, 'DELETE', 'patients/r2b19-cross-scope', 'other-professional');
  assert.equal(denied.statusCode, 404);
  assert.equal(denied.body.error.code, 'psychology/patient-not-found');
});

test('R2B19 DELETE nega contexto e workspace incompatíveis sem remover o paciente', async () => {
  const db = new FakeDb();
  const handler = createSyntheticHandler(db);
  const patientId = 'r2b19-context-workspace';
  assert.equal((await call(handler, 'POST', 'patients', 'edit-only', patient(patientId, 'R2B19 CONTEXT WORKSPACE'))).statusCode, 201);
  const wrongContext = await call(handler, 'DELETE', `patients/${patientId}`, 'wrong-context');
  const wrongWorkspace = await call(handler, 'DELETE', `patients/${patientId}`, 'wrong-workspace');
  assert.equal(wrongContext.statusCode, 422);
  assert.equal(wrongWorkspace.statusCode, 404);
  const preserved = await call(handler, 'GET', `patients/${patientId}`, 'edit-only');
  assert.equal(preserved.statusCode, 200);
  assert.equal(preserved.body.items[0].id, patientId);
});

test('R2B19 DELETE com histórico remove a cascata seletiva e exclui o paciente', async () => {
  const db = new FakeDb();
  const handler = createSyntheticHandler(db);
  const patientId = 'r2b19-related-data';
  assert.equal((await call(handler, 'POST', 'patients', 'edit-only', patient(patientId, 'R2B19 RELATED DATA'))).statusCode, 201);
  assert.equal((await call(handler, 'POST', 'sessions', 'edit-only', {
    id: 'r2b19-related-session',
    patientId,
    date: '2026-08-24',
    time: '09:00',
    durationMinutes: 50,
    modality: 'online',
    status: 'agendada',
  })).statusCode, 201);

  const result = await call(handler, 'DELETE', `patients/${patientId}`, 'edit-only');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deleted, true);
  assert.equal(result.body.inactivated, undefined);
  const removed = await call(handler, 'GET', `patients/${patientId}`, 'edit-only');
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.body.items, []);
});
