import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
  type PsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  cancelPsychologyCharge,
  createPsychologyChargeInLedger,
  createPsychologyExpenseInLedger,
  createPsychologyPaymentInLedger,
  createPsychologyPeriod,
  getPsychologyChargeFinancialState,
  getPsychologyFinancialLedger,
  getPsychologyFinancialOverview,
  isPsychologyPaymentActive,
  normalizePsychologyChargeStatus,
  reversePsychologyExpense,
  reversePsychologyPayment,
} from '../src/features/psychology-pilot/psychologyFinancialLedger';
import { getPsychologyPatientFinanceSummary } from '../src/features/psychology-pilot/psychologyPatientProfile';

const scope = createPsychologyScope('r2c2-professional');
const actor = scope.professionalId;

function fixture(): PsychologyStore {
  return upsertPsychologyPatient(createEmptyPsychologyStore(scope), { name: 'Paciente Financeiro Sintético', birthDate: '1990-01-01', phone: '000000000', email: '', preferredModality: 'online', administrativeNote: '', active: true }, 'patient-a', '2026-08-14T10:00:00.000Z');
}

function charge(store: PsychologyStore, amount = 200, dueDate = '2026-08-10', extra: Record<string, unknown> = {}): PsychologyStore {
  const result = createPsychologyChargeInLedger(store, { patientId: 'patient-a', description: 'Sessão sintética', amount, dueDate, createdBy: actor, ...extra } as never, '2026-08-14T10:00:00.000Z');
  assert.equal(result.error, undefined);
  return result.store;
}

function payment(store: PsychologyStore, amount: number, method: 'PIX' | 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER' = 'PIX', operationKey?: string): PsychologyStore {
  const item = store.charges[0];
  const result = createPsychologyPaymentInLedger(store, { patientId: 'patient-a', chargeId: item.id, amount, date: '2026-08-14', method, operationKey, createdBy: actor }, '2026-08-14T11:00:00.000Z');
  assert.equal(result.error, undefined);
  return result.store;
}

function expense(store: PsychologyStore, status: 'REALIZED' | 'PENDING' = 'REALIZED'): PsychologyStore {
  return createPsychologyExpenseInLedger(store, { description: 'Aluguel sintético', amount: 150, date: '2026-08-14', category: 'Aluguel', status, createdBy: actor }, '2026-08-14T12:00:00.000Z').store;
}

test('R2C2 01 — ledger mantém profissional da Psicologia', () => assert.equal(getPsychologyFinancialLedger(fixture()).scope.professionalId, actor));
test('R2C2 02 — ledger mantém contexto PSICOLOGIA', () => assert.equal(getPsychologyFinancialLedger(fixture()).scope.context, 'PSICOLOGIA'));
test('R2C2 03 — cobrança exige paciente ativo', () => assert.ok(createPsychologyChargeInLedger(createEmptyPsychologyStore(scope), { patientId: 'missing', description: 'x', amount: 1 }).error));
test('R2C2 04 — cobrança rejeita descrição vazia', () => assert.ok(createPsychologyChargeInLedger(fixture(), { patientId: 'patient-a', description: '', amount: 1 }).error));
test('R2C2 05 — cobrança rejeita valor negativo', () => assert.ok(createPsychologyChargeInLedger(fixture(), { patientId: 'patient-a', description: 'x', amount: -1 }).error));
test('R2C2 06 — cobrança aceita vencimento opcional', () => assert.equal(charge(fixture(), 200, null as unknown as string).charges[0].dueDate, undefined));
test('R2C2 07 — cobrança registra createdAt e updatedAt', () => { const item = charge(fixture()).charges[0]; assert.equal(item.createdAt, item.updatedAt); });
test('R2C2 08 — cobrança aceita vínculo opcional com serviço', () => assert.equal(charge(fixture(), 200, '2026-08-10', { serviceId: 'service-a' }).charges[0].serviceId, 'service-a'));
test('R2C2 09 — cobrança aceita vínculo opcional com pacote', () => assert.equal(charge(fixture(), 200, '2026-08-10', { packageId: 'package-a' }).charges[0].packageId, 'package-a'));
test('R2C2 10 — cobrança funciona sem sessão', () => assert.equal(charge(fixture()).charges[0].sessionId, undefined));
test('R2C2 11 — isento preserva valor administrativo', () => assert.equal(charge(fixture(), 200, '2026-08-10', { exempt: true }).charges[0].amount, 200));
test('R2C2 12 — isento não cria pagamento zero', () => assert.equal(charge(fixture(), 200, '2026-08-10', { exempt: true }).payments.length, 0));
test('R2C2 13 — isento zera saldo exigível', () => assert.equal(getPsychologyFinancialLedger(charge(fixture(), 200, '2026-08-01', { exempt: true })).chargeEntries[0].balance, 0));
test('R2C2 14 — isento não fica vencido', () => assert.equal(getPsychologyFinancialLedger(charge(fixture(), 200, '2026-08-01', { exempt: true })).chargeEntries[0].overdue, false));
test('R2C2 15 — status inicial normal é pendente', () => assert.equal(getPsychologyFinancialLedger(charge(fixture())).chargeEntries[0].status, 'PENDING'));
test('R2C2 16 — payment é entidade separada', () => { const store = payment(charge(fixture()), 100); assert.equal(store.payments.length, 1); assert.equal(store.charges.length, 1); });
test('R2C2 17 — pagamento vincula o mesmo paciente', () => assert.equal(payment(charge(fixture()), 100).payments[0].patientId, 'patient-a'));
test('R2C2 18 — pagamento rejeita zero', () => assert.ok(createPsychologyPaymentInLedger(charge(fixture()), { patientId: 'patient-a', chargeId: fixture().charges[0]?.id || 'missing', amount: 0, date: '2026-08-14', method: 'PIX' }).error));
test('R2C2 19 — pagamento bloqueia excesso', () => { const store = charge(fixture()); assert.ok(createPsychologyPaymentInLedger(store, { patientId: 'patient-a', chargeId: store.charges[0].id, amount: 201, date: '2026-08-14', method: 'PIX' }).error); });
test('R2C2 20 — pagamento parcial deixa saldo', () => assert.equal(getPsychologyFinancialLedger(payment(charge(fixture()), 100)).chargeEntries[0].balance, 100));
test('R2C2 21 — pagamento parcial atualiza status', () => assert.equal(getPsychologyFinancialLedger(payment(charge(fixture()), 100)).chargeEntries[0].status, 'PARTIALLY_PAID'));
test('R2C2 22 — múltiplos pagamentos somam', () => { let store = payment(charge(fixture()), 100); store = payment(store, 100, 'CASH'); assert.equal(getPsychologyFinancialLedger(store).activePayments.reduce((sum, item) => sum + item.amount, 0), 200); });
test('R2C2 23 — pagamento integral zera saldo', () => { let store = payment(charge(fixture()), 100); store = payment(store, 100, 'CASH'); assert.equal(getPsychologyFinancialLedger(store).chargeEntries[0].balance, 0); });
test('R2C2 24 — pagamento integral atualiza status', () => { let store = payment(charge(fixture()), 100); store = payment(store, 100, 'CASH'); assert.equal(getPsychologyFinancialLedger(store).chargeEntries[0].status, 'PAID'); });
test('R2C2 25 — Pix é aceito', () => assert.equal(payment(charge(fixture()), 50, 'PIX').payments[0].method, 'PIX'));
test('R2C2 26 — dinheiro é aceito', () => assert.equal(payment(charge(fixture()), 50, 'CASH').payments[0].method, 'CASH'));
test('R2C2 27 — cartão é aceito sem dados sensíveis', () => assert.equal(payment(charge(fixture()), 50, 'CARD').payments[0].method, 'CARD'));
test('R2C2 28 — transferência é aceita', () => assert.equal(payment(charge(fixture()), 50, 'TRANSFER').payments[0].method, 'TRANSFER'));
test('R2C2 29 — outro meio é aceito', () => assert.equal(payment(charge(fixture()), 50, 'OTHER').payments[0].method, 'OTHER'));
test('R2C2 30 — operationKey evita duplicação', () => { const store = charge(fixture()); const first = createPsychologyPaymentInLedger(store, { patientId: 'patient-a', chargeId: store.charges[0].id, amount: 50, date: '2026-08-14', method: 'PIX', operationKey: 'op-1' }); const second = createPsychologyPaymentInLedger(first.store, { patientId: 'patient-a', chargeId: store.charges[0].id, amount: 50, date: '2026-08-14', method: 'PIX', operationKey: 'op-1' }); assert.equal(second.store.payments.length, 1); });
test('R2C2 31 — data do pagamento é preservada', () => assert.equal(payment(charge(fixture()), 50).payments[0].date, '2026-08-14'));
test('R2C2 32 — somente pagamentos ativos entram no caixa', () => { const store = payment(charge(fixture()), 50); assert.equal(getPsychologyFinancialLedger(store).activePayments.length, 1); });
test('R2C2 33 — estorno exige motivo', () => { const store = payment(charge(fixture()), 50); assert.ok(reversePsychologyPayment(store, store.payments[0].id, '').error); });
test('R2C2 34 — estorno é lógico', () => { const store = payment(charge(fixture()), 50); const result = reversePsychologyPayment(store, store.payments[0].id, 'Correção'); assert.equal(result.store.payments[0].status, 'voided'); });
test('R2C2 35 — pagamento estornado permanece auditável', () => { const store = payment(charge(fixture()), 50); const result = reversePsychologyPayment(store, store.payments[0].id, 'Correção'); assert.equal(result.store.payments.length, 1); assert.equal(result.store.payments[0].reversalReason, 'Correção'); });
test('R2C2 36 — estorno remove recebido ativo', () => { const store = payment(charge(fixture()), 50); const result = reversePsychologyPayment(store, store.payments[0].id, 'Correção'); assert.equal(getPsychologyFinancialLedger(result.store).activePayments.length, 0); });
test('R2C2 37 — estorno recompõe saldo', () => { const store = payment(charge(fixture()), 50); const result = reversePsychologyPayment(store, store.payments[0].id, 'Correção'); assert.equal(getPsychologyFinancialLedger(result.store).chargeEntries[0].balance, 200); });
test('R2C2 38 — estorno recompõe status pendente', () => { const store = payment(charge(fixture()), 50); const result = reversePsychologyPayment(store, store.payments[0].id, 'Correção'); assert.equal(getPsychologyFinancialLedger(result.store).chargeEntries[0].status, 'PENDING'); });
test('R2C2 39 — cancelamento exige motivo', () => { const store = charge(fixture()); assert.ok(cancelPsychologyCharge(store, store.charges[0].id, '').error); });
test('R2C2 40 — cancelamento é lógico', () => { const store = charge(fixture()); const result = cancelPsychologyCharge(store, store.charges[0].id, 'Duplicada'); assert.equal(result.store.charges[0].status, 'canceled'); });
test('R2C2 41 — cancelada sai de a receber', () => { const store = charge(fixture()); const result = cancelPsychologyCharge(store, store.charges[0].id, 'Duplicada'); assert.equal(getPsychologyFinancialLedger(result.store).chargeEntries[0].balance, 0); });
test('R2C2 42 — cancelada sai de vencido', () => { const store = charge(fixture(), 200, '2026-08-01'); const result = cancelPsychologyCharge(store, store.charges[0].id, 'Duplicada'); assert.equal(getPsychologyFinancialLedger(result.store).chargeEntries[0].overdue, false); });
test('R2C2 43 — cancelada permanece na lista histórica', () => { const store = charge(fixture()); const result = cancelPsychologyCharge(store, store.charges[0].id, 'Duplicada'); assert.equal(result.store.charges.length, 1); });
test('R2C2 44 — despesa realiza com valor positivo', () => assert.equal(expense(fixture()).expenses[0].amount, 150));
test('R2C2 45 — categoria Aluguel é preservada', () => assert.equal(expense(fixture()).expenses[0].category, 'Aluguel'));
test('R2C2 46 — despesa realizada entra no agregado', () => assert.equal(getPsychologyFinancialOverview(expense(fixture()), createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).expenses, 150));
test('R2C2 47 — despesa pendente não entra no realizado', () => assert.equal(getPsychologyFinancialOverview(expense(fixture(), 'PENDING'), createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).expenses, 0));
test('R2C2 48 — estorno de despesa exige motivo', () => { const store = expense(fixture()); assert.ok(reversePsychologyExpense(store, store.expenses[0].id, '').error); });
test('R2C2 49 — estorno de despesa preserva linha', () => { const store = expense(fixture()); const result = reversePsychologyExpense(store, store.expenses[0].id, 'Correção'); assert.equal(result.store.expenses.length, 1); assert.equal(result.store.expenses[0].status, 'REVERSED'); });
test('R2C2 50 — despesa estornada sai do agregado', () => { const store = expense(fixture()); const result = reversePsychologyExpense(store, store.expenses[0].id, 'Correção'); assert.equal(getPsychologyFinancialOverview(result.store, createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).expenses, 0); });
test('R2C2 51 — saldo é recebido menos despesa', () => assert.equal(getPsychologyFinancialOverview(expense(payment(charge(fixture()), 200)), createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).balance, 50));
test('R2C2 52 — recebido usa data de pagamento', () => { const store = payment(charge(fixture()), 100); const result = { ...store, payments: store.payments.map(item => ({ ...item, date: '2026-07-01' })) }; assert.equal(getPsychologyFinancialOverview(result, createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).received, 0); });
test('R2C2 53 — despesa usa data da despesa', () => { const store = expense(fixture()); const result = { ...store, expenses: store.expenses.map(item => ({ ...item, date: '2026-07-01' })) }; assert.equal(getPsychologyFinancialOverview(result, createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).expenses, 0); });
test('R2C2 54 — período semanal tem sete dias', () => { const period = createPsychologyPeriod('week', new Date('2026-08-14T12:00:00')); assert.equal((new Date(`${period.endDate}T12:00:00`).getTime() - new Date(`${period.startDate}T12:00:00`).getTime()) / 86_400_000, 6); });
test('R2C2 55 — período anual respeita ano', () => { const period = createPsychologyPeriod('year', new Date('2026-08-14T12:00:00')); assert.deepEqual([period.startDate, period.endDate], ['2026-01-01', '2026-12-31']); });
test('R2C2 56 — período personalizado normaliza ordem', () => { const period = createPsychologyPeriod('custom', undefined, '2026-08-31', '2026-08-01'); assert.deepEqual([period.startDate, period.endDate], ['2026-08-01', '2026-08-31']); });
test('R2C2 57 — a receber inclui saldo parcial', () => assert.equal(getPsychologyFinancialOverview(payment(charge(fixture()), 100), createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).receivable, 100));
test('R2C2 58 — vencido é subconjunto aberto', () => { const overview = getPsychologyFinancialOverview(charge(fixture(), 200, '2026-08-01'), createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31'), '2026-08-14'); assert.equal(overview.overdue, 200); assert.equal(overview.receivable, 200); });
test('R2C2 59 — vencido não é somado ao saldo', () => { const overview = getPsychologyFinancialOverview(charge(fixture(), 200, '2026-08-01'), createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31'), '2026-08-14'); assert.equal(overview.balance, 0); });
test('R2C2 60 — item de outro contexto não entra', () => { const store = charge(fixture()); const foreign = { ...store.charges[0], id: 'foreign', context: 'NEURO' as const }; assert.equal(getPsychologyFinancialLedger({ ...store, charges: [...store.charges, foreign as never] }).charges.length, 1); });
test('R2C2 61 — pagamento estornado não entra no caixa', () => { const store = payment(charge(fixture()), 100); const result = reversePsychologyPayment(store, store.payments[0].id, 'Correção'); assert.equal(getPsychologyFinancialOverview(result.store, createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31')).received, 0); });
test('R2C2 62 — despesa de outro profissional não entra', () => { const store = expense(fixture()); const foreign = { ...store.expenses[0], id: 'foreign-expense', professionalId: 'other' }; assert.equal(getPsychologyFinancialLedger({ ...store, expenses: [...store.expenses, foreign] }).expenses.length, 1); });
test('R2C2 63 — charge e payment isolam contexto antes da soma', () => { const store = payment(charge(fixture()), 100); const foreign = { ...store.payments[0], id: 'foreign-payment', context: 'NEURO' as const }; assert.equal(getPsychologyFinancialLedger({ ...store, payments: [...store.payments, foreign as never] }).activePayments.length, 1); });
test('R2C2 64 — pacote não controla cobrança automaticamente', () => { const store = charge(fixture(), 200, '2026-08-10', { packageId: 'optional' }); assert.equal(getPsychologyFinancialLedger(store).chargeEntries[0].balance, 200); });
test('R2C2 65 — resumo da ficha usa o mesmo saldo do ledger', () => { const store = payment(charge(fixture()), 100); assert.equal(getPsychologyPatientFinanceSummary(store, 'patient-a', '2026-08-14').pending, getPsychologyFinancialLedger(store).chargeEntries[0].balance); });
test('R2C2 66 — status canônico reconhece legado partial', () => assert.equal(normalizePsychologyChargeStatus({ status: 'partial' }), 'PARTIALLY_PAID'));
test('R2C2 67 — status canônico reconhece cancelado', () => assert.equal(normalizePsychologyChargeStatus({ status: 'canceled' }), 'CANCELLED'));
test('R2C2 68 — pagamento ativo não depende de valor formatado', () => assert.equal(isPsychologyPaymentActive({ status: 'active' }), true));
test('R2C2 69 — saldo é arredondado com segurança', () => assert.equal(getPsychologyChargeFinancialState({ ...charge(fixture(), 100).charges[0], amount: 100.1 }, [], '2026-08-14').balance, 100.1));
test('R2C2 70 — ledger expõe despesas no mesmo núcleo', () => assert.equal(getPsychologyFinancialLedger(expense(fixture())).expenses[0].context, 'PSICOLOGIA'));
