import test from 'node:test';
import assert from 'node:assert/strict';
import { listPatientPackages, preparePatientPackageCreation, preparePatientPaymentLink } from '../shared/patientPackageOperations.js';
import { preparePaymentCreation } from '../shared/paymentOperations.js';
import { getActivatedPackageNumber, getPackagePaymentSummary } from '../shared/packagePayments.js';
import { calculatePackageFinancialSummary, SESSIONS_PER_PACKAGE } from '../src/lib/financePackages.ts';
import { sessionConsumesPackage } from '../shared/sessionScheduling.js';
const now = '2026-09-30T16:00:00Z';
const patient = { id: 'fixture-patient', name: 'Paciente fictício', status: 'Ativo', paymentModal: 'PADRÃO: Pix integral', startDate: '2026-01-01' };
const create = (p = patient, extra = {}) => preparePatientPackageCreation({ patient: p, operationKey: 'fixture-package', actor: 'Equipe fictícia', contractValue: 1000, startDate: '2026-09-30', now, ...extra });
const receipt = (p = patient, extra = {}) => preparePaymentCreation({ patient: p, operationKey: 'fixture-receipt', actor: 'Equipe fictícia', now, input: { patientId: p.id, amount: 1000, date: '2026-09-30', method: 'Pix', installment: 'Pagamento integral', packageLinkStatus: 'unlinked' }, ...extra });
const link = (p, r, extra = {}) => preparePatientPaymentLink({ patient: p, payments: r.payments, expenses: r.expenses, paymentId: r.payment.id, packageNumber: 1, operationKey: 'fixture-link', actor: 'Equipe fictícia', now, ...extra });

test('pacote primeiro é ativo sem pagamento e registra sempre dez ocorrências', () => {
  for (const doubleSession of [false, true]) {
    const result = create({ ...patient, doubleSession });
    assert.equal(result.record.sessionCount, SESSIONS_PER_PACKAGE);
    assert.equal(result.record.sessionCount, 10);
    const summary = calculatePackageFinancialSummary(result.patient, [], [], new Date(now));
    assert.equal(summary.hasCurrentPackage, true); assert.equal(summary.pendingGross, 1000);
    const p = listPatientPackages({ patient: result.patient })[0];
    assert.equal(p.label, 'Pacote ativo • Pagamento pendente'); assert.equal(p.used, 0); assert.equal(p.remaining, 10);
  }
});

test('pagamento primeiro permanece receita sem pacote, sem ativação ou alocação silenciosa', () => {
  const result = receipt();
  assert.equal(result.payment.packageLinkStatus, 'unlinked'); assert.equal(result.payment.packageNumber, undefined);
  assert.equal(listPatientPackages({ patient, payments: result.payments }).length, 0);
  assert.equal(getActivatedPackageNumber(result.payments, { patientId: patient.id, allowLegacyFirstPackage: false }), 0);
  assert.equal(getPackagePaymentSummary(result.payments, 1).paidAmount, 0);
  assert.equal(result.expense.pagamento_origem_id, result.payment.id); assert.equal(result.expense.amount, 200);
});

test('pacote → pagamento → vínculo preserva IDs e somente o vínculo modifica a alocação', () => {
  const p = create().patient, r = receipt(p), result = link(p, r);
  assert.equal(result.payment.id, r.payment.id); assert.equal(result.payments.length, 1);
  for (const field of ['amount', 'date', 'method', 'operationKey', 'createdAt', 'createdBy']) assert.equal(result.payment[field], r.payment[field]);
  assert.equal(getPackagePaymentSummary(result.payments, 1).paidAmount, 1000);
  assert.equal(listPatientPackages({ patient: p, payments: result.payments })[0].label, 'Pacote ativo • Pago');
  assert.equal(p.packageRecords[0].id, 'package-fixture-package');
  assert.equal(r.expenses.length, 1); assert.equal(result.payment.packageLinkHistory.length, 1);
});

test('pagamento → pacote → vínculo funciona sem recriar nenhum registro', () => {
  const r = receipt(), p = create(patient, { payments: r.payments }).patient;
  const result = link(p, r);
  assert.equal(result.payment.id, r.payment.id); assert.equal(p.packageRecords.length, 1); assert.equal(result.payment.packageNumber, 1);
});

test('recusar vínculo deixa pacote pendente e pagamento sem vínculo', () => {
  const r = receipt(), p = create(patient, { payments: r.payments }).patient;
  assert.equal(r.payment.packageLinkStatus, 'unlinked');
  assert.equal(listPatientPackages({ patient: p, payments: r.payments })[0].pendingAmount, 1000);
});

test('registrar diretamente com vínculo explícito usa o validador financeiro canônico', () => {
  const p = create().patient;
  const r = receipt(p, { input: { patientId: p.id, packageNumber: 1, amount: 1000, date: '2026-09-30', method: 'Pix', installment: 'Pagamento integral' } });
  assert.equal(getPackagePaymentSummary(r.payments, 1).isPaid, true);
});

test('retry da criação e do vínculo é idempotente', () => {
  const created = create(), r = receipt(created.patient), linked = link(created.patient, r);
  assert.equal(create(created.patient).idempotent, true);
  assert.equal(create(created.patient).patient, created.patient);
  assert.equal(receipt(created.patient, { payments: r.payments, expenses: r.expenses }).idempotent, true);
  const repeated = link(created.patient, { ...r, payments: linked.payments });
  assert.equal(repeated.idempotent, true); assert.equal(repeated.payments, linked.payments); assert.equal(repeated.payment.packageLinkHistory.length, 1);
});

test('múltiplos candidatos exigem seleção explícita; não há heurística por data ou valor', () => {
  const p = create().patient;
  const a = receipt(p), b = receipt(p, { operationKey: 'fixture-second-receipt', input: { patientId: p.id, amount: 500, date: '2026-09-29', method: 'Pix', installment: 'Pagamento integral', packageLinkStatus: 'unlinked' }, payments: a.payments, expenses: a.expenses });
  assert.throws(() => link(p, b, { paymentId: '', packageNumber: undefined }), /Escolha|Selecione/);
  const selected = link(p, b, { paymentId: b.payment.id });
  assert.equal(selected.payments[0], a.payment); assert.equal(selected.payments[1].packageNumber, 1);
});

test('vínculo inválido ou acima do saldo não altera pacote, pagamento ou repasse', () => {
  const p = create().patient, r = receipt(p, { input: { patientId: p.id, amount: 1001, date: '2026-09-30', method: 'Pix', installment: 'Pagamento integral', packageLinkStatus: 'unlinked' } });
  const before = JSON.stringify({ p, r });
  assert.throws(() => link(p, r), /ultrapassa/); assert.throws(() => link(p, r, { packageNumber: 99 }), /pacote existente/);
  assert.equal(JSON.stringify({ p, r }), before);
});

test('recibo de outro paciente, cancelado e vínculo já existente falham fechados', () => {
  const p = create().patient, r = receipt(p), done = link(p, r);
  assert.throws(() => link({ ...p, id: 'fixture-other' }, r), /paciente/);
  assert.throws(() => link(p, { ...r, payments: [{ ...r.payment, status: 'voided' }] }), /ativo/);
  assert.throws(() => link(p, { ...r, payments: done.payments }, { operationKey: 'fixture-other-link' }), /já possui vínculo/);
});

test('renovação preserva histórico e não duplica sessões, contratos, pagamento ou IDs', () => {
  const first = create(), r = receipt(first.patient), linked = link(first.patient, r);
  const sessions = Array.from({ length: 10 }, (_, n) => ({ id: 'fixture-session-' + n, patientId: patient.id, date: '2026-09-' + String(n + 1).padStart(2, '0'), time: '15:00', status: 'Realizada', type: 'Sessão dupla (2 × 50 min)' }));
  const second = create(first.patient, { operationKey: 'fixture-package-next', sessions, payments: linked.payments });
  assert.equal(second.record.packageNumber, 2); assert.equal(second.patient.packageRecords[0], first.record); assert.equal(second.patient.packageContracts[0].packageNumber, 1); assert.equal(sessions.length, 10);
  const candidates = listPatientPackages({ patient: second.patient, sessions, payments: linked.payments });
  assert.equal(candidates.length, 2); assert.equal(candidates[0].used, 10); assert.equal(candidates[1].used, 0);
  assert.throws(() => create(second.patient, { operationKey: 'fixture-too-early', sessions, payments: linked.payments }), /ainda possui sessões/);
});

test('ausência contabilizada e não contabilizada mantêm consumo canônico', () => {
  const p = create().patient;
  const absence = { id: 'fixture-absence', patientId: p.id, date: '2026-09-01', time: '15:00', status: 'late_cancellation_no_replacement', noReplacementReasonCode: 'outro', noReplacementObservation: 'Observação fictícia' };
  assert.equal(sessionConsumesPackage({ ...absence, consumesPackage: true }), true);
  assert.equal(sessionConsumesPackage({ ...absence, consumesPackage: false }), false);
  const result = listPatientPackages({ patient: p, sessions: [{ ...absence, consumesPackage: true }, { ...absence, id: 'fixture-not-counted', consumesPackage: false }] });
  assert.equal(result[0].used, 1); assert.equal(result[0].remaining, 9);
});

test('pagamentos legados sem metadata continuam alocados exatamente como antes', () => {
  const legacy = [{ id: 'fixture-legacy', patientId: patient.id, amount: 500, date: '2026-09-01' }];
  assert.equal(getPackagePaymentSummary(legacy, 1).paidAmount, 500);
  assert.equal(getActivatedPackageNumber(legacy, { allowLegacyFirstPackage: false }), 1);
});


test('múltiplos pacotes continuam exigindo o número explícito escolhido', () => {
  const first = create(), paid = receipt(first.patient), done = link(first.patient, paid);
  const sessions = Array.from({ length: 10 }, (_, n) => ({ id: 'fixture-old-' + n, patientId: patient.id, date: '2026-09-' + String(n + 1).padStart(2, '0'), status: 'Realizada', time: '15:00' }));
  const next = create(first.patient, { operationKey: 'fixture-next', sessions, payments: done.payments }).patient;
  const r = receipt(next, { operationKey: 'fixture-new-payment', payments: done.payments, expenses: paid.expenses });
  const args = { patient: next, sessions, payments: r.payments, expenses: r.expenses, paymentId: r.payment.id, operationKey: 'fixture-next-link', actor: 'Equipe fictícia', now };
  assert.throws(() => preparePatientPaymentLink(args), /Selecione explicitamente/);
  const selected = preparePatientPaymentLink({ ...args, packageNumber: 2 });
  assert.equal(selected.payment.packageNumber, 2); assert.equal(selected.payments[0].packageNumber, 1); assert.equal(next.packageRecords.length, 2);
});

test('datas inválidas, valores inválidos e operação de outro paciente falham sem gravar', () => {
  for (const date of ['2026-02-31', '0000', '2026-10-10']) assert.throws(() => receipt(patient, { input: { patientId: patient.id, date, amount: 100, method: 'Pix', installment: 'Pagamento integral', packageLinkStatus: 'unlinked' } }), /data|Data/);
  for (const amount of [0, -1, Infinity, NaN]) assert.throws(() => receipt(patient, { input: { patientId: patient.id, date: '2026-09-30', amount, method: 'Pix', installment: 'Pagamento integral', packageLinkStatus: 'unlinked' } }), /valor|Valor/);
  const r = receipt(); assert.throws(() => receipt({ ...patient, id: 'fixture-other' }, { payments: r.payments }), /outro paciente/);
});
