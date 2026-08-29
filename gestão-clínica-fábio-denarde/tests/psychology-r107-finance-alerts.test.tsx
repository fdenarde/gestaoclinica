import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import PsychologyFinanceView from '../src/features/psychology-pilot/PsychologyFinanceView';
import { PsychologyMoneyInput, applyPsychologyMoneyTyping, psychologyMoneyRawFromValue } from '../src/features/psychology-pilot/PsychologyMoneyInput';
import PsychologyPatientChart from '../src/features/psychology-pilot/PsychologyPatientChart';
import { DayView } from '../src/features/psychology-pilot/PsychologyPilot';
import { createEmptyPsychologyStore, type PsychologySession, type PsychologyStore } from '../src/features/psychology-pilot/psychologyDomain';
import {
  createPsychologyChargeInLedger,
  createPsychologyExpenseInLedger,
  createPsychologyPaymentInLedger,
  deletePsychologyChargeFromLedger,
  deletePsychologyExpenseFromLedger,
  deletePsychologyPaymentFromLedger,
  deletePsychologySessionPackageFromLedger,
  getPsychologyFinancialLedger,
} from '../src/features/psychology-pilot/psychologyFinancialLedger';
import { buildPsychologyOperationalAlerts } from '../src/features/psychology-pilot/psychologyOperationalAlerts';
import { parsePsychologyMoney } from '../src/features/psychology-pilot/psychologyMoney';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { activeElement: null } as Document;

const scope = { professionalId: 'r107-professional-synthetic', context: 'PSICOLOGIA' as const };
const baseStore = createEmptyPsychologyStore(scope);
const service = baseStore.services.find(item => item.id === 'psychotherapy-individual')!;
const patient = {
  id: 'r107-patient-synthetic',
  ...scope,
  name: 'TESTE HOMOLOGAÇÃO R107',
  dateOfBirth: '1990-01-01',
  phone: '27999999999',
  email: '',
  preferredModality: 'presencial' as const,
  active: true,
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-08-29T10:00:00.000Z',
};

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : textContent(child as TestRenderer.ReactTestInstance)).join('');
}

function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(item => textContent(item).trim() === label);
}

function moneyKey(input: TestRenderer.ReactTestInstance, key: string) {
  input.props.onKeyDown({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {},
    currentTarget: {
      value: input.props.value,
      selectionStart: String(input.props.value || '').length,
      selectionEnd: String(input.props.value || '').length,
    },
  });
}

test('R107 campo monetário processa digitação sequencial real, decimais, substituição e colagem BRL', async () => {
  let lastNumeric: number | null = null;
  function Harness() {
    const [value, setValue] = useState('');
    return <PsychologyMoneyInput testId="r107-money" value={value} className="input" onChange={(formatted, numeric) => { setValue(formatted); lastNumeric = numeric; }} />;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness />); });

  for (const key of '200') await act(async () => moneyKey(renderer.root.findByProps({ 'data-testid': 'r107-money' }), key));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'r107-money' }).props.value, 'R$ 200,00');
  assert.equal(lastNumeric, 200);

  let raw = '';
  for (const key of '1250,75') raw = applyPsychologyMoneyTyping(raw, key);
  assert.equal(raw, '1250,75');
  assert.equal(parsePsychologyMoney(raw), 1250.75);
  assert.equal(psychologyMoneyRawFromValue('R$ 1.250,75'), '1250,75');
  assert.deepEqual(['2', '20', '200', '250', '1250'].map(value => parsePsychologyMoney(value)), [2, 20, 200, 250, 1250]);

  await act(async () => {
    renderer.root.findByProps({ 'data-testid': 'r107-money' }).props.onPaste({
      preventDefault() {},
      clipboardData: { getData: () => '1.250,75' },
    });
  });
  assert.equal(renderer.root.findByProps({ 'data-testid': 'r107-money' }).props.value, 'R$ 1.250,75');
  assert.equal(lastNumeric, 1250.75);
  await act(async () => renderer.unmount());
});

test('R107 alertas aceitam apenas sessão passada não concluída e saldo financeiro real, sem duplicação', () => {
  const past: PsychologySession = { id: 'session-past', ...scope, patientId: patient.id, date: '2026-08-29', time: '09:00', durationMinutes: 50, modality: 'presencial', serviceId: service.id, status: 'agendada', createdAt: patient.createdAt, updatedAt: patient.updatedAt };
  const future = { ...past, id: 'session-future', time: '17:00' };
  const completed = { ...past, id: 'session-completed', status: 'realizada' as const };
  let store: PsychologyStore = { ...baseStore, patients: [patient], sessions: [past, future, completed] };
  store = createPsychologyChargeInLedger(store, { patientId: patient.id, amount: 200, dueDate: '2026-08-20', description: 'Cobrança sintética' }, patient.createdAt).store;
  const openCharge = store.charges[0];
  const paidStore = createPsychologyChargeInLedger(store, { patientId: patient.id, amount: 100, description: 'Quitada' }, patient.createdAt).store;
  const paidCharge = paidStore.charges.at(-1)!;
  store = createPsychologyPaymentInLedger(paidStore, { chargeId: paidCharge.id, patientId: patient.id, amount: 100, date: '2026-08-29', method: 'PIX' }, patient.createdAt).store;
  store = { ...store, charges: [...store.charges, { ...openCharge }] };

  const alerts = buildPsychologyOperationalAlerts(store, new Date('2026-08-29T15:00:00-03:00'));
  assert.deepEqual(alerts.map(alert => alert.key), [`session:${past.id}`, `charge:${openCharge.id}`]);
  assert.equal(alerts.some(alert => alert.text.includes('sem próxima sessão')), false);
  assert.equal(alerts.some(alert => alert.key === `session:${future.id}`), false);
  assert.equal(alerts.some(alert => alert.key === `session:${completed.id}`), false);
  assert.equal(alerts.some(alert => alert.key === `charge:${paidCharge.id}`), false);
});

test('R107 Meu Dia renderiza alertas acionáveis para a sessão e para o Financeiro', async () => {
  const past: PsychologySession = { id: 'session-action', ...scope, patientId: patient.id, date: '2020-01-01', time: '09:00', durationMinutes: 50, modality: 'presencial', serviceId: service.id, status: 'agendada', createdAt: patient.createdAt, updatedAt: patient.updatedAt };
  let store: PsychologyStore = { ...baseStore, patients: [patient], sessions: [past] };
  store = createPsychologyChargeInLedger(store, { patientId: patient.id, amount: 200, description: 'Cobrança sintética' }, patient.createdAt).store;
  let openedSession = '';
  let openedFinance = 0;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<DayView date="2026-08-29" setDate={() => {}} store={store} sessions={store.sessions} settings={store.settings} onSchedule={() => {}} onPersonal={() => {}} onOpenSession={session => { openedSession = session.id; }} onOpenFinance={() => { openedFinance += 1; }} />);
  });
  assert.doesNotMatch(textContent(renderer.root), /Sem próxima sessão/);
  await act(async () => renderer.root.findByProps({ 'data-alert-key': `session:${past.id}` }).props.onClick());
  await act(async () => renderer.root.findByProps({ 'data-alert-key': `charge:${store.charges[0].id}` }).props.onClick());
  assert.equal(openedSession, past.id);
  assert.equal(openedFinance, 1);
  await act(async () => renderer.unmount());
});

test('R107 exclusões preservam vínculos e recalculam o mesmo ledger compartilhado', () => {
  let store: PsychologyStore = { ...baseStore, patients: [patient] };
  store = createPsychologyChargeInLedger(store, { patientId: patient.id, amount: 200, description: 'Cobrança sintética' }, patient.createdAt).store;
  const chargeId = store.charges[0].id;
  store = createPsychologyPaymentInLedger(store, { chargeId, patientId: patient.id, amount: 80, date: '2026-08-29', method: 'PIX' }, patient.createdAt).store;
  const paymentId = store.payments[0].id;
  assert.match(deletePsychologyChargeFromLedger(store, chargeId).error || '', /pagamentos vinculados/);

  const withoutPayment = deletePsychologyPaymentFromLedger(store, paymentId, '2026-08-29T11:00:00.000Z');
  assert.equal(withoutPayment.error, undefined);
  assert.equal(withoutPayment.store.payments.length, 0);
  assert.equal(withoutPayment.store.charges[0].id, chargeId);
  assert.equal(getPsychologyFinancialLedger(withoutPayment.store).chargeEntries[0].balance, 200);
  assert.equal(withoutPayment.store.charges[0].status, 'pending');

  const withoutCharge = deletePsychologyChargeFromLedger(withoutPayment.store, chargeId);
  assert.equal(withoutCharge.store.charges.length, 0);
  const withExpense = createPsychologyExpenseInLedger(withoutCharge.store, { description: 'Despesa sintética', amount: 50, date: '2026-08-29', category: 'Outros' }, patient.createdAt).store;
  assert.equal(deletePsychologyExpenseFromLedger(withExpense, withExpense.expenses[0].id).store.expenses.length, 0);

  const packageRecord = { id: 'package-used', ...scope, patientId: patient.id, name: 'Pacote usado', totalSessions: 5, usedSessions: 1, startDate: '2026-08-29', active: true, createdAt: patient.createdAt, updatedAt: patient.updatedAt };
  assert.match(deletePsychologySessionPackageFromLedger({ ...store, sessionPackages: [packageRecord] }, packageRecord.id).error || '', /Desative-o/);
});

test('R107 exclusão pela UI exige confirmação, mostra processamento e bloqueia mutação duplicada', async () => {
  const initialStore = createPsychologyExpenseInLedger({ ...baseStore, patients: [patient] }, { description: 'Despesa sintética', amount: 50, date: '2026-08-29', category: 'Outros' }, patient.createdAt).store;
  let currentStore = initialStore;
  let remoteCalls = 0;
  let resolveRemote: ((value: boolean) => void) | undefined;
  const remoteResult = new Promise<boolean>(resolve => { resolveRemote = resolve; });
  function Harness() {
    const [store, setStore] = useState(initialStore);
    currentStore = store;
    return <PsychologyFinanceView store={store} onStoreChange={() => false} onNotice={() => {}} onRemoteMutation={mutation => {
      remoteCalls += 1;
      return remoteResult.then(saved => { if (saved) setStore(mutation.store); return saved; });
    }} />;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness />); });
  await act(async () => button(renderer, 'Despesas')?.props.onClick());
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Excluir definitivamente' }).props.onClick());
  assert.match(textContent(renderer.root.findByProps({ role: 'dialog' })), /A exclusão é definitiva/);
  const confirm = button(renderer, 'Excluir definitivamente')!;
  await act(async () => { confirm.props.onClick(); confirm.props.onClick(); await Promise.resolve(); });
  assert.equal(remoteCalls, 1);
  assert.match(textContent(renderer.root), /Excluindo…/);
  await act(async () => { resolveRemote?.(true); await remoteResult; await Promise.resolve(); });
  assert.equal(currentStore.expenses.length, 0);
  assert.match(textContent(renderer.root), /Nenhuma despesa encontrada/);
  await act(async () => renderer.unmount());
});

test('R107 pacote de 5 sessões e R$ 1.000 percorre a UI, envia uma mutação e aparece em todos os contextos pelo mesmo ID', async () => {
  const initialStore: PsychologyStore = { ...baseStore, patients: [patient] };
  let currentStore = initialStore;
  let remoteCalls = 0;
  let resolveRemote: ((value: boolean) => void) | undefined;
  const remoteResult = new Promise<boolean>(resolve => { resolveRemote = resolve; });
  function Harness() {
    const [store, setStore] = useState(initialStore);
    currentStore = store;
    return <PsychologyFinanceView store={store} onStoreChange={() => false} onNotice={() => {}} onRemoteMutation={mutation => {
      remoteCalls += 1;
      return remoteResult.then(saved => { if (saved) setStore(mutation.store); return saved; });
    }} />;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness />); });
  await act(async () => button(renderer, 'Novo pacote')?.props.onClick());
  const dialog = renderer.root.findByProps({ role: 'dialog' });
  const selects = dialog.findAllByType('select');
  await act(async () => selects[0].props.onChange({ target: { value: patient.id } }));
  await act(async () => selects[1].props.onChange({ target: { value: service.id } }));
  await act(async () => button(renderer, '5 sessões')?.props.onClick());
  for (const key of '1000') await act(async () => moneyKey(renderer.root.findByProps({ role: 'dialog' }).findAllByProps({ inputMode: 'decimal' })[0], key));

  const create = button(renderer, 'Criar pacote')!;
  await act(async () => { create.props.onClick(); create.props.onClick(); await Promise.resolve(); });
  assert.equal(remoteCalls, 1, 'duplo clique deve produzir somente uma mutação remota');
  assert.match(textContent(renderer.root), /Criando pacote…/);
  await act(async () => { resolveRemote?.(true); await remoteResult; await Promise.resolve(); });
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0, 'o modal deve fechar após sucesso remoto');
  assert.equal(currentStore.sessionPackages.length, 1);
  assert.equal(currentStore.sessionPackages[0].totalSessions, 5);
  assert.equal(currentStore.sessionPackages[0].totalPrice, 1000);
  assert.equal(currentStore.charges.length, 0, 'pacote não deve criar cobrança implícita');
  const packageId = currentStore.sessionPackages[0].id;

  await act(async () => button(renderer, 'Pacotes')?.props.onClick());
  assert.match(textContent(renderer.root), /Psicoterapia Individual · 5 sessões/);
  await act(async () => button(renderer, 'Nova cobrança')?.props.onClick());
  await act(async () => renderer.root.findByProps({ role: 'dialog' }).findAllByType('select')[0].props.onChange({ target: { value: patient.id } }));
  assert.ok(renderer.root.findAllByType('option').some(option => option.props.value === packageId));
  await act(async () => renderer.unmount());

  await act(async () => {
    renderer = TestRenderer.create(<PsychologyPatientChart store={currentStore} patientId={patient.id} initialTab="finance" onClose={() => {}} onEdit={() => {}} onSchedule={() => {}} onOpenSession={() => {}} onStoreChange={() => true} onStatus={() => true} onRecord={() => {}} />);
  });
  await act(async () => button(renderer, 'Pacotes')?.props.onClick());
  assert.match(textContent(renderer.root), /Psicoterapia Individual · 5 sessões/);
  assert.equal(currentStore.sessionPackages[0].id, packageId);
  await act(async () => renderer.unmount());
});
