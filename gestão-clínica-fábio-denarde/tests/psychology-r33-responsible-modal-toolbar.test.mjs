import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { readFile } from 'node:fs/promises';

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

const { PatientsView, PatientDialogR2F3E } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');
const { validatePsychologyPatientAdministrativeInput } = await import('../src/lib/psychologyPatientAdministrative.ts');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function buttons(renderer) {
  return renderer.root.findAllByType('button');
}

function buttonByText(renderer, text, exact = false) {
  return buttons(renderer).find(button => exact ? textContent(button).trim() === text : textContent(button).includes(text));
}

function renderWithAct(element) {
  let renderer;
  act(() => { renderer = create(element); });
  return renderer;
}

function checkboxInputs(renderer) {
  return renderer.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox');
}

const rows = Array.from({ length: 5 }, (_, index) => ({
  patient: { id: `r33-patient-${index + 1}`, name: `Paciente R33 ${index + 1}`, active: true, inReview: false },
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

test('R33 valida todos os campos do responsável como independentes e opcionais', () => {
  const base = { name: 'Paciente menor sintético', dateOfBirth: '2012-08-25', phone: '27999990000', email: '', preferredModality: 'presencial' };
  assert.deepEqual(validatePsychologyPatientAdministrativeInput({ ...base, administrativeResponsible: { fullName: 'Ana', relationship: 'Mãe', phone: '', email: '' } }, '2026-08-25'), {});
  assert.deepEqual(validatePsychologyPatientAdministrativeInput({ ...base, administrativeResponsible: { fullName: 'Ana', relationship: '', phone: '', email: '' } }, '2026-08-25'), {});
  assert.deepEqual(validatePsychologyPatientAdministrativeInput({ ...base, administrativeResponsible: { fullName: '', relationship: 'Mãe', phone: '', email: '' } }, '2026-08-25'), {});
  assert.deepEqual(validatePsychologyPatientAdministrativeInput({ ...base, administrativeResponsible: { fullName: '', relationship: '', phone: '', email: '' } }, '2026-08-25'), {});
  assert.match(validatePsychologyPatientAdministrativeInput({ ...base, administrativeResponsible: { fullName: '', relationship: '', phone: '123', email: '' } }, '2026-08-25')['administrativeResponsible.phone'], /telefone válido/);
  assert.match(validatePsychologyPatientAdministrativeInput({ ...base, administrativeResponsible: { fullName: '', relationship: '', phone: '', email: 'abc' } }, '2026-08-25')['administrativeResponsible.email'], /e-mail válido/);
});

test('R33 formulário permite apagar erro opcional e salvar menor sem responsável', async () => {
  let saved = 0;
  const renderer = renderWithAct(React.createElement(PatientDialogR2F3E, { value: null, onClose() {}, onSave: () => { saved += 1; return true; } }));
  const inputs = () => renderer.root.findAllByType('input');
  const textInputs = () => inputs().filter(input => !input.props.type);
  const date = () => inputs().find(input => input.props.type === 'date');
  const emailInputs = () => inputs().filter(input => input.props.type === 'email');

  act(() => { date().props.onChange({ target: { value: '2012-08-25' } }); });
  act(() => { textInputs()[0].props.onChange({ target: { value: 'Menor R33' } }); });
  act(() => { textInputs()[1].props.onChange({ target: { value: '27999990000' } }); });
  const responsibleTextInputs = () => textInputs().slice(2);
  act(() => { responsibleTextInputs()[0].props.onChange({ target: { value: 'Ana' } }); });
  act(() => { responsibleTextInputs()[1].props.onChange({ target: { value: 'Mãe' } }); });
  act(() => { responsibleTextInputs()[2].props.onChange({ target: { value: '123' } }); });
  act(() => { emailInputs()[1].props.onChange({ target: { value: 'abc' } }); });
  act(() => { renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  assert.match(textContent(renderer.root), /Informe um telefone válido para o responsável/);
  assert.match(textContent(renderer.root), /Informe um e-mail válido para o responsável/);
  act(() => { responsibleTextInputs()[2].props.onChange({ target: { value: '' } }); });
  act(() => { emailInputs()[1].props.onChange({ target: { value: '' } }); });
  assert.doesNotMatch(textContent(renderer.root), /Informe um telefone válido para o responsável|Informe um e-mail válido para o responsável/);
  act(() => { renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
  assert.equal(saved, 1);
  const dialogSection = renderer.root.findAllByType('section')[0];
  assert.match(dialogSection.props.className, /overflow-visible/);
  assert.doesNotMatch(dialogSection.props.className, /overflow-y-auto/);
  assert.ok(renderer.root.findByProps({ 'data-testid': 'psychology-patient-dialog-footer' }));
  renderer.unmount();
});

test('R33 toolbar real mostra bulk somente para 2 ou mais selecionados e confirma uma vez', async () => {
  let bulkCalls = 0;
  const renderer = renderPatients(ids => { bulkCalls += 1; return { processed: ids.length, deleted: ids.length, failed: 0, failedIds: [] }; });
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-bulk-delete-button' }).length, 0);
  const rowCheckboxes = () => checkboxInputs(renderer).slice(1);
  act(() => { rowCheckboxes()[0].props.onChange({ target: { checked: true } }); });
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-bulk-delete-button' }).length, 0);
  act(() => { rowCheckboxes()[1].props.onChange({ target: { checked: true } }); });
  assert.equal(textContent(renderer.root.findByProps({ 'data-testid': 'psychology-patient-selection-bar' })), '2 pacientes selecionados Excluir selecionados (2)Mover para revisãoLimpar seleção');
  act(() => { rowCheckboxes()[2].props.onChange({ target: { checked: true } }); rowCheckboxes()[3].props.onChange({ target: { checked: true } }); rowCheckboxes()[4].props.onChange({ target: { checked: true } }); });
  assert.ok(buttonByText(renderer, 'Excluir selecionados (5)', true));
  act(() => { buttonByText(renderer, 'Excluir selecionados (5)', true).props.onClick(); });
  const cancel = buttonByText(renderer, 'Cancelar', true);
  assert.ok(cancel);
  act(() => { cancel.props.onClick(); });
  assert.equal(bulkCalls, 0);
  act(() => { buttonByText(renderer, 'Excluir selecionados (5)', true).props.onClick(); });
  const confirmationInput = renderer.root.findAllByType('input').find(input => input.props.autoFocus === true);
  act(() => { confirmationInput.props.onChange({ target: { value: 'EXCLUIR' } }); });
  await act(async () => { buttonByText(renderer, 'Excluir selecionados', true).props.onClick(); await Promise.resolve(); });
  assert.equal(bulkCalls, 1);
  renderer.unmount();
});

test('R33 header e linhas compartilham grid, e modalidade/status/ações permanecem em células próprias', async () => {
  const source = await readFile('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  assert.equal((source.match(/\$\{PATIENT_LIST_GRID\}/g) || []).length, 2);
  assert.match(source, /data-testid="psychology-patient-list-modality"[^>]*className="[^"]*md:col-auto[^>]*md:row-auto/);
  assert.match(source, /data-testid="psychology-patient-list-status"[^>]*className="[^"]*md:items-center/);
  assert.match(source, /data-testid="psychology-patient-list-actions"[^>]*className="[^"]*items-center/);
  const renderer = renderPatients();
  const header = renderer.root.findByProps({ 'data-testid': 'psychology-patient-list-header' });
  const row = renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-row' })[0];
  assert.match(header.props.className, /md:grid-cols-\[auto_minmax\(220px,340px\)/);
  assert.match(row.props.className, /md:grid-cols-\[auto_minmax\(220px,340px\)/);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-modality' }).length, 5);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-status' }).length, 5);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-list-actions' }).length, 5);
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'psychology-patient-secondary-actions' }).length, 5);
  renderer.unmount();
});
