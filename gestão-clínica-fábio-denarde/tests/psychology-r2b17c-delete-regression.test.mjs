import assert from 'node:assert/strict';
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
const { createApiPsychologyRepositories } = await import('../src/features/psychology-persistence/repositories/api.ts');
const { default: PsychologyPilot } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');

let currentUser = { uid: 'r2b17c-regression-user', getIdToken: async () => 'r2b17c-regression-token' };
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
  id: 'r2b17c-regression-patient',
  ...scope,
  name: 'Paciente Sintético R2B17C Regression',
  dateOfBirth: '1990-01-01',
  birthDate: '1990-01-01',
  phone: '27999999999',
  email: 'r2b17c-regression@example.invalid',
  preferredModality: 'presencial',
  administrativeNote: '',
  active: true,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function exactButton(renderer, label) {
  return renderer.root.findAllByType('button').find(item => textContent(item).trim() === label);
}

test('R2B17 delete parity remains one DELETE through the real PsychologyPilot', async () => {
  let patientExists = true;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost');
    const method = init.method || 'GET';
    requests.push({ method, path: parsed.pathname });
    if (method === 'POST' && parsed.pathname === '/api/psychology-delete-diagnostic') return new Response(null, { status: 204 });
    if (method === 'DELETE') { patientExists = false; return response({ scope, deleted: true, id: patient.id }); }
    if (parsed.pathname === '/api/psychology/patients') return response({ scope, items: patientExists ? [patient] : [] });
    if (parsed.pathname === '/api/psychology/settings') return response({ scope, settings: {} });
    if (['/api/psychology/sessions', '/api/psychology/services', '/api/psychology/locations', '/api/psychology/personal-appointments'].includes(parsed.pathname)) return response({ scope, items: [] });
    throw new Error(`Unexpected request: ${method} ${parsed.pathname}`);
  };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPilot));
    await new Promise(resolve => setTimeout(resolve, 15));
  });
  act(() => { exactButton(renderer, 'Pacientes').props.onClick(); });
  const row = renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-row' })[0];
  act(() => { row.findAllByType('button').find(item => textContent(item).trim() === 'Excluir').props.onClick(); });
  const confirm = exactButton(renderer, 'Excluir definitivamente');
  await act(async () => { await Promise.all([confirm.props.onClick(), confirm.props.onClick()]); });
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 1);
  assert.equal(textContent(renderer.root).includes(patient.name), false);
  act(() => { renderer.unmount(); });
});

test('R2B17 delete contract remains one exact request without body', async () => {
  const requests = [];
  const repositories = createApiPsychologyRepositories({
    scope,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(String(url), 'http://localhost');
      requests.push({ method: init.method, path: parsed.pathname, authorizationPresent: Boolean(init.headers?.Authorization), cache: init.cache, bodyPresent: init.body !== undefined });
      return response({ scope, deleted: true, id: patient.id });
    },
  });
  const result = await repositories.patients.delete(scope, patient.id);
  assert.deepEqual(result, { id: patient.id });
  assert.deepEqual(requests, [{ method: 'DELETE', path: `/api/psychology/patients/${patient.id}`, authorizationPresent: true, cache: 'no-store', bodyPresent: false }]);
});
