import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

mock.module('../src/components/Auth/AccessRequestsAdminCard.tsx', { exports: { default: () => null } });
mock.module('../src/components/Common/Modal.tsx', { exports: { default: ({ isOpen, title, children }) =>
  isOpen ? React.createElement('section', { role: 'dialog', 'aria-label': title }, children) : null } });
const { default: Agenda } = await import('../src/components/Agenda.tsx');
mock.module('../src/firebase.ts', { exports: { auth: { currentUser: null }, db: {} } });
mock.module('../src/lib/accessApi.ts', { exports: {
  getProfessionalPatientProfileChangeRequests: async () => [],
  getProfessionalResponsibleDocumentUrl: async () => { throw Error('fixture offline'); },
  reviewPatientProfileChangeRequest: async () => { throw Error('escrita externa proibida'); },
} });
mock.module('../src/components/Auth/ResponsiblePortal.tsx', { exports: { default: () => null } });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalGlobals = new Map(['window', 'document', 'HTMLElement', 'Date', 'fetch']
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const text = node => typeof node === 'string' || typeof node === 'number'
  ? String(node) : (node?.children || []).map(text).join(' ');
const visible = node => { for (let cursor = node; cursor; cursor = cursor.parent) if (cursor.props?.hidden) return false; return true; };
const button = (renderer, label) => renderer.root.findAllByType('button')
  .find(node => visible(node) && text(node).trim() === label);
const patient = { id: 'fixture-patient', name: 'Atendido fictício', guardianName: 'Responsável fictício',
  whatsapp: '27 90000-0000', status: 'Ativo', startDate: '2026-01-01', fixedDay: '', fixedTime: '',
  paymentModal: 'PADRÃO: Pix integral', birthDate: '2020-01-01', packageTolerances: [], packageContracts: [] };
const session = { id: 'fixture-session', patientId: patient.id, date: '2026-09-30', time: '19:00',
  type: 'Sessão simples (50 min)', status: 'Agendada', packageNumber: 1 };
const makeState = (sessions = [session]) => ({ patients: [patient], sessions, payments: [], expenses: [], evolutions: [],
  repositions: [], personalAppointments: [], settings: { holidays: [], activityMediaMonitoringStart: '2026-09-01' } });

function offline() {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-30T19:10:00-03:00'])); }
    static now() { return new NativeDate('2026-09-30T19:10:00-03:00').getTime(); }
  };
  globalThis.HTMLElement = class {};
  globalThis.window = { setTimeout: () => 0, clearTimeout() {}, confirm: () => true,
    location: { origin: 'http://127.0.0.1:4291' }, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {},
    getElementById: () => ({ focus() {}, appendChild() {} }),
    createElement: () => ({ setAttribute() {}, append() {}, classList: { add() {}, remove() {} },
      addEventListener() {}, remove() {} }) };
  globalThis.fetch = async () => { throw Error('rede proibida na fixture'); };
}
function restore() {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
async function setup(onUpdate, onNavigateToPatientGallery, source = makeState()) {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Agenda,
    { state: source, onUpdate, onNavigateToPatientGallery, currentUserName: 'Equipe fictícia', currentUserRole: 'admin' })); });
  const card = renderer.root.findAll(node => node.type === 'div' && node.props.onClick
    && String(node.props['aria-label'] || '').includes('19:00')
    && String(node.props['aria-label'] || '').includes(patient.name))[0];
  assert.ok(card, 'sessão fictícia visível');
  await act(async () => card.props.onClick());
  await act(async () => button(renderer, 'Ações').props.onClick());
  return renderer;
}

test('pergunta só após sucesso; Registrar atividade agora reutiliza navegação com paciente, sessão e data originais', async () => {
  offline(); let renderer; const writes = []; const navigation = [];
  try {
    let finishSave;
    renderer = await setup(update => { writes.push(update); return new Promise(resolve => { finishSave = resolve; }); },
      (patientId, sessionId) => navigation.push({ patientId, sessionId }));
    const clickPromise = button(renderer, 'OK / Presença').props.onClick();
    await button(renderer, 'OK / Presença').props.onClick();
    assert.equal(button(renderer, 'Registrar atividade agora'), undefined, 'a pergunta aguarda o salvamento');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].sessions[0].status, 'Realizada');
    assert.equal(writes[0].sessions[0].date, session.date);
    await act(async () => { finishSave(true); await clickPromise; });
    assert.ok(button(renderer, 'Registrar atividade agora'));
    assert.deepEqual(navigation, [], 'nenhuma atividade é criada automaticamente');
    await act(async () => button(renderer, 'Registrar atividade agora').props.onClick());
    assert.deepEqual(navigation, [{ patientId: patient.id, sessionId: session.id }]);
    assert.equal(button(renderer, 'Registrar atividade agora'), undefined);
    assert.equal(writes.length, 1, 'a escolha opcional não grava atividade');
  } finally { if (renderer) await act(async () => renderer.unmount()); restore(); }
});

test('falha ao salvar presença não abre pergunta nem atividade', async () => {
  offline(); let renderer; const navigation = [];
  try {
    renderer = await setup(async () => false, (...args) => navigation.push(args));
    await act(async () => button(renderer, 'OK / Presença').props.onClick());
    assert.equal(button(renderer, 'Registrar atividade agora'), undefined);
    assert.deepEqual(navigation, []);
  } finally { if (renderer) await act(async () => renderer.unmount()); restore(); }
});

test('Agora não mantém presença, não navega e reabrir sessão realizada não pergunta novamente', async () => {
  offline(); let renderer; const navigation = []; let source = makeState();
  const props = { onUpdate: async update => { source = { ...source, ...update }; return true; },
    onNavigateToPatientGallery: (...args) => navigation.push(args), currentUserName: 'Equipe fictícia', currentUserRole: 'admin' };
  try {
    renderer = await setup(props.onUpdate, props.onNavigateToPatientGallery, source);
    await act(async () => button(renderer, 'OK / Presença').props.onClick());
    assert.ok(button(renderer, 'Agora não'));
    await act(async () => button(renderer, 'Agora não').props.onClick());
    assert.equal(source.sessions[0].status, 'Realizada');
    assert.deepEqual(navigation, []);
    await act(async () => renderer.update(React.createElement(Agenda, { ...props, state: source })));
    const card = renderer.root.findAll(node => node.type === 'div' && node.props.onClick
      && String(node.props['aria-label'] || '').includes('19:00')
      && String(node.props['aria-label'] || '').includes(patient.name))[0];
    assert.ok(card);
    await act(async () => card.props.onClick());
    await act(async () => button(renderer, 'Ações').props.onClick());
    assert.equal(button(renderer, 'OK / Presença'), undefined, 'sessão já realizada não permite nova transição');
    assert.equal(button(renderer, 'Registrar atividade agora'), undefined);
  } finally { if (renderer) await act(async () => renderer.unmount()); restore(); }
});
