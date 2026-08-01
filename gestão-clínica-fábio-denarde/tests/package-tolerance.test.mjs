import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closePackageToleranceAfterPayment,
  grantPackageTolerance,
  resolvePackageTolerance,
  resolvePackageToleranceOffer,
} from '../shared/packageTolerance.js';
import { buildActivityMediaPackageModel } from '../shared/activityMediaPackages.js';
import { calculateCanonicalPackageFinancialSummary } from '../shared/packageFinancialSummary.js';
import { preparePaymentCreation } from '../shared/paymentOperations.js';

const patientBase = {
  id: 'patient-1',
  name: 'Atendente',
  guardianName: 'Responsável',
  paymentModal: 'PADRÃO: Pix integral — R$1.000 antes da 1ª sessão',
  startDate: '2026-01-01',
  status: 'Ativo',
};

function payment(packageNumber) {
  return {
    id: `payment-${packageNumber}`,
    patientId: patientBase.id,
    packageNumber,
    amount: 1000,
    date: '2026-07-01',
    installment: 'Pagamento integral',
    method: 'Pix',
    status: 'active',
  };
}

function sessions(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${String(index + 1).padStart(2, '0')}`,
    patientId: patientBase.id,
    date: `2026-07-${String(Math.min(index + 1, 28)).padStart(2, '0')}`,
    time: index % 2 === 0 ? '14:00' : '15:00',
    type: 'Sessão simples (50 min)',
    status: 'Realizada',
    packageNumber: null,
  }));
}

function grant(patient, packageNumber, overrides = {}) {
  return grantPackageTolerance(patient, {
    packageNumber,
    reasonCode: 'requested_days',
    promisedPaymentDate: '2026-08-05',
    expiresAt: '2026-08-05',
    maxSessions: 2,
    actor: 'Fábio',
    now: new Date('2026-07-31T12:00:00-03:00'),
    ...overrides,
  });
}

test('liberação temporária preserva pagamento pendente e aplica prazo e limite explícitos', () => {
  const patient = grant(patientBase, 2);
  const resolution = resolvePackageTolerance({
    patient,
    sessions: sessions(11),
    payments: [payment(1)],
    packageNumber: 2,
    now: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(resolution.status, 'active');
  assert.equal(resolution.sessionsUsed, 1);
  assert.equal(resolution.remainingSessions, 1);
  assert.equal(resolution.record.maxSessions, 2);
});

test('limite de sessões vence a tolerância sem apagar o histórico', () => {
  const patient = grant(patientBase, 2);
  const resolution = resolvePackageTolerance({
    patient,
    sessions: sessions(12),
    payments: [payment(1)],
    packageNumber: 2,
    now: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(resolution.status, 'limit_reached');
  assert.equal(resolution.keepsHistoricalAccess, true);
  assert.equal(resolution.remainingSessions, 0);
});

test('prazo vencido mantém acesso histórico e bloqueia nova autorização operacional', () => {
  const patient = grant(patientBase, 2, { promisedPaymentDate: '2026-08-01', expiresAt: '2026-08-01' });
  const resolution = resolvePackageTolerance({
    patient,
    sessions: sessions(11),
    payments: [payment(1)],
    packageNumber: 2,
    now: new Date('2026-08-02T12:00:00-03:00'),
  });
  assert.equal(resolution.status, 'expired');
  assert.equal(resolution.canReceiveNewSessions, false);
  assert.equal(resolution.keepsHistoricalAccess, true);
});

test('galeria libera o pacote em tolerância sem transformar tolerância em pagamento', () => {
  const patient = grant(patientBase, 2);
  const model = buildActivityMediaPackageModel(sessions(11), {
    patientId: patient.id,
    payments: [payment(1)],
    packageTolerances: patient.packageTolerances,
    now: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(model.activatedPackageNumber, 1);
  assert.equal(model.temporarilyAuthorizedPackageNumber, 2);
  assert.equal(model.currentPackageNumber, 2);
  assert.equal(model.awaitingPaymentSessions.length, 0);
});

test('financeiro distingue EM TOLERÂNCIA de receita recebida', () => {
  const patient = grant(patientBase, 2);
  const summary = calculateCanonicalPackageFinancialSummary({
    patient,
    sessions: sessions(11),
    payments: [payment(1)],
    today: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(summary.packageNumber, 2);
  assert.equal(summary.status, 'EM TOLERÂNCIA');
  assert.equal(summary.paidGross, 0);
  assert.equal(summary.pendingGross, 1000);
});

test('sessões históricas completas permitem tolerância do pacote seguinte sem reabrir pacote antigo', () => {
  const legacyPatient = grant(patientBase, 4);
  const summary = calculateCanonicalPackageFinancialSummary({
    patient: legacyPatient,
    sessions: sessions(30),
    payments: [payment(1), payment(2)],
    today: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(summary.paidActivatedPackageNumber, 2);
  assert.equal(summary.nextPackageRequiringAuthorization, 4);
  assert.equal(summary.packageNumber, 4);
  assert.equal(summary.status, 'EM TOLERÂNCIA');
});

test('pagamento do pacote explicitamente tolerado é aceito e pode encerrar a tolerância', () => {
  const patient = grant(patientBase, 4);
  const prepared = preparePaymentCreation({
    patient,
    sessions: sessions(30),
    payments: [payment(1), payment(2)],
    expenses: [],
    input: {
      patientId: patient.id,
      packageNumber: 4,
      amount: 1000,
      date: '2026-08-01',
      installment: 'Pagamento integral',
      method: 'Pix',
    },
    operationKey: 'tolerance-payment-4',
    actor: 'Fábio',
    now: '2026-08-01T12:00:00-03:00',
  });
  assert.equal(prepared.payment.packageNumber, 4);
  const closed = closePackageToleranceAfterPayment(patient, {
    packageNumber: 4,
    actor: 'Fábio',
    now: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(closed.packageTolerances.at(-1).status, 'closed');
  assert.equal(closed.packageTolerances.at(-1).closeReason, 'payment_confirmed');
});


test('data prometida posterior ao prazo final é rejeitada sem alterar o atendente', () => {
  const patient = { ...patientBase };
  assert.throws(() => grantPackageTolerance(patient, {
    packageNumber: 2,
    reasonCode: 'requested_days',
    promisedPaymentDate: '2026-08-07',
    expiresAt: '2026-08-05',
    maxSessions: 2,
    actor: 'Fábio',
    now: new Date('2026-07-31T15:00:00-03:00'),
  }), /não pode ser posterior ao prazo final/);
  assert.equal(patient.packageTolerances, undefined);
});

test('pagamento futuro continua bloqueado sem tolerância explícita', () => {
  assert.throws(() => preparePaymentCreation({
    patient: patientBase,
    sessions: sessions(30),
    payments: [payment(1), payment(2)],
    expenses: [],
    input: {
      patientId: patientBase.id,
      packageNumber: 4,
      amount: 1000,
      date: '2026-08-01',
      installment: 'Pagamento integral',
      method: 'Pix',
    },
    operationKey: 'future-without-tolerance',
    actor: 'Fábio',
    now: '2026-08-01T12:00:00-03:00',
  }), /sem liberação temporária/);
});

test('pacote atual já iniciado sem qualquer pagamento oferece tolerância no próprio pacote', () => {
  const offer = resolvePackageToleranceOffer({
    hasCurrentPackage: true,
    packageNumber: 1,
    paidActivatedPackageNumber: 0,
    nextPackageRequiringAuthorization: 1,
    paidGross: 0,
    pendingGross: 1000,
    completedSessionsInCurrentPackage: 1,
    consumedSessionTotal: 1,
    hasNewPackageWithoutPayment: false,
    packageTolerance: null,
  });
  assert.equal(offer.canOffer, true);
  assert.equal(offer.targetPackageNumber, 1);
  assert.equal(offer.reason, 'current_package_unpaid');
});

test('pagamento parcial não é confundido automaticamente com tolerância por ausência total de pagamento', () => {
  const offer = resolvePackageToleranceOffer({
    hasCurrentPackage: true,
    packageNumber: 1,
    paidActivatedPackageNumber: 1,
    nextPackageRequiringAuthorization: 0,
    paidGross: 500,
    pendingGross: 500,
    completedSessionsInCurrentPackage: 1,
    consumedSessionTotal: 1,
    hasNewPackageWithoutPayment: false,
    packageTolerance: null,
  });
  assert.equal(offer.canOffer, false);
  assert.equal(offer.targetPackageNumber, 0);
});

test('tolerância do Pacote 1 sem pagamento real não é tratada como paga pelo fallback legado', () => {
  const patient = grant(patientBase, 1);
  const resolution = resolvePackageTolerance({
    patient,
    sessions: sessions(1),
    payments: [],
    packageNumber: 1,
    now: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(resolution.paidActivatedPackageNumber, 1);
  assert.equal(resolution.status, 'active');
  assert.equal(resolution.isPaid, false);
  assert.equal(resolution.sessionsUsed, 1);

  const summary = calculateCanonicalPackageFinancialSummary({
    patient,
    sessions: sessions(1),
    payments: [],
    today: new Date('2026-08-01T12:00:00-03:00'),
  });
  assert.equal(summary.packageNumber, 1);
  assert.equal(summary.status, 'EM TOLERÂNCIA');
  assert.equal(summary.paidGross, 0);
  assert.equal(summary.packageTolerance.status, 'active');

  const offer = resolvePackageToleranceOffer(summary);
  assert.equal(offer.reason, 'existing_tolerance');
  assert.equal(offer.targetPackageNumber, 1);
});
