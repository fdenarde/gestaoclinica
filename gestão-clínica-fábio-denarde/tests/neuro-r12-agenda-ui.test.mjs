import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
// Unrelated access-management infrastructure is outside this offline UI fixture.
mock.module('../src/components/Auth/AccessRequestsAdminCard.tsx', { exports: { default: () => null } });
const { default: Agenda } = await import('../src/components/Agenda.tsx');
const { default: Finance } = await import('../src/components/Finance.tsx');
const { default: Dashboard } = await import('../src/components/Dashboard.tsx');
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
  globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById: () => ({ appendChild: element => toasts.push(element) }), createElement: () => ({ attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...nodes) { this.children.push(...nodes); }, classList: { add() {}, remove() {} }, addEventListener() {}, remove() {} }) };
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

test('conflito exige decisão; cancelar não grava e confirmar mantém dois registros independentes', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state([occurrence(), occurrence({ id: 'fixture-conflict', patientId: 'fixture-other-patient', time: '16:00', type: 'Sessão dupla (2 × 50 min)' })]);
  const writes = [];
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda, { state: source, onUpdate: async update => { writes.push(update); return true; }, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' })); });
    await openReschedule(renderer);
    let pending;
    await act(async () => { pending = button(renderer, 'Confirmar reagendamento').props.onClick(); });
    assert.equal(writes.length, 0);
    assert.ok(button(renderer, 'Agendar mesmo assim'));
    await act(async () => { button(renderer, 'Cancelar').props.onClick(); await pending; });
    assert.equal(writes.length, 0);
    await act(async () => { pending = button(renderer, 'Confirmar reagendamento').props.onClick(); });
    await act(async () => { button(renderer, 'Agendar mesmo assim').props.onClick(); await pending; });
    assert.equal(writes.length, 1);
    const updated = writes[0].sessions;
    assert.equal(updated.length, 2);
    assert.deepEqual(updated[1], source.sessions[1]);
    for (const field of ['id', 'patientId', 'packageNumber', 'notes', 'paymentId', 'mediaId']) assert.equal(updated[0][field], source.sessions[0][field]);
    assert.equal(updated[0].time, '16:40');
    assert.equal(updated[0].rescheduleHistory.length, 1);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('agenda alterada durante confirmação cancela a operação obsoleta', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state([occurrence(), occurrence({ id: 'fixture-conflict', patientId: 'fixture-other-patient', time: '16:00' })]); let writes = 0;
  const props = { state: source, onUpdate: async () => { writes += 1; return true; }, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda, props)); });
    await openReschedule(renderer, '16:20');
    let pending;
    await act(async () => { pending = button(renderer, 'Confirmar reagendamento').props.onClick(); });
    await act(async () => renderer.update(React.createElement(Agenda, { ...props, state: { ...source, sessions: [...source.sessions, occurrence({ id: 'fixture-added', time: '17:30' })] } })));
    await act(async () => { button(renderer, 'Agendar mesmo assim').props.onClick(); await pending; });
    assert.equal(writes, 0);
    assert.match(toastText(), /agenda mudou/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('novo agendamento usa minuto livre, confirmação de conflito e trava de gravação', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state([occurrence({ id: 'fixture-conflict', patientId: 'fixture-other-patient', time: '16:00', type: 'Sessão dupla (2 × 50 min)' })]);
  const writes = []; let release;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda, { state: source, onUpdate: update => { writes.push(update); return new Promise(resolve => { release = resolve; }); }, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' })); });
    const slot = renderer.root.findAll(node => node.type === 'div' && node.props.onClick && String(node.props['aria-label'] || '').includes('18:00') && String(node.props['aria-label'] || '').includes('30/09/2026'))[0];
    assert.ok(slot);
    await act(async () => slot.props.onClick());
    const patientSelect = renderer.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === '__BLOCK__'));
    await act(async () => patientSelect.props.onChange({ target: { value: patient.id } }));
    const timeInput = renderer.root.findAllByType('input').find(node => node.props.type === 'time');
    await act(async () => timeInput.props.onChange({ target: { value: '16:40' } }));
    await act(async () => { const save = button(renderer, 'Confirmar Agendamento').props.onClick; save(); save(); });
    assert.equal(writes.length, 0);
    await act(async () => button(renderer, 'Agendar mesmo assim').props.onClick());
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].sessions[0], source.sessions[0]);
    assert.equal(writes[0].sessions.length, 2);
    assert.equal(writes[0].sessions[1].time, '16:40');
    assert.notEqual(writes[0].sessions[1].id, source.sessions[0].id);
    await act(async () => { button(renderer, 'Gravando...').props.onClick(); });
    assert.equal(writes.length, 1);
    await act(async () => release(true));
    assert.match(toastText(), /Sessão agendada com sucesso/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('checkboxes persistem só a preferência, herança e retorno ao padrão', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state(); const writes = []; let release;
  const onUpdate = update => { writes.push(update); return new Promise(resolve => { release = resolve; }); };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda, { state: source, onUpdate, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' })); });
    await openSession(renderer);
    await act(async () => button(renderer, 'WhatsApp').props.onClick());
    await act(async () => button(renderer, 'Editar lembretes').props.onClick());
    const checkbox = renderer.root.findAllByType('input').filter(node => node.props.type === 'checkbox')[0];
    await act(async () => checkbox.props.onChange({ target: { checked: false } }));
    let pending;
    await act(async () => { const save = button(renderer, 'Salvar alterações').props.onClick; pending = save(); void save(); });
    assert.equal(writes.length, 1, 'clique duplo não duplica');
    assert.deepEqual(writes[0].sessions[0].whatsappReminderPreferences, { dayBefore: false, sameDay: true });
    assert.equal(writes[0].sessions[0].id, source.sessions[0].id);
    assert.equal(writes[0].patients, undefined);
    await act(async () => { release(false); await pending; });
    assert.ok(button(renderer, 'Salvar alterações'), 'erro mantém edição disponível');
    assert.match(toastText(), /Não foi possível salvar/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('Financeiro não anuncia renovação com persistência false e retry reutiliza identidade', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state([occurrence({ status: 'Realizada', date: '2026-09-10' })]);
  const writes = []; let result = false;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Finance, { state: source, onUpdate: async update => { writes.push(update); return result; }, currentUserName: 'Equipe fictícia' })); });
    // Open the existing revenue dialog, choose the synthetic patient and amount.
    const newRevenue = renderer.root.findAllByType('button').find(node => /\+ Registrar pagamento/.test(text(node)));
    assert.ok(newRevenue);
    await act(async () => newRevenue.props.onClick());
    const patientSelect = renderer.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === patient.id));
    await act(async () => patientSelect.props.onChange({ target: { value: patient.id } }));
    const linkSelect = renderer.root.findAllByType('select').find(node => node.props['aria-label'] === 'Vínculo do pagamento');
    await act(async () => linkSelect.props.onChange({ target: { value: '1' } }));
    const amountInput = renderer.root.findAllByType('input').find(node => node.props.type === 'number');
    await act(async () => amountInput.props.onChange({ target: { value: '1000' } }));
    await act(async () => button(renderer, 'Confirmar').props.onClick());
    assert.equal(writes.length, 1);
    assert.ok(button(renderer, 'Confirmar'), 'falha não fecha modal nem confirma renovação');
    assert.match(toastText(), /Não foi possível confirmar a gravação/);
    assert.doesNotMatch(toastText(), /Pagamento registrado com sucesso/);
    result = true;
    await act(async () => button(renderer, 'Confirmar').props.onClick());
    assert.equal(writes.length, 2);
    assert.equal(writes[0].payments[0].id, writes[1].payments[0].id);
    assert.match(toastText(), /Pagamento registrado com sucesso/);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('Dashboard navega para a Galeria com o contexto da pendência derivada', async () => {
  installOfflineEnvironment(); let renderer;
  const source = state([occurrence({ status: 'Realizada', date: '2026-09-10' })]);
  const groups = buildUnregisteredActivityGroups({ ...source, monitoringStart: '2026-09-01', now: new Date(), mediaReadComplete: true, isAlbumReadComplete: () => true });
  const opened = []; let writes = 0;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Dashboard, { state: source, onUpdate: async () => { writes++; return true; }, unregisteredActivities: groups, onRegisterUnregisteredActivity: group => opened.push(group), isPrimaryAdmin: false, whatsappReportState: { dateKey: '2026-09-30', status: 'ready', report: null, error: '' } })); });
    const open = renderer.root.findAllByType('button').find(node => /Registrar atividade/.test(text(node)));
    assert.ok(open);
    await act(async () => open.props.onClick());
    assert.equal(opened.length, 1);
    assert.equal(opened[0].patientId, patient.id);
    assert.deepEqual(opened[0].sessionIds, ['fixture-session']);
    assert.equal(writes, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); }
});

test('sino e Dashboard usam a mesma lista e refresh não depende da navegação', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(/visibleUnregisteredActivities\.map/.test(app));
  assert.ok(/unregisteredActivities=\{visibleUnregisteredActivities\}/.test(app));
  assert.ok(/openActivityGallery\(activity\.patientId, activity\.sessionIds\[0\] \|\| null, activity\.packageNumber\)/.test(app));
  assert.ok(/activityAttentionCount = visibleUnregisteredActivities.length/.test(app));
  assert.ok(/createActivityRefreshGate/.test(app));
  assert.doesNotMatch(app.slice(app.indexOf('const refreshUnregisteredActivities'), app.indexOf('const refreshUnregisteredActivities') + 2600), /writeBatch|setDoc|updateDoc/);
});
