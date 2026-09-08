import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listeners = new Map<string, EventListener>();
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = {
  innerWidth: 390,
  innerHeight: 844,
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

Object.defineProperty(auth, 'currentUser', {
  configurable: true,
  get: () => ({ uid: 'r108-mobile-user-synthetic', getIdToken: async () => 'synthetic-token-not-real' }),
});

const scope = { workspaceId: 'r108-mobile-workspace', professionalId: 'r108-mobile-professional', context: 'PSICOLOGIA' as const };
const patient = {
  id: 'r108-mobile-patient',
  ...scope,
  name: 'Paciente Sintético Mobile R108',
  dateOfBirth: '1990-01-01',
  phone: '27999999999',
  preferredModality: 'presencial',
  active: true,
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-08-29T10:00:00.000Z',
};
const service = { id: 'r108-mobile-service', ...scope, name: 'Serviço Sintético Mobile', defaultDurationMinutes: 50, defaultPrice: 200, modality: 'BOTH', active: true, createdAt: patient.createdAt, updatedAt: patient.updatedAt };
const location = { id: 'r108-mobile-location', ...scope, type: 'PRIMARY_OFFICE', displayName: 'Local Sintético Mobile', address: '', active: true, isPrimary: true, color: '#7c3aed', createdAt: patient.createdAt, updatedAt: patient.updatedAt };
const settings = { scope: { professionalId: scope.professionalId, context: scope.context }, agenda: { defaultDurationMinutes: 50, workingDays: [1, 2, 3, 4, 5], availableTimes: [] }, services: [service], locations: [location], colors: {}, reminders: { enabled: false, advanceMinutes: 30 }, updatedAt: patient.updatedAt };

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : textContent(child as TestRenderer.ReactTestInstance)).join('');
}

function responseFor(path: string): Response {
  if (path.endsWith('/patients')) return new Response(JSON.stringify({ scope, items: [patient] }), { status: 200 });
  if (path.endsWith('/settings')) return new Response(JSON.stringify({ scope, settings: { id: 'settings', ...scope, settings, updatedAt: settings.updatedAt } }), { status: 200 });
  return new Response(JSON.stringify({ scope, items: [] }), { status: 200 });
}

function mobileNavButton(renderer: TestRenderer.ReactTestRenderer, label: string): TestRenderer.ReactTestInstance {
  const nav = renderer.root.findByProps({ 'data-testid': 'psychology-bottom-nav' });
  return nav.findAllByType('button').find(button => textContent(button).trim() === label)!;
}

async function openMobileFinance(renderer: TestRenderer.ReactTestRenderer): Promise<void> {
  await act(async () => renderer.root.findByProps({ 'data-testid': 'psychology-more-button' }).props.onClick());
  const sheet = renderer.root.findByProps({ 'aria-label': 'Mais opções da Psicologia' });
  await act(async () => sheet.findAllByType('button').find(button => textContent(button).trim() === 'Financeiro')!.props.onClick());
}

function providerStatus(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findByProps({ 'data-testid': 'psychology-pilot' }).props['data-remote-provider-status'];
}

test('R108 mobile preserva provider e dados durante navegação rápida sem tempestade de fetch', async () => {
  const requests: Array<{ method: string; path: string }> = [];
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url), 'http://localhost');
    requests.push({ method: String(init.method || 'GET'), path: parsed.pathname });
    await delayed;
    return responseFor(parsed.pathname);
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<PsychologyPilot runtimeMode="authenticated-remote" />);
    await Promise.resolve();
  });
  assert.equal(providerStatus(renderer), 'BOOTSTRAPPING');
  assert.equal(requests.length, 8);

  await act(async () => mobileNavButton(renderer, 'Pacientes').props.onClick());
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-remote-loading-state' }).length, 1);
  await act(async () => mobileNavButton(renderer, 'Agenda').props.onClick());
  await openMobileFinance(renderer);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-finance-remote-readonly' }).length, 1);
  await act(async () => mobileNavButton(renderer, 'Meu Dia').props.onClick());
  await openMobileFinance(renderer);
  assert.equal(requests.length, 8, 'trocas de abas móveis não podem reiniciar o bootstrap');

  await act(async () => { release(); await delayed; await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(providerStatus(renderer), 'READY');
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-finance-remote-readonly' }).length, 0);
  for (const label of ['Novo pacote', 'Registrar pagamento', 'Nova despesa']) {
    const control = renderer.root.findAllByType('button').find(button => textContent(button).trim() === label);
    assert.ok(control);
    assert.equal(control.props.disabled, false);
  }

  await act(async () => mobileNavButton(renderer, 'Pacientes').props.onClick());
  assert.match(textContent(renderer.root), /Paciente Sintético Mobile R108/);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-remote-error-state' }).length, 0);
  assert.equal(requests.filter(request => request.path.endsWith('/patients')).length, 1);
  assert.equal(requests.filter(request => ['/charges', '/payments', '/expenses', '/packages'].some(path => request.path.endsWith(path))).length, 4);
  assert.ok(requests.every(request => request.method === 'GET'));
  await act(async () => renderer.unmount());
});

test('R108 mobile mantém fail-closed no erro e um retry bem-sucedido transita para READY', async () => {
  const requests: string[] = [];
  let fail = true;
  globalThis.fetch = async (url: string | URL) => {
    const parsed = new URL(String(url), 'http://localhost');
    requests.push(parsed.pathname);
    return fail
      ? new Response(JSON.stringify({ error: { code: 'psychology/transient-synthetic', message: 'Falha sintética transitória.' } }), { status: 503 })
      : responseFor(parsed.pathname);
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<PsychologyPilot runtimeMode="authenticated-remote" />);
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert.equal(providerStatus(renderer), 'ERROR');
  await openMobileFinance(renderer);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-finance-remote-error' }).length, 1);
  assert.ok(renderer.root.findAllByType('button').filter(button => textContent(button).trim() === 'Novo pacote').every(button => button.props.disabled === true));

  fail = false;
  const retry = renderer.root.findByProps({ 'data-testid': 'psychology-finance-remote-error' }).findAllByType('button').find(button => textContent(button).trim() === 'Tentar novamente')!;
  await act(async () => { retry.props.onClick(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(providerStatus(renderer), 'READY');
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-finance-remote-error' }).length, 0);
  assert.equal(requests.length, 16, 'um bootstrap e exatamente um retry devem executar oito leituras cada');
  assert.equal(requests.filter(path => path.endsWith('/patients')).length, 2);
  assert.equal(renderer.root.findAllByType('button').find(button => textContent(button).trim() === 'Novo pacote')!.props.disabled, false);
  await act(async () => renderer.unmount());
});
