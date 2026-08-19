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

function patient(id = 'patient-r3', snapshots = [], paymentModal = 'PADRÃO: Pix integral') {
  return {
    id,
    name: 'Paciente sintético R3',
    status: 'Ativo',
    startDate: '2026-01-01',
    paymentModal,
    packageContracts: snapshots,
  };
}

function snapshot(packageNumber, value) {
  return {
    packageNumber,
    packageContractValue: value,
    source: PACKAGE_CONTRACT_SOURCE.EXPLICIT,
    createdAt: `2026-08-${String(packageNumber).padStart(2, '0')}T10:00:00.000Z`,
  };
}

function payment(id, amount, packageNumber, patientId = 'patient-r3', overrides = {}) {
  return {
    id,
    patientId,
    amount,
    packageNumber,
    date: '2026-08-01',
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
      method: overrides.method || 'Pix',
    },
    operationKey: overrides.operationKey || `operation-${targetPatient.id}-${amount}-${payments.length}`,
    actor: 'Profissional sintético',
    now: `${TODAY}T12:00:00.000Z`,
  });
}

test('R3-A/B/C: 850 integral, 900 com 500 e 1200 com 500+400 calculam saldo por snapshot', () => {
  const p850 = patient('p850', [snapshot(1, 850)]);
  const p900 = patient('p900', [snapshot(1, 900)]);
  const p1200 = patient('p1200', [snapshot(1, 1200)]);
  const s850 = summaryFor(p850, [payment('p850-1', 850, 1, 'p850')]);
  const s900 = summaryFor(p900, [payment('p900-1', 500, 1, 'p900')]);
  const s1200 = summaryFor(p1200, [
    payment('p1200-1', 500, 1, 'p1200'),
    payment('p1200-2', 400, 1, 'p1200'),
  ]);

  assert.deepEqual(
    [s850.contractValue, s850.paidGross, s850.pendingGross],
    [850, 850, 0],
  );
  assert.deepEqual(
    [s900.contractValue, s900.paidGross, s900.pendingGross],
    [900, 500, 400],
  );
  assert.deepEqual(
    [s1200.contractValue, s1200.paidGross, s1200.pendingGross],
    [1200, 900, 300],
  );
});

test('R3-D: novo snapshot não altera os valores dos pacotes anteriores', () => {
  const original = patient('history', [snapshot(1, 900), snapshot(2, 900), snapshot(3, 1000)]);
  const updated = upsertPackageContractSnapshot(original, {
    packageNumber: 4,
    packageContractValue: 1100,
    createdAt: `${TODAY}T12:00:00.000Z`,
  });
  assert.equal(original.packageContracts.length, 3);
  assert.deepEqual(
    updated.packageContracts.map(item => [item.packageNumber, item.packageContractValue]),
    [[1, 900], [2, 900], [3, 1000], [4, 1100]],
  );
  const resolver = packageNumber => resolvePackageContract(updated, packageNumber).contractValue;
  assert.equal(getPackagePaymentSummary([payment('history-1', 900, 1, 'history')], 1, { packageValueResolver: resolver }).pendingAmount, 0);
  assert.equal(getPackagePaymentSummary([], 3, { packageValueResolver: resolver }).packageValue, 1000);
  assert.equal(getPackagePaymentSummary([], 4, { packageValueResolver: resolver }).packageValue, 1100);
});

test('R3-E: parcelamento deriva metade do snapshot e aceita lançamento manual positivo', () => {
  const p900 = patient('parcel-900', [snapshot(1, 900)], 'ALTERNATIVA: Parcelado');
  const first900 = prepare(p900, 450, [], { installment: '1ª parcela', operationKey: 'parcel-900-1' });
  const second900 = prepare(p900, 450, first900.payments, { installment: '2ª parcela', operationKey: 'parcel-900-2' });
  const p1200 = patient('parcel-1200', [snapshot(1, 1200)], 'ALTERNATIVA: Parcelado');
  const first1200 = prepare(p1200, 600, [], { installment: '1ª parcela', operationKey: 'parcel-1200-1' });

  assert.equal(first900.payment.amount, 450);
  assert.equal(second900.payment.amount, 450);
  assert.equal(first1200.payment.amount, 600);
  assert.equal(summaryFor(p900, second900.payments).pendingGross, 0);
  assert.equal(summaryFor(p1200, first1200.payments).pendingGross, 600);
});

test('R3-F/G: integral explícito e legado sem snapshot', () => {
  const p850 = patient('integral-850', [snapshot(1, 850)]);
  const p1200 = patient('integral-1200', [snapshot(1, 1200)]);
  assert.equal(prepare(p850, 850, [], { operationKey: 'integral-850' }).payment.amount, 850);
  assert.equal(prepare(p1200, 1200, [], { operationKey: 'integral-1200' }).payment.amount, 1200);

  const legacy = patient('legacy', []);
  const resolved = resolvePackageContract(legacy, 1);
  assert.equal(resolved.source, PACKAGE_CONTRACT_SOURCE.LEGACY_FALLBACK);
  assert.equal(resolved.contractValue, LEGACY_PACKAGE_CONTRACT_VALUE);
  assert.equal(legacy.packageContracts.length, 0);
  assert.equal(summaryFor(legacy, [payment('legacy-1', 500, 1, 'legacy')]).contractSource, 'legacy_fallback');
});

test('R3-H: entradas inválidas, saldo excedente, idempotência e void preservam a operação', () => {
  assert.equal(normalizePackageContractValue(0), 0);
  assert.equal(normalizePackageContractValue(-1), 0);
  assert.equal(normalizePackageContractValue(Number.NaN), 0);
  assert.equal(normalizePackageContractValue(Number.POSITIVE_INFINITY), 0);

  const target = patient('operations', [snapshot(1, 900)]);
  assert.throws(() => prepare(target, Number.NaN, [], { operationKey: 'invalid-nan' }), /finito/i);
  assert.throws(() => prepare(target, -1, [], { operationKey: 'invalid-negative' }), /maior que zero/i);
  assert.throws(() => prepare(target, 901, [], { operationKey: 'overbalance' }), /saldo pendente/i);

  const created = prepare(target, 500, [], { operationKey: 'same-operation' });
  const repeated = prepare(target, 500, created.payments, { operationKey: 'same-operation' });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.payments.length, 1);
  const voided = preparePaymentVoid({
    payments: created.payments,
    expenses: created.expenses,
    paymentId: created.payment.id,
    reason: 'Correção sintética',
    actor: 'Profissional sintético',
    now: `${TODAY}T13:00:00.000Z`,
  });
  assert.equal(voided.payment.status, 'voided');
  assert.equal(voided.expenses[0].status, 'voided');
});

test('R3-I/J: consumidores usam resumo compartilhado e Portal preserva o cálculo sem expor o contrato', () => {
  const finance = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
  const patients = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const dashboard = fs.readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  const portal = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.match(finance, /resolvePatientPackageContract/);
  assert.match(patients, /setPatientPackageContract/);
  assert.match(dashboard, /financialSummary\.contractValue/);
  assert.match(reports, /calculatePackageFinancialSummary/);
  assert.doesNotMatch(portal, /selectedPackage\.(contractValue|contractSource)/);
  assert.doesNotMatch(portal, /Contratado:/);

  const portalPatient = patient('portal-variable', [snapshot(1, 900), snapshot(2, 1200)]);
  const sessions = Array.from({ length: 11 }, (_, index) => ({
    id: `session-${index + 1}`,
    patientId: 'portal-variable',
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    time: '10:00',
    status: 'Realizada',
  }));
  const result = buildResponsiblePackages(sessions, {
    today: TODAY,
    patient: portalPatient,
    payments: [payment('portal-1', 900, 1, 'portal-variable'), payment('portal-2', 600, 2, 'portal-variable')],
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
