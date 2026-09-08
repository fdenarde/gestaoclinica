import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const listeners = new Map();
const storage = { getItem() { return JSON.stringify({ settings: { publicBookingAvailability: [], publicBookingExceptions: [] } }); }, setItem() {}, removeItem() {} };
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener(type, handler) { listeners.set(type, handler); },
  removeEventListener(type) { listeners.delete(type); },
  setInterval() { return 0; },
  clearInterval() {},
  setTimeout,
  clearTimeout,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  localStorage: storage,
  sessionStorage: storage,
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

let currentUser = { uid: 'r98-synthetic-user', getIdToken: async () => 'r98-synthetic-token' };
try {
  Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => currentUser });
} catch {
  // The synthetic test runtime normally exposes a configurable getter.
}

const scope = {
  workspaceId: 'psychology-remote-workspace',
  professionalId: 'psychology-local-professional',
  context: 'PSICOLOGIA',
};
const patient = {
  id: 'r98-synthetic-patient',
  ...scope,
  name: 'Paciente Sintético R98',
  dateOfBirth: '1990-01-01',
  birthDate: '1990-01-01',
  phone: '27999999999',
  email: 'r98-synthetic@example.invalid',
  preferredModality: 'presencial',
  administrativeNote: '',
  active: true,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};
const service = {
  id: 'r98-service-individual',
  professionalId: scope.professionalId,
  context: scope.context,
  name: 'Psicoterapia Sintética',
  defaultDurationMinutes: 50,
  defaultPrice: 0,
  modality: 'BOTH',
  active: true,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};
const locations = [
  { id: 'r98-location-primary', professionalId: scope.professionalId, context: scope.context, type: 'PRIMARY_OFFICE', displayName: 'Consultório Sintético', address: '', active: true, isPrimary: true, color: '#DC2626', createdAt: service.createdAt, updatedAt: service.updatedAt },
  { id: 'r98-location-other', professionalId: scope.professionalId, context: scope.context, type: 'OTHER', displayName: 'Local Sintético Alternativo', address: '', active: true, isPrimary: false, color: '#7C3AED', createdAt: service.createdAt, updatedAt: service.updatedAt },
];
const settings = {
  scope: { professionalId: scope.professionalId, context: scope.context },
  agenda: {
    defaultDurationMinutes: 50,
    weeklyAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, enabled: true, periods: [{ startTime: '08:00', endTime: '18:00' }] })),
  },
  services: [service],
  locations,
  updatedAt: service.updatedAt,
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

function configureFetch({ failCreate = false } = {}) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: parsed.pathname, body });
    if (method === 'GET' && parsed.pathname === '/api/psychology/patients') return response({ scope, items: [patient] });
    if (method === 'GET' && parsed.pathname === '/api/psychology/sessions') return response({ scope, items: [] });
    if (method === 'GET' && parsed.pathname === '/api/psychology/personal-appointments') return response({ scope, items: [] });
    if (method === 'GET' && parsed.pathname === '/api/psychology/packages') return response({ scope, items: [] });
    if (method === 'GET' && ['/api/psychology/charges', '/api/psychology/payments', '/api/psychology/expenses'].includes(parsed.pathname)) return response({ scope, items: [] });
    if (method === 'GET' && parsed.pathname === '/api/psychology/settings') return response({ scope, settings: { id: 'settings', ...scope, settings, updatedAt: settings.updatedAt } });
    if (method === 'POST' && parsed.pathname === '/api/psychology/sessions') {
      if (failCreate) return response({ error: { code: 'psychology/synthetic-create-failed', message: 'Falha sintética no agendamento.' } }, 503);
      return response({ scope, session: { ...body, status: 'agendada', createdAt: settings.updatedAt, updatedAt: settings.updatedAt } }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${parsed.pathname}`);
  };
  return requests;
}

async function renderRemote() {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPilot, { runtimeMode: 'authenticated-remote' }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  return renderer;
}

function openSessionDialog(renderer) {
  act(() => { exactButton(renderer, 'Agendar sessão').props.onClick(); });
  return renderer.root.findByProps({ 'aria-label': 'Novo agendamento' });
}

test('R98 agenda remota valida seletores, bloqueia inválido e envia uma única criação', async () => {
  const requests = configureFetch();
  const renderer = await renderRemote();
  const dialog = openSessionDialog(renderer);
  const selects = dialog.findAllByType('select');
  const serviceSelect = selects.find(item => item.props.value === service.id);
  const locationSelect = selects.find(item => item.props.value === locations[0].id);
  assert.ok(serviceSelect);
  assert.equal(serviceSelect.findAllByType('option').length, 2);
  assert.deepEqual(serviceSelect.findAllByType('option').map(textContent), ['Selecione um serviço', service.name]);
  assert.ok(locationSelect);
  assert.equal(locationSelect.findAllByType('option').length, 3);
  assert.deepEqual(locationSelect.findAllByType('option').map(textContent), ['Selecione um local', locations[0].displayName, locations[1].displayName]);

  const patientSelect = selects.find(item => item.props.value === patient.id);
  const form = dialog.findByType('form');
  act(() => { patientSelect.props.onChange({ target: { value: '' } }); });
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
  assert.equal(requests.filter(request => request.method === 'POST' && request.path.endsWith('/sessions')).length, 0);
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Novo agendamento' }).length, 1);

  act(() => { patientSelect.props.onChange({ target: { value: patient.id } }); });
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
    form.props.onSubmit({ preventDefault() {} });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  const creates = requests.filter(request => request.method === 'POST' && request.path === '/api/psychology/sessions');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].body.patientId, patient.id);
  assert.equal(creates[0].body.serviceId, service.id);
  assert.equal(creates[0].body.locationId, locations[0].id);
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Novo agendamento' }).length, 0);
  assert.match(textContent(renderer.root), /Sessão agendada no provider remoto/);
  act(() => { renderer.unmount(); });
});

test('R98 erro remoto permanece visível e mantém o modal aberto', async () => {
  const requests = configureFetch({ failCreate: true });
  const renderer = await renderRemote();
  const dialog = openSessionDialog(renderer);
  const form = dialog.findByType('form');
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert.equal(requests.filter(request => request.method === 'POST' && request.path === '/api/psychology/sessions').length, 1);
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Novo agendamento' }).length, 1);
  assert.match(textContent(renderer.root), /Falha sintética no agendamento/);
  act(() => { renderer.unmount(); });
});
