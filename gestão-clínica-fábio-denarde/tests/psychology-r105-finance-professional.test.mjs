import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyRemotePatientClient } from '../src/features/psychology-persistence/remotePatientClient.ts';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope.ts';
import { createEmptyPsychologyStore } from '../src/features/psychology-pilot/psychologyDomain.ts';
import { isPsychologyMentoringService, resolvePsychologyAgendaEventStyle, createDefaultPsychologySettings } from '../src/features/psychology-pilot/psychologyR2a.ts';
import { formatPsychologyMoneyInput, parsePsychologyMoney } from '../src/features/psychology-pilot/psychologyMoney.ts';
import {
  cancelPsychologyCharge,
  createPsychologyChargeInLedger,
  createPsychologyExpenseInLedger,
  createPsychologyPaymentInLedger,
  createPsychologySessionPackageInLedger,
  reactivatePsychologyCharge,
  reactivatePsychologyExpense,
  reactivatePsychologyPayment,
  reversePsychologyExpense,
  reversePsychologyPayment,
  updatePsychologyChargeInLedger,
  updatePsychologyExpenseInLedger,
  updatePsychologyPaymentInLedger,
} from '../src/features/psychology-pilot/psychologyFinancialLedger.ts';

const NOW = '2026-08-29T12:00:00.000Z';
const WORKSPACE = 'workspace-r105-synthetic';
const PROFESSIONAL = 'professional-r105-synthetic';
const PATIENT_ID = 'patient-r105-synthetic';

class FakeDocument {
  constructor(store, path, id) { this.store = store; this.path = path; this.id = id; }
  async get() { const value = this.store.get(`${this.path}/${this.id}`); return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined }; }
  async set(value) { this.store.set(`${this.path}/${this.id}`, structuredClone(value)); }
  async delete() { this.store.delete(`${this.path}/${this.id}`); }
}
class FakeCollection {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new FakeDocument(this.store, this.path, id); }
  async get() { const prefix = `${this.path}/`; return { docs: [...this.store.entries()].filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0).map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })) }; }
  where(field, operator, value) { return { get: async () => { const all = await this.get(); return { docs: all.docs.filter(snapshot => operator === 'in' ? value.includes(snapshot.data()?.[field]) : snapshot.data()?.[field] === value) }; } }; }
}
class FakeDb { constructor() { this.store = new Map(); } collection(path) { return new FakeCollection(this.store, path); } }
function response() { return { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; }
function scopeForToken(token) { const base = ['patients.create', 'patients.list']; return { workspaceId: WORKSPACE, tenantId: 'tenant-r105-synthetic', professionalId: PROFESSIONAL, context: 'PSICOLOGIA', bindingMode: 'synthetic', permissions: token === 'no-finance' ? base : [...base, 'finance.patient.view', 'finance.manage'] }; }
function handlerFor(db) { return createPsychologyApiHandler({ getDb: () => db, now: () => NOW, resolveAccess: async (req, options = {}) => { const scope = scopeForToken(String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')); for (const permission of options.requiredPermissions || []) if (!scope.permissions.includes(permission)) throw Object.assign(new Error('Permissão negada.'), { code: 'access/permission-denied', statusCode: 403 }); return Object.freeze(scope); }, auditLogger: () => {} }); }
async function call(handler, method, path, token = 'own', body) { const req = { method, url: `/api/psychology?path=${encodeURIComponent(path)}`, query: { path }, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body }) }; const res = response(); await handler(req, res); return res; }
function patient() { return { id: PATIENT_ID, name: 'Paciente sintético R105', birthDate: '1990-01-01', phone: '27999901050', preferredModality: 'presencial', active: true, professionalId: PROFESSIONAL, context: 'PSICOLOGIA' }; }

test('R105 dinheiro aceita BRL brasileira sem deslocar casas decimais', () => {
  assert.equal(parsePsychologyMoney('250'), 250);
  assert.equal(parsePsychologyMoney('250,5'), 250.5);
  assert.equal(parsePsychologyMoney('R$ 1.250,00'), 1250);
  assert.equal(formatPsychologyMoneyInput('250').replace(/\u00a0/g, ' '), 'R$ 250,00');
  assert.equal(formatPsychologyMoneyInput('250,5').replace(/\u00a0/g, ' '), 'R$ 250,50');
});

test('R105 ledger permite descrição vazia e preserva edição, cancelamento e reativação', () => {
  let store = createEmptyPsychologyStore({ professionalId: PROFESSIONAL, context: 'PSICOLOGIA' });
  store = { ...store, patients: [{ ...patient(), createdAt: NOW, updatedAt: NOW }] };
  const chargeResult = createPsychologyChargeInLedger(store, { patientId: PATIENT_ID, description: '', amount: 100 }, NOW);
  assert.ok(chargeResult.charge);
  store = chargeResult.store;
  const edited = updatePsychologyChargeInLedger(store, chargeResult.charge.id, { description: 'Sessão avulsa', amount: 120 }, NOW);
  assert.equal(edited.charge.description, 'Sessão avulsa');
  const paid = createPsychologyPaymentInLedger(edited.store, { chargeId: chargeResult.charge.id, patientId: PATIENT_ID, amount: 50, date: '2026-08-29', method: 'PIX' }, NOW);
  const paymentEdited = updatePsychologyPaymentInLedger(paid.store, paid.payment.id, { amount: 40, method: 'CARD' }, NOW);
  const reversedPayment = reversePsychologyPayment(paymentEdited.store, paid.payment.id, 'Correção sintética', PROFESSIONAL, NOW);
  const activePayment = reactivatePsychologyPayment(reversedPayment.store, paid.payment.id, NOW);
  assert.equal(activePayment.payment.reversalReason, 'Correção sintética');
  assert.equal(activePayment.payment.reactivatedBy, PROFESSIONAL);
  const canceled = cancelPsychologyCharge(activePayment.store, chargeResult.charge.id, 'Correção sintética', PROFESSIONAL, NOW);
  const reactivated = reactivatePsychologyCharge(canceled.store, chargeResult.charge.id, PROFESSIONAL, NOW);
  assert.equal(reactivated.charge.status, 'partial');
  assert.equal(reactivated.charge.id, chargeResult.charge.id);
  assert.equal(reactivated.charge.cancellationReason, 'Correção sintética');
  assert.equal(reactivated.charge.reactivatedBy, PROFESSIONAL);
});

test('R105 despesas são editáveis e reversíveis sem apagar histórico', () => {
  let store = createEmptyPsychologyStore({ professionalId: PROFESSIONAL, context: 'PSICOLOGIA' });
  const created = createPsychologyExpenseInLedger(store, { description: '', amount: 25, date: '2026-08-29', category: 'Outros', status: 'REALIZED' }, NOW);
  const edited = updatePsychologyExpenseInLedger(created.store, created.expense.id, { description: 'Sala', amount: 30 }, NOW);
  const reversed = reversePsychologyExpense(edited.store, created.expense.id, 'Correção sintética', PROFESSIONAL, NOW);
  const reactivated = reactivatePsychologyExpense(reversed.store, created.expense.id, NOW);
  assert.equal(reactivated.expense.id, created.expense.id);
  assert.equal(reactivated.expense.description, 'Sala');
  assert.equal(reactivated.expense.status, 'REALIZED');
  assert.equal(reactivated.expense.reversalReason, 'Correção sintética');
});

test('R105 pacote usa paciente, serviço, quantidade, valor por sessão e total calculado', () => {
  let store = createEmptyPsychologyStore({ professionalId: PROFESSIONAL, context: 'PSICOLOGIA' });
  store = { ...store, patients: [{ ...patient(), createdAt: NOW, updatedAt: NOW }] };
  const service = store.services[0];
  const result = createPsychologySessionPackageInLedger(store, { patientId: PATIENT_ID, name: `${service.name} · 5 sessões`, serviceId: service.id, totalSessions: 5, pricePerSession: 80, totalPrice: 400, price: 400, startDate: '2026-08-29' }, NOW);
  assert.ok(result.sessionPackage);
  assert.equal(result.sessionPackage.serviceId, service.id);
  assert.equal(result.sessionPackage.totalSessions, 5);
  assert.equal(result.sessionPackage.totalPrice, 400);
  const charge = createPsychologyChargeInLedger(result.store, { patientId: PATIENT_ID, description: '', amount: 400, serviceId: service.id, packageId: result.sessionPackage.id }, NOW);
  assert.ok(charge.charge);
  const payment = createPsychologyPaymentInLedger(charge.store, { chargeId: charge.charge.id, patientId: PATIENT_ID, amount: 400, date: '2026-08-29', method: 'PIX' }, NOW);
  assert.equal(payment.payment.amount, 400);
  assert.equal(payment.store.charges[0].status, 'paid');
});

test('R105 Mentoria vence modalidade e mantém marrom nas superfícies de estilo', () => {
  const settings = createDefaultPsychologySettings({ professionalId: PROFESSIONAL, context: 'PSICOLOGIA' });
  for (const modality of ['online', 'presencial']) {
    const style = resolvePsychologyAgendaEventStyle({ source: 'SESSION', serviceName: 'Mentoria', modality, colors: settings.colors });
    assert.equal(style.baseColor, '#C8803E');
  }
  assert.equal(isPsychologyMentoringService('Mentoria online'), true);
  const source = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyFinanceView.tsx', import.meta.url), 'utf8');
  assert.match(source, /Descrição \(opcional\)/);
  assert.match(source, /Novo pacote/);
  assert.match(source, /Reativar/);
});

test('R105 API permite escrita de pacote somente com finance.manage', async () => {
  const db = new FakeDb();
  const handler = handlerFor(db);
  assert.equal((await call(handler, 'POST', 'patients', 'own', patient())).statusCode, 201);
  const packageBody = { id: 'package-r105-api', patientId: PATIENT_ID, name: 'Psicoterapia · 5 sessões', totalSessions: 5, usedSessions: 0, startDate: '2026-08-29', active: true, pricePerSession: 80, totalPrice: 400 };
  const denied = await call(handler, 'POST', 'packages', 'no-finance', packageBody);
  assert.equal(denied.statusCode, 403);
  const allowed = await call(handler, 'POST', 'packages', 'own', packageBody);
  assert.equal(allowed.statusCode, 201);
  assert.equal(allowed.body.item.id, packageBody.id);
  const packageCharge = await call(handler, 'POST', 'charges', 'own', { id: 'charge-r105-package', patientId: PATIENT_ID, packageId: packageBody.id, description: '', amount: 400, status: 'pending' });
  assert.equal(packageCharge.statusCode, 201);
  assert.equal(packageCharge.body.item.description, '');
  const packagePayment = await call(handler, 'POST', 'payments', 'own', { id: 'payment-r105-package', chargeId: 'charge-r105-package', patientId: PATIENT_ID, amount: 400, date: '2026-08-29', method: 'PIX', status: 'active' });
  assert.equal(packagePayment.statusCode, 201);
  const wrongTotal = await call(handler, 'POST', 'charges', 'own', { id: 'charge-r105-package-wrong', patientId: PATIENT_ID, packageId: packageBody.id, amount: 80, status: 'pending' });
  assert.equal(wrongTotal.statusCode, 422);
});

test('R105 remote load inclui pacotes sem acessar dados clínicos', async () => {
  const requests = [];
  const scope = createPsychologyPersistenceScope(PROFESSIONAL, WORKSPACE);
  const client = createPsychologyRemotePatientClient({ scope, api: { getToken: async () => 'synthetic-token', fetchImpl: async (url, init = {}) => { const parsed = new URL(String(url), 'http://localhost'); requests.push([init.method || 'GET', parsed.pathname]); const payload = { scope: { workspaceId: WORKSPACE, professionalId: PROFESSIONAL, context: 'PSICOLOGIA' } }; if (parsed.pathname.endsWith('/settings')) return new Response(JSON.stringify({ ...payload, settings: {} }), { status: 200 }); if (parsed.pathname.endsWith('/packages')) return new Response(JSON.stringify({ ...payload, items: [{ id: 'package-r105-load', patientId: PATIENT_ID, name: 'Pacote', totalSessions: 3, usedSessions: 0, startDate: '2026-08-29', active: true }] }), { status: 200 }); return new Response(JSON.stringify({ ...payload, items: [] }), { status: 200 }); } } });
  const loaded = await client.load();
  assert.equal(loaded.sessionPackages.length, 1);
  assert.ok(requests.some(([method, path]) => method === 'GET' && path.endsWith('/packages')));
  assert.equal(requests.some(([, path]) => path.endsWith('/session-records')), false);
});
