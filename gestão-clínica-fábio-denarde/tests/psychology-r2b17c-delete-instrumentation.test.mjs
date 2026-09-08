import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const listeners = new Map();
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener(type, handler) { listeners.set(type, handler); },
  removeEventListener(type) { listeners.delete(type); },
  setInterval() { return 0; },
  clearInterval() {},
  setTimeout,
  clearTimeout,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { reload() {} },
};
globalThis.document = {
  activeElement: null,
  addEventListener(type, handler) { listeners.set(type, handler); },
  removeEventListener(type) { listeners.delete(type); },
  getElementById() { return null; },
  createElement() { return { click() {} }; },
};
globalThis.HTMLElement = class HTMLElement {};

const { auth } = await import('../src/firebase.ts');
const { default: PsychologyPilot } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');

let currentUser = null;
try {
  Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => currentUser });
} catch {
  // The synthetic test runtime normally exposes a configurable getter.
}

const scope = {
  workspaceId: 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3',
  tenantId: 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3',
  professionalId: 'prof-2232f031-c409-4a5d-a56b-f696d284f447',
  context: 'PSICOLOGIA',
};

const patient = {
  id: 'r2b17c-patient-delete',
  ...scope,
  name: 'Paciente Sintético R2B17C',
  dateOfBirth: '1990-01-01',
  birthDate: '1990-01-01',
  phone: '27999999999',
  email: 'r2b17c-delete@example.invalid',
  preferredModality: 'presencial',
  administrativeNote: '',
  active: true,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function validUser() {
  return { uid: 'r2b17c-synthetic-user', getIdToken: async () => 'r2b17c-synthetic-token' };
}

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function exactButton(renderer, label) {
  return renderer.root.findAllByType('button').find(item => textContent(item).trim() === label);
}

function createFetchHarness({ deleteStatus = 200 } = {}) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost');
    const method = init.method || 'GET';
    requests.push({ method, path: parsed.pathname });
    if (method === 'POST' && parsed.pathname === '/api/psychology-delete-diagnostic') return new Response(null, { status: 204 });
    if (method === 'DELETE' && parsed.pathname === `/api/psychology/patients/${patient.id}`) {
      return deleteStatus >= 200 && deleteStatus < 300
        ? response({ scope, deleted: true, id: patient.id }, deleteStatus)
        : response({ error: { code: 'psychology/synthetic-delete-failure', message: 'Falha sintética.' } }, deleteStatus);
    }
    if (method === 'GET' && parsed.pathname === `/api/psychology/patients/${patient.id}`) return response({ scope, items: [] });
    if (method === 'GET' && parsed.pathname === '/api/psychology/patients') return response({ scope, items: [patient] });
    if (method === 'GET' && parsed.pathname === '/api/psychology/settings') return response({ scope, settings: {} });
    if (method === 'GET' && ['/api/psychology/sessions', '/api/psychology/services', '/api/psychology/locations', '/api/psychology/personal-appointments'].includes(parsed.pathname)) return response({ scope, items: [] });
    throw new Error(`Unexpected synthetic request: ${method} ${parsed.pathname}`);
  };
  return { requests };
}

async function mountPilot() {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPilot));
    await new Promise(resolve => setTimeout(resolve, 15));
  });
  act(() => { exactButton(renderer, 'Pacientes').props.onClick(); });
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-row' }).length, 1);
  return renderer;
}

function openDelete(renderer) {
  const row = renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-row' })[0];
  act(() => { row.findAllByType('button').find(item => textContent(item).trim() === 'Excluir').props.onClick(); });
  const confirm = exactButton(renderer, 'Excluir definitivamente');
  assert.ok(confirm);
  return confirm;
}

async function captureDiagnostics(action) {
  const events = [];
  const originalInfo = console.info;
  console.info = (prefix, event) => {
    if (prefix === '[PSYCHOLOGY DELETE DIAGNOSTIC]') events.push(event);
  };
  try {
    await action();
  } finally {
    console.info = originalInfo;
  }
  return events;
}

function assertSequence(events, expectedStages) {
  assert.deepEqual(events.map(event => event.DELETE_PATIENT_STAGE), expectedStages);
  assert.ok(events.length > 0);
  const correlationIds = new Set(events.map(event => event.correlationId));
  assert.equal(correlationIds.size, 1, 'all stages of one attempt must share one correlationId');
  for (const event of events) {
    assert.equal(event.method, 'DELETE');
    assert.equal(event.routeTemplate, '/api/psychology/patients/:id');
    for (const key of ['token', 'email', 'phone', 'cookie', 'patientId', 'payload', 'name']) assert.equal(key in event, false, `forbidden diagnostic key: ${key}`);
  }
  return events[0];
}

test('R2B17C emits the minimal sanitized diagnostic sequences A-E and session-loss F', async () => {
  currentUser = validUser();
  let harness = createFetchHarness();
  let renderer = await mountPilot();
  let confirm = openDelete(renderer);
  let events = await captureDiagnostics(async () => { await act(async () => { await confirm.props.onClick(); }); });
  const successFirst = assertSequence(events, ['confirm_start', 'before_repository', 'before_token', 'token_ok', 'before_fetch', 'fetch_response']);
  assert.equal(successFirst.authUserPresent, 'YES');
  assert.equal(events.find(event => event.DELETE_PATIENT_STAGE === 'before_fetch').authorizationPresent, 'YES');
  assert.equal(harness.requests.filter(request => request.method === 'DELETE').length, 1);
  act(() => { renderer.unmount(); });

  currentUser = validUser();
  harness = createFetchHarness();
  renderer = await mountPilot();
  currentUser = null;
  confirm = openDelete(renderer);
  events = await captureDiagnostics(async () => { await act(async () => { await confirm.props.onClick(); }); });
  assertSequence(events, ['confirm_start', 'before_repository', 'before_token', 'token_error', 'catch']);
  assert.equal(harness.requests.filter(request => request.method === 'DELETE').length, 0);
  act(() => { renderer.unmount(); });

  currentUser = validUser();
  harness = createFetchHarness();
  renderer = await mountPilot();
  currentUser = { uid: 'r2b17c-rejected-user', getIdToken: async () => { throw Object.assign(new Error('synthetic token failure'), { code: 'auth/network-request-failed' }); } };
  confirm = openDelete(renderer);
  events = await captureDiagnostics(async () => { await act(async () => { await confirm.props.onClick(); }); });
  assertSequence(events, ['confirm_start', 'before_repository', 'before_token', 'token_error', 'catch']);
  assert.equal(harness.requests.filter(request => request.method === 'DELETE').length, 0);
  act(() => { renderer.unmount(); });

  currentUser = validUser();
  harness = createFetchHarness({ deleteStatus: 500 });
  renderer = await mountPilot();
  confirm = openDelete(renderer);
  events = await captureDiagnostics(async () => { await act(async () => { await confirm.props.onClick(); }); });
  assertSequence(events, ['confirm_start', 'before_repository', 'before_token', 'token_ok', 'before_fetch', 'fetch_response', 'catch']);
  assert.equal(events.find(event => event.DELETE_PATIENT_STAGE === 'fetch_response').httpStatus, 500);
  assert.equal(harness.requests.filter(request => request.method === 'DELETE').length, 1);
  act(() => { renderer.unmount(); });

  currentUser = validUser();
  harness = createFetchHarness();
  renderer = await mountPilot();
  confirm = openDelete(renderer);
  currentUser = null;
  events = await captureDiagnostics(async () => { await act(async () => { await confirm.props.onClick(); }); });
  assertSequence(events, ['confirm_start', 'before_repository', 'before_token', 'token_error', 'catch']);
  assert.equal(harness.requests.filter(request => request.method === 'DELETE').length, 0);
  act(() => { renderer.unmount(); });
});

test('R2B17C repository-unavailable guard is instrumented without exposing an identifier', () => {
  const source = readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  assert.match(source, /DELETE_PATIENT_STAGE: 'before_repository'[\s\S]*repositoryPresent/);
  assert.match(source, /if \(!remoteRepositories\)[\s\S]*DELETE_PATIENT_STAGE: 'catch'[\s\S]*psychology\/repository-not-ready/);
  assert.match(source, /patientSelectionPresent: patientDelete \? 'YES' : 'NO'/);
});
