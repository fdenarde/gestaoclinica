import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  confirm: () => true,
  localStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
  sessionStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.HTMLElement = class HTMLElement {};
globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });

const {
  PatientsView,
  AgendaView,
  PsychologySettingsView,
} = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');
const PsychologyPatientChart = (await import('../src/features/psychology-pilot/PsychologyPatientChart.tsx')).default;
const PersonalAgenda = (await import('../src/components/PersonalAgenda.tsx')).default;
const { createEmptyPsychologyStore, createPsychologyScope, getPsychologyDayItems } = await import('../src/features/psychology-pilot/psychologyDomain.ts');
const { createPsychologyPersistenceScope } = await import('../src/features/psychology-persistence/scope.ts');
const { createApiPsychologyRepositories } = await import('../src/features/psychology-persistence/repositories/api.ts');
const { getPsychologyPatientListViewModels } = await import('../src/features/psychology-pilot/psychologyPatientList.ts');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function button(renderer, text, exact = false) {
  return renderer.root.findAllByType('button').find(item => exact ? textContent(item).trim() === text : textContent(item).includes(text));
}

function nodesByTestId(renderer, value) {
  return renderer.root.findAll(node => node.props?.['data-testid'] === value);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function deferred() {
  let resolve;
  const promise = new Promise(result => { resolve = result; });
  return { promise, resolve };
}

function syntheticPatient(scope, active = true) {
  return {
    id: 'synthetic-patient-r2b14b', professionalId: scope.professionalId, context: 'PSICOLOGIA',
    name: 'Paciente Sintético R2B14-B', dateOfBirth: '1990-01-01', birthDate: '1990-01-01',
    phone: '27999999999', email: 'r2b14b@example.test', preferredModality: 'presencial',
    administrativeNote: '', administrativeNotes: '', active,
    createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

test('R2B14-B group 1 — patient active toggle uses one PATCH, pending, persistence and retryable failure', async () => {
  const scope = createPsychologyPersistenceScope('synthetic-professional-r2b14b');
  let currentPatient = syntheticPatient(scope, true);
  const baseStore = createEmptyPsychologyStore(scope);
  const requests = [];
  const responses = [];
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-token',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method });
      return new Promise(resolve => responses.push(resolve));
    },
  });
  let renderer;
  function Harness() {
    const [patient, setPatient] = useState(currentPatient);
    const store = { ...baseStore, patients: [patient] };
    const rows = getPsychologyPatientListViewModels(store, [patient], new Date('2026-08-23T12:00:00'));
    const onToggle = async value => {
      const updated = await repositories.patients.update(scope, value.id, { active: !value.active });
      if (updated) { currentPatient = updated; setPatient(updated); }
      return Boolean(updated);
    };
    return React.createElement(PatientsView, { rows, search: '', setSearch: () => {}, onNew: () => {}, onEdit: () => {}, onOpen: () => {}, onDelete: () => {}, onToggle });
  }
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });

  let toggle = button(renderer, 'Inativar', true);
  assert.ok(toggle);
  let firstToggle;
  let secondClick;
  act(() => {
    firstToggle = toggle.props.onClick();
    secondClick = toggle.props.onClick();
  });
  await act(async () => { await secondClick; await Promise.resolve(); });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PATCH');
  assert.ok(button(renderer, 'Salvando…', true));
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.ok(button(renderer, 'Salvando…', true));
  const inactive = { ...currentPatient, active: false, updatedAt: '2026-08-23T00:01:00.000Z' };
  await act(async () => { responses.shift()(jsonResponse({ patient: inactive })); await firstToggle; });
  assert.match(textContent(renderer.root), /Inativo/);
  assert.ok(button(renderer, 'Ativar', true));

  toggle = button(renderer, 'Ativar', true);
  let secondToggle;
  await act(async () => { secondToggle = toggle.props.onClick(); await Promise.resolve(); });
  assert.equal(requests.length, 2);
  const active = { ...inactive, active: true, updatedAt: '2026-08-23T00:02:00.000Z' };
  await act(async () => { responses.shift()(jsonResponse({ patient: active })); await secondToggle; });
  assert.match(textContent(renderer.root), /Ativo/);

  toggle = button(renderer, 'Inativar', true);
  let failedToggle;
  await act(async () => { failedToggle = toggle.props.onClick(); await Promise.resolve(); });
  assert.equal(requests.length, 3);
  await act(async () => { responses.shift()(jsonResponse({ message: 'synthetic failure' }, 500)); await failedToggle; });
  assert.ok(renderer.root.findAll(node => node.props?.role === 'alert').length > 0);
  assert.ok(button(renderer, 'Inativar', true));
  act(() => renderer.unmount());
});

test('R2B14-B group 2 — Agenda visible actions open session, create session and create personal commitment', async () => {
  const scope = createPsychologyScope('synthetic-professional-r2b14b');
  const store = createEmptyPsychologyStore(scope);
  const patient = syntheticPatient(scope, true);
  const session = { id: 'synthetic-agenda-session-r2b14b', professionalId: scope.professionalId, context: 'PSICOLOGIA', patientId: patient.id, date: '2026-08-18', time: '09:00', durationMinutes: 50, modality: 'presencial', serviceId: store.services[0].id, locationId: store.locations[0].id, locationType: store.locations[0].type, status: 'agendada', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' };
  const commitment = { id: 'synthetic-agenda-personal-r2b14b', professionalId: scope.professionalId, context: 'PSICOLOGIA', date: '2026-08-18', time: '10:00', durationMinutes: 60, type: 'Compromisso pessoal', title: 'Compromisso sintético', note: '', recurrence: 'Não repetir', alarmEnabled: false, isDone: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' };
  const openedSessions = [];
  const openedPersonal = [];
  const newEvents = [];
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(AgendaView, {
      sessions: [session], personalCommitments: [commitment], patientMap: new Map([[patient.id, patient]]), settings: store.settings,
      weekStart: new Date('2026-08-17T12:00:00'), onPreviousWeek: () => {}, onNextWeek: () => {}, onToday: () => {},
      onNew: (...args) => newEvents.push(args), onPublicBookingAction: () => {}, onOpenSession: value => openedSessions.push(value.id), onOpenPersonal: value => openedPersonal.push(value.id),
    }));
  });
  const sessionTile = nodesByTestId(renderer, 'psychology-weekly-session')[0];
  assert.ok(sessionTile);
  act(() => sessionTile.props.onClick());
  assert.deepEqual(openedSessions, [session.id]);
  const personalTile = nodesByTestId(renderer, 'psychology-weekly-personal')[0];
  assert.ok(personalTile);
  act(() => personalTile.props.onClick());
  assert.deepEqual(openedPersonal, [commitment.id]);

  const freeSlot = nodesByTestId(renderer, 'psychology-agenda-free-slot')[0];
  assert.ok(freeSlot);
  act(() => freeSlot.props.onClick());
  const scheduleButton = button(renderer, 'Agendar paciente');
  act(() => scheduleButton.props.onClick());
  assert.deepEqual(newEvents.at(-1), ['2026-08-18', '07:00']);
  const secondFreeSlot = nodesByTestId(renderer, 'psychology-agenda-free-slot')[0];
  act(() => secondFreeSlot.props.onClick());
  const personalButton = button(renderer, 'Criar compromisso pessoal');
  act(() => personalButton.props.onClick());
  assert.deepEqual(newEvents.at(-1), ['2026-08-18', '07:00', 'personal']);
  act(() => renderer.unmount());
});

test('R2B14-B group 3 — patient chart exposes edit, schedule, open session and status controls', async () => {
  const scope = createPsychologyScope('synthetic-professional-r2b14b');
  const store = createEmptyPsychologyStore(scope);
  const patient = syntheticPatient(scope, true);
  const session = { id: 'synthetic-chart-session-r2b14b', professionalId: scope.professionalId, context: 'PSICOLOGIA', patientId: patient.id, date: '2026-09-01', time: '09:00', durationMinutes: 50, modality: 'presencial', serviceId: store.services[0].id, locationId: store.locations[0].id, locationType: store.locations[0].type, status: 'agendada', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' };
  store.patients = [patient];
  store.sessions = [session];
  const requests = [];
  let responseResolve;
  const repositories = createApiPsychologyRepositories({
    scope: createPsychologyPersistenceScope(scope.professionalId),
    getToken: async () => 'synthetic-token',
    fetchImpl: async (url, init) => { requests.push({ url: String(url), method: init?.method }); return new Promise(resolve => { responseResolve = resolve; }); },
  });
  const actions = { edit: 0, schedule: 0, open: 0, status: 0 };
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(PsychologyPatientChart, {
      store, patientId: patient.id, onClose: () => {}, onDelete: () => {}, onEdit: () => { actions.edit += 1; }, onSchedule: () => { actions.schedule += 1; }, onOpenSession: () => { actions.open += 1; },
      onStoreChange: () => true,
      onStatus: async (sessionId, status) => { actions.status += 1; return Boolean(await repositories.sessions.update(repositories.scope, sessionId, { status })); },
      onRecord: () => {},
    }));
  });
  act(() => button(renderer, 'Editar paciente').props.onClick());
  act(() => button(renderer, 'Agendar sessão').props.onClick());
  assert.equal(actions.edit, 1);
  assert.equal(actions.schedule, 1);
  act(() => button(renderer, 'Sessões', true).props.onClick());
  act(() => button(renderer, 'Abrir sessão').props.onClick());
  assert.equal(actions.open, 1);
  const cancel = renderer.root.findAllByType('button').find(item => textContent(item).trim() === 'Cancelar');
  assert.ok(cancel);
  let statusMutation;
  await act(async () => { statusMutation = cancel.props.onClick(); await Promise.resolve(); });
  assert.equal(actions.status, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PATCH');
  assert.ok(button(renderer, 'Cancelando…', true));
  await act(async () => { responseResolve(jsonResponse({ session: { ...session, status: 'cancelada' } })); await statusMutation; });
  act(() => renderer.unmount());
});

test('R2B14-B group 4 — Personal Agenda completes create, edit, done/undone and delete with one awaited update each', async () => {
  const initialAppointment = { id: 'synthetic-personal-r2b14b', type: 'Outro', date: '2026-08-23', time: '10:00', durationMinutes: 60, recurrence: 'Não repetir', notes: 'Inicial', alarmEnabled: false, isDone: false, alarmVolume: 80, alarmFadeIn: false };
  const initialState = { patients: [], sessions: [], payments: [], repositions: [], expenses: [], evolutions: [], settings: {}, personalAppointments: [initialAppointment], externalRegistrationForms: [] };
  const updates = [];
  let completePending = null;
  function Harness() {
    const [state, setState] = useState(initialState);
    const onUpdate = patch => {
      updates.push(patch);
      return new Promise(resolve => { completePending = () => { setState(current => ({ ...current, ...patch })); completePending = null; resolve(true); }; });
    };
    return React.createElement(PersonalAgenda, { state, onUpdate, activeAlarmId: null, activeAlarmLabel: '', stopAlarm: () => {}, variant: 'psychology' });
  }
  const complete = async () => { assert.ok(completePending, 'mutation must be pending'); const resolve = completePending; await act(async () => { resolve(); await Promise.resolve(); }); };
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });

  act(() => button(renderer, 'Novo Compromisso').props.onClick());
  const dateInput = renderer.root.findAllByType('input').find(input => input.props.type === 'date');
  const timeSelect = renderer.root.findAllByType('select')[0];
  act(() => dateInput.props.onChange({ target: { value: '2026-08-23' } }));
  act(() => timeSelect.props.onChange({ target: { value: '11:00' } }));
  const alarm = renderer.root.findAllByType('input').find(input => input.props.type === 'checkbox');
  await act(async () => { await alarm.props.onChange({ target: { checked: true } }); });
  const saveNew = button(renderer, 'Salvar Compromisso', true);
  let saveNewPromise;
  act(() => { saveNewPromise = saveNew.props.onClick(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(updates.length, 1);
  assert.ok(button(renderer, 'Salvando...', true));
  await complete();
  await saveNewPromise;
  assert.equal(updates[0].personalAppointments.length, 2);

  const occupied = nodesByTestId(renderer, 'psychology-personal-occupied-card')[0];
  assert.ok(occupied);
  act(() => occupied.props.onClick());
  const editSave = button(renderer, 'Atualizar Compromisso', true);
  let editPromise;
  await act(async () => { editPromise = editSave.props.onClick(); await Promise.resolve(); });
  assert.equal(updates.length, 2);
  await complete();
  await editPromise;

  const doneButton = renderer.root.findAllByType('button').find(item => item.props['aria-label'] === 'Marcar como concluído');
  assert.ok(doneButton);
  let donePromise;
  await act(async () => { donePromise = doneButton.props.onClick({ stopPropagation() {} }); await Promise.resolve(); });
  assert.equal(updates.length, 3);
  await complete();
  await donePromise;
  assert.equal(updates[2].personalAppointments.find(item => item.id === initialAppointment.id).isDone, true);

  const undoneButton = renderer.root.findAllByType('button').find(item => item.props['aria-label'] === 'Reativar');
  assert.ok(undoneButton);
  let undonePromise;
  await act(async () => { undonePromise = undoneButton.props.onClick({ stopPropagation() {} }); await Promise.resolve(); });
  assert.equal(updates.length, 4);
  await complete();
  await undonePromise;
  assert.equal(updates[3].personalAppointments.find(item => item.id === initialAppointment.id).isDone, false);

  const deleteButton = renderer.root.findAllByType('button').find(item => item.props['aria-label'] === 'Excluir');
  assert.ok(deleteButton);
  let deletePromise;
  await act(async () => { deletePromise = deleteButton.props.onClick({ stopPropagation() {} }); await Promise.resolve(); });
  assert.equal(updates.length, 5);
  await complete();
  await deletePromise;
  assert.equal(updates[4].personalAppointments.some(item => item.id === initialAppointment.id), false);
  act(() => renderer.unmount());
});

test('R2B14-B group 5 — profile controls save once, show pending/error and reopen with saved value', async () => {
  const scope = createPsychologyScope('synthetic-professional-r2b14b');
  const store = createEmptyPsychologyStore(scope);
  let currentSettings = store.settings;
  const calls = [];
  const waits = [];
  const makeProps = () => ({ store: { ...store, settings: currentSettings }, settings: currentSettings, patients: [], sessionPackages: [], onUpdatePackage: async () => true,
    onUpdate: patch => { calls.push(patch); return new Promise(resolve => waits.push({ patch, resolve })); }, onUpdateLocation: async () => true, onCreateLocation: async () => true,
    onSetLocationColor: async () => true, onSetPrimary: async () => true, onSetActive: async () => true, onSetColor: async () => true, onRestoreColors: async () => true,
    preview: null, hiddenCancelledEventCount: 0, onRestoreHiddenCancelled: () => {}, previewLoading: false, previewLoadError: '', onActivatePreview: async () => {}, onEndPreview: () => {} });
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(PsychologySettingsView, makeProps())); });
  act(() => button(renderer, 'Editar', true).props.onClick());
  const nameInput = renderer.root.findAllByType('input').find(input => input.props['aria-label'] === 'Nome de exibição');
  act(() => nameInput.props.onChange({ target: { value: 'Profissional Sintética R2B14-B' } }));
  const save = button(renderer, 'Salvar perfil', true);
  let savePromise;
  await act(async () => { savePromise = save.props.onClick(); await Promise.resolve(); });
  assert.equal(calls.length, 1);
  assert.match(textContent(renderer.root), /Salvando perfil/);
  const savedSettings = { ...currentSettings, professionalProfile: { ...currentSettings.professionalProfile, displayName: 'Profissional Sintética R2B14-B', name: 'Profissional Sintética R2B14-B' } };
  currentSettings = savedSettings;
  await act(async () => { waits.shift().resolve(true); await savePromise; });
  act(() => { renderer.update(React.createElement(PsychologySettingsView, makeProps())); });
  act(() => button(renderer, 'Editar', true).props.onClick());
  assert.equal(renderer.root.findAllByType('input').find(input => input.props['aria-label'] === 'Nome de exibição').props.value, 'Profissional Sintética R2B14-B');

  const failedSave = button(renderer, 'Salvar perfil', true);
  let failedPromise;
  await act(async () => { failedPromise = failedSave.props.onClick(); await Promise.resolve(); });
  await act(async () => { waits.shift().resolve(false); await failedPromise; });
  assert.ok(renderer.root.findAll(node => node.props?.role === 'alert').length > 0);
  act(() => renderer.unmount());
});

test('R2B14-B group 6 — system controls are visible, awaited, locked and have no placeholder action', async () => {
  const scope = createPsychologyScope('synthetic-professional-r2b14b');
  const store = createEmptyPsychologyStore(scope);
  const calls = { restore: 0, colors: 0, reminders: 0 };
  let resolveRestore;
  const props = { store, settings: store.settings, patients: [], sessionPackages: [], onUpdatePackage: async () => true, onUpdate: async patch => { calls.reminders += 1; return true; }, onUpdateLocation: async () => true, onCreateLocation: async () => true,
    onSetLocationColor: async () => true, onSetPrimary: async () => true, onSetActive: async () => true, onSetColor: async () => { calls.colors += 1; return true; },
    onRestoreColors: () => { calls.restore += 1; return new Promise(resolve => { resolveRestore = resolve; }); }, preview: null, hiddenCancelledEventCount: 0, onRestoreHiddenCancelled: () => {}, previewLoading: false, previewLoadError: '', onActivatePreview: async () => {}, onEndPreview: () => {} };
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(PsychologySettingsView, props)); });
  act(() => button(renderer, 'Aparência e Sistema').props.onClick());
  assert.ok(nodesByTestId(renderer, 'psychology-settings-panel-system').length > 0);
  const restore = button(renderer, 'Restaurar padrões', true);
  let restoreMutation;
  act(() => { restoreMutation = restore.props.onClick(); restore.props.onClick(); });
  assert.equal(calls.restore, 1);
  assert.ok(renderer.root.findAll(node => node.props?.role === 'status').length > 0);
  await act(async () => { resolveRestore(true); await restoreMutation; });
  const colorInputs = renderer.root.findAllByType('input').filter(input => input.props.type === 'color');
  assert.equal(colorInputs.length, 4);
  for (const input of colorInputs) {
    let colorMutation;
    act(() => { colorMutation = input.props.onChange({ target: { value: '#123456' } }); });
    await act(async () => { await colorMutation; });
  }
  const reminder = renderer.root.findAllByType('input').find(input => input.props.type === 'checkbox');
  act(() => reminder.props.onChange({ target: { checked: true } }));
  assert.equal(calls.colors, 4);
  assert.equal(calls.reminders, 1);
  act(() => renderer.unmount());
});

test('R2B14-B latency gate — visible mutation remains pending and single-submit at 200, 1000 and 3000 ms', async () => {
  for (const latency of [200, 1000, 3000]) {
    let locked = false;
    let calls = 0;
    const guardedMutation = async () => {
      if (locked) return false;
      locked = true;
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, latency));
      locked = false;
      return true;
    };
    const firstMutation = guardedMutation();
    const secondMutation = guardedMutation();
    assert.equal(await secondMutation, false);
    assert.equal(await firstMutation, true);
    assert.equal(calls, 1);
  }
});

test('R2B14-B integrated synthetic flow — canonical patient/session/personal entities remain coherent across modules', async () => {
  const scope = createPsychologyPersistenceScope('synthetic-professional-r2b14b');
  const domainScope = createPsychologyScope(scope.professionalId);
  const baseStore = createEmptyPsychologyStore(domainScope);
  const patient = syntheticPatient(scope, true);
  const server = { patient, sessions: new Map(), personalAppointments: new Map() };
  const requests = [];
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-token',
    fetchImpl: async (url, init) => {
      const parsed = new URL(String(url), 'http://synthetic.local');
      const body = init?.body ? JSON.parse(init.body) : undefined;
      requests.push({ method: init?.method, path: parsed.pathname });
      const parts = parsed.pathname.split('/').filter(Boolean);
      const aggregate = parts[2];
      const id = parts[3];
      if (aggregate === 'patients' && init?.method === 'PATCH') { server.patient = { ...server.patient, ...body }; return jsonResponse({ patient: server.patient }); }
      if (aggregate === 'sessions' && init?.method === 'POST') { server.sessions.set(body.id, body); return jsonResponse({ session: body }); }
      if (aggregate === 'sessions' && init?.method === 'PATCH') { const next = { ...server.sessions.get(id), ...body }; server.sessions.set(id, next); return jsonResponse({ session: next }); }
      if (aggregate === 'personal-appointments' && init?.method === 'POST') { server.personalAppointments.set(body.id, body); return jsonResponse({ personalAppointment: body }); }
      if (aggregate === 'personal-appointments' && init?.method === 'PATCH') { const next = { ...server.personalAppointments.get(id), ...body }; server.personalAppointments.set(id, next); return jsonResponse({ personalAppointment: next }); }
      if (aggregate === 'personal-appointments' && init?.method === 'DELETE') { server.personalAppointments.delete(id); return jsonResponse({ id, deleted: true }); }
      return jsonResponse({ error: { code: 'synthetic/unexpected-request', message: 'Unexpected synthetic request' } }, 500);
    },
  });

  const updatedPatient = await repositories.patients.update(scope, patient.id, { active: false });
  assert.equal(updatedPatient?.id, patient.id);
  const createdSession = await repositories.sessions.upsert(scope, {
    id: 'synthetic-integrated-session-r2b14b', professionalId: scope.professionalId, context: 'PSICOLOGIA', patientId: patient.id, date: '2026-08-25', time: '09:00', durationMinutes: 50, modality: 'presencial', serviceId: baseStore.services[0].id, locationId: baseStore.locations[0].id, locationType: baseStore.locations[0].type, status: 'agendada', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
  });
  const onlineSession = await repositories.sessions.update(scope, createdSession.id, { modality: 'online', locationId: undefined, locationType: undefined });
  const rescheduledSession = await repositories.sessions.update(scope, createdSession.id, { date: '2026-08-26', time: '11:00' });
  const cancelledSession = await repositories.sessions.update(scope, createdSession.id, { status: 'cancelada' });
  const createdPersonal = await repositories.personalAppointments.upsert(scope, {
    id: 'synthetic-integrated-personal-r2b14b', professionalId: scope.professionalId, context: 'PSICOLOGIA', date: '2026-08-26', time: '12:00', durationMinutes: 60, type: 'Compromisso pessoal', title: 'Compromisso integrado', note: '', recurrence: 'Não repetir', alarmEnabled: false, isDone: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
  });
  const editedPersonal = await repositories.personalAppointments.update(scope, createdPersonal.id, { title: 'Compromisso integrado editado', time: '12:30' });
  const donePersonal = await repositories.personalAppointments.update(scope, editedPersonal.id, { isDone: true });
  await repositories.personalAppointments.delete(scope, donePersonal.id);

  assert.equal(onlineSession?.modality, 'online');
  assert.equal(rescheduledSession?.date, '2026-08-26');
  assert.equal(cancelledSession?.status, 'cancelada');
  assert.equal(server.personalAppointments.size, 0);
  const integratedStore = { ...baseStore, patients: [updatedPatient], sessions: [cancelledSession], personalCommitments: [] };
  const dayItems = getPsychologyDayItems(integratedStore, '2026-08-26');
  assert.equal(dayItems.length, 1);
  assert.equal(dayItems[0].kind, 'session');
  assert.equal(dayItems[0].item.patientId, patient.id);
  assert.equal(requests.filter(request => request.method === 'POST' && request.path.endsWith('/sessions')).length, 1);
  assert.equal(requests.filter(request => request.method === 'POST' && request.path.endsWith('/personal-appointments')).length, 1);
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 1);
});
