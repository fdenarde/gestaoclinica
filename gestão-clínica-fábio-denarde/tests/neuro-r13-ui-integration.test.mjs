import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
// Unrelated access-management infrastructure is outside this offline UI fixture.
mock.module('../src/components/Auth/AccessRequestsAdminCard.tsx', { exports: { default: () => null } });
const { default: Agenda } = await import('../src/components/Agenda.tsx');
const { default: Finance } = await import('../src/components/Finance.tsx');
mock.module('../src/firebase.ts', { exports: { auth: { currentUser: null }, db: {} } });
mock.module('../src/lib/accessApi.ts', { exports: { getProfessionalPatientProfileChangeRequests: async () => [], getProfessionalResponsibleDocumentUrl: async () => { throw Error('Não usado nesta fixture'); }, reviewPatientProfileChangeRequest: async () => { throw Error('Escrita externa proibida'); } } });
mock.module('../src/components/Auth/ResponsiblePortal.tsx', { exports: { default: () => null } });
const { default: Patients } = await import('../src/components/Patients.tsx');
const { default: Dashboard } = await import('../src/components/Dashboard.tsx');
import PatientPackagesPayments, { PatientPackagesPaymentsDialog } from '../src/components/Common/PatientPackagesPayments.tsx';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import { isWhatsappAutomationBlocked } from '../shared/whatsappSessionAutomation.js';
import { createMemoryReminderLedger, createRoutineCheckpointId } from '../src/lib/whatsappReminderOperations.js';
import { buildUnregisteredActivityGroups } from '../shared/unregisteredActivities.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NativeDate = Date;
const frozen = '2026-09-30T19:10:00-03:00';
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join(' ');
const button = (renderer, label) => renderer.root.findAllByType('button').find(node => text(node).trim() === label);
const originalGlobals = new Map(['window', 'document', 'HTMLElement', 'Date', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const toasts = [];
function installOfflineEnvironment() {
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [frozen])); } static now() { return new NativeDate(frozen).getTime(); } };
  globalThis.HTMLElement = class {};
  globalThis.window = { setTimeout: () => 0, clearTimeout() {}, confirm: () => true, location: { origin: 'http://localhost:4173' }, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById: () => ({ focus() {}, appendChild: element => toasts.push(element) }), createElement: () => ({ attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...nodes) { this.children.push(...nodes); }, classList: { add() {}, remove() {} }, addEventListener() {}, remove() {} }) };
  globalThis.fetch = async () => { throw new Error('Acesso externo proibido nesta fixture offline.'); };
  toasts.length = 0;
}
function restoreEnvironment() {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
const patient = { id: 'fixture-patient', name: 'Paciente fictício', guardianName: 'Responsável fictício', whatsapp: '27 90000-0000', status: 'Ativo', startDate: '2026-01-01', fixedDay: '', fixedTime: '', paymentModal: 'PADRÃO: Pix integral', birthDate: '2020-01-01', packageTolerances: [], packageContracts: [{ packageNumber: 1, packageContractValue: 1000, createdAt: '2026-09-01T12:00:00Z', createdBy: 'Equipe fictícia', source: 'explicit' }] };
const occurrence = (extra = {}) => ({ id: 'fixture-session', patientId: patient.id, date: '2026-09-30', time: '19:00', type: 'Sessão simples (50 min)', status: 'Agendada', packageNumber: 1, notes: 'Nota fictícia', paymentId: 'fixture-payment', mediaId: 'fixture-media', ...extra });
function state(sessions = [occurrence()]) {
  return { patients: [patient, { ...patient, id: 'fixture-other-patient', name: 'Outro paciente fictício' }], sessions, payments: [], expenses: [], evolutions: [], repositions: [], personalAppointments: [], settings: { holidays: [], activityMediaMonitoringStart: '2026-09-01' } };
}
async function openSession(renderer) {
  const card = renderer.root.findAll(node => node.type === 'div' && node.props.onClick && String(node.props['aria-label'] || '').includes('19:00') && String(node.props['aria-label'] || '').includes(patient.name))[0];
  assert.ok(card, 'card fictício da sessão em andamento');
  await act(async () => card.props.onClick());
}
async function openReschedule(renderer, time = '16:40') {
  await openSession(renderer);
  await act(async () => button(renderer, 'Sessão / Agenda').props.onClick());
  assert.ok(button(renderer, 'Reagendar sessão'), 'sessão em andamento continua editável');
  await act(async () => button(renderer, 'Reagendar sessão').props.onClick());
  const input = renderer.root.findAllByType('input').find(node => node.props.type === 'time');
  assert.equal(input.props.step, 60);
  await act(async () => input.props.onChange({ target: { value: time } }));
}
const toastText = () => toasts.map(node => node.children.map(child => child.textContent || '').join(' ')).join('\n');


const visible = node => { for (let cursor = node; cursor; cursor = cursor.parent) if (cursor.props?.hidden) return false; return true; };
const visibleButton = (renderer, label) => renderer.root.findAllByType('button').find(node => visible(node) && text(node).trim() === label);
const tabs = renderer => renderer.root.findAll(node => node.props.role === 'tab');
const change = async (renderer, label, value) => act(async () => renderer.root.findAll(node => node.props['aria-label'] === label && node.props.onChange)[0].props.onChange({ target: { value } }));
const renderAgenda = async (source, update) => { let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda, { state: source, onUpdate: update, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' })); }); return renderer; };

test('modal possui cinco abas, Resumo inicial, controles separados, teclado e drafts preservados sem gravar', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  try {
    renderer = await renderAgenda(state(), async () => { writes++; return true; }); await openSession(renderer);
    assert.deepEqual(tabs(renderer).map(text), ['Resumo', 'Sessão / Agenda', 'WhatsApp', 'Pacote e Financeiro', 'Ações']);
    assert.equal(tabs(renderer)[0].props['aria-selected'], true);
    assert.equal(visibleButton(renderer, 'Silenciar mensagens'), undefined);
    assert.equal(visibleButton(renderer, 'Reagendar sessão'), undefined);
    await act(async () => button(renderer, 'WhatsApp').props.onClick());
    assert.equal(visibleButton(renderer, 'Salvar alterações'), undefined);
    await act(async () => button(renderer, 'Editar lembretes').props.onClick());
    await act(async () => button(renderer, 'Configurar silêncio').props.onClick());
    assert.ok(visibleButton(renderer, 'Salvar alterações')); assert.ok(visibleButton(renderer, 'Silenciar mensagens'));
    const checkbox = renderer.root.findAllByType('input').filter(node => node.props.type === 'checkbox')[0];
    await act(async () => checkbox.props.onChange({ target: { checked: false } }));
    const scope = renderer.root.findAllByType('input').find(node => String(node.props.name || '').endsWith('-silence-scope') && node.props.checked === false);
    await act(async () => scope.props.onChange());
    await act(async () => button(renderer, 'Resumo').props.onClick());
    await act(async () => button(renderer, 'WhatsApp').props.onClick());
    assert.equal(renderer.root.findAllByType('input').filter(node => node.props.type === 'checkbox')[0].props.checked, false);
    assert.equal(renderer.root.findAllByType('input').filter(node => String(node.props.name || '').endsWith('-silence-scope'))[1].props.checked, true);
    let prevented = 0; await act(async () => tabs(renderer)[2].props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; } }));
    assert.equal(tabs(renderer)[3].props['aria-selected'], true); assert.equal(prevented, 1);
    assert.ok(visibleButton(renderer, '+ Novo pacote')); assert.ok(visibleButton(renderer, '+ Registrar pagamento'));
    await act(async () => tabs(renderer)[3].props.onKeyDown({ key: 'Home', preventDefault() {} }));
    assert.equal(tabs(renderer)[0].props['aria-selected'], true); assert.equal(writes, 0);
    assert.equal(tabs(renderer).filter(node => node.props.tabIndex === 0).length, 1);
    assert.match(tabs(renderer)[0].parent.props.className, /flex-wrap/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('WhatsApp exibe estado efetivo e silêncio sem criar subabas', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state([occurrence({ whatsappReminderPreferences: { dayBefore: false, sameDay: true }, whatsappAutomationControl: { blockAll: true } })]);
  try {
    renderer = await renderAgenda(source, async () => { throw Error('Troca de aba não grava.'); }); await openSession(renderer);
    await act(async () => button(renderer, 'WhatsApp').props.onClick());
    const panel = renderer.root.findAll(node => node.props.role === 'tabpanel' && visible(node))[0];
    assert.match(text(panel), /Personalizada nesta sessão/); assert.match(text(panel), /nenhum lembrete será enviado/);
    assert.ok(visibleButton(renderer, 'Desbloquear')); assert.equal(tabs(renderer).length, 5);
    assert.equal(isWhatsappAutomationBlocked(source.sessions[0], { patient, reminderType: 'HOJE_TARDE' }), true);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('ações mantêm presença, falta, falta profissional, cancelamento e um só reagendamento', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  try {
    renderer = await renderAgenda(state(), async () => { writes++; return true; }); await openSession(renderer);
    await act(async () => button(renderer, 'Ações').props.onClick());
    for (const label of ['OK / Presença', 'Falta', 'Falta Prof.', 'Registrar falta sem reposição', 'Reagendar sessão', 'Cancelar']) assert.ok(renderer.root.findAllByType('button').find(node => visible(node) && text(node).includes(label)), label);
    assert.equal(renderer.root.findAllByType('button').filter(node => /Reagendar sessão/.test(text(node))).length, 1);
    await act(async () => button(renderer, 'Resumo').props.onClick());
    await act(async () => visibleButton(renderer, 'Fechar').props.onClick());
    assert.equal(tabs(renderer).length, 0); await openSession(renderer); assert.equal(tabs(renderer)[0].props['aria-selected'], true); assert.equal(writes, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('pacote: clique duplo trava; falha não mostra sucesso e retry preserva ID', async () => {
  installOfflineEnvironment(); let renderer; const writes = []; let release;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(PatientPackagesPayments, { patient, state: state([]), actor: 'Equipe fictícia', onUpdate: update => { writes.push(update); return new Promise(resolve => { release = resolve; }); } })); });
    await act(async () => button(renderer, '+ Novo pacote').props.onClick()); await change(renderer, 'Valor contratado', '1000');
    await act(async () => { const click = button(renderer, 'Confirmar').props.onClick; click(); click(); });
    assert.equal(writes.length, 1); assert.equal(writes[0].sessions, undefined); assert.equal(writes[0].payments, undefined);
    const packageId = writes[0].patients[0].packageRecords[0].id;
    await act(async () => release(false)); assert.ok(button(renderer, 'Confirmar')); assert.doesNotMatch(toastText(), /Pacote registrado com sucesso/);
    await act(async () => button(renderer, 'Confirmar').props.onClick()); assert.equal(writes[1].patients[0].packageRecords[0].id, packageId);
    await act(async () => release(true)); assert.match(toastText(), /Pacote registrado com sucesso/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('pagamento sem pacote exige decisão; falha, retry e repasse preservam a identidade', async () => {
  installOfflineEnvironment(); let renderer; const writes = []; let result = false;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(PatientPackagesPayments, { patient, state: state([]), actor: 'Equipe fictícia', onUpdate: async update => { writes.push(update); return result; } })); });
    await act(async () => button(renderer, '+ Registrar pagamento').props.onClick()); await change(renderer, 'Valor recebido', '1000');
    await act(async () => button(renderer, 'Confirmar').props.onClick()); assert.equal(writes.length, 0);
    await change(renderer, 'Vínculo do pagamento', 'unlinked');
    await act(async () => button(renderer, 'Confirmar').props.onClick()); assert.equal(writes.length, 1);
    assert.equal(writes[0].payments[0].packageLinkStatus, 'unlinked'); assert.equal(writes[0].patients, undefined); assert.equal(writes[0].sessions, undefined);
    assert.ok(button(renderer, 'Confirmar')); assert.doesNotMatch(toastText(), /Pagamento registrado com sucesso/);
    result = true; await act(async () => button(renderer, 'Confirmar').props.onClick());
    assert.equal(writes[0].payments[0].id, writes[1].payments[0].id); assert.equal(writes[0].expenses[0].id, writes[1].expenses[0].id); assert.match(toastText(), /Pagamento registrado com sucesso/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('Dashboard pacote encerrado abre o mesmo componente sem persistência', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  const source = state(Array.from({ length: 10 }, (_, n) => occurrence({ id: 'fixture-complete-' + n, status: 'Realizada', date: '2026-09-' + String(n + 1).padStart(2, '0') })));
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Dashboard, { state: source, onUpdate: async () => { writes++; return true; }, whatsappReportState: { dateKey: '2026-09-30', status: 'ready', report: null, error: '' } })); });
    assert.ok(button(renderer, 'Novo pacote')); assert.ok(button(renderer, 'Registrar pagamento'));
    await act(async () => button(renderer, 'Novo pacote').props.onClick());
    assert.equal(renderer.root.findAllByType(PatientPackagesPayments).length, 1); assert.ok(renderer.root.findAll(node => node.props['aria-label'] === 'Valor contratado').length); assert.equal(writes, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('Pagamentos seleciona paciente e usa o mesmo fluxo que permite receita sem pacote', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Finance, { state: state([]), onUpdate: async () => { writes++; return true; }, currentUserName: 'Equipe fictícia' })); });
    const entry = renderer.root.findAllByType('button').find(node => text(node).includes('+ Registrar pagamento'));
    await act(async () => entry.props.onClick()); await change(renderer, 'Paciente do pagamento', patient.id);
    assert.equal(renderer.root.findAllByType(PatientPackagesPayments).length, 1);
    const choices = renderer.root.findAll(node => node.props['aria-label'] === 'Vínculo do pagamento')[0];
    assert.equal(choices.props.value, ''); assert.ok(choices.findAllByType('option').some(node => node.props.value === 'unlinked')); assert.equal(writes, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('Agenda × WhatsApp: sobreposição explícita, 15:50 → 15:40, independência, sem duplicação ou catch-up', async () => {
  installOfflineEnvironment(); let renderer; const writes = [];
  const a = { ...patient, id: 'fixture-a', name: 'Eliza fictícia', fixedDay: 'quarta', fixedTime: '15:00', whatsappReminderPreferences: { dayBefore: true, sameDay: false } };
  const b = { ...patient, id: 'fixture-b', name: 'Isabelly fictícia', fixedDay: 'quarta', fixedTime: '15:50', whatsappReminderPreferences: { dayBefore: false, sameDay: true } };
  const original = [occurrence({ id: 'fixture-a-session', patientId: a.id, time: '15:00', type: 'Sessão dupla (2 × 50 min)', packageNumber: 1 }), occurrence({ id: 'fixture-b-session', patientId: b.id, time: '15:50', isFixedSchedule: true, source: 'fixed', packageNumber: 2, whatsappReminderPreferences: { dayBefore: true, sameDay: true } })];
  original.push(occurrence({ id: 'fixture-b-previous', patientId: b.id, date: '2026-09-23', time: '15:50', status: 'Realizada', packageNumber: 1 }));
  const source = { ...state(original), patients: [a, b] };
  try {
    renderer = await renderAgenda(source, async update => { writes.push(update); return true; });
    const card = renderer.root.findAll(node => node.type === 'div' && node.props.onClick && String(node.props['aria-label'] || '').includes('15:50') && String(node.props['aria-label'] || '').includes(b.name))[0];
    assert.ok(card); await act(async () => card.props.onClick()); await act(async () => button(renderer, 'Sessão / Agenda').props.onClick()); await act(async () => button(renderer, 'Reagendar sessão').props.onClick());
    const input = renderer.root.findAllByType('input').find(node => node.props.type === 'time'); assert.equal(input.props.step, 60); await act(async () => input.props.onChange({ target: { value: '15:40' } }));
    await act(async () => button(renderer, 'Confirmar reagendamento').props.onClick()); assert.equal(writes.length, 0); assert.ok(button(renderer, 'Agendar mesmo assim'));
    await act(async () => button(renderer, 'Agendar mesmo assim').props.onClick()); assert.equal(writes.length, 1);
    const sessions = writes[0].sessions;
    assert.deepEqual(sessions[0], original[0]); assert.equal(sessions[1].id, original[1].id); assert.equal(sessions[1].patientId, b.id); assert.equal(sessions[1].packageNumber, 2); assert.equal(sessions[1].time, '15:40'); assert.equal(sessions[1].rescheduleHistory[0].previousTime, '15:50'); assert.deepEqual(sessions[1].whatsappReminderPreferences, original[1].whatsappReminderPreferences);
    const plan = (patients = [a, b], list = sessions, tipo = 'HOJE_TARDE') => getWhatsappReminderPlan({ patients, sessions: list, settings: { holidays: [] }, runDateStr: tipo === 'AMANHA' ? '2026-09-29' : '2026-09-30', tipo, referenceDateStr: '2026-09-29', now: new Date('2026-09-30T12:30:00-03:00') });
    const tomorrow = plan(undefined, undefined, 'AMANHA'); assert.equal(tomorrow.reminders.find(item => item.patientId === a.id).time, '15:00'); assert.equal(tomorrow.reminders.find(item => item.patientId === b.id).time, '15:40'); assert.ok(!tomorrow.reminders.some(item => item.patientId === b.id && item.time === '15:50'));
    const same = plan(); assert.ok(!same.reminders.some(item => item.patientId === a.id)); assert.equal(same.reminders.filter(item => item.patientId === b.id).length, 1);
    const silence = { blockAll: true };
    assert.ok(plan([{ ...a, whatsappAutomationControl: silence }, b]).reminders.some(item => item.patientId === b.id));
    assert.equal(plan([a, { ...b, whatsappAutomationControl: silence }]).reminders.length, 0);
    assert.ok(plan([{ ...a, whatsappReminderPreferences: { dayBefore: false, sameDay: false } }, b]).reminders.some(item => item.patientId === b.id));
    const reverse = plan([{ ...a, whatsappReminderPreferences: { dayBefore: true, sameDay: true } }, { ...b, whatsappReminderPreferences: { dayBefore: false, sameDay: false } }], [sessions[0], { ...sessions[1], whatsappReminderPreferences: undefined }]);
    assert.equal(reverse.reminders.filter(item => item.patientId === a.id).length, 1); assert.equal(reverse.reminders.filter(item => item.patientId === b.id).length, 0);
    const ledger = createMemoryReminderLedger(), checkpoint = createRoutineCheckpointId({ dateStr: '2026-09-30', routine: 'HOJE_TARDE' });
    ledger.queueRoutine(checkpoint, { date: '2026-09-30', routine: 'HOJE_TARDE', expectedWindowStart: '2026-09-30T15:30:00Z', expectedWindowEnd: '2026-09-30T16:00:00Z' });
    assert.equal(ledger.expireOverdueQueuedRoutines(new Date('2026-09-30T17:00:00Z')).length, 1); assert.equal(ledger.claimNextQueuedRoutine({ now: new Date('2026-09-30T17:00:00Z') }), null); assert.equal(ledger.getCheckpoint(checkpoint).status, 'expired');
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});


test('entrada pelo paciente usa o componente compartilhado e histórico sem inferir vínculo novo', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  const synthetic = { ...patient, anamnese: { complaint: '', school: '', grade: '', referredBy: '', diagnoses: '', initialNotes: '' }, clinicalNotes: '' };
  const source = { ...state([]), patients: [synthetic], externalRegistrationForms: [], responsibleDocuments: [] };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Patients, { state: source, onUpdate: async () => { writes++; return true; }, selectedPatientId: patient.id, currentUserId: 'fixture-user', currentUserName: 'Equipe fictícia', initialPatientSubTab: 'pacotes-pagamentos' })); });
    assert.equal(renderer.root.findAllByType(PatientPackagesPayments).length, 1); assert.ok(button(renderer, '+ Novo pacote')); assert.ok(button(renderer, '+ Registrar pagamento')); assert.equal(writes, 0);
    const withoutPackage = { id: 'fixture-unlinked', patientId: patient.id, date: '2026-09-29', amount: 1000, method: 'Pix', installment: 'Pagamento integral', packageLinkStatus: 'unlinked' };
    await act(async () => renderer.update(React.createElement(Patients, { state: { ...source, payments: [withoutPackage] }, onUpdate: async () => { writes++; return true; }, selectedPatientId: patient.id, currentUserId: 'fixture-user', currentUserName: 'Equipe fictícia', initialPatientSubTab: 'financeiro' })));
    assert.match(text(renderer.toJSON()), /Pagamentos não vinculados/); assert.equal(writes, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('vínculo: seleção obrigatória, clique duplo, falha preservada e retry sem recriação', async () => {
  installOfflineEnvironment(); let renderer; const writes = []; let release;
  const synthetic = { ...patient, packageRecords: [{ id: 'fixture-package', packageNumber: 1, sessionCount: 10, startDate: '2026-09-01', operationKey: 'fixture-create', createdAt: '2026-09-01T12:00:00Z', createdBy: 'Equipe fictícia' }] };
  const payments = [500, 200].map((amount, index) => ({ id: 'fixture-unlinked-' + index, patientId: patient.id, date: '2026-09-29', amount, method: 'Pix', installment: 'Pagamento integral', status: 'active', packageLinkStatus: 'unlinked', operationKey: 'fixture-original-' + index }));
  const source = { ...state([]), patients: [synthetic], payments };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(PatientPackagesPayments, { patient: synthetic, state: source, actor: 'Equipe fictícia', onUpdate: update => { writes.push(update); return new Promise(resolve => { release = resolve; }); } })); });
    await act(async () => button(renderer, 'Vincular pagamento').props.onClick());
    await act(async () => button(renderer, 'Confirmar').props.onClick()); assert.equal(writes.length, 0);
    await change(renderer, 'Pagamento sem vínculo', payments[1].id); await change(renderer, 'Vínculo do pagamento', '1');
    await act(async () => { const click = button(renderer, 'Confirmar').props.onClick; click(); click(); });
    assert.equal(writes.length, 1); assert.equal(writes[0].payments[0], payments[0]); assert.equal(writes[0].payments[1].id, payments[1].id); assert.equal(writes[0].patients, undefined); assert.equal(writes[0].expenses, undefined);
    await act(async () => release(false)); assert.ok(button(renderer, 'Confirmar')); assert.doesNotMatch(toastText(), /Vínculo confirmado/);
    await act(async () => button(renderer, 'Confirmar').props.onClick()); assert.equal(writes[1].payments[1].packageLinkHistory[0].operationKey, writes[0].payments[1].packageLinkHistory[0].operationKey);
    await act(async () => release(true)); assert.match(toastText(), /Vínculo confirmado/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('Agenda preserva rascunho financeiro ao trocar abas e ao voltar à sessão', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  try {
    renderer = await renderAgenda(state(), async () => { writes++; return true; }); await openSession(renderer); await act(async () => button(renderer, 'Pacote e Financeiro').props.onClick());
    await act(async () => button(renderer, '+ Novo pacote').props.onClick()); await change(renderer, 'Valor contratado', '950');
    await act(async () => button(renderer, 'Resumo').props.onClick()); await act(async () => button(renderer, 'Pacote e Financeiro').props.onClick());
    assert.equal(renderer.root.findAll(node => node.props['aria-label'] === 'Valor contratado')[0].props.value, '950'); assert.equal(writes, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});


test('pagamento em andamento bloqueia fechamento e não cria modal aninhada', async () => {
  installOfflineEnvironment(); let renderer; let release;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(PatientPackagesPaymentsDialog, { patientId: patient.id, state: state([]), actor: 'Equipe fictícia', action: 'payment', onUpdate: () => new Promise(resolve => { release = resolve; }), onClose() { throw Error('Fechamento prematuro proibido'); } })); });
    await change(renderer, 'Valor recebido', '500'); await change(renderer, 'Vínculo do pagamento', 'unlinked'); await act(async () => button(renderer, 'Confirmar').props.onClick());
    const closeButtons = renderer.root.findAllByType('button').filter(node => node.props['aria-label'] === 'Fechar modal'); assert.equal(closeButtons.length, 1); assert.ok(closeButtons.every(node => node.props.disabled));
    await act(async () => release(false)); assert.ok(closeButtons.every(node => node.props.disabled === false));
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});
