import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createPsychologyApiHandler } from '../api/psychology.js';

const NOW = '2026-08-23T00:00:00.000Z';
const SCOPE_A = {
  workspaceId: 'workspace-r2b21-synthetic',
  tenantId: 'workspace-r2b21-synthetic',
  professionalId: 'professional-r2b21-a',
  context: 'PSICOLOGIA',
  role: 'professional',
  authUid: 'auth-r2b21-a',
  permissions: ['agenda.edit'],
};

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
  constructor(database, path, field, operator, value) { this.database = database; this.path = path; this.field = field; this.operator = operator; this.value = value; this.maxResults = Infinity; }
  limit(value) { this.database.metrics.limitCalls += 1; this.maxResults = value; return this; }
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
  where(field, operator, value) { this.database.metrics.whereCalls += 1; return new FakeQuery(this.database, this.path, field, operator, value); }
  async get() {
    this.database.metrics.collectionGets += 1;
    const prefix = `${this.path}/`;
    return { docs: [...this.database.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })) };
  }
}

class FakeDb {
  constructor() { this.store = new Map(); this.resetMetrics(); }
  collection(path) { return new FakeCollection(this, path); }
  resetMetrics() { this.metrics = { collectionGets: 0, documentGets: 0, whereCalls: 0, limitCalls: 0, queryGets: 0, queries: [] }; }
  seed(path, value) { this.store.set(path, structuredClone(value)); }
  value(path) { return this.store.get(path); }
}

function aggregatePath(scope, aggregate, id) {
  return `workspaces/${scope.workspaceId}/professionals/${scope.professionalId}/contexts/PSICOLOGIA/${aggregate}/${id}`;
}

function session(scope, id = 'session-r2b21') {
  return { id, ...scope, patientId: 'patient-r2b21', date: '2026-08-24', time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada', createdAt: NOW, updatedAt: NOW };
}

function createSyntheticHandler(db, resolvedScope = SCOPE_A) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (_req, options = {}) => {
      for (const permission of options.requiredPermissions || []) {
        if (!resolvedScope.permissions.includes(permission)) throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
      }
      return Object.freeze(resolvedScope);
    },
    auditLogger: () => {},
  });
}

function capture() {
  return { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}

async function call(handler, method, path) {
  const response = capture();
  await handler({ method, url: `/api/psychology?path=${encodeURIComponent(path)}`, query: { path }, headers: { authorization: 'Bearer r2b21-synthetic' } }, response);
  return response;
}

test('R2B21 exclusão limpa remove a sessão sem varrer coleções', async () => {
  const db = new FakeDb();
  db.seed(aggregatePath(SCOPE_A, 'sessions', 'session-r2b21'), session(SCOPE_A));
  db.resetMetrics();

  const result = await call(createSyntheticHandler(db), 'DELETE', 'sessions/session-r2b21');

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deleted, true);
  assert.equal(result.body.id, 'session-r2b21');
  assert.equal(result.body.scope.workspaceId, SCOPE_A.workspaceId);
  assert.equal(result.body.scope.professionalId, SCOPE_A.professionalId);
  assert.equal(result.body.scope.context, SCOPE_A.context);
  assert.equal(db.value(aggregatePath(SCOPE_A, 'sessions', 'session-r2b21')), undefined);
  assert.equal(db.metrics.collectionGets, 0);
  assert.equal(db.metrics.whereCalls, 3);
  assert.equal(db.metrics.limitCalls, 3);
  assert.equal(db.metrics.queryGets, 3);
  assert.ok(db.metrics.queries.every(query => query.field === 'sessionId' && query.operator === '==' && query.value === 'session-r2b21' && query.limit === 1));
});

test('R2B21 histórico clínico, cobrança ou pagamento protege a sessão e cancela somente o status', async () => {
  for (const aggregate of ['sessionRecords', 'charges', 'payments']) {
    const db = new FakeDb();
    db.seed(aggregatePath(SCOPE_A, 'sessions', `session-${aggregate}`), session(SCOPE_A, `session-${aggregate}`));
    db.seed(aggregatePath(SCOPE_A, aggregate, `reference-${aggregate}`), { id: `reference-${aggregate}`, ...SCOPE_A, sessionId: `session-${aggregate}`, createdAt: NOW, updatedAt: NOW });
    db.resetMetrics();

    const result = await call(createSyntheticHandler(db), 'DELETE', `sessions/session-${aggregate}`);

    assert.equal(result.statusCode, 200, aggregate);
    assert.equal(result.body.deleted, false, aggregate);
    assert.equal(result.body.cancelled, true, aggregate);
    assert.equal(result.body.session.status, 'cancelada', aggregate);
    assert.equal(db.value(aggregatePath(SCOPE_A, 'sessions', `session-${aggregate}`)).status, 'cancelada', aggregate);
    assert.ok(db.value(aggregatePath(SCOPE_A, aggregate, `reference-${aggregate}`)), aggregate);
    assert.equal(db.metrics.collectionGets, 0, aggregate);
    assert.equal(db.metrics.queryGets, 3, aggregate);
  }
});

test('R2B21 sessão de outro profissional permanece inacessível', async () => {
  const db = new FakeDb();
  db.seed(aggregatePath(SCOPE_A, 'sessions', 'session-cross-professional'), session(SCOPE_A, 'session-cross-professional'));
  const scopeB = { ...SCOPE_A, professionalId: 'professional-r2b21-b', authUid: 'auth-r2b21-b' };

  const result = await call(createSyntheticHandler(db, scopeB), 'DELETE', 'sessions/session-cross-professional');

  assert.equal(result.statusCode, 404);
  assert.equal(db.value(aggregatePath(SCOPE_A, 'sessions', 'session-cross-professional')).status, 'agendada');
});

test('R2B21 cliente preserva o resultado explícito e a UI reconcilia somente a sessão afetada', () => {
  const apiSource = fs.readFileSync(new URL('../src/features/psychology-persistence/repositories/api.ts', import.meta.url), 'utf8');
  const pilotSource = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  const deleteStart = pilotSource.indexOf('const confirmSessionDelete');
  const deleteEnd = pilotSource.indexOf('\n  return (', deleteStart);
  const deleteBranch = pilotSource.slice(deleteStart, deleteEnd);

  assert.match(apiSource, /deleteWithResult/);
  assert.match(apiSource, /deleted: result\.deleted !== false/);
  assert.match(apiSource, /cancelled: result\.cancelled === true/);
  assert.match(deleteBranch, /deleteWithResult/);
  assert.match(deleteBranch, /current\.sessions\.filter\(session => session\.id !== selectedSession\.id\)/);
  assert.match(deleteBranch, /current\.sessions\.map\(session => session\.id === selectedSession\.id/);
  assert.doesNotMatch(deleteBranch, /remoteRepositories\.sessions\.list\(/);
  assert.match(pilotSource, /title="Excluir sessão\?"/);
  assert.match(pilotSource, /Use esta opção para remover um agendamento criado por engano/);
  assert.match(pilotSource, /Cancelar sessão/);
  assert.match(pilotSource, /Excluir sessão/);
});
