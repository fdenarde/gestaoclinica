import assert from 'node:assert/strict';
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
      .filter(snapshot => snapshot.data()?.[this.field] === this.value)
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

const NOW = '2026-08-29T12:00:00.000Z';
const SCOPE = {
  workspaceId: 'r107-workspace-synthetic',
  tenantId: 'r107-workspace-synthetic',
  professionalId: 'r107-professional-synthetic',
  context: 'PSICOLOGIA',
  role: 'professional',
  authUid: 'r107-auth-synthetic',
  permissions: ['patients.list', 'patients.create', 'patients.edit', 'agenda.own.view', 'agenda.edit', 'finance.patient.view', 'finance.manage'],
};

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

function handler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (_req, options = {}) => {
      for (const permission of options.requiredPermissions || []) {
        if (!SCOPE.permissions.includes(permission)) throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
      }
      return Object.freeze(SCOPE);
    },
    auditLogger: () => {},
  });
}

async function call(api, method, path, body) {
  const req = { method, url: `/api/psychology?path=${encodeURIComponent(path)}`, query: { path }, headers: { authorization: 'Bearer synthetic-r107' }, ...(body === undefined ? {} : { body }) };
  const res = capture();
  await api(req, res);
  return res;
}

test('R107 API aceita serviço canônico efetivo quando settings.services está vazio e rejeita identidade arbitrária', async () => {
  const api = handler(new FakeDb());
  const patient = await call(api, 'POST', 'patients', { id: 'patient-package', name: 'TESTE HOMOLOGAÇÃO R107', phone: '27999999999', preferredModality: 'presencial' });
  assert.equal(patient.statusCode, 201);

  const valid = await call(api, 'POST', 'packages', {
    id: 'package-canonical',
    patientId: 'patient-package',
    name: 'Psicoterapia Individual · 5 sessões',
    serviceId: 'psychotherapy-individual',
    totalSessions: 5,
    usedSessions: 0,
    startDate: '2026-08-29',
    active: true,
    price: 1000,
    pricePerSession: 200,
    totalPrice: 1000,
  });
  assert.equal(valid.statusCode, 201);
  assert.equal(valid.body.item.serviceId, 'psychotherapy-individual');

  const invalid = await call(api, 'POST', 'packages', {
    id: 'package-arbitrary',
    patientId: 'patient-package',
    name: 'Pacote sintético inválido',
    serviceId: 'service-not-configured',
    totalSessions: 5,
    usedSessions: 0,
    startDate: '2026-08-29',
    active: true,
    totalPrice: 1000,
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.body.error.code, 'psychology/package-service-invalid');
});

test('R107 API exclui finanças com finance.manage, bloqueia órfãos e recalcula a cobrança após excluir pagamento', async () => {
  const api = handler(new FakeDb());
  assert.equal((await call(api, 'POST', 'patients', { id: 'patient-finance', name: 'TESTE HOMOLOGAÇÃO R107', phone: '27999999998', preferredModality: 'presencial' })).statusCode, 201);
  assert.equal((await call(api, 'POST', 'charges', { id: 'charge-r107', patientId: 'patient-finance', description: 'Cobrança sintética', amount: 200, status: 'pending' })).statusCode, 201);
  assert.equal((await call(api, 'POST', 'payments', { id: 'payment-r107', chargeId: 'charge-r107', patientId: 'patient-finance', amount: 80, date: '2026-08-29', method: 'PIX', status: 'active' })).statusCode, 201);

  const blockedCharge = await call(api, 'DELETE', 'charges/charge-r107');
  assert.equal(blockedCharge.statusCode, 409);
  assert.equal(blockedCharge.body.error.code, 'psychology/charge-delete-blocked-by-payments');

  const deletedPayment = await call(api, 'DELETE', 'payments/payment-r107');
  assert.equal(deletedPayment.statusCode, 200);
  const chargeAfterPayment = await call(api, 'GET', 'charges/charge-r107');
  assert.equal(chargeAfterPayment.body.items[0].id, 'charge-r107');
  assert.equal(chargeAfterPayment.body.items[0].status, 'pending');
  assert.equal((await call(api, 'DELETE', 'charges/charge-r107')).statusCode, 200);
  assert.equal((await call(api, 'GET', 'charges/charge-r107')).body.items.length, 0);

  assert.equal((await call(api, 'POST', 'expenses', { id: 'expense-r107', description: 'Despesa sintética', amount: 50, date: '2026-08-29', category: 'Outros', status: 'REALIZED' })).statusCode, 201);
  assert.equal((await call(api, 'DELETE', 'expenses/expense-r107')).statusCode, 200);
  assert.equal((await call(api, 'GET', 'expenses/expense-r107')).body.items.length, 0);
});

test('R107 API impede exclusão de pacote com dependência e permite excluir pacote nunca utilizado', async () => {
  const api = handler(new FakeDb());
  assert.equal((await call(api, 'POST', 'patients', { id: 'patient-package-delete', name: 'TESTE HOMOLOGAÇÃO R107', phone: '27999999997', preferredModality: 'presencial' })).statusCode, 201);
  const packageBody = { patientId: 'patient-package-delete', serviceId: 'psychotherapy-individual', totalSessions: 5, usedSessions: 0, startDate: '2026-08-29', active: true, price: 1000, pricePerSession: 200, totalPrice: 1000 };
  assert.equal((await call(api, 'POST', 'packages', { ...packageBody, id: 'package-free', name: 'Pacote livre' })).statusCode, 201);
  assert.equal((await call(api, 'DELETE', 'packages/package-free')).statusCode, 200);

  assert.equal((await call(api, 'POST', 'packages', { ...packageBody, id: 'package-linked', name: 'Pacote vinculado' })).statusCode, 201);
  assert.equal((await call(api, 'POST', 'charges', { id: 'charge-package-linked', patientId: 'patient-package-delete', packageId: 'package-linked', serviceId: 'psychotherapy-individual', description: 'Cobrança do pacote', amount: 1000, status: 'pending' })).statusCode, 201);
  const blocked = await call(api, 'DELETE', 'packages/package-linked');
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error.code, 'psychology/package-delete-blocked-by-dependencies');
});
