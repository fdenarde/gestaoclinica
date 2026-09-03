import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).window = {
  innerWidth: 1366,
  innerHeight: 768,
  atob: (...args: Parameters<typeof atob>) => atob(...args),
  btoa: (...args: Parameters<typeof btoa>) => btoa(...args),
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
} as any;
(globalThis as any).document = { activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, createElement() { return { click() {} }; } };
(globalThis as any).HTMLElement = class HTMLElement {};

const { PatientsView } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');

function textContent(node: { children?: unknown[] }): string {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child as { children?: unknown[] })).join('') || '';
}

const rows = [
  {
    patient: { id: 'ui-patient-1', name: 'Paciente Sintético Um', active: true, inReview: false },
    phone: '(27) 99999-0001',
    email: 'nao-exibir@example.test',
    createdAt: '01/01/2026',
    createdAtValue: 1,
    lastSession: '10/08/2026',
    lastSessionValue: '2026-08-10',
    nextSession: '20/08/2026 · 09:00',
    nextSessionValue: '2026-08-20',
    modalityLocation: 'Presencial · Local Sintético',
  },
  {
    patient: { id: 'ui-patient-2', name: 'Paciente Sintético Dois', active: false, inReview: false },
    phone: '(27) 99999-0002',
    email: 'nao-exibir-2@example.test',
    createdAt: '02/01/2026',
    createdAtValue: 2,
    lastSession: '—',
    lastSessionValue: null,
    nextSession: 'Sem agendamento',
    nextSessionValue: null,
    modalityLocation: 'Online',
  },
];

function renderPatients() {
  let renderer;
  act(() => {
    renderer = create(React.createElement(PatientsView, {
      rows,
      search: '',
      searchKey: '',
      setSearch() {},
      onNew() {},
      onEdit() {},
      onOpen() {},
      onOpenFinance() {},
      onDelete() {},
      onToggle() { return true; },
      onSetReview() { return true; },
      onBulkDelete() { return { processed: 0, deleted: 0, failed: 0, failedIds: [] }; },
    }));
  });
  return renderer;
}

test('a listagem principal usa somente as cinco colunas operacionais', () => {
  const renderer = renderPatients();
  const header = renderer.root.findByProps({ 'data-testid': 'psychology-patient-list-header' });
  const headerText = textContent(header);
  for (const label of ['Paciente', 'Telefone', 'Modalidade / local', 'Status', 'Ação']) assert.match(headerText, new RegExp(label, 'i'));
  for (const label of ['E-mail', 'Cadastro', 'Última sessão', 'Próxima sessão']) assert.doesNotMatch(headerText, new RegExp(label, 'i'));
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-row' }).length, 2);
  renderer.unmount();
});

test('a ação primária fica visível e as ações secundárias permanecem no menu', () => {
  const renderer = renderPatients();
  const actionGroups = renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-actions' });
  assert.equal(actionGroups.length, 2);
  for (const group of actionGroups) {
    assert.equal(group.children.filter((child: any) => child?.type === 'button').length, 1);
    assert.equal(group.findAllByProps({ 'data-testid': 'psychology-patient-secondary-actions' }).length, 1);
    assert.equal(textContent(group).includes('Abrir ficha'), true);
  }
  renderer.unmount();
});

test('filtros permanecem agrupados e a ficha preserva os dados removidos da lista', async () => {
  const renderer = renderPatients();
  assert.equal(renderer.root.findByProps({ 'data-testid': 'psychology-patient-filters' }).findAllByType('select').length, 4);
  const source = await (await import('node:fs/promises')).readFile('src/features/psychology-pilot/PsychologyPatientChart.tsx', 'utf8');
  assert.match(source, /Contato/);
  assert.match(source, /E-mail/);
  assert.match(source, /Cadastro/);
  assert.match(source, /Última sessão/);
  assert.match(source, /Próxima sessão/);
  renderer.unmount();
});
