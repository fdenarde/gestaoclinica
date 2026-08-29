import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { DayView } from '../src/features/psychology-pilot/PsychologyPilot';
import {
  createEmptyPsychologyStore,
  type PsychologyPatient,
  type PsychologySession,
  type PsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  createPsychologyChargeInLedger,
  createPsychologyPaymentInLedger,
} from '../src/features/psychology-pilot/psychologyFinancialLedger';
import {
  deriveOperationalPendencies,
  OPERATIONAL_ALERT_INITIAL_LIMIT,
  SESSION_PENDING_ALERT_LOOKBACK_DAYS,
} from '../src/features/psychology-pilot/psychologyOperationalAlerts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { activeElement: null } as Document;

const reference = new Date('2026-08-29T12:00:00-03:00');
const scope = { professionalId: 'r108-professional-synthetic', context: 'PSICOLOGIA' as const };
const emptyStore = createEmptyPsychologyStore(scope);
const service = emptyStore.services.find(item => item.id === 'psychotherapy-individual')!;

function patient(id: string, active: boolean | undefined = true): PsychologyPatient {
  return {
    id,
    ...scope,
    name: `Paciente Sintético ${id}`,
    dateOfBirth: '1990-01-01',
    phone: '27999999999',
    preferredModality: 'presencial',
    active: active as boolean,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

function session(id: string, patientId: string, date: string, time = '09:00', status: PsychologySession['status'] = 'agendada'): PsychologySession {
  return {
    id,
    ...scope,
    patientId,
    date,
    time,
    durationMinutes: 50,
    modality: 'presencial',
    serviceId: service.id,
    status,
    administrativeNote: '',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : textContent(child as TestRenderer.ReactTestInstance)).join('');
}

function day(store: PsychologyStore, callbacks: { onSession?: (session: PsychologySession) => void; onFinance?: (patientId?: string, chargeId?: string) => void } = {}) {
  return <DayView
    date="2026-08-29"
    setDate={() => {}}
    store={store}
    sessions={store.sessions}
    settings={store.settings}
    onSchedule={() => {}}
    onPersonal={() => {}}
    onOpenSession={callbacks.onSession || (() => {})}
    onOpenFinance={callbacks.onFinance || (() => {})}
    operationalReference={reference}
  />;
}

test('R108 selector canônico filtra ativo, inativo, órfão, legado desconhecido e estados não pendentes', () => {
  const active = patient('active');
  const inactive = patient('inactive', false);
  const unknown = { ...patient('unknown'), active: undefined as unknown as boolean };
  const sessions = [
    session('eligible', active.id, '2026-08-28'),
    session('inactive', inactive.id, '2026-08-28'),
    session('unknown', unknown.id, '2026-08-28'),
    session('orphan', 'missing', '2026-08-28'),
    session('historical', active.id, '2025-08-28'),
    session('future', active.id, '2026-08-30'),
    session('completed', active.id, '2026-08-28', '10:00', 'realizada'),
    session('absent', active.id, '2026-08-28', '11:00', 'falta'),
    session('cancelled', active.id, '2026-08-28', '12:00', 'cancelada'),
  ];
  const result = deriveOperationalPendencies({ ...emptyStore, patients: [active, inactive, unknown], sessions }, reference);
  assert.deepEqual(result.sessionAlerts.map(alert => alert.sessionId), ['eligible']);
  assert.equal(result.sessionPendingCount, 1);
  assert.equal(SESSION_PENDING_ALERT_LOOKBACK_DAYS, 30);
});

test('R108 fronteira temporal em America/Sao_Paulo inclui exatamente 30 dias e exclui 31', () => {
  const active = patient('boundary');
  const store = {
    ...emptyStore,
    patients: [active],
    sessions: [
      session('day-29', active.id, '2026-07-31', '12:00'),
      session('day-30', active.id, '2026-07-30', '12:00'),
      session('day-31', active.id, '2026-07-29', '12:00'),
    ],
  };
  assert.deepEqual(deriveOperationalPendencies(store, reference).sessionAlerts.map(alert => alert.sessionId), ['day-29', 'day-30']);
});

test('R108 financeiro alerta somente saldo válido de paciente atualmente ativo e ordena vencidos primeiro', () => {
  const active = patient('finance-active');
  const inactive = patient('finance-inactive', false);
  let store: PsychologyStore = { ...emptyStore, patients: [active, inactive] };
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 200, dueDate: '2026-08-28', description: 'Vencida sintética' }, '2026-08-01T10:00:00.000Z').store;
  const overdueId = store.charges.at(-1)!.id;
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 100, dueDate: '2026-09-10', description: 'Aberta sintética' }, '2026-08-02T10:00:00.000Z').store;
  const openId = store.charges.at(-1)!.id;
  store = { ...store, charges: [...store.charges, { id: 'inactive-open-charge', ...scope, patientId: inactive.id, amount: 300, dueDate: '2026-08-20', description: 'Inativa sintética', status: 'pending', createdAt: '2026-08-03T10:00:00.000Z', updatedAt: '2026-08-03T10:00:00.000Z' }] };
  store = { ...store, charges: [...store.charges, { id: 'active-cancelled-charge', ...scope, patientId: active.id, amount: 300, dueDate: '2026-08-20', description: 'Cancelada sintética', status: 'canceled', createdAt: '2026-08-03T11:00:00.000Z', updatedAt: '2026-08-03T11:00:00.000Z' }] };
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 50, description: 'Quitada sintética' }, '2026-08-04T10:00:00.000Z').store;
  const paidId = store.charges.at(-1)!.id;
  store = createPsychologyPaymentInLedger(store, { chargeId: paidId, patientId: active.id, amount: 50, date: '2026-08-29', method: 'PIX' }, '2026-08-29T10:00:00.000Z').store;
  const result = deriveOperationalPendencies(store, reference);
  assert.deepEqual(result.financialAlerts.map(alert => alert.chargeId), [overdueId, openId]);
  assert.equal(result.financialPendingCount, 2);
});

test('R108 contadores compartilham a derivação e ignoram backlog histórico e pacientes inativos', () => {
  const active = patient('mixed-active');
  const inactivePatients = Array.from({ length: 20 }, (_, index) => patient(`mixed-inactive-${index}`, false));
  const historical = Array.from({ length: 100 }, (_, index) => session(`historical-${index}`, active.id, '2025-01-01'));
  const inactiveRecent = inactivePatients.map((item, index) => session(`inactive-recent-${index}`, item.id, '2026-08-28'));
  const eligible = ['09:00', '10:00', '11:00'].map((time, index) => session(`eligible-${index}`, active.id, '2026-08-28', time));
  let store: PsychologyStore = { ...emptyStore, patients: [active, ...inactivePatients], sessions: [...historical, ...inactiveRecent, ...eligible] };
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 100, description: 'Aberta A' }, '2026-08-01T10:00:00.000Z').store;
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 200, description: 'Aberta B' }, '2026-08-02T10:00:00.000Z').store;
  const result = deriveOperationalPendencies(store, reference);
  assert.equal(result.sessionPendingCount, 3);
  assert.equal(result.financialPendingCount, 2);
  assert.equal(result.alerts.length, 5);
});

test('R108 componente real limita 10 alertas, expande explicitamente e mantém o total', async () => {
  const active = patient('limit');
  const sessions = Array.from({ length: 12 }, (_, index) => session(`limit-${index}`, active.id, '2026-08-28', `${String(index + 1).padStart(2, '0')}:00`));
  const store = { ...emptyStore, patients: [active], sessions };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(day(store)); });
  assert.equal(renderer.root.findAll(node => Boolean(node.props['data-alert-key'])).length, OPERATIONAL_ALERT_INITIAL_LIMIT);
  assert.match(textContent(renderer.root.findByProps({ 'data-testid': 'psychology-pendencies' })), /Sessões pendentes de registro12/);
  await act(async () => renderer.root.findAllByType('button').find(button => textContent(button).includes('Ver todas as pendências'))!.props.onClick());
  assert.equal(renderer.root.findAll(node => Boolean(node.props['data-alert-key'])).length, 12);
  await act(async () => renderer.unmount());
});

test('R108 ações reais preservam sessionId e patientId/chargeId específicos', async () => {
  const active = patient('actions');
  const pendingSession = session('action-session', active.id, '2026-08-28');
  let store: PsychologyStore = { ...emptyStore, patients: [active], sessions: [pendingSession] };
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 200, description: 'Ação financeira' }, '2026-08-01T10:00:00.000Z').store;
  const chargeId = store.charges[0].id;
  let openedSession = '';
  let openedFinance: [string | undefined, string | undefined] = [undefined, undefined];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(day(store, { onSession: value => { openedSession = value.id; }, onFinance: (patientId, valueChargeId) => { openedFinance = [patientId, valueChargeId]; } })); });
  await act(async () => renderer.root.findByProps({ 'data-alert-key': `session:${pendingSession.id}` }).props.onClick());
  await act(async () => renderer.root.findByProps({ 'data-alert-key': `charge:${chargeId}` }).props.onClick());
  assert.equal(openedSession, pendingSession.id);
  assert.deepEqual(openedFinance, [active.id, chargeId]);
  await act(async () => renderer.unmount());
});

test('R108 componente real sincroniza inativação, reativação, conclusão e pagamento sem refresh', async () => {
  const active = patient('sync');
  const pendingSession = session('sync-session', active.id, '2026-08-28');
  let initial: PsychologyStore = { ...emptyStore, patients: [active], sessions: [pendingSession] };
  initial = createPsychologyChargeInLedger(initial, { patientId: active.id, amount: 200, description: 'Sincronismo financeiro' }, '2026-08-01T10:00:00.000Z').store;
  const chargeId = initial.charges[0].id;
  let updateStore!: React.Dispatch<React.SetStateAction<PsychologyStore>>;

  function Harness() {
    const [store, setStore] = useState(initial);
    updateStore = setStore;
    return day(store);
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness />); });
  const counters = () => textContent(renderer.root.findByProps({ 'data-testid': 'psychology-pendencies' }));
  assert.match(counters(), /Sessões pendentes de registro1Saldos financeiros em aberto1/);
  await act(async () => updateStore(current => ({ ...current, patients: current.patients.map(item => ({ ...item, active: false })) })));
  assert.match(counters(), /Sessões pendentes de registro0Saldos financeiros em aberto0/);
  await act(async () => updateStore(current => ({ ...current, patients: current.patients.map(item => ({ ...item, active: true })) })));
  assert.match(counters(), /Sessões pendentes de registro1Saldos financeiros em aberto1/);
  await act(async () => updateStore(current => ({ ...current, sessions: current.sessions.map(item => ({ ...item, status: 'realizada' })) })));
  assert.match(counters(), /Sessões pendentes de registro0Saldos financeiros em aberto1/);
  await act(async () => updateStore(current => createPsychologyPaymentInLedger(current, { chargeId, patientId: active.id, amount: 200, date: '2026-08-29', method: 'PIX' }, '2026-08-29T11:00:00.000Z').store));
  assert.match(counters(), /Sessões pendentes de registro0Saldos financeiros em aberto0/);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-alerts' }).length, 0);
  await act(async () => renderer.unmount());
});

test('R108 deduplica IDs repetidos e zero state não renderiza alertas operacionais', () => {
  const active = patient('dedup');
  const duplicateSession = session('dedup-session', active.id, '2026-08-28');
  let store: PsychologyStore = { ...emptyStore, patients: [active], sessions: [duplicateSession, { ...duplicateSession }] };
  store = createPsychologyChargeInLedger(store, { patientId: active.id, amount: 100, description: 'Dedup financeiro' }, '2026-08-01T10:00:00.000Z').store;
  store = { ...store, charges: [...store.charges, { ...store.charges[0] }] };
  const result = deriveOperationalPendencies(store, reference);
  assert.equal(result.sessionPendingCount, 1);
  assert.equal(result.financialPendingCount, 1);
  assert.deepEqual(deriveOperationalPendencies(emptyStore, reference), {
    sessionAlerts: [], financialAlerts: [], alerts: [], sessionPendingCount: 0, financialPendingCount: 0,
  });
});
