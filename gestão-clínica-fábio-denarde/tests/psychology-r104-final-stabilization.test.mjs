import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyRemotePatientClient } from '../src/features/psychology-persistence/remotePatientClient.ts';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope.ts';
import {
  createEmptyPsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain.ts';
import {
  colorForAgendaCategory,
  createDefaultPsychologySettings,
  PSYCHOLOGY_COLOR_DEFAULTS,
  resolvePsychologyAgendaEventStyle,
  normalizePsychologySettings,
} from '../src/features/psychology-pilot/psychologyR2a.ts';
import {
  createPsychologyChargeInLedger,
  createPsychologyExpenseInLedger,
  createPsychologyPaymentInLedger,
  getPsychologyFinancialOverview,
} from '../src/features/psychology-pilot/psychologyFinancialLedger.ts';

const NOW = '2026-08-29T12:00:00.000Z';
const WORKSPACE = 'workspace-r104-synthetic';
const PROFESSIONAL = 'professional-r104-synthetic';
const TENANT = 'tenant-r104-synthetic';
const PATIENT_ID = 'patient-r104-synthetic';

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
  constructor(store, path, field, operator, value) { this.store = store; this.path = path; this.field = field; this.operator = operator; this.value = value; }
  async get() {
    const prefix = `${this.path}/`;
    return { docs: [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) }))
      .filter(snapshot => {
        const candidate = snapshot.data()?.[this.field];
        return this.operator === 'in' ? this.value.includes(candidate) : candidate === this.value;
      }) };
  }
}

class FakeCollection {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new FakeDocument(this.store, this.path, id); }
  where(field, operator, value) { return new FakeQuery(this.store, this.path, field, operator, value); }
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

function scopeForToken(token) {
  const base = {
    workspaceId: WORKSPACE,
    tenantId: TENANT,
    professionalId: PROFESSIONAL,
    context: 'PSICOLOGIA',
    bindingMode: 'synthetic',
    permissions: ['patients.list', 'patients.create', 'finance.patient.view', 'finance.manage'],
  };
  if (token === 'wrong-workspace') return { ...base, workspaceId: 'workspace-r104-other' };
  if (token === 'wrong-professional') return { ...base, professionalId: 'professional-r104-other' };
  if (token === 'wrong-context') return { ...base, context: 'NEUROPSICOPEDAGOGIA' };
  if (token === 'no-finance') return { ...base, permissions: ['patients.list', 'patients.create'] };
  return base;
}

function syntheticHandler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (req, options = {}) => {
      const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      const scope = scopeForToken(token);
      for (const permission of options.requiredPermissions || []) {
        if (!scope.permissions.includes(permission)) throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
      }
      return Object.freeze(scope);
    },
    auditLogger: () => {},
  });
}

async function call(handler, method, path, token = 'own', body, idempotencyKey) {
  const req = {
    method,
    url: `/api/psychology?path=${encodeURIComponent(path)}`,
    query: { path },
    headers: { authorization: `Bearer ${token}`, ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body }),
  };
  const response = capture();
  await handler(req, response);
  return response;
}

function patientPayload() {
  return { id: PATIENT_ID, name: 'Paciente sintético R104', birthDate: '1990-01-01', phone: '27999901040', preferredModality: 'presencial', active: true };
}

test('R104 contrato financeiro remoto passa pelo adapter real e carrega os três agregados', async () => {
  const scope = createPsychologyPersistenceScope(PROFESSIONAL, WORKSPACE);
  const requests = [];
  const patient = { ...patientPayload(), workspaceId: WORKSPACE, professionalId: PROFESSIONAL, context: 'PSICOLOGIA' };
  const charge = { id: 'charge-r104-adapter', patientId: PATIENT_ID, professionalId: PROFESSIONAL, context: 'PSICOLOGIA', description: 'Teste', amount: 100, status: 'pending', createdAt: NOW, updatedAt: NOW };
  const payment = { id: 'payment-r104-adapter', chargeId: charge.id, patientId: PATIENT_ID, professionalId: PROFESSIONAL, context: 'PSICOLOGIA', amount: 40, date: '2026-08-29', method: 'PIX', status: 'active', createdAt: NOW, updatedAt: NOW };
  const expense = { id: 'expense-r104-adapter', professionalId: PROFESSIONAL, context: 'PSICOLOGIA', description: 'Teste', amount: 10, date: '2026-08-29', category: 'Outros', status: 'REALIZED', createdAt: NOW, updatedAt: NOW };
  const client = createPsychologyRemotePatientClient({
    scope,
    now: () => NOW,
    api: {
      getToken: async () => 'synthetic-token',
      fetchImpl: async (url, init = {}) => {
        const parsed = new URL(String(url), 'http://localhost');
        const method = init.method || 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ path: parsed.pathname, method, body });
        const payload = { scope: { workspaceId: WORKSPACE, professionalId: PROFESSIONAL, context: 'PSICOLOGIA' } };
        if (method === 'GET' && parsed.pathname.endsWith('/patients')) return new Response(JSON.stringify({ ...payload, items: [patient] }), { status: 200 });
        if (method === 'GET' && parsed.pathname.endsWith('/sessions')) return new Response(JSON.stringify({ ...payload, items: [] }), { status: 200 });
        if (method === 'GET' && parsed.pathname.endsWith('/personal-appointments')) return new Response(JSON.stringify({ ...payload, items: [] }), { status: 200 });
        if (method === 'GET' && parsed.pathname.endsWith('/charges')) return new Response(JSON.stringify({ ...payload, items: [charge] }), { status: 200 });
        if (method === 'GET' && parsed.pathname.endsWith('/payments')) return new Response(JSON.stringify({ ...payload, items: [payment] }), { status: 200 });
        if (method === 'GET' && parsed.pathname.endsWith('/expenses')) return new Response(JSON.stringify({ ...payload, items: [expense] }), { status: 200 });
        if (method === 'GET' && parsed.pathname.endsWith('/settings')) return new Response(JSON.stringify({ ...payload, settings: {} }), { status: 200 });
        if (method === 'POST' && parsed.pathname.endsWith('/charges')) return new Response(JSON.stringify({ ...payload, item: body }), { status: 201 });
        if (method === 'POST' && parsed.pathname.endsWith('/payments')) return new Response(JSON.stringify({ ...payload, item: body }), { status: 201 });
        if (method === 'POST' && parsed.pathname.endsWith('/expenses')) return new Response(JSON.stringify({ ...payload, item: body }), { status: 201 });
        throw new Error(`Rota sintética inesperada: ${method} ${parsed.pathname}`);
      },
    },
  });
  const loaded = await client.load();
  assert.equal(loaded.charges.length, 1);
  assert.equal(loaded.payments.length, 1);
  assert.equal(loaded.expenses.length, 1);
  await client.repositories.financial.upsertCharge(scope, charge);
  await client.repositories.financial.createPayment(scope, payment);
  await client.repositories.financial.upsertExpense(scope, expense);
  assert.deepEqual(requests.slice(-3).map(request => [request.method, request.path]), [
    ['POST', '/api/psychology/charges'],
    ['POST', '/api/psychology/payments'],
    ['POST', '/api/psychology/expenses'],
  ]);
});

test('R104 API cria cobrança, pagamento e despesa no mesmo escopo e mantém idempotência', async () => {
  const db = new FakeDb();
  const handler = syntheticHandler(db);
  assert.equal((await call(handler, 'POST', 'patients', 'own', patientPayload())).statusCode, 201);
  const chargeBody = { id: 'charge-r104-api', patientId: PATIENT_ID, description: 'Homologação R104', amount: 120, dueDate: '2026-08-29', status: 'pending' };
  const firstCharge = await call(handler, 'POST', 'charges', 'own', chargeBody, 'r104-charge-once');
  const secondCharge = await call(handler, 'POST', 'charges', 'own', chargeBody, 'r104-charge-once');
  assert.equal(firstCharge.statusCode, 201);
  assert.equal(secondCharge.statusCode, 201);
  assert.equal(secondCharge.body.item.id, chargeBody.id);
  assert.equal((await call(handler, 'POST', 'payments', 'own', { id: 'payment-r104-api', chargeId: chargeBody.id, patientId: PATIENT_ID, amount: 120, date: '2026-08-29', method: 'PIX', status: 'active' })).statusCode, 201);
  assert.equal((await call(handler, 'POST', 'expenses', 'own', { id: 'expense-r104-api', description: 'Homologação R104', amount: 20, date: '2026-08-29', category: 'Outros', status: 'REALIZED' })).statusCode, 201);
  const ownItems = await call(handler, 'GET', 'charges', 'own');
  assert.equal(ownItems.statusCode, 200);
  assert.equal(ownItems.body.items.length, 1);
});

test('R104 API rejeita workspace, profissional, contexto e ausência de permissão sem gravar', async () => {
  const db = new FakeDb();
  const handler = syntheticHandler(db);
  assert.equal((await call(handler, 'POST', 'patients', 'own', patientPayload())).statusCode, 201);
  const body = { id: 'charge-r104-denied', patientId: PATIENT_ID, description: 'Não gravar', amount: 10, status: 'pending' };
  assert.equal((await call(handler, 'POST', 'charges', 'wrong-workspace', { ...body, workspaceId: WORKSPACE })).statusCode, 422);
  assert.equal((await call(handler, 'POST', 'charges', 'wrong-professional', { ...body, professionalId: PROFESSIONAL })).statusCode, 422);
  assert.equal((await call(handler, 'POST', 'charges', 'wrong-context', { ...body, context: 'NEUROPSICOPEDAGOGIA' })).statusCode, 422);
  assert.equal((await call(handler, 'POST', 'charges', 'no-finance', body)).statusCode, 403);
  assert.equal((await call(handler, 'GET', 'charges', 'own')).body.items.length, 0);
});

test('R104 ledger mantém domínio financeiro existente e recalcula resumo após as três operações', () => {
  let store = createEmptyPsychologyStore({ professionalId: PROFESSIONAL, context: 'PSICOLOGIA' });
  store = { ...store, patients: [{ ...patientPayload(), professionalId: PROFESSIONAL, context: 'PSICOLOGIA', createdAt: NOW, updatedAt: NOW }] };
  const chargeResult = createPsychologyChargeInLedger(store, { patientId: PATIENT_ID, description: 'Cobrança R104', amount: 120, dueDate: '2026-08-29' }, NOW);
  assert.ok(chargeResult.charge);
  const paymentResult = createPsychologyPaymentInLedger(chargeResult.store, { chargeId: chargeResult.charge.id, patientId: PATIENT_ID, amount: 120, date: '2026-08-29', method: 'PIX' }, NOW);
  assert.ok(paymentResult.payment);
  const expenseResult = createPsychologyExpenseInLedger(paymentResult.store, { description: 'Despesa R104', amount: 20, date: '2026-08-29', category: 'Outros', status: 'REALIZED' }, NOW);
  assert.ok(expenseResult.expense);
  const overview = getPsychologyFinancialOverview(expenseResult.store, { preset: 'custom', startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.equal(overview.received, 120);
  assert.equal(overview.expenses, 20);
  assert.equal(overview.balance, 100);
});

test('R104 Mentoria usa o token marrom central em todas as superfícies sem herdar Online', () => {
  const defaults = createDefaultPsychologySettings({ professionalId: PROFESSIONAL, context: 'PSICOLOGIA' });
  assert.equal(PSYCHOLOGY_COLOR_DEFAULTS.MENTORING, '#C9823B');
  assert.equal(colorForAgendaCategory({ ...defaults.colors, MENTORING: defaults.colors.ONLINE }, 'MENTORING'), '#C9823B');
  const normalized = normalizePsychologySettings({ colors: { ONLINE: '#16A34A', MENTORING: '#16A34A' } }, defaults.scope);
  assert.equal(normalized.colors.MENTORING, '#C9823B');
  const style = resolvePsychologyAgendaEventStyle({ source: 'MENTORING', colors: normalized.colors });
  assert.equal(style.baseColor, '#C9823B');
  const source = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  assert.match(source, /resolvePsychologyAgendaEventStyle\(\{ source: commitment\.type === 'Mentoria' \? 'MENTORING'/);
  assert.match(source, /colorForAgendaCategory\(settings\.colors, category\)/);
});

test('R104 fecha o estado correto do modal após sucesso e mantém ambos abertos em falha', () => {
  const source = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  assert.match(source, /setSessionDialog\(null\);\s*setNewEventDialog\(null\);\s*setSessionPatientId\(undefined\);/);
  assert.match(source, /setNotice\(cause instanceof Error \? cause\.message : 'Não foi possível salvar a sessão no provider remoto\.'/);
  assert.match(source, /data-testid="psychology-event-mutation-processing"/);
  assert.match(source, /onRemoteMutation=\{remoteConfiguration\.enabled \? persistRemoteFinanceMutation/);
});
