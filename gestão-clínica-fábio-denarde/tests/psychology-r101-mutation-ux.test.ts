import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listeners = new Map<string, EventListener>();
const storage = {
  getItem() { return JSON.stringify({ settings: { publicBookingAvailability: [], publicBookingExceptions: [] } }); },
  setItem() {},
  removeItem() {},
};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener(type: string, handler: EventListener) { listeners.set(type, handler); },
  removeEventListener(type: string) { listeners.delete(type); },
  setInterval() { return 0; },
  clearInterval() {},
  setTimeout,
  clearTimeout,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  localStorage: storage,
  sessionStorage: storage,
  location: { reload() {} },
} as unknown as Window & typeof globalThis;
globalThis.document = {
  activeElement: null,
  addEventListener(type: string, handler: EventListener) { listeners.set(type, handler); },
  removeEventListener(type: string) { listeners.delete(type); },
  getElementById() { return null; },
  createElement() { return { click() {} }; },
} as unknown as Document;
globalThis.HTMLElement = class HTMLElement {} as typeof HTMLElement;

const { auth } = await import('../src/firebase');
const { default: PsychologyPilot } = await import('../src/features/psychology-pilot/PsychologyPilot');

const scope = { workspaceId: 'r101-ux-workspace', professionalId: 'r101-ux-professional', context: 'PSICOLOGIA' };
const patient = { id: 'r101-ux-patient', ...scope, name: 'Paciente Sintético R101', dateOfBirth: '1990-01-01', birthDate: '1990-01-01', phone: '27999999999', email: '', preferredModality: 'presencial', active: true, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z' };
const service = { id: 'r101-ux-service', ...scope, name: 'Psicoterapia Sintética', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', active: true, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z' };
const location = { id: 'r101-ux-location', ...scope, type: 'PRIMARY_OFFICE', displayName: 'Consultório Sintético', address: '', active: true, isPrimary: true, color: '#DC2626', createdAt: service.createdAt, updatedAt: service.updatedAt };
const settings = { scope: { professionalId: scope.professionalId, context: scope.context }, agenda: { defaultDurationMinutes: 50, weeklyAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, enabled: true, periods: [{ startTime: '08:00', endTime: '18:00' }] })) }, services: [service], locations: [location], updatedAt: service.updatedAt };

Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => ({ uid: 'r101-ux-user', getIdToken: async () => 'synthetic-token' }) });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child as TestRenderer.ReactTestInstance)).join('');
}

function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(item => textContent(item).trim() === label);
}

test('R101 sessão atrasada mostra processamento, impede duplo envio e libera a conclusão', async () => {
  const requests: Array<{ method: string; path: string }> = [];
  let resolveCreate: ((value: Response) => void) | undefined;
  const createResponse = new Promise<Response>(resolve => { resolveCreate = resolve; });
  globalThis.fetch = async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url), 'http://localhost');
    const method = String(init.method || 'GET');
    requests.push({ method, path: parsed.pathname });
    if (method === 'GET' && parsed.pathname.endsWith('/patients')) return response({ scope, items: [patient] });
    if (method === 'GET' && parsed.pathname.endsWith('/sessions')) return response({ scope, items: [] });
    if (method === 'GET' && parsed.pathname.endsWith('/personal-appointments')) return response({ scope, items: [] });
    if (method === 'GET' && (parsed.pathname.endsWith('/charges') || parsed.pathname.endsWith('/payments') || parsed.pathname.endsWith('/expenses'))) return response({ scope, items: [] });
    if (method === 'GET' && parsed.pathname.endsWith('/settings')) return response({ scope, settings: { id: 'settings', ...scope, settings, updatedAt: settings.updatedAt } });
    if (method === 'POST' && parsed.pathname.endsWith('/sessions')) return createResponse;
    throw new Error(`Unexpected request: ${method} ${parsed.pathname}`);
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPilot, { runtimeMode: 'authenticated-remote' }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  await act(async () => { button(renderer, 'Agendar sessão')?.props.onClick(); });
  const dialog = renderer.root.findByProps({ 'aria-label': 'Novo agendamento' });
  const form = dialog.findByType('form');
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
    form.props.onSubmit({ preventDefault() {} });
  });

  assert.equal(requests.filter(request => request.method === 'POST' && request.path.endsWith('/sessions')).length, 1);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-event-mutation-processing' }).length, 1);
  assert.match(textContent(renderer.root), /Salvando…/);

  await act(async () => {
    resolveCreate?.(response({ scope, session: { id: 'r101-ux-session', ...scope, patientId: patient.id, date: '2026-08-28', time: '09:00', durationMinutes: 50, modality: 'presencial', serviceId: service.id, locationId: location.id, locationType: location.type, status: 'agendada', createdAt: settings.updatedAt, updatedAt: settings.updatedAt } }, 201));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Novo agendamento' }).length, 0);
  renderer.unmount();
});
