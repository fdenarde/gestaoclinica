import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packagePayments = await import('../shared/packagePayments.js');
const canonicalModule = await import('../shared/packageFinancialSummary.js').catch(() => ({}));
const operationsModule = await import('../shared/paymentOperations.js').catch(() => ({}));

const TODAY = '2026-07-24';
const PATIENT = {
  id: 'patient-financial-integrity',
  name: 'Paciente Fictício Financeiro',
  status: 'Ativo',
  startDate: '2026-01-01',
  paymentModal: 'ALTERNATIVA: Parcelado — R$500 antes da 1ª / R$500 na 5ª sessão',
};

function payment(id, amount, packageNumber, overrides = {}) {
  return {
    id,
    patientId: PATIENT.id,
    amount,
    date: '2026-01-01',
    installment: amount >= 1000 ? 'Pagamento integral' : '1ª parcela',
    method: 'Pix',
    ...(packageNumber ? { packageNumber } : {}),
    ...overrides,
  };
}

function sessions(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index + 1}`,
    patientId: PATIENT.id,
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    time: '08:00',
    status: 'Realizada',
    type: 'Simples',
  }));
}

function requireFunction(module, name) {
  assert.equal(typeof module[name], 'function', `${name} deve existir como função compartilhada`);
  return module[name];
}

function creationInput(overrides = {}) {
  return {
    patient: PATIENT,
    sessions: sessions(10),
    payments: [],
    expenses: [],
    operationKey: 'operation-financial-integrity-1',
    actor: 'Profissional Fictício',
    now: '2026-07-24T12:00:00.000Z',
    input: {
      patientId: PATIENT.id,
      packageNumber: 1,
      amount: 500,
      date: TODAY,
      installment: '1ª parcela',
      method: 'Pix',
      ...overrides,
    },
  };
}

test('1. cadastro de atendente não cria Payment automaticamente', () => {
  const source = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const creationStart = source.indexOf('const handleCreatePatient');
  const creationEnd = source.indexOf('const resetNewPatientForm', creationStart);
  const creationFlow = source.slice(creationStart, creationEnd > creationStart ? creationEnd : creationStart + 7000);
  assert.doesNotMatch(creationFlow, /generatedPayments|payments:\s*\[\.\.\.state\.payments/);
});

test('2. parcela futura não é considerada dinheiro recebido', () => {
  const summarize = requireFunction(packagePayments, 'getPackagePaymentSummary');
  const result = summarize([
    payment('future-installment', 500, 1, { date: '2026-08-01', installment: '2ª parcela' }),
  ], 1, { patientId: PATIENT.id, throughDate: TODAY });
  assert.equal(result.paidAmount, 0);
  assert.equal(result.pendingAmount, 1000);
});

test('3. pagamento explícito do Pacote 1 não ativa nem financia o Pacote 2', () => {
  const explicitOverpayment = [payment('package-one-overpayment', 1500, 1)];
  assert.equal(packagePayments.getActivatedPackageNumber(explicitOverpayment, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }), 1);
  const summarize = requireFunction(packagePayments, 'getPackagePaymentSummary');
  assert.equal(summarize(explicitOverpayment, 2, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }).paidAmount, 0);
});

test('4. pagamento duplicado do Pacote 1 não libera o Pacote 2', () => {
  const duplicated = [payment('duplicate-a', 1000, 1), payment('duplicate-b', 1000, 1)];
  assert.equal(packagePayments.getActivatedPackageNumber(duplicated, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }), 1);
});

test('5. sobrepagamento é bloqueado', () => {
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  assert.throws(() => prepare(creationInput({ amount: 1000 })), /saldo pendente|ultrapassa/i);
});

test('6. valor zero é bloqueado', () => {
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  assert.throws(() => prepare(creationInput({ amount: 0 })), /maior que zero|valor/i);
});

test('7. valor negativo é bloqueado', () => {
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  assert.throws(() => prepare(creationInput({ amount: -10 })), /maior que zero|valor/i);
});

test('8. NaN e valores não finitos são bloqueados', () => {
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => prepare(creationInput({ amount: invalid })), /finito|valor/i);
  }
});

test('9. clique duplo usa busy lock nas duas entradas visuais', () => {
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  const patients = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  assert.match(finance, /paymentWriteLockRef/);
  assert.match(patients, /paymentWriteLockRef/);
});

test('10. retry da mesma operação é idempotente', () => {
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  const first = prepare(creationInput());
  const retry = prepare({
    ...creationInput(),
    payments: first.payments,
    expenses: first.expenses,
  });
  assert.equal(first.payments.length, 1);
  assert.equal(retry.payments.length, 1);
  assert.equal(retry.payment.id, first.payment.id);
  assert.equal(retry.idempotent, true);
});

test('11. sucesso visual ocorre somente depois da confirmação do write', () => {
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  const patients = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  assert.match(finance, /await onUpdate\([\s\S]*showToast\(/);
  assert.match(patients, /await onUpdate\([\s\S]*showToast\(/);
});

test('12. pagamento e repasse são preparados na mesma operação coordenada', () => {
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  const result = prepare(creationInput());
  assert.equal(result.payments.length, 1);
  assert.equal(result.expenses.length, 1);
  assert.equal(result.expense.pagamento_origem_id, result.payment.id);
  assert.equal(result.expense.amount, 100);
});

test('13. Dashboard fica correto sem montar Finance.tsx', () => {
  const dashboard = fs.readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /isPaymentActive|filterActivePayments/);
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  const result = prepare(creationInput());
  assert.equal(result.expenses[0].amount, result.payments[0].amount * 0.2);
});

test('14. renovação com R$ 500 pagos mostra R$ 500 pendentes', () => {
  const summarize = requireFunction(canonicalModule, 'calculateCanonicalPackageFinancialSummary');
  const result = summarize({
    patient: PATIENT,
    sessions: sessions(14),
    payments: [payment('p1', 1000, 1), payment('p2-partial', 500, 2)],
    today: TODAY,
  });
  assert.equal(result.packageNumber, 2);
  assert.equal(result.paidGross, 500);
  assert.equal(result.pendingGross, 500);
});

test('15. PDF e CSV não usam todo o histórico para calcular o pacote atual', () => {
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  assert.match(reports, /calculatePackageFinancialSummary/);
  assert.doesNotMatch(reports, /const remaining = 1000 - paid/);
});

test('16. Financeiro, Atendentes, Relatórios e Portal usam o mesmo saldo canônico', () => {
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  const patients = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  const portal = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  assert.match(finance, /calculatePackageFinancialSummary/);
  assert.match(patients, /calculatePackageFinancialSummary/);
  assert.match(reports, /calculatePackageFinancialSummary/);
  assert.match(agenda, /calculatePackageFinancialSummary/);
  assert.match(portal, /getPackagePaymentSummary/);
  assert.doesNotMatch(portal, /function getPackagePaymentSummary/);
});

test('17. segunda parcela vence na quinta sessão', () => {
  const summarize = requireFunction(canonicalModule, 'calculateCanonicalPackageFinancialSummary');
  const patientSessions = sessions(5);
  const result = summarize({
    patient: PATIENT,
    sessions: patientSessions,
    payments: [payment('first-installment', 500, 1)],
    today: TODAY,
  });
  assert.equal(result.dueSessionNumber, 5);
  assert.equal(result.dueDate, patientSessions[4].date);
});

test('18. cancelamento preserva o registro original e exige justificativa', () => {
  const create = requireFunction(operationsModule, 'preparePaymentCreation');
  const cancel = requireFunction(operationsModule, 'preparePaymentVoid');
  const created = create(creationInput());
  assert.throws(() => cancel({
    payments: created.payments,
    expenses: created.expenses,
    paymentId: created.payment.id,
    reason: ' ',
    actor: 'Profissional Fictício',
    now: '2026-07-24T13:00:00.000Z',
  }), /justificativa/i);
  const canceled = cancel({
    payments: created.payments,
    expenses: created.expenses,
    paymentId: created.payment.id,
    reason: 'Lançamento registrado com valor incorreto',
    actor: 'Profissional Fictício',
    now: '2026-07-24T13:00:00.000Z',
  });
  const original = canceled.payments.find(item => item.id === created.payment.id);
  assert.equal(original.amount, 500);
  assert.equal(original.status, 'voided');
  assert.equal(original.voidReason, 'Lançamento registrado com valor incorreto');
  assert.equal(original.voidedBy, 'Profissional Fictício');
  const patientsSource = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const deletionStart = patientsSource.indexOf('const confirmDelete');
  const deletionEnd = patientsSource.indexOf('const filteredPatients', deletionStart);
  assert.doesNotMatch(patientsSource.slice(deletionStart, deletionEnd), /payments:\s*updatedPayments/);
});

test('19. pagamento cancelado não participa de receita, saldo ou ativação', () => {
  const voided = payment('voided-p2', 1000, 2, {
    status: 'voided',
    voidedAt: '2026-07-24T13:00:00.000Z',
    voidedBy: 'Profissional Fictício',
    voidReason: 'Cancelado para teste',
  });
  assert.equal(packagePayments.getActivatedPackageNumber([voided], {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }), 1);
  const summarize = requireFunction(packagePayments, 'getPackagePaymentSummary');
  assert.equal(summarize([voided], 2, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }).paidAmount, 0);
});

test('20. pagamentos legados sem packageNumber mantêm fallback acumulado', () => {
  const summarize = requireFunction(packagePayments, 'getPackagePaymentSummary');
  const legacy = [payment('legacy-1', 1000), payment('legacy-2', 500)];
  assert.equal(packagePayments.getActivatedPackageNumber(legacy, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }), 2);
  assert.equal(summarize(legacy, 2, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }).paidAmount, 500);
});

test('21. pagamento com packageNumber explícito nunca usa fallback acumulado', () => {
  const summarize = requireFunction(packagePayments, 'getPackagePaymentSummary');
  const explicit = [payment('explicit-p1-a', 1000, 1), payment('explicit-p1-b', 500, 1)];
  assert.equal(summarize(explicit, 2, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }).paidAmount, 0);
});

test('22. pacientes e pacotes distintos não misturam pagamentos', () => {
  const summarize = requireFunction(packagePayments, 'getPackagePaymentSummary');
  const mixed = [
    payment('patient-a-package-1', 500, 1),
    { ...payment('patient-b-package-2', 1000, 2), patientId: 'different-patient' },
  ];
  assert.equal(summarize(mixed, 1, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }).paidAmount, 500);
  assert.equal(summarize(mixed, 2, {
    patientId: PATIENT.id,
    throughDate: TODAY,
  }).paidAmount, 0);
});

test('23. reload preserva idempotência, cancelamento e resultado', () => {
  const create = requireFunction(operationsModule, 'preparePaymentCreation');
  const cancel = requireFunction(operationsModule, 'preparePaymentVoid');
  const created = create(creationInput());
  const canceled = cancel({
    payments: created.payments,
    expenses: created.expenses,
    paymentId: created.payment.id,
    reason: 'Correção fictícia persistida',
    actor: 'Profissional Fictício',
    now: '2026-07-24T13:00:00.000Z',
  });
  const reloadedPayments = JSON.parse(JSON.stringify(canceled.payments));
  const reloadedExpenses = JSON.parse(JSON.stringify(canceled.expenses));
  assert.equal(reloadedPayments[0].status, 'voided');
  assert.equal(reloadedExpenses[0].status, 'voided');
  const retry = create({
    ...creationInput(),
    payments: reloadedPayments,
    expenses: reloadedExpenses,
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.payments.length, 1);
});

test('24. nenhuma operação financeira depende da montagem de Finance.tsx', () => {
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(finance, /Sincronização, Limpeza e Blindagem|syncLock/);
  const prepare = requireFunction(operationsModule, 'preparePaymentCreation');
  const result = prepare(creationInput());
  assert.equal(result.expenses.some(item => item.pagamento_origem_id === result.payment.id), true);
});
