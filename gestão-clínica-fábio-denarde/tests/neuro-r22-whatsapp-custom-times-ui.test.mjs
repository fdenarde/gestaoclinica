import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

mock.module('../src/components/Auth/AccessRequestsAdminCard.tsx', { exports: { default: () => null } });
const { default: Agenda } = await import('../src/components/Agenda.tsx');
mock.module('../src/firebase.ts', { exports: { auth: { currentUser: null }, db: {} } });
mock.module('../src/lib/accessApi.ts', { exports: { getProfessionalPatientProfileChangeRequests: async () => [],
  getProfessionalResponsibleDocumentUrl: async () => { throw Error('fixture offline'); },
  reviewPatientProfileChangeRequest: async () => { throw Error('escrita externa proibida'); } } });
mock.module('../src/components/Auth/ResponsiblePortal.tsx', { exports: { default: () => null } });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : (node?.children || []).map(text).join(' ');
const visible = node => { for (let cursor = node; cursor; cursor = cursor.parent) if (cursor.props?.hidden) return false; return true; };
const button = (renderer, label) => renderer.root.findAllByType('button').find(node => visible(node) && text(node).trim() === label);
const label = (renderer, name) => renderer.root.findAllByType('label').find(node => text(node).trim() === name);
const patient = { id: 'fixture-patient', name: 'Atendido fictício', guardianName: 'Responsável fictício',
  whatsapp: '27 90000-0000', status: 'Ativo', startDate: '2026-01-01', fixedDay: '', fixedTime: '',
  paymentModal: 'PADRÃO: Pix integral', birthDate: '2020-01-01', packageTolerances: [], packageContracts: [] };
const session = { id: 'fixture-session', patientId: patient.id, date: '2026-09-30', time: '19:00',
  type: 'Sessão simples (50 min)', status: 'Agendada', packageNumber: 1 };
const state = owner => ({ patients: [owner], sessions: [session], payments: [], expenses: [], evolutions: [], repositions: [],
  personalAppointments: [], settings: { holidays: [], activityMediaMonitoringStart: '2026-09-01' } });
const originalGlobals = new Map(['window', 'document', 'HTMLElement', 'Date', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
function offline() {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-09-30T19:10:00-03:00'])); } static now() { return new NativeDate('2026-09-30T19:10:00-03:00').getTime(); } };
  globalThis.HTMLElement = class {};
  globalThis.window = { setTimeout: () => 0, clearTimeout() {}, confirm: () => true,
    location: { origin: 'http://localhost:4173' }, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {},
    getElementById: () => ({ focus() {}, appendChild() {} }),
    createElement: () => ({ setAttribute() {}, append() {}, classList: { add() {}, remove() {} }, addEventListener() {}, remove() {} }) };
  globalThis.fetch = async () => { throw Error('rede proibida na fixture'); };
}
function restore() { for (const [key, descriptor] of originalGlobals) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
} }
async function setup(owner, onUpdate) {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda,
    { state: state(owner), onUpdate, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' })); });
  const card = renderer.root.findAll(node => node.type === 'div' && node.props.onClick
    && String(node.props['aria-label'] || '').includes('19:00') && String(node.props['aria-label'] || '').includes(patient.name))[0];
  assert.ok(card);
  await act(async () => card.props.onClick());
  await act(async () => button(renderer, 'WhatsApp').props.onClick());
  await act(async () => button(renderer, 'Editar lembretes').props.onClick());
  return renderer;
}

test('UI adiciona, ordena e remove horários por atendido no fluxo existente, sem rede', async () => {
  offline(); let renderer; const writes = [];
  try {
    renderer = await setup(patient, async update => { writes.push(update); return true; });
    await act(async () => label(renderer, 'Personalizar').findByType('input').props.onChange());
    assert.equal(button(renderer, 'Salvar alterações').props.disabled, true);
    const timeInput = () => renderer.root.findAllByType('input').find(node => node.props.type === 'time');
    await act(async () => timeInput().props.onChange({ target: { value: '13:15' } }));
    await act(async () => renderer.root.findAllByType('select').find(node => node.props.value === 'dayBefore').props.onChange({ target: { value: 'sameDay' } }));
    await act(async () => button(renderer, 'Adicionar').props.onClick());
    await act(async () => timeInput().props.onChange({ target: { value: '08:00' } }));
    await act(async () => button(renderer, 'Adicionar').props.onClick());
    assert.equal(renderer.root.findAllByType('button').filter(node => text(node).trim() === 'Remover').length, 2);
    await act(async () => renderer.root.findAllByType('button').find(node => text(node).trim() === 'Remover').props.onClick());
    await act(async () => label(renderer, 'Padrão para as próximas sessões').findByType('input').props.onChange());
    await act(async () => button(renderer, 'Salvar alterações').props.onClick());
    assert.equal(writes.length, 1);
    assert.equal(writes[0].patients[0].whatsappReminderPreferences.timingMode, 'custom');
    assert.deepEqual(writes[0].patients[0].whatsappReminderPreferences.customTimes, [{ relativeDay: 'sameDay', time: '13:15' }]);
    assert.equal(writes[0].sessions, undefined);
  } finally { if (renderer) await act(async () => renderer.unmount()); restore(); }
});

test('UI restaura os horários padrão em preferência personalizada', async () => {
  offline(); let renderer; const writes = [];
  try {
    const owner = { ...patient, whatsappReminderPreferences: { dayBefore: true, sameDay: true,
      timingMode: 'custom', customTimes: [{ relativeDay: 'sameDay', time: '13:15' }] } };
    renderer = await setup(owner, async update => { writes.push(update); return true; });
    await act(async () => button(renderer, 'Restaurar horários padrão').props.onClick());
    await act(async () => label(renderer, 'Padrão para as próximas sessões').findByType('input').props.onChange());
    await act(async () => button(renderer, 'Salvar alterações').props.onClick());
    assert.equal(writes[0].patients[0].whatsappReminderPreferences.timingMode, 'default');
    assert.equal(writes[0].patients[0].whatsappReminderPreferences.customTimes, undefined);
  } finally { if (renderer) await act(async () => renderer.unmount()); restore(); }
});
