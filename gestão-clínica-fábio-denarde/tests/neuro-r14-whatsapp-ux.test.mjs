import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
// Unrelated access-management infrastructure is outside this offline UI fixture.
mock.module('../src/components/Auth/AccessRequestsAdminCard.tsx', { exports: { default: () => null } });
const { default: Agenda } = await import('../src/components/Agenda.tsx');
mock.module('../src/firebase.ts', { exports: { auth: { currentUser: null }, db: {} } });
mock.module('../src/lib/accessApi.ts', { exports: { getProfessionalPatientProfileChangeRequests: async () => [], getProfessionalResponsibleDocumentUrl: async () => { throw Error('Não usado nesta fixture'); }, reviewPatientProfileChangeRequest: async () => { throw Error('Escrita externa proibida'); } } });
mock.module('../src/components/Auth/ResponsiblePortal.tsx', { exports: { default: () => null } });
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


const panel = renderer => renderer.root.findAll(node => node.props.role === 'tabpanel' && visible(node))[0];
const summary = renderer => renderer.root.findByProps({ 'aria-label': 'Status resumido do WhatsApp' });
const editor = (renderer, suffix) => renderer.root.findAllByType('fieldset').find(node => String(node.props.id || '').endsWith(suffix));
const inputForLabel = (renderer, label) => renderer.root.findAllByType('label').find(node => text(node).trim() === label).findByType('input');
const click = async (renderer, label) => { assert.ok(visibleButton(renderer, label), label); await act(async () => visibleButton(renderer, label).props.onClick()); };
async function setup(source = state(), onUpdate = async () => true, role = 'admin') {
  let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda, { state: source, onUpdate, currentUserName: 'Equipe fictícia', currentUserRole: role })); });
  await openSession(renderer); await click(renderer, 'WhatsApp'); return renderer;
}
const cleanup = async renderer => { if (renderer) await act(async () => renderer.unmount()); restoreEnvironment(); };

for (const [dayBefore, sameDay, label, feedback] of [
  [true, true, 'Véspera + Dia', 'Serão enviados lembretes na véspera e no dia do atendimento.'],
  [true, false, 'Somente véspera', 'Será enviado somente o lembrete da véspera.'],
  [false, true, 'Somente dia', 'Será enviado somente o lembrete do dia do atendimento.'],
  [false, false, 'Nenhum', 'Nenhum lembrete automático será enviado.'],
]) {
  test('consulta compacta e edição: ' + label, async () => {
    installOfflineEnvironment(); let renderer; let writes = 0;
    try {
      const source = state([occurrence({ whatsappReminderPreferences: { dayBefore, sameDay } })]);
      renderer = await setup(source, async () => { writes++; return true; });
      assert.match(text(summary(renderer)), new RegExp(label.replace('+','\\+')));
      assert.match(text(summary(renderer)), /Personalizada nesta sessão/);
      assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), feedback);
      assert.equal(editor(renderer, '-reminder-editor').props.hidden, true);
      assert.equal(editor(renderer, '-silence-editor').props.hidden, true);
      assert.equal(visibleButton(renderer, 'Salvar alterações'), undefined);
      assert.equal(visibleButton(renderer, 'Silenciar mensagens'), undefined);
      assert.equal(renderer.root.findAllByType('details').find(node => /Detalhes da configuração/.test(text(node))).props.open, undefined);
      for (const term of ['Lembretes', 'Configuração', 'Silêncio']) assert.equal(summary(renderer).findAllByType('dt').filter(node => text(node) === term).length, 1);
      await click(renderer, 'Editar lembretes');
      assert.equal(inputForLabel(renderer, 'Dia anterior').props.checked, dayBefore);
      assert.equal(inputForLabel(renderer, 'Dia do atendimento').props.checked, sameDay);
      assert.equal(renderer.root.findAllByType('input').filter(node => node.props.type === 'checkbox').length, 2);
      assert.equal(renderer.root.findAllByType('button').filter(node => text(node).trim() === 'Salvar alterações').length, 1);
      assert.equal(renderer.root.findAllByType('button').filter(node => text(node).trim() === 'Restaurar padrão do paciente').length, 1);
      assert.equal(writes, 0);
    } finally { await cleanup(renderer); }
  });
}

test('origem usa herança/legado e override sem repetir a configuração efetiva', async () => {
  installOfflineEnvironment(); let renderer;
  try {
    const source = state(); source.patients[0] = { ...patient, whatsappReminderPreferences: { dayBefore: true, sameDay: false } };
    renderer = await setup(source);
    assert.match(text(summary(renderer)), /Padrão do paciente/); assert.match(text(summary(renderer)), /Somente véspera/);
    assert.equal(summary(renderer).findAllByType('dd').length, 3);
    await cleanup(renderer); renderer = null; installOfflineEnvironment();
    renderer = await setup(state()); assert.match(text(summary(renderer)), /Véspera \+ Dia/);
  } finally { await cleanup(renderer); }
});

for (const scope of ['session','patient']) {
  test('Salvar alterações reutiliza handler no escopo ' + scope + ' sem modificar o outro escopo', async () => {
    installOfflineEnvironment(); let renderer; const writes = [];
    const source = state([occurrence({ whatsappReminderPreferences: { dayBefore: false, sameDay: true } })]);
    try {
      renderer = await setup(source, async update => { writes.push(update); return true; });
      await click(renderer, 'Editar lembretes');
      await act(async () => inputForLabel(renderer, 'Dia anterior').props.onChange({ target: { checked: true } }));
      await act(async () => inputForLabel(renderer, 'Dia do atendimento').props.onChange({ target: { checked: false } }));
      if (scope === 'patient') await act(async () => inputForLabel(renderer, 'Padrão para as próximas sessões').props.onChange());
      await click(renderer, 'Salvar alterações');
      assert.equal(writes.length, 1);
      assert.deepEqual(Object.keys(writes[0]), [scope === 'session' ? 'sessions' : 'patients']);
      assert.deepEqual(writes[0][scope === 'session' ? 'sessions' : 'patients'][0].whatsappReminderPreferences, { dayBefore: true, sameDay: false });
      assert.deepEqual(source.sessions[0].whatsappReminderPreferences, { dayBefore: false, sameDay: true });
      if (scope === 'session') {
        for (const key of ['id','patientId','notes','paymentId','mediaId','packageNumber','date','time']) assert.equal(writes[0].sessions[0][key], source.sessions[0][key]);
      } else assert.deepEqual(writes[0].patients[1], source.patients[1]);
      assert.equal(tabs(renderer).length, 0);
    } finally { await cleanup(renderer); }
  });
}

test('Restaurar padrão remove somente o override e preserva o silêncio', async () => {
  installOfflineEnvironment(); let renderer; const writes = [];
  const source = state([occurrence({ whatsappReminderPreferences: { dayBefore: false, sameDay: true }, whatsappAutomationControl: { blockAll: true } })]);
  try {
    renderer = await setup(source, async update => { writes.push(update); return true; });
    await click(renderer, 'Editar lembretes'); await click(renderer, 'Restaurar padrão do paciente');
    assert.equal(writes.length, 1); assert.equal(writes[0].sessions[0].whatsappReminderPreferences, undefined);
    assert.deepEqual(writes[0].sessions[0].whatsappAutomationControl, source.sessions[0].whatsappAutomationControl);
    assert.equal(writes[0].patients, undefined);
  } finally { await cleanup(renderer); }
});

test('padrão futuro mantém confirmação e permissão; profissional edita só a sessão', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0, confirms = 0;
  try {
    renderer = await setup(state(), async () => { writes++; return true; });
    await click(renderer, 'Editar lembretes');
    await act(async () => inputForLabel(renderer, 'Padrão para as próximas sessões').props.onChange());
    window.confirm = () => { confirms++; return false; };
    await click(renderer, 'Salvar alterações'); assert.equal(writes, 0); assert.equal(confirms, 1); assert.equal(tabs(renderer).length, 5);
    await cleanup(renderer); renderer = null; installOfflineEnvironment();
    renderer = await setup(state(), async () => { writes++; return true; }, 'professional');
    await click(renderer, 'Editar lembretes');
    assert.equal(renderer.root.findAllByType('label').filter(node => text(node) === 'Padrão para as próximas sessões').length, 0);
    await click(renderer, 'Configurar silêncio');
    assert.equal(inputForLabel(renderer, 'Todas as sessões deste atendente').props.disabled, true);
    assert.equal(writes, 0);
  } finally { await cleanup(renderer); }
});

test('silêncio inativo recolhido expande escopo, duração e motivo; recolher mantém draft sem escrita', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0;
  try {
    renderer = await setup(state(), async () => { writes++; return true; });
    assert.match(text(summary(renderer)), /Inativo/);
    assert.equal(editor(renderer, '-silence-editor').props.hidden, true);
    await click(renderer, 'Configurar silêncio');
    assert.equal(editor(renderer, '-silence-editor').props.hidden, false);
    await act(async () => inputForLabel(renderer, 'Todas as sessões deste atendente').props.onChange());
    const duration = renderer.root.findAllByType('label').find(node => text(node).startsWith('Duração')).findByType('select');
    await act(async () => duration.props.onChange({ target: { value: 'custom' } }));
    const until = inputForLabel(renderer, 'Até');
    await act(async () => until.props.onChange({ target: { value: '2026-10-02T18:00' } }));
    await click(renderer, 'Recolher silêncio'); await click(renderer, 'Configurar silêncio');
    assert.equal(inputForLabel(renderer, 'Até').props.value, '2026-10-02T18:00');
    assert.equal(inputForLabel(renderer, 'Todas as sessões deste atendente').props.checked, true);
    assert.match(visibleButton(renderer, 'Silenciar mensagens').props.className, /bg-amber-50/);
    assert.doesNotMatch(visibleButton(renderer, 'Silenciar mensagens').props.className, /w-full|bg-rose-700/);
    assert.equal(writes, 0);
  } finally { await cleanup(renderer); }
});

for (const scope of ['session','patient']) {
  test('silêncio ativo de ' + scope + ': resumo, edição recolhida e desbloqueio pelo handler existente', async () => {
    installOfflineEnvironment(); let renderer; const writes = [];
    const control = { version: 1, blockAll: true, scope, silenceUntil: '2026-10-02T21:00:00Z', reasonCode: 'recesso' };
    const source = state([occurrence(scope === 'session' ? { whatsappAutomationControl: control } : {})]);
    if (scope === 'patient') source.patients[0] = { ...patient, whatsappAutomationControl: control };
    try {
      renderer = await setup(source, async update => { writes.push(update); return true; });
      assert.match(text(summary(renderer)), /Ativo/); assert.match(text(summary(renderer)), scope === 'session' ? /Esta sessão/ : /Todas as sessões deste atendente/);
      assert.match(text(renderer.root.findByProps({ role: 'status' })), /Silenciado até.*02[/]10[/]2026.*18:00.*nenhum lembrete/);
      assert.equal(editor(renderer, '-silence-editor').props.hidden, true); assert.ok(visibleButton(renderer, 'Desbloquear'));
      await click(renderer, 'Editar configuração do silêncio'); assert.equal(editor(renderer, '-silence-editor').props.hidden, false);
      assert.ok(visibleButton(renderer, 'Salvar silêncio'));
      await click(renderer, 'Recolher silêncio'); await click(renderer, 'Desbloquear');
      assert.equal(writes.length, 1); assert.equal(writes[0][scope === 'session' ? 'sessions' : 'patients'][0].whatsappAutomationControl, undefined);
      assert.equal(isWhatsappAutomationBlocked(source.sessions[0], { patient: source.patients[0], reminderType: 'HOJE_TARDE' }), true);
    } finally { await cleanup(renderer); }
  });
}

test('modo consulta mantém silêncio parcial legado e sessão encerrada sem promessa de envio', async () => {
  installOfflineEnvironment(); let renderer;
  try {
    renderer = await setup(state([occurrence({ whatsappAutomationControl: { blockedReminderTypes: ['AMANHA'] } })]));
    assert.match(text(summary(renderer)), /Ativo parcial/);
    assert.match(text(renderer.root.findByProps({ role: 'status' })), /Alguns lembretes estão silenciados/);
    assert.match(text(panel(renderer)), /Lembrete da véspera/);
    await cleanup(renderer); renderer = null; installOfflineEnvironment();
    renderer = await setup(state([occurrence({ status: 'Realizada' })]));
    assert.equal(text(renderer.root.findByProps({ role: 'status' })), 'Esta sessão não recebe lembretes automáticos.');
  } finally { await cleanup(renderer); }
});

test('rascunho e escopo sobrevivem abas; fechar exige descarte e nova abertura volta à consulta', async () => {
  installOfflineEnvironment(); let renderer; let writes = 0, confirms = 0;
  try {
    renderer = await setup(state(), async () => { writes++; return true; });
    await click(renderer, 'Editar lembretes');
    await act(async () => inputForLabel(renderer, 'Dia anterior').props.onChange({ target: { checked: false } }));
    await act(async () => inputForLabel(renderer, 'Padrão para as próximas sessões').props.onChange());
    await click(renderer, 'Configurar silêncio');
    await act(async () => inputForLabel(renderer, 'Todas as sessões deste atendente').props.onChange());
    for (const tab of ['Resumo','Sessão / Agenda','Pacote e Financeiro','Ações','WhatsApp']) await click(renderer, tab);
    assert.equal(inputForLabel(renderer, 'Dia anterior').props.checked, false);
    assert.equal(inputForLabel(renderer, 'Padrão para as próximas sessões').props.checked, true);
    assert.equal(inputForLabel(renderer, 'Todas as sessões deste atendente').props.checked, true);
    assert.equal(editor(renderer, '-reminder-editor').props.hidden, false);
    window.confirm = () => { confirms++; return false; };
    await click(renderer, 'Fechar'); assert.equal(tabs(renderer).length, 5);
    window.confirm = () => { confirms++; return true; };
    await click(renderer, 'Fechar'); assert.equal(tabs(renderer).length, 0);
    await openSession(renderer); await click(renderer, 'WhatsApp');
    assert.equal(editor(renderer, '-reminder-editor').props.hidden, true);
    assert.equal(editor(renderer, '-silence-editor').props.hidden, true);
    assert.equal(inputForLabel(renderer, 'Dia anterior').props.checked, true);
    assert.equal(inputForLabel(renderer, 'Somente esta sessão').props.checked, true);
    assert.equal(writes, 0); assert.equal(confirms, 2);
  } finally { await cleanup(renderer); }
});

test('controles nativos, disclosure acessível, foco e layout responsivo sem ações duplicadas', async () => {
  installOfflineEnvironment(); let renderer; let focused = '', prevented = 0;
  try {
    renderer = await setup();
    const toggle = visibleButton(renderer, 'Editar lembretes');
    assert.equal(toggle.props.type, 'button'); assert.equal(toggle.props['aria-expanded'], false);
    assert.equal(toggle.props['aria-controls'], editor(renderer, '-reminder-editor').props.id);
    assert.match(toggle.props.className, /focus-visible/); assert.match(toggle.parent.props.className, /flex-col.*sm:flex-row.*sm:flex-wrap/);
    await click(renderer, 'Editar lembretes');
    assert.equal(visibleButton(renderer, 'Recolher lembretes').props['aria-expanded'], true);
    for (const input of editor(renderer, '-reminder-editor').findAllByType('input')) {
      assert.equal(input.parent.type, 'label'); assert.match(input.props.className, /focus-visible/);
    }
    document.getElementById = id => ({ focus() { focused = id; } });
    await act(async () => tabs(renderer)[2].props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; } }));
    assert.equal(focused, tabs(renderer)[3].props.id); assert.equal(prevented, 1);
    assert.ok(visibleButton(renderer, '+ Novo pacote')); assert.ok(visibleButton(renderer, '+ Registrar pagamento'));
    await act(async () => tabs(renderer)[3].props.onKeyDown({ key: 'End', preventDefault() {} }));
    assert.equal(tabs(renderer)[4].props['aria-selected'], true);
    await act(async () => tabs(renderer)[4].props.onKeyDown({ key: 'Home', preventDefault() {} }));
    assert.equal(tabs(renderer)[0].props['aria-selected'], true);
    assert.equal(tabs(renderer).filter(node => node.props.tabIndex === 0).length, 1);
  } finally { await cleanup(renderer); }
});
