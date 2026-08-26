import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createPsychologyApiHandler } from '../api/psychology.js';

const NOW = '2026-08-23T00:00:00.000Z';
const WORKSPACE = 'workspace-r2b20-synthetic';
const PROFESSIONAL = 'professional-r2b20-a';
const SCOPE = {
  workspaceId: WORKSPACE,
  tenantId: WORKSPACE,
  professionalId: PROFESSIONAL,
  context: 'PSICOLOGIA',
  role: 'professional',
  authUid: 'auth-r2b20-a',
  permissions: ['patients.list', 'patients.create', 'patients.edit', 'patients.delete', 'agenda.own.view', 'agenda.edit'],
};
const PROTECTED_AGGREGATES = ['sessions', 'sessionRecords', 'packages', 'documents', 'attachments', 'charges', 'payments'];

class FakeDocument {
  constructor(database, path, id) { this.database = database; this.path = path; this.id = id; }
  async get() {
    this.database.metrics.documentGets += 1;
    const value = this.database.store.get(`${this.path}/${this.id}`);
    return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined };
  }
  async set(value) { this.database.store.set(`${this.path}/${this.id}`, structuredClone(value)); }
  async delete() { this.database.store.delete(`${this.path}/${this.id}`); }
}

class FakeQuery {
  constructor(database, path, field, operator, value) {
    this.database = database;
    this.path = path;
    this.field = field;
    this.operator = operator;
    this.value = value;
    this.maxResults = Infinity;
  }
  limit(value) {
    this.database.metrics.limitCalls += 1;
    this.maxResults = value;
    return this;
  }
  async get() {
    this.database.metrics.queryGets += 1;
    const prefix = `${this.path}/`;
    const docs = [...this.database.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) }))
      .filter(documentSnapshot => documentSnapshot.data()?.[this.field] === this.value)
      .slice(0, this.maxResults);
    this.database.metrics.queries.push({ path: this.path, field: this.field, operator: this.operator, value: this.value, limit: this.maxResults });
    return { docs };
  }
}

class FakeCollection {
  constructor(database, path) { this.database = database; this.path = path; }
  doc(id) { return new FakeDocument(this.database, this.path, id); }
  where(field, operator, value) {
    this.database.metrics.whereCalls += 1;
    return new FakeQuery(this.database, this.path, field, operator, value);
  }
  async get() {
    this.database.metrics.collectionGets += 1;
    const prefix = `${this.path}/`;
    return {
      docs: [...this.database.store.entries()]
        .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
        .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })),
    };
  }
}

class FakeDb {
  constructor() {
    this.store = new Map();
    this.resetMetrics();
  }
  collection(path) { return new FakeCollection(this, path); }
  resetMetrics() {
    this.metrics = { collectionGets: 0, documentGets: 0, whereCalls: 0, limitCalls: 0, queryGets: 0, queries: [] };
  }
  seed(path, value) { this.store.set(path, structuredClone(value)); }
  value(path) { return this.store.get(path); }
}

function aggregatePath(aggregate, id) {
  return `workspaces/${WORKSPACE}/professionals/${PROFESSIONAL}/contexts/PSICOLOGIA/${aggregate}/${id}`;
}

function patient(id) {
  return {
    id,
    ...SCOPE,
    name: `Paciente ${id}`,
    birthDate: '1990-01-01',
    phone: '27999990020',
    preferredModality: 'online',
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createSyntheticHandler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (_req, options = {}) => {
      for (const permission of options.requiredPermissions || []) {
        if (!SCOPE.permissions.includes(permission)) {
          throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
        }
      }
      return Object.freeze(SCOPE);
    },
    auditLogger: () => {},
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

async function call(handler, method, path) {
  const response = responseCapture();
  await handler({
    method,
    url: `/api/psychology?path=${encodeURIComponent(path)}`,
    query: { path },
    headers: { authorization: 'Bearer r2b20-synthetic' },
  }, response);
  return response;
}

function seedPatientAndReference(db, patientId, aggregate, referencePatientId = patientId) {
  db.seed(aggregatePath('patients', patientId), patient(patientId));
  db.seed(aggregatePath(aggregate, `reference-${aggregate}`), {
    id: `reference-${aggregate}`,
    ...SCOPE,
    patientId: referencePatientId,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

test('R2B20 DELETE sem vínculos usa somente consultas limitadas e exclui o paciente', async () => {
  const db = new FakeDb();
  const patientId = 'r2b20-no-reference';
  db.seed(aggregatePath('patients', patientId), patient(patientId));
  db.resetMetrics();

  const result = await call(createSyntheticHandler(db), 'DELETE', `patients/${patientId}`);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deleted, true);
  assert.equal(db.value(aggregatePath('patients', patientId)), undefined);
  assert.equal(db.metrics.collectionGets, 0);
  assert.equal(db.metrics.whereCalls, PROTECTED_AGGREGATES.length);
  assert.equal(db.metrics.limitCalls, PROTECTED_AGGREGATES.length);
  assert.equal(db.metrics.queryGets, PROTECTED_AGGREGATES.length);
  assert.ok(db.metrics.queries.every(query => query.field === 'patientId' && query.operator === '==' && query.value === patientId && query.limit === 1));
});

test('R31 cada vínculo protegido é removido pela cascata dirigida', async () => {
  for (const aggregate of PROTECTED_AGGREGATES) {
    const db = new FakeDb();
    const patientId = `r2b20-related-${aggregate}`;
    seedPatientAndReference(db, patientId, aggregate);
    db.resetMetrics();

    const result = await call(createSyntheticHandler(db), 'DELETE', `patients/${patientId}`);

    assert.equal(result.statusCode, 200, aggregate);
    assert.equal(result.body.deleted, true, aggregate);
    assert.equal(result.body.inactivated, undefined, aggregate);
    assert.equal(db.value(aggregatePath('patients', patientId)), undefined, aggregate);
    assert.equal(db.value(aggregatePath(aggregate, `reference-${aggregate}`)), undefined, aggregate);
    assert.equal(db.metrics.collectionGets, 0, aggregate);
    assert.equal(db.metrics.queryGets, PROTECTED_AGGREGATES.length, aggregate);
  }
});

test('R2B20 vínculo de outro patientId não bloqueia exclusão', async () => {
  const db = new FakeDb();
  const patientId = 'r2b20-isolated-target';
  seedPatientAndReference(db, patientId, 'sessions', 'r2b20-other-patient');

  const result = await call(createSyntheticHandler(db), 'DELETE', `patients/${patientId}`);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deleted, true);
  assert.equal(db.value(aggregatePath('sessions', 'reference-sessions')).patientId, 'r2b20-other-patient');
});

test('R2B20 servidor e cliente não reintroduzem scans completos no fluxo de DELETE', () => {
  const repositorySource = fs.readFileSync(new URL('../api/_lib/psychologyRepository.js', import.meta.url), 'utf8');
  const apiSource = fs.readFileSync(new URL('../api/psychology.js', import.meta.url), 'utf8');
  const pilotSource = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  const patientDeleteStart = apiSource.indexOf("if (resource === 'patients' && req.method === 'DELETE' && id)");
  const patientDeleteEnd = apiSource.indexOf("if (resource === 'settings'", patientDeleteStart);
  const patientDeleteBranch = apiSource.slice(patientDeleteStart, patientDeleteEnd);
  assert.match(repositorySource, /where\('patientId', '==', normalizedPatientId\)\.limit\(1\)\.get\(\)/);
  assert.match(patientDeleteBranch, /deletePsychologyPatientSafely/);
  assert.doesNotMatch(patientDeleteBranch, /\.list\(/);
  assert.match(pilotSource, /remoteClient\.deletePatient\(patientId\)/);
  assert.doesNotMatch(pilotSource, /remoteRepositories\.patients\.list\(/);
});
