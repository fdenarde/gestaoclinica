import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const documentListeners = new Map();
let exportClicks = 0;
let reloadClicks = 0;

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  atob: (...args) => globalThis.atob(...args),
  btoa: (...args) => globalThis.btoa(...args),
  addEventListener() {},
  removeEventListener() {},
  setInterval() { return 0; },
  clearInterval() {},
  setTimeout,
  clearTimeout,
  localStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
  sessionStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
  location: { reload() { reloadClicks += 1; } },
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.HTMLElement = class HTMLElement {};
globalThis.document = {
  activeElement: null,
  addEventListener(type, handler) { documentListeners.set(type, handler); },
  removeEventListener(type) { documentListeners.delete(type); },
  getElementById() { return null; },
  createElement() { return { click() { exportClicks += 1; } }; },
};
globalThis.fetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => {} } } });
Object.defineProperty(globalThis.URL, 'createObjectURL', { configurable: true, value: () => 'blob:synthetic' });
Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, value: () => {} });

const { auth } = await import('../src/firebase.ts');
const syntheticUser = { uid: 'synthetic-r2b15b-user', getIdToken: async () => 'synthetic-id-token' };
try {
  Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => syntheticUser });
} catch {
  // Firebase's Auth object may expose a non-configurable getter in some runtimes.
}

const pilot = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');
const PsychologyPilot = pilot.default;
const {
  AgendaView,
  DateToolbar,
  DayView,
  DeletePatientDialog,
  PatientDialogR2F3E,
  PatientsView,
  PsychologyRemoteError,
  PsychologySettingsView,
  SessionActionsDialog,
  SessionDialog,
  TabbedAgendaSlotMenu,
} = pilot;
const PsychologyPatientChart = (await import('../src/features/psychology-pilot/PsychologyPatientChart.tsx')).default;
const PersonalAgenda = (await import('../src/components/PersonalAgenda.tsx')).default;
const { createEmptyPsychologyStore, createPsychologyScope, getPsychologyDayItems } = await import('../src/features/psychology-pilot/psychologyDomain.ts');
const { getPsychologyPatientDeletionAssessment } = await import('../src/features/psychology-pilot/psychologyPatientDeletion.ts');
const { createDefaultPublicBookingSettings, createPublicBookingException, getPublicBookingAgendaMarker } = await import('../src/features/psychology-online-booking/bookingDomain.ts');
const { getPsychologyPatientListViewModels } = await import('../src/features/psychology-pilot/psychologyPatientList.ts');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function allButtons(renderer) {
  return renderer.root.findAllByType('button');
}

function button(renderer, text, { exact = false, last = false } = {}) {
  const matches = allButtons(renderer).filter(item => exact ? textContent(item).trim() === text : textContent(item).includes(text));
  return last ? matches.at(-1) : matches[0];
}

function buttonByTestId(renderer, value) {
  return renderer.root.findAllByType('button').find(item => item.props['data-testid'] === value);
}

function nodesByTestId(renderer, value) {
  return renderer.root.findAll(node => node.props?.['data-testid'] === value);
}

function inputs(renderer) {
  return renderer.root.findAll(node => ['input', 'select', 'textarea'].includes(node.type));
}

function render(element) {
  let renderer;
  act(() => { renderer = TestRenderer.create(element); });
  return renderer;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function scopeStore() {
  const scope = createPsychologyScope('r2b15b-synthetic-professional');
  return createEmptyPsychologyStore(scope);
}

function patient(id, name, active = true) {
  return {
    id,
    professionalId: 'r2b15b-synthetic-professional',
    context: 'PSICOLOGIA',
    name,
    dateOfBirth: '1990-08-20',
    birthDate: '1990-08-20',
    phone: '27999999999',
    email: `${id}@example.test`,
    preferredModality: 'presencial',
    administrativeNote: '',
    administrativeNotes: '',
    active,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
  };
}

function session(id, patientId, date = '2026-08-19', time = '09:00', status = 'agendada') {
  return {
    id,
    professionalId: 'r2b15b-synthetic-professional',
    context: 'PSICOLOGIA',
    patientId,
    date,
    time,
    durationMinutes: 50,
    modality: 'presencial',
    serviceId: 'service-therapy',
    locationId: 'location-primary',
    locationType: 'PRIMARY_OFFICE',
    status,
    administrativeNote: '',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  };
}

function commitment(id, date = '2026-08-19', time = '10:00') {
  return {
    id,
    professionalId: 'r2b15b-synthetic-professional',
    context: 'PSICOLOGIA',
    date,
    time,
    title: 'Compromisso sintético',
    type: 'Outro',
    durationMinutes: 60,
    recurrence: 'Não repetir',
    note: 'Nota sintética',
    alarmEnabled: false,
    isDone: false,
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  };
}

function patientRows(store, patients) {
  return getPsychologyPatientListViewModels(store, patients, new Date('2026-08-20T12:00:00'));
}

function shellFetch({ fail = false } = {}) {
  return async (url) => {
    if (fail) throw new Error('synthetic boot failure');
    const path = String(url);
    if (path.endsWith('/settings')) return new Response(JSON.stringify({ settings: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

test('R2B15-B N01 — remote boot loading/error/retry is visible and retryable', async () => {
  reloadClicks = 0;
  globalThis.fetch = shellFetch({ fail: true });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPilot));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.equal(nodesByTestId(renderer, 'psychology-real-error').length, 1);
  assert.ok(button(renderer, 'Tentar novamente', { exact: true }));
  act(() => { button(renderer, 'Tentar novamente', { exact: true }).props.onClick(); });
  assert.equal(reloadClicks, 1);
  act(() => { renderer.unmount(); });
});

test('R2B15-B N02-N06 — shell navigation, mobile Mais and conditional actions stay coherent', async () => {
  globalThis.fetch = shellFetch();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPilot));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.equal(nodesByTestId(renderer, 'psychology-hourglass-loading').length, 0);
  assert.equal(renderer.root.findAllByProps({ href: '/' }).length, 1);

  act(() => { button(renderer, 'Pacientes', { exact: true }).props.onClick(); });
  assert.equal(textContent(renderer.root).includes('Pacientes'), true);
  assert.ok(renderer.root.findAllByProps({ 'aria-label': 'Voltar para Meu Dia' }).length >= 1);
  act(() => { renderer.root.findAllByProps({ 'aria-label': 'Voltar para Meu Dia' })[0].props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-day').length, 1);
  act(() => { button(renderer, 'Agenda', { exact: true }).props.onClick(); });
  assert.equal(textContent(renderer.root).includes('Agenda'), true);

  const bottomNav = nodesByTestId(renderer, 'psychology-bottom-nav')[0];
  const bottomAgenda = bottomNav.findAllByType('button').find(item => textContent(item).includes('Agenda'));
  act(() => { bottomAgenda.props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-bottom-nav').length, 1);

  act(() => { buttonByTestId(renderer, 'psychology-more-button').props.onClick(); });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Mais opções da Psicologia' }).length, 1);
  const keydown = documentListeners.get('keydown');
  assert.ok(keydown);
  act(() => { keydown({ key: 'Escape' }); });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Mais opções da Psicologia' }).length, 0);
  act(() => { buttonByTestId(renderer, 'psychology-more-button').props.onClick(); });
  const moreDialog = renderer.root.findAllByProps({ 'aria-label': 'Mais opções da Psicologia' })[0];
  act(() => { moreDialog.findAllByType('button').find(item => textContent(item).includes('Ajustes')).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings').length, 1);

  const store = scopeStore();
  const rows = patientRows(store, [patient('active', 'Ativo')]);
  const preview = { patientDetailsById: new Map(), bundle: { patientCounts: { initiallyImportable: 1, activeByFutureEvidence: 1, inactiveReview: 0 } } };
  const previewRenderer = render(React.createElement(PatientsView, { rows, search: '', setSearch() {}, onNew() {}, onEdit() {}, onOpen() {}, onDelete() {}, onToggle: async () => true, preview }));
  assert.equal(button(previewRenderer, 'Novo paciente', { exact: true }), undefined);
  assert.equal(previewRenderer.root.findAllByType('button').some(item => textContent(item).trim() === 'Editar'), false);
  act(() => { previewRenderer.unmount(); renderer.unmount(); });
});

test('R2B15-B N07 — Meu Dia date toolbar proves previous, next, input and Hoje', () => {
  let current = '2026-08-20';
  function Harness() {
    const [date, setDate] = React.useState(current);
    return React.createElement(DateToolbar, { date, setDate: value => { current = value; setDate(value); } });
  }
  const renderer = render(React.createElement(Harness));
  const previous = renderer.root.findAllByProps({ 'aria-label': 'Dia anterior' })[0];
  const next = renderer.root.findAllByProps({ 'aria-label': 'Próximo dia' })[0];
  act(() => { previous.props.onClick(); });
  assert.equal(current, '2026-08-19');
  act(() => { next.props.onClick(); });
  assert.equal(current, '2026-08-20');
  const dateInput = inputs(renderer).find(item => item.props.type === 'date');
  act(() => { dateInput.props.onChange({ target: { value: '2026-08-23' } }); });
  assert.equal(current, '2026-08-23');
  act(() => { button(renderer, 'Hoje', { exact: true }).props.onClick(); });
  assert.match(current, /^\d{4}-\d{2}-\d{2}$/);
  act(() => { renderer.unmount(); });
});

test('R2B15-B N08-N09 — Meu Dia empty shortcut and contextual session/birthday entries are coherent', () => {
  const store = scopeStore();
  const p = patient('p-day', 'Aniversariante');
  const s = session('s-day', p.id, '2026-08-20', '09:00');
  const callbacks = { schedule: 0, personal: 0, opened: null };
  const emptyRenderer = render(React.createElement(DayView, { date: '2026-08-20', setDate() {}, store: { ...store, patients: [] }, sessions: [], settings: store.settings, onSchedule: () => { callbacks.schedule += 1; }, onPersonal: () => { callbacks.personal += 1; }, onOpenSession() {} }));
  assert.ok(button(emptyRenderer, 'Novo compromisso pessoal', { exact: true }));
  act(() => { button(emptyRenderer, 'Novo compromisso pessoal', { exact: true }).props.onClick(); });
  assert.equal(callbacks.personal, 1);
  act(() => { emptyRenderer.unmount(); });

  const dayRenderer = render(React.createElement(DayView, { date: '2026-08-20', setDate() {}, store: { ...store, patients: [p], sessions: [s] }, sessions: [s], settings: store.settings, onSchedule: () => { callbacks.schedule += 1; }, onPersonal: () => { callbacks.personal += 1; }, onOpenSession: value => { callbacks.opened = value; } }));
  assert.match(textContent(dayRenderer.root), /Aniversariante/);
  const sessionCard = nodesByTestId(dayRenderer, 'psychology-session-compact-card')[0];
  act(() => { sessionCard.props.onClick(); });
  assert.equal(callbacks.opened.id, s.id);
  assert.equal(getPsychologyDayItems({ ...store, patients: [p], sessions: [s] }, '2026-08-20').find(item => item.kind === 'session').item.id, s.id);
  act(() => { dayRenderer.unmount(); });
});

test('R2B15-B N10-N12 — patient list search, status filters, create and edit remain reachable', async () => {
  const store = scopeStore();
  const patients = [patient('p-active', 'Ana Ativa', true), patient('p-inactive', 'Bruna Inativa', false), patient('p-review', 'Carla Revisar', false)];
  const rows = patientRows(store, patients);
  const preview = { patientDetailsById: new Map([['p-review', { reviewReason: 'Histórico sem evidência futura' }]]), bundle: { patientCounts: { initiallyImportable: 3, activeByFutureEvidence: 1, inactiveReview: 2 } } };
  function PatientHarness() {
    const [search, setSearch] = React.useState('');
    const filteredRows = rows.filter(row => `${row.patient.name} ${row.patient.phone} ${row.patient.email}`.toLowerCase().includes(search.toLowerCase()));
    return React.createElement(PatientsView, { rows: filteredRows, search, setSearch, onNew() {}, onEdit() {}, onOpen() {}, onDelete() {}, onToggle: async () => true, preview });
  }
  const renderer = render(React.createElement(PatientHarness));
  assert.equal(nodesByTestId(renderer, 'psychology-patient-list-row').length, 3);
  const search = inputs(renderer).find(item => item.props.placeholder?.includes('Buscar paciente'));
  act(() => { search.props.onChange({ target: { value: 'Bruna' } }); });
  assert.equal(nodesByTestId(renderer, 'psychology-patient-list-row').length, 1);
  act(() => { search.props.onChange({ target: { value: '' } }); });
  act(() => { button(renderer, 'Todos', { exact: true }).props.onClick(); });
  act(() => { button(renderer, 'Ativos', { exact: true }).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-patient-list-row').length, 1);
  act(() => { button(renderer, 'Revisar status', { exact: true }).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-patient-list-row').length, 1);
  act(() => { renderer.unmount(); });

  let saved = null;
  const createRenderer = render(React.createElement(PatientDialogR2F3E, { value: null, onClose() {}, onSave: input => { saved = input; return true; } }));
  const createInputs = inputs(createRenderer);
  act(() => { createInputs.find(item => item.props.type === 'date').props.onChange({ target: { value: '1990-08-20' } }); });
  act(() => { createInputs.find(item => item.props.type === 'email').props.onChange({ target: { value: 'ana@example.test' } }); });
  const textInputs = inputs(createRenderer).filter(item => item.type === 'input' && !item.props.type);
  act(() => { textInputs[0].props.onChange({ target: { value: 'Ana Criada' } }); });
  act(() => { inputs(createRenderer).filter(item => item.type === 'input' && !item.props.type)[1].props.onChange({ target: { value: '27999999999' } }); });
  act(() => { createRenderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  await flush();
  assert.equal(saved.name, 'Ana Criada');
  assert.equal(saved.phone, '27999999999');
  act(() => { createRenderer.unmount(); });

  let edited = null;
  const editRenderer = render(React.createElement(PatientDialogR2F3E, { value: patients[0], onClose() {}, onSave: input => { edited = input; return true; } }));
  const editName = inputs(editRenderer).find(item => item.props.value === 'Ana Ativa');
  act(() => { editName.props.onChange({ target: { value: 'Ana Editada' } }); });
  act(() => { editRenderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  await flush();
  assert.equal(edited.name, 'Ana Editada');
  act(() => { editRenderer.unmount(); });
});

test('R2B15-B N13-N16 — patient chart tabs, session actions, export and deletion guard are wired', async () => {
  const base = scopeStore();
  const p = patient('p-chart', 'Paciente Ficha');
  const s = session('s-chart', p.id, '2026-08-20', '09:00');
  const store = { ...base, patients: [p], sessions: [s] };
  let chartClosed = 0;
  const chartRenderer = render(React.createElement(PsychologyPatientChart, { store, patientId: p.id, allowSyntheticLocalTools: true, onClose: () => { chartClosed += 1; }, onEdit() {}, onSchedule() {}, onOpenSession() {}, onStoreChange: () => true, onStatus: async () => true, onRecord() {} }));
  assert.ok(chartRenderer.root.findAllByProps({ 'aria-label': 'Fechar ficha' }).length);
  act(() => { chartRenderer.root.findAllByType('button').find(item => textContent(item).trim() === 'Sessões').props.onClick(); });
  assert.equal(nodesByTestId(chartRenderer, 'psychology-patient-session-row').length, 1);
  act(() => { chartRenderer.root.findAllByProps({ 'aria-label': 'Exportar dados' })[0].props.onClick(); });
  assert.equal(nodesByTestId(chartRenderer, 'psychology-patient-export-options').length, 1);
  act(() => { button(chartRenderer, 'Gerar exportação sintética', { exact: true }).props.onClick(); });
  await flush();
  assert.equal(exportClicks, 1);
  act(() => { chartRenderer.root.findAllByProps({ 'aria-label': 'Fechar ficha' })[0].props.onClick(); });
  assert.equal(chartClosed, 1);
  act(() => { chartRenderer.unmount(); });

  const readOnlyRenderer = render(React.createElement(PsychologyPatientChart, { store, patientId: p.id, readOnly: true, onClose() {}, onEdit() {}, onSchedule() {}, onOpenSession() {}, onStoreChange: () => true, onStatus: async () => true, onRecord() {} }));
  assert.match(textContent(readOnlyRenderer.root), /somente leitura/);
  assert.equal(readOnlyRenderer.root.findAllByProps({ 'aria-label': 'Exportar dados' }).length, 0);
  act(() => { readOnlyRenderer.unmount(); });

  let status = null;
  const actionsRenderer = render(React.createElement(SessionActionsDialog, { session: s, patient: p, hasRecord: false, onClose() {}, onEdit() {}, onStatus: async value => { status = value; return true; }, onRecord() {} }));
  act(() => { button(actionsRenderer, 'Marcar realizada', { exact: true }).props.onClick(); });
  await flush();
  assert.equal(status, 'realizada');
  act(() => { actionsRenderer.unmount(); });

  const assessment = getPsychologyPatientDeletionAssessment(store, p.id);
  let deleted = 0;
  const deleteRenderer = render(React.createElement(DeletePatientDialog, { assessment, onClose() {}, onConfirm: async () => { deleted += 1; return true; } }));
  act(() => { button(deleteRenderer, 'Excluir definitivamente', { exact: true }).props.onClick(); });
  await flush();
  assert.equal(deleted, 1);
  act(() => { deleteRenderer.unmount(); });
});

test('R2B15-B N17-N20 and N28 — agenda navigation, occupied tiles, free slots and cancelled cleanup are wired', () => {
  const store = scopeStore();
  const p = patient('p-agenda', 'Paciente Agenda');
  const clinical = session('s-agenda', p.id, '2026-08-18', '09:00');
  const cancelled = session('s-cancelled', p.id, '2026-08-19', '11:00', 'cancelada');
  const personal = commitment('c-agenda', '2026-08-20', '10:00');
  const calls = { previous: 0, next: 0, today: 0, new: null, session: null, personal: null, removed: null };
  const renderer = render(React.createElement(AgendaView, {
    sessions: [clinical, cancelled],
    personalCommitments: [personal],
    patientMap: new Map([[p.id, p]]),
    settings: store.settings,
    weekStart: new Date('2026-08-17T12:00:00'),
    onPreviousWeek: () => { calls.previous += 1; },
    onNextWeek: () => { calls.next += 1; },
    onToday: () => { calls.today += 1; },
    onNew: (...value) => { calls.new = value; },
    onPublicBookingAction() {},
    onOpenSession: value => { calls.session = value; },
    onRemoveCancelled: value => { calls.removed = value; },
    onOpenPersonal: value => { calls.personal = value; },
  }));
  act(() => { renderer.root.findAllByProps({ 'aria-label': 'Semana anterior' })[0].props.onClick(); renderer.root.findAllByProps({ 'aria-label': 'Próxima semana' })[0].props.onClick(); button(renderer, 'Hoje', { exact: true }).props.onClick(); });
  assert.deepEqual({ previous: calls.previous, next: calls.next, today: calls.today }, { previous: 1, next: 1, today: 1 });
  const occupiedSession = nodesByTestId(renderer, 'psychology-weekly-session').find(node => node.props['data-agenda-cancelled'] === 'false');
  act(() => { occupiedSession.props.onClick(); });
  assert.equal(calls.session.id, clinical.id);
  const occupiedPersonal = nodesByTestId(renderer, 'psychology-weekly-personal')[0];
  act(() => { occupiedPersonal.props.onClick(); });
  assert.equal(calls.personal.id, personal.id);
  const cancelledTile = nodesByTestId(renderer, 'psychology-weekly-session').find(node => node.props['data-agenda-cancelled'] === 'true');
  const removeCancelled = cancelledTile.findAllByProps({ 'aria-label': 'Remover consulta cancelada' })[0];
  act(() => { removeCancelled.props.onClick({ stopPropagation() {} }); });
  assert.equal(calls.removed.id, cancelled.id);
  const freeSlot = nodesByTestId(renderer, 'psychology-agenda-free-slot')[0];
  act(() => { freeSlot.props.onClick(); });
  assert.equal(renderer.root.findAll(node => node.props?.role === 'dialog' && node.props?.['aria-label'] === 'Ações do horário').length, 1);
  act(() => { renderer.root.findAllByProps({ 'aria-label': 'Fechar menu' })[0].props.onClick(); });
  assert.equal(renderer.root.findAll(node => node.props?.role === 'dialog' && node.props?.['aria-label'] === 'Ações do horário').length, 0);
  act(() => { renderer.unmount(); });
});

test('R2B15-B N21-N27 — agenda slot menu covers tabs, schedule, availability, blocks and custom intervals', () => {
  const settings = scopeStore().settings;
  const publicSettings = createDefaultPublicBookingSettings(new Date('2026-08-17T12:00:00'));
  const actions = [];
  const common = { settings, publicBookingSettings: publicSettings, onClose() {}, onNew: (...value) => actions.push({ kind: 'new', value }), onPublicBookingAction: action => actions.push(action) };
  const baseSlot = { date: '2026-08-18', time: '10:00', endTime: '11:00', marker: { kind: 'NONE' } };
  const renderer = render(React.createElement(TabbedAgendaSlotMenu, { ...common, slotMenu: baseSlot }));
  assert.ok(buttonByTestId(renderer, 'psychology-agenda-manual-booking'));
  act(() => { buttonByTestId(renderer, 'psychology-agenda-manual-booking').props.onClick(); });
  act(() => { buttonByTestId(renderer, 'psychology-agenda-personal-booking').props.onClick(); });
  assert.equal(actions.filter(item => item.kind === 'new').length, 2);
  act(() => { buttonByTestId(renderer, 'psychology-agenda-menu-tab-block').props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-agenda-block-slot').length, 1);
  act(() => { buttonByTestId(renderer, 'psychology-agenda-block-interval').props.onClick(); });
  const intervalInputs = renderer.root.findAllByProps({ 'aria-label': 'Fim do bloqueio personalizado' });
  act(() => { intervalInputs[0].props.onChange({ target: { value: '10:00' } }); });
  act(() => { buttonByTestId(renderer, 'psychology-agenda-confirm-custom-interval').props.onClick(); });
  assert.ok(renderer.root.findAllByProps({ role: 'alert' }).some(node => textContent(node).includes('fim precisa')));
  act(() => { intervalInputs[0].props.onChange({ target: { value: '12:00' } }); });
  act(() => { buttonByTestId(renderer, 'psychology-agenda-confirm-custom-interval').props.onClick(); });
  assert.ok(actions.some(item => item.kind === 'BLOCK_PERIOD' && item.startTime === '10:00' && item.endTime === '12:00'));
  act(() => { buttonByTestId(renderer, 'psychology-agenda-menu-tab-availability').props.onClick(); });
  assert.match(textContent(renderer.root), /Disponível para Agendamento Online/);
  act(() => { renderer.unmount(); });

  const blockedException = createPublicBookingException({ professionalId: publicSettings.professionalId, civilDate: '2026-08-18', type: 'BLOCK_PERIOD', startTime: '10:00', endTime: '11:00', id: 'synthetic-block' });
  const blockedSettings = { ...publicSettings, publicBookingExceptions: [blockedException] };
  let unblock = null;
  const blockedRenderer = render(React.createElement(TabbedAgendaSlotMenu, { settings, publicBookingSettings: blockedSettings, slotMenu: { ...baseSlot, marker: getPublicBookingAgendaMarker(blockedSettings, baseSlot.date, baseSlot.time, baseSlot.endTime) }, onClose() {}, onNew() {}, onPublicBookingAction: value => { unblock = value; } }));
  act(() => { buttonByTestId(blockedRenderer, 'psychology-agenda-unblock-online').props.onClick(); });
  assert.equal(unblock.kind, 'UNBLOCK');
  act(() => { blockedRenderer.unmount(); });

  let opened = null;
  const outsideRenderer = render(React.createElement(TabbedAgendaSlotMenu, { settings, publicBookingSettings: publicSettings, slotMenu: { date: '2026-08-23', time: '10:00', endTime: '11:00', marker: { kind: 'NONE' } }, onClose() {}, onNew() {}, onPublicBookingAction: value => { opened = value; } }));
  act(() => { buttonByTestId(outsideRenderer, 'psychology-agenda-menu-tab-availability').props.onClick(); });
  act(() => { buttonByTestId(outsideRenderer, 'psychology-agenda-open-slot').props.onClick(); });
  assert.equal(opened.kind, 'OPEN_PERIOD');
  act(() => { outsideRenderer.unmount(); });

  const quickActions = [];
  const quickRenderer = render(React.createElement(TabbedAgendaSlotMenu, { settings, publicBookingSettings: publicSettings, slotMenu: baseSlot, onClose() {}, onNew() {}, onPublicBookingAction: value => quickActions.push(value) }));
  act(() => { buttonByTestId(quickRenderer, 'psychology-agenda-menu-tab-block').props.onClick(); });
  for (const id of ['psychology-agenda-block-morning', 'psychology-agenda-block-afternoon', 'psychology-agenda-block-evening', 'psychology-agenda-block-day']) act(() => { buttonByTestId(quickRenderer, id).props.onClick(); });
  assert.equal(quickActions.length, 4);
  act(() => { quickRenderer.unmount(); });
});

test('R2B15-B N29-N31 — session dialog resolves service, modality, availability warning and submit lock', async () => {
  const base = scopeStore();
  const p = patient('p-session', 'Paciente Sessão');
  const store = { ...base, patients: [p] };
  const settings = store.settings;
  const services = settings.services.filter(item => item.active);
  let saved = null;
  const renderer = render(React.createElement(SessionDialog, { value: null, store, settings, defaultPatientId: p.id, defaultDate: '2026-08-17', defaultTime: '10:00', onClose() {}, onSave: async input => { saved = input; return true; } }));
  const selects = () => renderer.root.findAllByType('select');
  if (services.length > 1) {
    act(() => { selects()[1].props.onChange({ target: { value: services[1].id } }); });
    assert.match(textContent(renderer.root.findAllByProps({ 'data-testid': 'psychology-service-duration' })[0]), new RegExp(String(services[1].defaultDurationMinutes)));
  }
  act(() => { selects().find(item => item.props.value === 'presencial').props.onChange({ target: { value: 'online' } }); });
  assert.equal(renderer.root.findAllByType('select').some(item => item.props.value === undefined), false);
  const form = renderer.root.findAllByType('form')[0];
  await act(async () => { await form.props.onSubmit({ preventDefault() {} }); });
  assert.equal(saved.modality, 'online');
  act(() => { renderer.unmount(); });

  let outsideSaved = 0;
  const outsideRenderer = render(React.createElement(SessionDialog, { value: null, store, settings, defaultPatientId: p.id, defaultDate: '2026-08-23', defaultTime: '10:00', onClose() {}, onSave: async () => { outsideSaved += 1; return true; } }));
  await act(async () => { await outsideRenderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  assert.equal(outsideRenderer.root.findAllByProps({ role: 'alert' }).length, 1);
  act(() => { button(outsideRenderer, 'Cancelar', { exact: true }).props.onClick(); });
  await act(async () => { await outsideRenderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  act(() => { button(outsideRenderer, 'Agendar mesmo assim', { exact: true }).props.onClick(); });
  await flush();
  assert.equal(outsideSaved, 1);
  act(() => { outsideRenderer.unmount(); });

  let resolveSave;
  let attempts = 0;
  const pendingRenderer = render(React.createElement(SessionDialog, { value: null, store, settings, defaultPatientId: p.id, defaultDate: '2026-08-17', defaultTime: '10:00', onClose() {}, onSave: () => { attempts += 1; return new Promise(resolve => { resolveSave = resolve; }); } }));
  const pendingForm = pendingRenderer.root.findAllByType('form')[0];
  await act(async () => { pendingForm.props.onSubmit({ preventDefault() {} }); await Promise.resolve(); });
  assert.equal(attempts, 1);
  assert.equal(button(pendingRenderer, 'Salvando…', { exact: true }).props.disabled, true);
  act(() => { pendingForm.props.onSubmit({ preventDefault() {} }); });
  assert.equal(attempts, 1);
  resolveSave(false);
  await flush();
  assert.equal(button(pendingRenderer, 'Salvar sessão', { exact: true }).props.disabled, false);
  act(() => { pendingRenderer.unmount(); });
});

test('R2B15-B N32-N37 — personal agenda views, temporal navigation, keyboard entry and advanced form persist one update', async () => {
  const today = new Date();
  const todayDate = today.toISOString().slice(0, 10);
  const existing = { id: 'personal-existing', type: 'Outro', date: todayDate, time: '08:00', durationMinutes: 60, recurrence: 'Não repetir', notes: 'Existente', alarmEnabled: false, isDone: false };
  const updates = [];
  const state = { personalAppointments: [existing] };
  const renderer = render(React.createElement(PersonalAgenda, { state, variant: 'psychology', activeAlarmId: null, activeAlarmLabel: '', stopAlarm() {}, onUpdate: async patch => { updates.push(patch); return true; } }));
  assert.equal(nodesByTestId(renderer, 'psychology-personal-agenda').length, 1);
  for (const label of ['Mensal', 'Lista', 'Próximos', 'Semanal']) {
    act(() => { button(renderer, label, { exact: true }).props.onClick(); });
    assert.equal(nodesByTestId(renderer, 'psychology-personal-agenda').length, 1);
  }
  act(() => { button(renderer, 'Lista', { exact: true }).props.onClick(); });
  for (const label of ['Hoje', 'Esta Semana', 'Este Mês']) act(() => { button(renderer, label, { exact: true }).props.onClick(); });
  assert.match(textContent(renderer.root), /Compromissos de/);
  act(() => { button(renderer, 'Semanal', { exact: true }).props.onClick(); });
  const navigationArrows = allButtons(renderer).filter(item => String(item.props.className || '').includes('p-1 hover:bg-clinic-bg text-clinic-primary'));
  assert.equal(navigationArrows.length, 2);
  const beforePrevious = textContent(renderer.root).match(/\d{2}\/\d{2} - \d{2}\/\d{2}/)?.[0];
  act(() => { navigationArrows[0].props.onClick(); });
  const afterPrevious = textContent(renderer.root).match(/\d{2}\/\d{2} - \d{2}\/\d{2}/)?.[0];
  assert.notEqual(afterPrevious, beforePrevious);
  act(() => { navigationArrows[1].props.onClick(); });
  assert.equal(textContent(renderer.root).match(/\d{2}\/\d{2} - \d{2}\/\d{2}/)?.[0], beforePrevious);

  const empty = nodesByTestId(renderer, 'psychology-personal-empty-slot')[0];
  act(() => { empty.props.onKeyDown({ key: 'Enter', preventDefault() {} }); });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Fechar modal' }).length, 1);
  act(() => { renderer.root.findAllByProps({ 'aria-label': 'Fechar modal' })[0].props.onClick(); });
  const occupied = nodesByTestId(renderer, 'psychology-personal-occupied-card')[0];
  act(() => { occupied.props.onKeyDown({ key: 'Enter', preventDefault() {} }); });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Fechar modal' }).length, 1);
  act(() => { renderer.root.findAllByProps({ 'aria-label': 'Fechar modal' })[0].props.onClick(); });

  act(() => { button(renderer, '+ Novo Compromisso', { exact: false }).props.onClick(); });
  const recurrence = inputs(renderer).find(item => item.type === 'select' && item.props.value === 'Não repetir');
  act(() => { recurrence.props.onChange({ target: { value: 'Toda semana' } }); });
  const note = inputs(renderer).find(item => item.type === 'textarea');
  act(() => { note.props.onChange({ target: { value: 'Nota persistida' } }); });
  const alarm = inputs(renderer).find(item => item.props.type === 'checkbox');
  await act(async () => { await alarm.props.onChange({ target: { checked: true } }); });
  const range = inputs(renderer).find(item => item.props.type === 'range');
  act(() => { range.props.onChange({ target: { value: '65' } }); });
  const fade = inputs(renderer).find(item => item.props.type === 'checkbox' && item !== alarm);
  act(() => { fade.props.onChange({ target: { checked: true } }); });
  act(() => { button(renderer, 'Salvar Compromisso', { exact: true }).props.onClick(); });
  await flush();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].personalAppointments[1].recurrence, 'Toda semana');
  assert.equal(updates[0].personalAppointments[1].notes, 'Nota persistida');
  assert.equal(updates[0].personalAppointments[1].alarmEnabled, true);
  assert.equal(updates[0].personalAppointments[1].alarmVolume, 65);
  assert.equal(updates[0].personalAppointments[1].alarmFadeIn, true);
  act(() => { renderer.unmount(); });
});

test('R2B15-B N38 — personal agenda keeps modal close disabled while save is pending', async () => {
  let resolveUpdate;
  const renderer = render(React.createElement(PersonalAgenda, { state: { personalAppointments: [] }, variant: 'psychology', activeAlarmId: null, activeAlarmLabel: '', stopAlarm() {}, onUpdate: () => new Promise(resolve => { resolveUpdate = resolve; }) }));
  act(() => { button(renderer, '+ Novo Compromisso', { exact: false }).props.onClick(); });
  act(() => { button(renderer, 'Salvar Compromisso', { exact: true }).props.onClick(); });
  await act(async () => { await Promise.resolve(); });
  const close = renderer.root.findAllByProps({ 'aria-label': 'Fechar modal' })[0];
  assert.equal(close.props.disabled, true);
  resolveUpdate(true);
  await flush();
  act(() => { renderer.unmount(); });
});

test('R2B15-B N39 — settings tabs and secondary profile actions preserve one coherent route', () => {
  const store = scopeStore();
  const p = patient('p-settings', 'Paciente Ajustes');
  const callbacks = { back: 0, updates: 0 };
  const renderer = render(React.createElement(PsychologySettingsView, {
    store,
    settings: store.settings,
    patients: [p],
    sessionPackages: [],
    onUpdatePackage: async () => true,
    onUpdate: async () => { callbacks.updates += 1; return true; },
    onUpdateLocation: async () => true,
    onCreateLocation: async () => true,
    onSetLocationColor: async () => true,
    onSetPrimary: async () => true,
    onSetActive: async () => true,
    onSetColor: async () => true,
    onRestoreColors: async () => true,
    hiddenCancelledEventCount: 1,
    onRestoreHiddenCancelled: () => { callbacks.back += 1; },
    previewLoading: false,
    previewLoadError: '',
    onActivatePreview() {},
    onEndPreview() {},
  }));
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-profile').length, 1);
  act(() => { buttonByTestId(renderer, 'psychology-settings-tab-attendance').props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-attendance').length, 1);
  act(() => { buttonByTestId(renderer, 'psychology-settings-tab-agenda').props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-agenda').length, 1);
  act(() => { button(renderer, 'Configurar', { exact: true }).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-agenda-settings-editor').length, 1);
  act(() => { buttonByTestId(renderer, 'psychology-settings-tab-system').props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-system').length, 1);
  act(() => { button(renderer, 'Voltar às áreas de ajustes', { exact: true }).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-settings-panel-agenda').length, 1);
  act(() => { buttonByTestId(renderer, 'psychology-settings-tab-profile').props.onClick(); });
  act(() => { button(renderer, 'Editar', { exact: true }).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-profile-editor').length, 1);
  act(() => { button(renderer, 'Cancelar', { exact: true }).props.onClick(); });
  assert.equal(nodesByTestId(renderer, 'psychology-profile-editor').length, 0);
  act(() => { renderer.unmount(); });
});
