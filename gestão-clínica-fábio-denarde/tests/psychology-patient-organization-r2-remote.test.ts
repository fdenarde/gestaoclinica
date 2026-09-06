import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPsychologyRemotePatientClient,
  createPsychologyPersistenceScope,
} from '../src/features/psychology-persistence';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  filterPsychologyPatientList,
  formatPsychologyPatientPhone,
  getPsychologyPatientListViewModels,
  sortPsychologyPatientList,
} from '../src/features/psychology-pilot/psychologyPatientList';
import { normalizePhoneForIntegration } from '../shared/phoneNormalization.js';
import { deletePsychologyPatientSafely } from '../api/_lib/psychologyPatientDeletion.js';

const initialScope = createPsychologyPersistenceScope('browser-placeholder', 'browser-placeholder');
const serverScope = createPsychologyPersistenceScope('professional-remote-synthetic', 'workspace-remote-synthetic');
const now = '2026-08-24T12:00:00.000Z';

function base(id: string) {
  return { id, workspaceId: serverScope.workspaceId, professionalId: serverScope.professionalId, context: serverScope.context, createdAt: now, updatedAt: now };
}

const patientA = { ...base('patient-a'), name: 'Ana Remota', birthDate: '1990-01-01', phone: '+55 27 99991-3553', email: 'ana@synthetic.test', preferredModality: 'online' as const, administrativeNote: '', active: true };
const patientB = { ...base('patient-b'), name: 'Bia Sem Marca', birthDate: '1991-01-01', phone: '5527999913554', email: 'bia@synthetic.test', preferredModality: 'presencial' as const, administrativeNote: '', active: false };
const sessionA = { ...base('session-a'), patientId: 'patient-a', date: '2026-08-30', time: '09:00', durationMinutes: 50, modality: 'online' as const, status: 'agendada' as const };

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function createRemoteFixture() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const settings = createEmptyPsychologyStore(createPsychologyScope(serverScope.professionalId)).settings;
  const patients = new Map<string, any>([[patientA.id, patientA], [patientB.id, patientB]]);
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const path = url.replace('/api/psychology', '');
    if (method === 'GET' && path === '/patients') return response({ scope: serverScope, items: [...patients.values()] });
    if (method === 'GET' && path === '/sessions') return response({ scope: serverScope, items: [sessionA] });
    if (method === 'GET' && path === '/settings') return response({ scope: serverScope, settings: { ...settings, scope: createPsychologyScope(serverScope.professionalId) } });
    if (method === 'PATCH' && path.startsWith('/patients/')) {
      const id = decodeURIComponent(path.split('/').pop() || '');
      const current = patients.get(id);
      if (!current) return response({ error: { code: 'not-found', message: 'not found' } }, 404);
      const next = { ...current, ...body, updatedAt: now };
      patients.set(id, next);
      return response({ scope: serverScope, patient: next });
    }
    if (method === 'DELETE' && path === '/patients/patient-a') return response({ scope: serverScope, id: 'patient-a', deleted: false, preserved: true, active: false });
    if (method === 'DELETE' && path === '/patients/patient-b') return response({ error: { code: 'synthetic-failure', message: 'falha sintética' } }, 503);
    return response({ error: { code: 'unexpected', message: `${method} ${path}` } }, 500);
  };
  const client = createPsychologyRemotePatientClient({
    scope: initialScope,
    api: { getToken: async () => 'synthetic-token', fetchImpl },
    now: () => now,
  });
  return { client, calls };
}

test('R2 remoto 01 — provider carrega pacientes, sessões e settings no escopo devolvido pelo servidor', async () => {
  const { client, calls } = createRemoteFixture();
  const store = await client.load();
  assert.equal(store.patients.length, 2);
  assert.equal(store.sessions.length, 1);
  assert.equal(client.scope.workspaceId, serverScope.workspaceId);
  assert.equal(client.scope.professionalId, serverScope.professionalId);
  assert.equal(calls.filter(call => call.method === 'GET').length, 3);
});

test('R2 remoto 02 — cartões, busca, filtros e ordenação continuam locais após a carga', async () => {
  const { client, calls } = createRemoteFixture();
  const store = await client.load();
  const rows = getPsychologyPatientListViewModels(store, store.patients, new Date('2026-08-24T12:00:00.000Z'));
  const beforeLocalDerivations = calls.length;
  assert.equal(filterPsychologyPatientList(rows, { query: 'ana' }).length, 1);
  assert.equal(filterPsychologyPatientList(rows, { nextSession: 'without' }).length, 1);
  assert.equal(sortPsychologyPatientList(rows, 'name', 'desc')[0].patient.name, 'Bia Sem Marca');
  assert.equal(calls.length, beforeLocalDerivations);
});

test('R2 remoto 03 — paciente sem inReview legado fica fora da revisão', async () => {
  const { client } = createRemoteFixture();
  const store = await client.load();
  assert.equal(store.patients.every(patient => patient.inReview !== true), true);
  const rows = getPsychologyPatientListViewModels(store, store.patients);
  assert.equal(filterPsychologyPatientList(rows, { review: 'out-of-review' }).length, 2);
});

test('R2 remoto 04 — marcar e retirar Em revisão persistem somente os IDs selecionados', async () => {
  const { client, calls } = createRemoteFixture();
  await client.load();
  const marked = await client.updatePatientReview(['patient-a'], true);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].inReview, true);
  assert.equal(marked[0].reviewMarkedAt, now);
  const unmarked = await client.updatePatientReview(['patient-a'], false);
  assert.equal(unmarked[0].inReview, false);
  const patches = calls.filter(call => call.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[0].body, { inReview: true, reviewMarkedAt: now });
  assert.deepEqual(patches[1].body, { inReview: false });
});

test('R2 remoto 05 — exclusão coletiva usa operação individual protegida e preserva falha por paciente', async () => {
  const { client, calls } = createRemoteFixture();
  await client.load();
  const result = await client.deletePatients(['patient-a', 'patient-b']);
  assert.deepEqual(result.summary, { processed: 2, deleted: 0, preserved: 1, failed: 1 });
  assert.deepEqual(result.preservedIds, ['patient-a']);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 2);
});

test('R2 remoto 06 — lista não cria query de contador, listener ou N+1 ao filtrar', () => {
  const source = readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  const start = source.indexOf('function PatientsView(');
  const end = source.indexOf('\nfunction psychologyLegendLabel', start);
  const patientsView = source.slice(start, end);
  assert.doesNotMatch(patientsView, /fetch\s*\(|onSnapshot\s*\(|getDocs\s*\(|query\s*\(/);
  assert.match(patientsView, /countPsychologyPatientList\(baseRows\)/);
  assert.match(patientsView, /filteredRows/);
});

test('R2 remoto 07 — +55 e 55 ficam nacionais na apresentação sem alterar o valor técnico', () => {
  const expected = '(27) 99991-3553';
  for (const value of ['+55 27 99991-3553', '5527999913553', "'5527999913553", '(27) 99991-3553', '27999913553']) {
    assert.equal(formatPsychologyPatientPhone(value), expected, value);
  }
  const technical = normalizePhoneForIntegration('+55 27 99991-3553');
  assert.equal(technical.canonicalPhone, '5527999913553');
  assert.equal(technical.whatsappRecipientId, '5527999913553');
  assert.equal(/^(?:\+?55\b)/u.test(formatPsychologyPatientPhone('5527999913553')), false);
});

test('R2 remoto 08 — proteção individual remota preserva pagamento concluído e remove PII do paciente', async () => {
  const patient = { ...patientA };
  const sessions = new Map([['session-a', sessionA]]);
  const sessionRecords = new Map([['record-a', { ...base('record-a'), patientId: 'patient-a', sessionId: 'session-a' }]]);
  const charges = new Map([
    ['charge-paid', { ...base('charge-paid'), patientId: 'patient-a', sessionId: 'session-a', description: 'paga', amount: 100, status: 'paid' }],
    ['charge-pending', { ...base('charge-pending'), patientId: 'patient-a', sessionId: 'session-a', description: 'pendente', amount: 80, status: 'pending' }],
  ]);
  const payments = new Map([
    ['payment-paid', { ...base('payment-paid'), patientId: 'patient-a', chargeId: 'charge-paid', sessionId: 'session-a', amount: 100, status: 'active' }],
    ['payment-pending', { ...base('payment-pending'), patientId: 'patient-a', chargeId: 'charge-pending', sessionId: 'session-a', amount: 80, status: 'active', reversedAt: now }],
  ]);
  const deletedPatients: string[] = [];
  const repository = {
    patients: { get: async () => patient, deleteKnown: async (current: { id: string }) => { deletedPatients.push(current.id); return { id: current.id }; } },
    sessions: { listByPatientId: async () => [...sessions.values()], deleteKnown: async (current: { id: string }) => { sessions.delete(current.id); return { id: current.id }; } },
    sessionRecords: { listByPatientOrSessionIds: async () => [...sessionRecords.values()], deleteKnown: async (current: { id: string }) => { sessionRecords.delete(current.id); return { id: current.id }; } },
    financial: {
      listChargesByPatientOrSessionIds: async () => [...charges.values()],
      listPaymentsByPatientOrSessionOrChargeIds: async () => [...payments.values()],
      updateChargeKnown: async (current: { id: string }, patch: Record<string, unknown>) => { charges.set(current.id, { ...charges.get(current.id), ...patch }); return charges.get(current.id); },
      updatePaymentKnown: async (current: { id: string }, patch: Record<string, unknown>) => { payments.set(current.id, { ...payments.get(current.id), ...patch }); return payments.get(current.id); },
    },
    packages: { listByPatientId: async () => [], deleteKnown: async (current: { id: string }) => ({ id: current.id }) },
    documents: { listByPatientId: async () => [], deleteKnown: async (current: { id: string }) => ({ id: current.id }) },
    attachments: { listByPatientOrSessionRecordIds: async () => [], deleteKnown: async (current: { id: string }) => ({ id: current.id }) },
  };
  const result = await deletePsychologyPatientSafely({ repository, patientId: 'patient-a', now });
  assert.deepEqual(result, { id: 'patient-a', deleted: true, preserved: true, active: false });
  assert.deepEqual(deletedPatients, ['patient-a']);
  assert.equal(payments.get('payment-paid')?.patientId, null);
  assert.equal(payments.get('payment-paid')?.status, 'active');
  assert.equal(payments.get('payment-pending')?.status, 'voided');
  assert.equal(charges.get('charge-paid')?.patientId, null);
  assert.equal(charges.get('charge-pending')?.status, 'cancelled');
});
