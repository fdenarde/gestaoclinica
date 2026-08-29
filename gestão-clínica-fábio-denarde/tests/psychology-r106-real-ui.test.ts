import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import PsychologyFinanceView from '../src/features/psychology-pilot/PsychologyFinanceView';
import PsychologyPatientChart from '../src/features/psychology-pilot/PsychologyPatientChart';
import { DayView, PatientDialogR2F3E, SessionCard } from '../src/features/psychology-pilot/PsychologyPilot';
import { createEmptyPsychologyStore, type PsychologySession, type PsychologyStore } from '../src/features/psychology-pilot/psychologyDomain';
import { cancelPsychologyCharge, createPsychologyChargeInLedger, createPsychologyExpenseInLedger, createPsychologyPaymentInLedger, createPsychologySessionPackageInLedger } from '../src/features/psychology-pilot/psychologyFinancialLedger';
import { PSYCHOLOGY_COLOR_DEFAULTS } from '../src/features/psychology-pilot/psychologyR2a';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listeners = new Map<string, EventListener>();
const storage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener(type: string, handler: EventListener) { listeners.set(type, handler); },
  removeEventListener(type: string) { listeners.delete(type); },
  setTimeout,
  clearTimeout,
  localStorage: storage,
  sessionStorage: storage,
  location: { reload() {} },
} as unknown as Window & typeof globalThis;
globalThis.document = {
  activeElement: null,
  addEventListener(type: string, handler: EventListener) { listeners.set(type, handler); },
  removeEventListener(type: string) { listeners.delete(type); },
  createElement() { return { click() {} }; },
} as unknown as Document;
globalThis.HTMLElement = class HTMLElement {} as typeof HTMLElement;

const scope = { professionalId: 'r106-ui-professional', context: 'PSICOLOGIA' as const };
const baseStore = createEmptyPsychologyStore(scope);
const primaryService = baseStore.services.find(service => service.id === 'psychotherapy-individual')!;
const patient = {
  id: 'r106-ui-patient',
  ...scope,
  name: 'Paciente Sintético R106',
  dateOfBirth: '1990-01-01',
  phone: '27999999999',
  email: '',
  preferredModality: 'presencial' as const,
  active: true,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
};
const secondPatient = { ...patient, id: 'r106-ui-other-patient', name: 'Outro Paciente Sintético' };

function storeWithLedger(): PsychologyStore {
  const withPatients = { ...baseStore, patients: [patient, secondPatient] };
  return createPsychologyChargeInLedger(withPatients, {
    patientId: patient.id,
    serviceId: primaryService.id,
    description: '',
    amount: 250,
    dueDate: '2099-01-01',
  }, '2026-08-29T00:00:00.000Z').store;
}

function storeWithPackageLedger(): PsychologyStore {
  const withPatients = { ...baseStore, patients: [patient] };
  const withPackage = createPsychologySessionPackageInLedger(withPatients, {
    patientId: patient.id,
    name: 'Psicoterapia Individual · 5 sessões',
    serviceId: primaryService.id,
    totalSessions: 5,
    startDate: '2026-08-29',
    price: 1100,
    totalPrice: 1100,
    pricePerSession: 220,
  }, '2026-08-29T00:00:00.000Z').store;
  return createPsychologyChargeInLedger(withPackage, {
    patientId: patient.id,
    serviceId: primaryService.id,
    packageId: withPackage.sessionPackages[0].id,
    description: '',
    amount: 1100,
    dueDate: '2099-01-01',
  }, '2026-08-29T00:00:00.000Z').store;
}

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return child ? textContent(child as TestRenderer.ReactTestInstance) : '';
  }).join('');
}

function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(item => textContent(item).trim() === label);
}

function dialogByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  return renderer.root.findAllByProps({ role: 'dialog' }).find(item => textContent(item).includes(title));
}

function session(overrides: Partial<PsychologySession> = {}): PsychologySession {
  return {
    id: `r106-session-${overrides.id || 'default'}`,
    ...scope,
    patientId: patient.id,
    date: '2026-08-29',
    time: '09:00',
    durationMinutes: 50,
    modality: 'online',
    serviceId: 'mentoring',
    status: 'agendada',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

test('R106 UI real: cobrança expõe moeda BRL, descrição opcional e criação descobrível de pacote', async () => {
  const store: PsychologyStore = { ...baseStore, patients: [patient], services: baseStore.services, locations: baseStore.locations };
  let savedStore: PsychologyStore = store;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyFinanceView, {
      store,
      onStoreChange: (next: PsychologyStore) => { savedStore = next; return true; },
      onNotice() {},
    }));
  });

  await act(async () => { button(renderer, 'Nova cobrança')?.props.onClick(); });
  const chargeDialog = dialogByTitle(renderer, 'Nova cobrança');
  assert.ok(chargeDialog);
  assert.match(textContent(chargeDialog!), /Descrição \(opcional\)/);
  assert.doesNotMatch(textContent(chargeDialog!), /Descrição \*/);

  const selects = chargeDialog!.findAllByType('select');
  await act(async () => { selects[0].props.onChange({ target: { value: patient.id } }); });
  const moneyInput = chargeDialog!.findAllByProps({ inputMode: 'decimal' })[0];
  await act(async () => { moneyInput.props.onChange({ target: { value: '250' } }); });
  assert.match(String(moneyInput.props.value), /250,00/);

  await act(async () => { button(renderer, 'Criar pacote')?.props.onClick(); });
  const packageDialog = dialogByTitle(renderer, 'Novo pacote');
  assert.ok(packageDialog);
  assert.match(textContent(renderer.root), /1 sessões/);
  assert.match(textContent(renderer.root), /2 sessões/);
  assert.match(textContent(renderer.root), /5 sessões/);
  assert.match(textContent(renderer.root), /10 sessões/);
  const packageSelects = packageDialog!.findAllByType('select');
  assert.equal(packageSelects[0].props.value, patient.id, 'o paciente selecionado na cobrança deve ser preservado');
  await act(async () => { packageSelects[1].props.onChange({ target: { value: primaryService.id } }); });
  await act(async () => { button(renderer, '5 sessões')?.props.onClick(); });
  const packageMoney = packageDialog!.findAllByProps({ inputMode: 'decimal' })[0];
  await act(async () => { packageMoney.props.onChange({ target: { value: '1100' } }); });
  await act(async () => { button(renderer, 'Criar pacote')?.props.onClick(); });
  assert.equal(savedStore.charges.length, 0, 'o fluxo de pacote não deve gravar cobrança automaticamente');
  assert.equal(savedStore.sessionPackages.length, 1);
  const returnedChargeDialog = dialogByTitle(renderer, 'Nova cobrança');
  assert.ok(returnedChargeDialog, 'o fluxo deve retornar à cobrança após criar o pacote');
  assert.equal(returnedChargeDialog!.findAllByType('select')[3].props.value, savedStore.sessionPackages[0].id);
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: cobrança sem descrição pode ser salva e pagamento direto pré-seleciona saldo', async () => {
  const store = storeWithLedger();
  let savedStore = store;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyFinanceView, {
      store,
      onStoreChange: (next: PsychologyStore) => { savedStore = next; return true; },
      onNotice() {},
    }));
  });
  await act(async () => { button(renderer, 'Nova cobrança')?.props.onClick(); });
  const dialog = dialogByTitle(renderer, 'Nova cobrança')!;
  const chargePatientSelect = dialog.findAllByType('select')[0];
  await act(async () => { chargePatientSelect.props.onChange({ target: { value: patient.id } }); });
  const chargeMoney = dialog.findAllByProps({ inputMode: 'decimal' })[0];
  await act(async () => { chargeMoney.props.onChange({ target: { value: '250' } }); });
  await act(async () => { button(renderer, 'Criar cobrança')?.props.onClick(); });
  assert.equal(savedStore.charges.length, 2);
  assert.equal(savedStore.charges.at(-1)?.description, '');

  await act(async () => { button(renderer, 'Cobranças')?.props.onClick(); });
  const directPay = renderer.root.findAllByProps({ 'aria-label': 'Registrar pagamento' })[0];
  assert.ok(directPay);
  await act(async () => { directPay.props.onClick(); await Promise.resolve(); });
  const paymentDialog = dialogByTitle(renderer, 'Registrar pagamento');
  assert.ok(paymentDialog);
  const paymentSelect = paymentDialog!.findAllByType('select')[0];
  assert.equal(paymentSelect.props.value, store.charges[0].id);
  await act(async () => { await Promise.resolve(); });
  const paymentMoney = paymentDialog!.findAllByProps({ inputMode: 'decimal' })[0];
  assert.match(String(paymentMoney.props.value), /250,00/);
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: pacote mostra recebido/saldo e permite pagar pela própria linha', async () => {
  const store = storeWithPackageLedger();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyFinanceView, {
      store,
      onStoreChange: () => true,
      onNotice() {},
    }));
  });
  await act(async () => { button(renderer, 'Pacotes')?.props.onClick(); });
  assert.match(textContent(renderer.root), /Recebido/);
  assert.match(textContent(renderer.root), /Saldo/);
  const payPackage = renderer.root.findAllByProps({ 'aria-label': 'Registrar pagamento' })[0];
  assert.ok(payPackage);
  await act(async () => { payPackage.props.onClick(); await Promise.resolve(); });
  const paymentDialog = dialogByTitle(renderer, 'Registrar pagamento');
  assert.ok(paymentDialog);
  assert.equal(paymentDialog!.findAllByType('select')[0].props.value, store.charges[0].id);
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: edição de pagamento e despesa usa os formulários renderizados', async () => {
  const charged = storeWithLedger();
  const paid = createPsychologyPaymentInLedger(charged, {
    chargeId: charged.charges[0].id,
    patientId: patient.id,
    amount: 100,
    date: '2026-08-29',
    method: 'PIX',
  }, '2026-08-29T00:00:00.000Z').store;
  let savedStore = paid;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyFinanceView, {
      store: paid,
      onStoreChange: (next: PsychologyStore) => { savedStore = next; return true; },
      onNotice() {},
    }));
  });
  await act(async () => { button(renderer, 'Pagamentos')?.props.onClick(); });
  await act(async () => { button(renderer, 'Editar')?.props.onClick(); });
  const paymentEdit = dialogByTitle(renderer, 'Editar pagamento');
  assert.ok(paymentEdit);
  await act(async () => { paymentEdit!.findAllByProps({ inputMode: 'decimal' })[0].props.onChange({ target: { value: '125' } }); });
  await act(async () => { button(renderer, 'Salvar pagamento')?.props.onClick(); });
  assert.equal(savedStore.payments[0]?.amount, 125);
  await act(async () => { renderer.unmount(); });

  const withExpense = createPsychologyExpenseInLedger(paid, {
    description: '',
    amount: 80,
    date: '2026-08-29',
    category: 'Outros',
    status: 'REALIZED',
  }, '2026-08-29T00:00:00.000Z').store;
  savedStore = withExpense;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyFinanceView, {
      store: withExpense,
      onStoreChange: (next: PsychologyStore) => { savedStore = next; return true; },
      onNotice() {},
    }));
  });
  await act(async () => { button(renderer, 'Despesas')?.props.onClick(); });
  await act(async () => { button(renderer, 'Editar')?.props.onClick(); });
  const expenseEdit = dialogByTitle(renderer, 'Editar despesa');
  assert.ok(expenseEdit);
  await act(async () => { expenseEdit!.findAllByProps({ inputMode: 'decimal' })[0].props.onChange({ target: { value: '90' } }); });
  await act(async () => { button(renderer, 'Salvar despesa')?.props.onClick(); });
  assert.equal(savedStore.expenses[0]?.amount, 90);
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: paciente possui Financeiro integrado e isola o ledger pelo paciente', async () => {
  const store = storeWithLedger();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyPatientChart, {
      store,
      patientId: patient.id,
      initialTab: 'finance',
      onClose() {},
      onEdit() {},
      onSchedule() {},
      onOpenSession() {},
      onStoreChange: () => true,
      onStatus: () => true,
      onRecord() {},
    }));
  });
  assert.ok(renderer.root.findByProps({ 'data-testid': 'psychology-finance' }));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'psychology-finance' }).props['data-patient-id'], patient.id);
  assert.match(textContent(renderer.root), /Financeiro de Paciente Sintético R106/);
  assert.doesNotMatch(textContent(renderer.root), /Outro Paciente Sintético/);
  assert.ok(button(renderer, 'Nova cobrança'));
  assert.ok(button(renderer, 'Novo pacote'));
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: cadastro de paciente expõe configuração financeira opcional sem cobrança automática', async () => {
  let savedInput: import('../src/features/psychology-pilot/psychologyDomain').PsychologyPatientInput | undefined;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PatientDialogR2F3E, {
      value: null,
      store: { ...baseStore, patients: [] },
      onClose() {},
      onSave: input => { savedInput = input; return true; },
    }));
  });
  const config = renderer.root.findByProps({ 'data-testid': 'psychology-patient-finance-config' });
  assert.match(textContent(config), /Configuração financeira opcional/);
  await act(async () => { button(renderer, 'Configurar')?.props.onClick(); });
  const modeSelect = renderer.root.findByProps({ 'aria-label': 'Modalidade financeira' });
  await act(async () => { modeSelect.props.onChange({ target: { value: 'package' } }); });
  assert.match(textContent(renderer.root), /Quantidade de sessões/);
  const fiveSessions = button(renderer, '5 sessões');
  assert.ok(fiveSessions);
  await act(async () => { fiveSessions!.props.onClick(); });
  const packageTotal = renderer.root.findByProps({ 'aria-label': 'Valor total do pacote' });
  await act(async () => { packageTotal.props.onChange({ target: { value: '1100' } }); });
  assert.match(textContent(renderer.root), /R\$\s*220,00 por sessão/);
  const inputs = renderer.root.findAllByType('input');
  const nameInput = inputs.find(input => input.props.autoFocus);
  const phoneInput = inputs.find(input => input.props.required && input !== nameInput);
  await act(async () => {
    nameInput?.props.onChange({ target: { value: 'Paciente Financeiro R106' } });
    phoneInput?.props.onChange({ target: { value: '27999999999' } });
  });
  const form = renderer.root.findByProps({ 'data-testid': 'psychology-patient-dialog-form' });
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
  assert.equal(savedInput?.financialSettings?.mode, 'package');
  assert.equal(savedInput?.financialSettings?.packageQuantity, 5);
  assert.equal(savedInput?.financialSettings?.packageTotalPrice, 1100);
  assert.equal(savedInput?.financialSettings?.packageId, undefined);
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: Mentoria preserva marrom nos três modos no card efetivamente renderizado', async () => {
  const settings = { ...baseStore.settings, services: [], locations: [] };
  for (const modality of ['online', 'presencial'] as const) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(SessionCard, {
        session: session({ id: modality, modality, locationType: modality === 'presencial' ? 'PRIMARY_OFFICE' : undefined }),
        settings,
        patient,
        hasRecord: false,
        onEdit() {},
        onStatus() {},
        onRecord() {},
      }));
    });
    const card = renderer.root.findByProps({ 'data-testid': 'psychology-clinical-session' });
    assert.equal(card.props['data-agenda-category'], 'MENTORING');
    assert.equal(card.props.style.backgroundColor, `${PSYCHOLOGY_COLOR_DEFAULTS.MENTORING}18`);
    assert.ok(card.findAllByType('div').some(item => item.props.style?.backgroundColor === PSYCHOLOGY_COLOR_DEFAULTS.MENTORING));
    await act(async () => { renderer.unmount(); });
  }
  let externalRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    externalRenderer = TestRenderer.create(React.createElement(SessionCard, {
      session: session({ id: 'external', modality: 'presencial', locationType: 'EXTERNAL_OFFICE' }),
      settings,
      patient,
      hasRecord: false,
      onEdit() {},
      onStatus() {},
      onRecord() {},
    }));
  });
  assert.equal(externalRenderer.root.findByProps({ 'data-testid': 'psychology-clinical-session' }).props.style.borderColor, PSYCHOLOGY_COLOR_DEFAULTS.MENTORING);
  await act(async () => { externalRenderer.unmount(); });
});

test('R106 UI real: Meu Dia expõe atalho Financeiro', async () => {
  let opened = 0;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(DayView, {
      date: '2026-08-29',
      setDate() {},
      store: { ...baseStore, patients: [patient], sessions: [session()] },
      sessions: [session()],
      settings: baseStore.settings,
      onSchedule() {},
      onPersonal() {},
      onOpenFinance() { opened += 1; },
      onOpenSession() {},
    }));
  });
  const financeButton = button(renderer, 'Abrir Financeiro');
  assert.ok(financeButton);
  financeButton!.props.onClick();
  assert.equal(opened, 1);
  await act(async () => { renderer.unmount(); });
});

test('R106 UI real: reativação de cobrança mantém o mesmo registro', async () => {
  const base = storeWithLedger();
  const cancelled = cancelPsychologyCharge(base, base.charges[0].id, 'fixture', 'r106-ui-professional', '2026-08-29T00:00:00.000Z').store;
  let savedStore = cancelled;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PsychologyFinanceView, {
      store: cancelled,
      onStoreChange: (next: PsychologyStore) => { savedStore = next; return true; },
      onNotice() {},
    }));
  });
  await act(async () => { button(renderer, 'Cobranças')?.props.onClick(); });
  const reactivate = button(renderer, 'Reativar');
  assert.ok(reactivate);
  await act(async () => { reactivate!.props.onClick(); });
  assert.equal(savedStore.charges.length, cancelled.charges.length);
  assert.equal(savedStore.charges.find(charge => charge.id === cancelled.charges[0].id)?.id, cancelled.charges[0].id);
  assert.equal(savedStore.charges.find(charge => charge.id === cancelled.charges[0].id)?.status, 'pending');
  await act(async () => { renderer.unmount(); });
});
