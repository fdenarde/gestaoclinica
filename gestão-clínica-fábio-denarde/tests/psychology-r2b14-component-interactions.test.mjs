import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
};

const {
  DeletePatientDialog,
  PatientDialogR2F3E,
  SessionActionsDialog,
  SessionDialog,
} = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');
const { createEmptyPsychologyStore, createPsychologyScope } = await import('../src/features/psychology-pilot/psychologyDomain.ts');
const { createPsychologyPersistenceScope } = await import('../src/features/psychology-persistence/scope.ts');
const { createApiPsychologyRepositories } = await import('../src/features/psychology-persistence/repositories/api.ts');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function findButton(renderer, label) {
  return renderer.root.findAllByType('button').find(button => textContent(button).includes(label));
}

function deferred() {
  let resolve;
  const promise = new Promise(result => { resolve = result; });
  return { promise, resolve };
}

const patient = {
  id: 'synthetic-patient-r2b14',
  professionalId: 'synthetic-professional-r2b14',
  context: 'PSICOLOGIA',
  name: 'Paciente Sintético R2B14',
  dateOfBirth: '1990-01-01',
  birthDate: '1990-01-01',
  phone: '27999999999',
  email: 'r2b14@example.test',
  preferredModality: 'presencial',
  administrativeNote: '',
  administrativeNotes: '',
  active: true,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

test('SessionActionsDialog performs one awaited status mutation and keeps failure visible', async () => {
  const pending = deferred();
  const requests = [];
  const scope = createPsychologyPersistenceScope('synthetic-professional-r2b14');
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-token',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method });
      return pending.promise;
    },
  });
  let calls = 0;
  let closed = 0;
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(SessionActionsDialog, {
      session: {
        id: 'synthetic-session-r2b14', patientId: patient.id, modality: 'presencial', date: '2026-08-24', time: '09:00',
        durationMinutes: 50, status: 'agendada', previewStatus: undefined,
      },
      patient,
      hasRecord: false,
      onClose: () => { closed += 1; },
      onEdit: () => {},
      onRecord: () => {},
      onStatus: async status => { calls += 1; return Boolean(await repositories.sessions.update(scope, 'synthetic-session-r2b14', { status })); },
    }));
  });

  const cancel = findButton(renderer, 'Cancelar sessão');
  assert.ok(cancel, 'cancel action must be visible');
  let firstCancel;
  await act(async () => {
    firstCancel = cancel.props.onClick();
    const second = cancel.props.onClick();
    await second;
    await Promise.resolve();
  });
  assert.equal(calls, 1, 'double click must send one status mutation');
  assert.equal(requests.length, 1, 'cancel must reach the API once');
  assert.equal(requests[0].method, 'PATCH');
  assert.ok(findButton(renderer, 'Cancelando…'), 'pending state must be visible');

  await act(async () => {
    pending.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await Promise.all([pending.promise, firstCancel]);
  });
  assert.ok(renderer.root.findAll(node => node.props?.role === 'alert').length > 0, 'mutation failure must stay visible');
  assert.equal(closed, 0, 'failed mutation must not close the dialog');
  act(() => renderer.unmount());
});

test('DeletePatientDialog sends one real DELETE through the API repository and keeps failure visible', async () => {
  const pendingResponse = deferred();
  const requests = [];
  const scope = createPsychologyPersistenceScope('synthetic-professional-r2b14');
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-token',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method });
      return pendingResponse.promise;
    },
  });
  const assessment = {
    patient,
    canDelete: true,
    impact: { sessions: 0, records: 0, charges: 0, payments: 0, expenses: 0, packages: 0, documents: 0, attachments: 0 },
  };
  let renderer;
  let firstDelete;
  act(() => {
    renderer = TestRenderer.create(React.createElement(DeletePatientDialog, {
      assessment,
      onClose: () => {},
      onConfirm: async () => Boolean(await repositories.patients.delete(scope, patient.id)),
    }));
  });
  const button = findButton(renderer, 'Excluir definitivamente');
  assert.ok(button, 'delete action must be visible');
  await act(async () => {
    firstDelete = button.props.onClick();
    const secondDelete = button.props.onClick();
    await secondDelete;
    await Promise.resolve();
  });
  assert.equal(requests.length, 1, 'same-tick delete clicks must send one request');
  assert.equal(requests[0].method, 'DELETE');
  assert.ok(findButton(renderer, 'Excluindo…'), 'delete pending state must be visible');
  await act(async () => {
    pendingResponse.resolve(new Response(JSON.stringify({ deleted: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await firstDelete;
  });
  assert.ok(renderer.root.findAll(node => node.props?.role === 'alert').length > 0, 'delete failure must stay visible');
  act(() => renderer.unmount());
});

test('PatientDialogR2F3E gates duplicate submits and permits retry after failure', async () => {
  const pending = deferred();
  let calls = 0;
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(PatientDialogR2F3E, {
      value: patient,
      onClose: () => {},
      onSave: () => { calls += 1; return pending.promise; },
    }));
  });
  const form = renderer.root.findByType('form');
  let firstSave;
  await act(async () => {
    firstSave = form.props.onSubmit({ preventDefault() {} });
    const second = form.props.onSubmit({ preventDefault() {} });
    await second;
    await Promise.resolve();
  });
  assert.equal(calls, 1, 'one manual action must invoke one save callback');
  await act(async () => {
    pending.resolve(false);
    await Promise.all([pending.promise, firstSave]);
  });
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} });
  });
  assert.equal(calls, 2, 'failed save must remain retryable');
  act(() => renderer.unmount());
});

test('SessionDialog changes modality both ways and gates duplicate save submits', async () => {
  const scope = createPsychologyScope('synthetic-professional-r2b14');
  const store = createEmptyPsychologyStore(scope);
  const service = store.services[0];
  const location = store.locations[0];
  const session = {
    id: 'synthetic-session-r2b14', professionalId: scope.professionalId, context: 'PSICOLOGIA', patientId: patient.id,
    date: '2026-08-24', time: '09:00', durationMinutes: service.defaultDurationMinutes, modality: 'presencial', serviceId: service.id,
    locationId: location.id, locationType: location.type, status: 'agendada', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
  };
  store.patients = [patient];
  store.sessions = [session];
  let calls = 0;
  const pending = deferred();
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(SessionDialog, {
      value: session,
      store,
      settings: store.settings,
      defaultDate: session.date,
      defaultTime: session.time,
      onClose: () => {},
      onSave: () => { calls += 1; return pending.promise; },
    }));
  });
  const modality = () => renderer.root.findAllByType('select').find(select => ['presencial', 'online'].includes(select.props.value));
  act(() => { modality().props.onChange({ target: { value: 'online' } }); });
  assert.equal(modality().props.value, 'online', 'presencial → online must update the controlled field');
  act(() => { modality().props.onChange({ target: { value: 'presencial' } }); });
  assert.equal(modality().props.value, 'presencial', 'online → presencial must update the controlled field');

  const form = renderer.root.findByType('form');
  let firstSessionSave;
  await act(async () => {
    firstSessionSave = form.props.onSubmit({ preventDefault() {} });
    const second = form.props.onSubmit({ preventDefault() {} });
    await second;
    await Promise.resolve();
  });
  assert.equal(calls, 1, 'modality edit save must be one mutation per action');
  assert.ok(findButton(renderer, 'Salvando…'), 'session save must show pending state');
  await act(async () => {
    pending.resolve(true);
    await Promise.all([pending.promise, firstSessionSave]);
  });
  act(() => renderer.unmount());
});
