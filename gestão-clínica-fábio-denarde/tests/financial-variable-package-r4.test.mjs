import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LEGACY_PACKAGE_CONTRACT_VALUE,
  PACKAGE_CONTRACT_SOURCE,
  normalizePackageContractValue,
  resolvePackageContract,
  upsertPackageContractSnapshot,
} from '../shared/packageContract.js';
import { getPackagePaymentSummary } from '../shared/packagePayments.js';
import { calculateCanonicalPackageFinancialSummary } from '../shared/packageFinancialSummary.js';
import { preparePaymentCreation, preparePaymentVoid } from '../shared/paymentOperations.js';
import { buildResponsiblePackages } from '../api/_lib/responsiblePortalPackages.js';

const TODAY = '2026-08-18';

function patient(id, snapshots = [], paymentModal = 'PADRÃO: Pix integral') {
  return {
    id,
    name: `Paciente sintético ${id}`,
    status: 'Ativo',
    startDate: '2026-01-01',
    paymentModal,
    packageContracts: snapshots,
  };
}

function snapshot(packageNumber, value, overrides = {}) {
  return {
    packageNumber,
    packageContractValue: value,
    source: PACKAGE_CONTRACT_SOURCE.EXPLICIT,
    createdAt: `2026-08-${String(packageNumber).padStart(2, '0')}T10:00:00.000Z`,
    ...overrides,
  };
}

function payment(id, amount, packageNumber, patientId, overrides = {}) {
  return {
    id,
    patientId,
    amount,
    packageNumber,
    date: TODAY,
    installment: 'Pagamento integral',
    method: 'Pix',
    status: 'active',
    ...overrides,
  };
}

function summaryFor(targetPatient, payments) {
  return calculateCanonicalPackageFinancialSummary({
    patient: targetPatient,
    sessions: [],
    payments,
    today: TODAY,
  });
}

function prepare(targetPatient, amount, payments = [], overrides = {}) {
  return preparePaymentCreation({
    patient: targetPatient,
    payments,
    expenses: [],
    sessions: [],
    input: {
      patientId: targetPatient.id,
      amount,
      packageNumber: overrides.packageNumber || 1,
      date: TODAY,
      installment: overrides.installment || 'Pagamento integral',
      method: 'Pix',
    },
    operationKey: overrides.operationKey || `${targetPatient.id}-${amount}-${payments.length}`,
    actor: 'Profissional sintético',
    now: `${TODAY}T12:00:00.000Z`,
  });
}

test('R4-A: valores explícitos de 850, 900 e 1200 fecham o saldo por pacote', () => {
  const p850 = patient('p850', [snapshot(1, 850)]);
  const p900 = patient('p900', [snapshot(1, 900)]);
  const p1200 = patient('p1200', [snapshot(1, 1200)]);

  const s850 = summaryFor(p850, [payment('p850-1', 850, 1, p850.id)]);
  const s900 = summaryFor(p900, [payment('p900-1', 500, 1, p900.id)]);
  const s1200 = summaryFor(p1200, [
    payment('p1200-1', 500, 1, p1200.id),
    payment('p1200-2', 400, 1, p1200.id),
  ]);

  assert.deepEqual([s850.contractValue, s850.paidGross, s850.pendingGross], [850, 850, 0]);
  assert.deepEqual([s900.contractValue, s900.paidGross, s900.pendingGross], [900, 500, 400]);
  assert.deepEqual([s1200.contractValue, s1200.paidGross, s1200.pendingGross], [1200, 900, 300]);
});

test('R4-B: pacote novo e pacote legado usado podem receber definição administrativa sem reescrever pagamentos', () => {
  const original = patient('legacy-definition', [snapshot(1, 850)]);
  const originalPayments = [payment('legacy-definition-2', 500, 2, original.id)];
  const before = structuredClone(originalPayments);
  const updated = upsertPackageContractSnapshot(original, {
    packageNumber: 2,
    packageContractValue: 900,
    receivedAmount: 500,
    updatedAt: `${TODAY}T13:00:00.000Z`,
    updatedBy: 'Admin sintético',
  });

  assert.deepEqual(original.packageContracts, [snapshot(1, 850)]);
  assert.deepEqual(originalPayments, before);
  assert.equal(resolvePackageContract(original, 2).source, 'legacy_fallback');
  assert.deepEqual(updated.packageContracts.map(item => [item.packageNumber, item.packageContractValue]), [[1, 850], [2, 900]]);
  assert.deepEqual(
    [summaryFor(updated, originalPayments).contractValue, summaryFor(updated, originalPayments).paidGross, summaryFor(updated, originalPayments).pendingGross],
    [900, 500, 400],
  );
  assert.equal(original.packageContracts.some(item => item.packageNumber === 2), false);
});

test('R4-C: definição 900 com 900 recebido fecha; definição 1200 com 800 mantém 400 pendente', () => {
  const paid900 = patient('paid-900');
  const paid900Updated = upsertPackageContractSnapshot(paid900, {
    packageNumber: 1,
    packageContractValue: 900,
    receivedAmount: 900,
  });
  const paid1200 = patient('paid-800');
  const paid1200Updated = upsertPackageContractSnapshot(paid1200, {
    packageNumber: 1,
    packageContractValue: 1200,
    receivedAmount: 800,
  });

  assert.equal(summaryFor(paid900Updated, [payment('paid-900-1', 900, 1, paid900.id)]).pendingGross, 0);
  assert.equal(summaryFor(paid1200Updated, [payment('paid-800-1', 800, 1, paid1200.id)]).pendingGross, 400);
});

test('R4-D: correção preserva criação/origem, registra atualização e não altera outro pacote', () => {
  const original = patient('correction', [
    snapshot(1, 900, { createdBy: 'Cadastro original' }),
    snapshot(2, 1100),
  ]);
  const updated = upsertPackageContractSnapshot(original, {
    packageNumber: 1,
    packageContractValue: 950,
    receivedAmount: 900,
    updatedAt: `${TODAY}T14:00:00.000Z`,
    updatedBy: 'Admin sintético',
  });
  const corrected = updated.packageContracts.find(item => item.packageNumber === 1);
  const untouched = updated.packageContracts.find(item => item.packageNumber === 2);

  assert.equal(corrected.packageContractValue, 950);
  assert.equal(corrected.source, 'explicit');
  assert.equal(corrected.createdAt, '2026-08-01T10:00:00.000Z');
  assert.equal(corrected.createdBy, 'Cadastro original');
  assert.equal(corrected.updatedAt, `${TODAY}T14:00:00.000Z`);
  assert.equal(corrected.updatedBy, 'Admin sintético');
  assert.deepEqual(untouched, snapshot(2, 1100));
});

test('R4-E: guarda impede valor abaixo do recebido e entradas inválidas sem mutação', () => {
  const original = patient('guard', [snapshot(1, 1000)]);
  const before = structuredClone(original);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizePackageContractValue(invalid), 0);
    assert.throws(() => upsertPackageContractSnapshot(original, { packageNumber: 1, packageContractValue: invalid }), /finito|maior que zero/i);
  }
  assert.equal(normalizePackageContractValue(899.99), 899.99);
  assert.throws(
    () => upsertPackageContractSnapshot(original, { packageNumber: 1, packageContractValue: 850, receivedAmount: 900 }),
    /não pode ser menor.*900\.00/i,
  );
  assert.deepEqual(original, before);
});

test('R4-F: contratos independentes mantêm limite de parcelas, idempotência e void', () => {
  const p900 = patient('parcel-900', [snapshot(1, 900)], 'ALTERNATIVA: Parcelado');
  const p1200 = patient('parcel-1200', [snapshot(1, 1200)], 'ALTERNATIVA: Parcelado');
  const first900 = prepare(p900, 450, [], { installment: '1ª parcela', operationKey: 'parcel-900-1' });
  const second900 = prepare(p900, 450, first900.payments, { installment: '2ª parcela', operationKey: 'parcel-900-2' });
  const first1200 = prepare(p1200, 600, [], { installment: '1ª parcela', operationKey: 'parcel-1200-1' });
  const repeated = prepare(p900, 450, second900.payments, { operationKey: 'parcel-900-2' });

  assert.deepEqual([first900.payment.amount, second900.payment.amount, first1200.payment.amount], [450, 450, 600]);
  assert.equal(summaryFor(p900, second900.payments).pendingGross, 0);
  assert.equal(repeated.idempotent, true);
  const voided = preparePaymentVoid({
    payments: second900.payments,
    expenses: second900.expenses,
    paymentId: second900.payment.id,
    reason: 'Correção sintética',
    actor: 'Profissional sintético',
    now: `${TODAY}T15:00:00.000Z`,
  });
  assert.equal(voided.payment.status, 'voided');
  assert.equal(voided.expenses.at(-1).status, 'voided');
});

test('R4-G: fallback legado não persiste sozinho e Portal não expõe contrato financeiro', () => {
  const legacy = patient('legacy-fallback');
  const resolved = resolvePackageContract(legacy, 1);
  assert.equal(resolved.source, PACKAGE_CONTRACT_SOURCE.LEGACY_FALLBACK);
  assert.equal(resolved.contractValue, LEGACY_PACKAGE_CONTRACT_VALUE);
  assert.deepEqual(legacy.packageContracts, []);
  assert.equal(getPackagePaymentSummary([payment('legacy-fallback-1', 500, 1, legacy.id)], 1, {
    packageValueResolver: number => resolvePackageContract(legacy, number).contractValue,
  }).pendingAmount, 500);

  const portalPatient = patient('portal-r4', [snapshot(1, 900), snapshot(2, 1200)]);
  const sessions = Array.from({ length: 11 }, (_, index) => ({
    id: `portal-r4-session-${index + 1}`,
    patientId: portalPatient.id,
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    time: '10:00',
    status: 'Realizada',
  }));
  const result = buildResponsiblePackages(sessions, {
    today: TODAY,
    patient: portalPatient,
    payments: [payment('portal-r4-1', 900, 1, portalPatient.id), payment('portal-r4-2', 600, 2, portalPatient.id)],
  });
  const packageOne = result.packages.find(pkg => pkg.number === 1);
  const packageTwo = result.packages.find(pkg => pkg.number === 2);
  assert.equal(Object.hasOwn(packageOne, 'contractValue'), false);
  assert.equal(Object.hasOwn(packageOne, 'contractSource'), false);
  assert.equal(Object.hasOwn(packageTwo, 'contractValue'), false);
  assert.equal(Object.hasOwn(packageTwo, 'contractSource'), false);
  assert.deepEqual(
    [resolvePackageContract(portalPatient, 1).contractValue, resolvePackageContract(portalPatient, 2).contractValue],
    [900, 1200],
  );
});

test('R4-H: Financeiro e Atendentes oferecem definição/correção administrativa separada', () => {
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  const patients = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/components/Common/PackageContractEditor.tsx', import.meta.url), 'utf8');
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  assert.match(finance, /PackageContractEditor/);
  assert.match(finance, /Definir valor contratado/);
  assert.match(finance, /Alterar valor contratado/);
  assert.match(patients, /PackageContractEditor/);
  assert.match(patients, /setPackageContractEditorOpen/);
  assert.match(editor, /window\.confirm/);
  assert.match(editor, /pagamentos existentes/);
  assert.match(reports, /calculatePackageFinancialSummary/);
});
