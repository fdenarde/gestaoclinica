import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  atob: (...args) => globalThis.atob(...args),
  btoa: (...args) => globalThis.btoa(...args),
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { reload() {} },
};
globalThis.document = {
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
  getElementById() { return null; },
  createElement() { return { click() {} }; },
};
globalThis.HTMLElement = class HTMLElement {};
globalThis.fetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const { PatientDialogR2F3E, PatientsView } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function renderWithAct(element) {
  let renderer;
  act(() => { renderer = create(element); });
  return renderer;
}

function checkboxInputs(renderer) {
  return renderer.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox');
}

function buttonByText(renderer, text, exact = false) {
  return renderer.root.findAllByType('button').find(button => exact ? textContent(button).trim() === text : textContent(button).includes(text));
}

const rows = Array.from({ length: 5 }, (_, index) => ({
  patient: { id: `r34-patient-${index + 1}`, name: `Paciente R34 ${index + 1}`, active: true, inReview: false },
  phone: '(27) 99999-0000',
  email: '—',
  createdAt: '25/08/2026',
  createdAtValue: Date.now(),
  lastSession: '—',
  lastSessionValue: null,
  nextSession: 'Sem agendamento',
  nextSessionValue: null,
  modalityLocation: 'Presencial · Shopping Moxuara',
}));

function renderPatients(onBulkDelete = () => ({ processed: 0, deleted: 0, failed: 0, failedIds: [] })) {
  return renderWithAct(React.createElement(PatientsView, {
    rows,
    search: '',
    setSearch() {},
    onNew() {},
    onEdit() {},
    onOpen() {},
    onDelete() {},
    onSetReview: async () => true,
    onBulkDelete,
  }));
}

test('R34 valida a cadeia real do modal com e-mail do responsável opcional', () => {
  let saved = 0;
  const renderer = renderWithAct(React.createElement(PatientDialogR2F3E, {
    value: null,
    onClose() {},
    onSave: () => { saved += 1; return true; },
  }));
  const inputs = () => renderer.root.findAllByType('input');
  const textInputs = () => inputs().filter(input => !input.props.type);
  const date = () => inputs().find(input => input.props.type === 'date');
  const emailInputs = () => inputs().filter(input => input.props.type === 'email');

  act(() => { date().props.onChange({ target: { value: '2012-08-25' } }); });
  act(() => { textInputs()[0].props.onChange({ target: { value: 'Menor R34' } }); });
  act(() => { textInputs()[1].props.onChange({ target: { value: '27999990000' } }); });
  const responsibleTextInputs = () => textInputs().slice(2);
  act(() => { responsibleTextInputs()[0].props.onChange({ target: { value: 'Ana' } }); });
  act(() => { responsibleTextInputs()[1].props.onChange({ target: { value: 'Mãe' } }); });

  act(() => { renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  assert.doesNotMatch(textContent(renderer.root), /Informe um telefone válido para o responsável|Informe um e-mail válido para o responsável/);
  assert.equal(saved, 1);
  renderer.unmount();
});

test('R34 mostra e remove o erro de e-mail inválido no mesmo formulário', () => {
  const renderer = renderWithAct(React.createElement(PatientDialogR2F3E, { value: null, onClose() {}, onSave() { return true; } }));
  const inputs = () => renderer.root.findAllByType('input');
  const textInputs = () => inputs().filter(input => !input.props.type);
  const date = () => inputs().find(input => input.props.type === 'date');
  const emailInputs = () => inputs().filter(input => input.props.type === 'email');

  act(() => { date().props.onChange({ target: { value: '2012-08-25' } }); });
  act(() => { textInputs()[0].props.onChange({ target: { value: 'Menor R34 inválido' } }); });
  act(() => { textInputs()[1].props.onChange({ target: { value: '27999990000' } }); });
  act(() => { emailInputs()[1].props.onChange({ target: { value: 'abc' } }); });
  act(() => { renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  assert.match(textContent(renderer.root), /Informe um e-mail válido para o responsável/);
  act(() => { emailInputs()[1].props.onChange({ target: { value: '' } }); });
  assert.doesNotMatch(textContent(renderer.root), /Informe um e-mail válido para o responsável/);
  renderer.unmount();
});

test('R34 toolbar do piloto local mantém revisão, limpeza e bulk no DOM', async () => {
  let bulkCalls = 0;
  const renderer = renderPatients(ids => { bulkCalls += 1; return { processed: ids.length, deleted: ids.length, failed: 0, failedIds: [] }; });
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-bulk-delete-button' }).length, 0);
  const rowCheckboxes = () => checkboxInputs(renderer).slice(1);
  act(() => { rowCheckboxes()[0].props.onChange({ target: { checked: true } }); });
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-bulk-delete-button' }).length, 0);
  act(() => { rowCheckboxes()[1].props.onChange({ target: { checked: true } }); });
  const toolbar2 = textContent(renderer.root.findByProps({ 'data-testid': 'psychology-patient-selection-bar' }));
  assert.match(toolbar2, /2 pacientes selecionados/);
  assert.match(toolbar2, /Excluir selecionados \(2\)/);
  assert.match(toolbar2, /Mover para revisão/);
  assert.match(toolbar2, /Limpar seleção/);
  act(() => { rowCheckboxes()[2].props.onChange({ target: { checked: true } }); rowCheckboxes()[3].props.onChange({ target: { checked: true } }); rowCheckboxes()[4].props.onChange({ target: { checked: true } }); });
  assert.ok(buttonByText(renderer, 'Excluir selecionados (5)', true));
  act(() => { buttonByText(renderer, 'Excluir selecionados (5)', true).props.onClick(); });
  assert.match(textContent(renderer.root), /Excluir definitivamente os 5 pacientes selecionados\?/);
  const confirmationInput = renderer.root.findAllByType('input').find(input => input.props.autoFocus === true);
  act(() => { confirmationInput.props.onChange({ target: { value: 'EXCLUIR' } }); });
  await act(async () => { buttonByText(renderer, 'Excluir selecionados', true).props.onClick(); await Promise.resolve(); });
  assert.equal(bulkCalls, 1);
  renderer.unmount();
});
