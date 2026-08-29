import type {
  PsychologyCharge,
  PsychologyExpense,
  PsychologyExpenseCategory,
  PsychologyExpenseStatus,
  PsychologyPayment,
} from './psychologyR2a';
import type {
  PsychologyChargeInput,
  PsychologyPaymentInput,
  PsychologyScope,
  PsychologySessionPackageInput,
  PsychologyStore,
} from './psychologyDomain';
import { validatePsychologySessionPackage, upsertPsychologySessionPackage } from './psychologyDomain';
import type { PsychologySessionPackage } from './psychologyR2a';

export const PSYCHOLOGY_FINANCE_TIMEZONE = 'America/Sao_Paulo';

export type PsychologyCanonicalChargeStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'EXEMPT' | 'CANCELLED';
export type PsychologyLedgerPaymentStatus = 'ACTIVE' | 'REVERSED';
export type PsychologyPeriodPreset = 'week' | 'month' | 'year' | 'custom';

export interface PsychologyFinancialPeriod {
  preset: PsychologyPeriodPreset;
  startDate: string;
  endDate: string;
}

export interface PsychologyLedgerCharge {
  charge: PsychologyCharge;
  status: PsychologyCanonicalChargeStatus;
  received: number;
  balance: number;
  exigibleBalance: number;
  overdue: boolean;
}

export interface PsychologyFinancialLedger {
  scope: PsychologyScope;
  charges: PsychologyCharge[];
  chargeEntries: PsychologyLedgerCharge[];
  payments: PsychologyPayment[];
  activePayments: PsychologyPayment[];
  expenses: PsychologyExpense[];
}

export interface PsychologyFinancialOverview {
  period: PsychologyFinancialPeriod;
  received: number;
  receivable: number;
  overdue: number;
  expenses: number;
  balance: number;
}

export interface PsychologyExpenseInput {
  description: string;
  amount: number;
  date: string;
  category: PsychologyExpenseCategory;
  status?: PsychologyExpenseStatus;
  createdBy?: string;
}

export interface PsychologyLedgerMutation {
  store: PsychologyStore;
  error?: string;
  charge?: PsychologyCharge;
  payment?: PsychologyPayment;
  expense?: PsychologyExpense;
  sessionPackage?: PsychologySessionPackage;
}

const PERIOD_DAYS = { week: 7, month: 0, year: 0 } as const;
const PAYMENT_METHODS = new Set(['PIX', 'CASH', 'CARD', 'TRANSFER', 'OTHER']);
const EXPENSE_CATEGORIES = new Set<PsychologyExpenseCategory>(['Aluguel', 'Materiais', 'Serviços', 'Impostos/Taxas', 'Marketing', 'Capacitação', 'Tecnologia', 'Outros']);

export function roundPsychologyMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function amount(value: number): number {
  return Math.max(0, roundPsychologyMoney(Number(value) || 0));
}

export function psychologyCivilDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PSYCHOLOGY_FINANCE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseCivilDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function dateFromIso(value?: string): string {
  return value ? String(value).slice(0, 10) : '';
}

function scopeMatch(item: { professionalId?: string; context?: string }, scope: PsychologyScope): boolean {
  return item.professionalId === scope.professionalId && item.context === scope.context;
}

function normalizedStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace('ç', 'c');
}

export function isPsychologyPaymentReversed(payment: Pick<PsychologyPayment, 'status' | 'reversedAt' | 'voidedAt' | 'reactivatedAt'>): boolean {
  return normalizedStatus(payment.status) === 'voided' || normalizedStatus(payment.status) === 'reversed' || (Boolean(payment.reversedAt || payment.voidedAt) && !payment.reactivatedAt);
}

export function isPsychologyPaymentActive(payment: Pick<PsychologyPayment, 'status' | 'reversedAt' | 'voidedAt' | 'reactivatedAt'>): boolean {
  return !isPsychologyPaymentReversed(payment);
}

export function normalizePsychologyChargeStatus(charge: Pick<PsychologyCharge, 'status'>): PsychologyCanonicalChargeStatus {
  const status = normalizedStatus(charge.status);
  if (status === 'canceled' || status === 'cancelled') return 'CANCELLED';
  if (status === 'exempt') return 'EXEMPT';
  if (status === 'paid') return 'PAID';
  if (status === 'partial' || status === 'partially_paid') return 'PARTIALLY_PAID';
  return 'PENDING';
}

export function getPsychologyChargeFinancialState(charge: PsychologyCharge, payments: PsychologyPayment[], today = psychologyCivilDate()): PsychologyLedgerCharge {
  const received = amount(payments.filter(payment => payment.chargeId === charge.id && isPsychologyPaymentActive(payment)).reduce((sum, payment) => sum + amount(payment.amount), 0));
  const statusBeforeBalance = normalizePsychologyChargeStatus(charge);
  const status = statusBeforeBalance === 'CANCELLED'
    ? 'CANCELLED'
    : statusBeforeBalance === 'EXEMPT' || amount(charge.amount) === 0
      ? 'EXEMPT'
      : received >= amount(charge.amount)
        ? 'PAID'
        : received > 0
          ? 'PARTIALLY_PAID'
          : 'PENDING';
  const balance = status === 'CANCELLED' || status === 'EXEMPT' ? 0 : amount(amount(charge.amount) - received);
  return {
    charge,
    status,
    received,
    balance,
    exigibleBalance: balance,
    overdue: status !== 'CANCELLED' && status !== 'EXEMPT' && status !== 'PAID' && balance > 0 && Boolean(charge.dueDate) && dateFromIso(charge.dueDate) < today,
  };
}

export function getPsychologyFinancialLedger(store: PsychologyStore, today = psychologyCivilDate()): PsychologyFinancialLedger {
  const charges = store.charges.filter(charge => scopeMatch(charge, store.scope));
  const payments = store.payments.filter(payment => scopeMatch(payment, store.scope));
  const activePayments = payments.filter(isPsychologyPaymentActive);
  const expenses = (store.expenses || []).filter(expense => scopeMatch(expense, store.scope));
  return {
    scope: store.scope,
    charges,
    chargeEntries: charges.map(charge => getPsychologyChargeFinancialState(charge, payments, today)),
    payments,
    activePayments,
    expenses,
  };
}

export function createPsychologyPeriod(preset: PsychologyPeriodPreset, referenceDate = new Date(), customStart?: string, customEnd?: string): PsychologyFinancialPeriod {
  if (preset === 'custom') {
    const startDate = customStart || psychologyCivilDate(referenceDate);
    const endDate = customEnd || startDate;
    return { preset, startDate: startDate <= endDate ? startDate : endDate, endDate: startDate <= endDate ? endDate : startDate };
  }
  const current = psychologyCivilDate(referenceDate);
  const date = parseCivilDate(current);
  if (preset === 'week') {
    const day = date.getDay();
    const start = new Date(date);
    start.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    const end = new Date(start);
    end.setDate(start.getDate() + PERIOD_DAYS.week - 1);
    return { preset, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
  }
  if (preset === 'year') return { preset, startDate: `${current.slice(0, 4)}-01-01`, endDate: `${current.slice(0, 4)}-12-31` };
  return { preset: 'month', startDate: `${current.slice(0, 7)}-01`, endDate: new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10) };
}

export function isPsychologyDateInPeriod(date: string | undefined, period: PsychologyFinancialPeriod): boolean {
  const civil = dateFromIso(date);
  return Boolean(civil) && civil >= period.startDate && civil <= period.endDate;
}

export function getPsychologyFinancialOverview(store: PsychologyStore, period = createPsychologyPeriod('month'), today = psychologyCivilDate()): PsychologyFinancialOverview {
  const ledger = getPsychologyFinancialLedger(store, today);
  const received = roundPsychologyMoney(ledger.activePayments.filter(payment => isPsychologyDateInPeriod(payment.date, period)).reduce((sum, payment) => sum + amount(payment.amount), 0));
  const expenses = roundPsychologyMoney(ledger.expenses.filter(expense => normalizedStatus(expense.status) === 'realized' && isPsychologyDateInPeriod(expense.date, period)).reduce((sum, expense) => sum + amount(expense.amount), 0));
  const periodCharges = ledger.chargeEntries.filter(entry => isPsychologyDateInPeriod(entry.charge.dueDate || entry.charge.createdAt, period));
  const receivable = roundPsychologyMoney(periodCharges.reduce((sum, entry) => sum + entry.balance, 0));
  const overdue = roundPsychologyMoney(periodCharges.filter(entry => entry.overdue).reduce((sum, entry) => sum + entry.balance, 0));
  return { period, received, receivable, overdue, expenses, balance: roundPsychologyMoney(received - expenses) };
}

function mutation(store: PsychologyStore, error?: string, values: Omit<PsychologyLedgerMutation, 'store' | 'error'> = {}): PsychologyLedgerMutation {
  return { store, ...(error ? { error } : {}), ...values };
}

function validateChargePackage(store: PsychologyStore, packageId: string | undefined, patientId: string, chargeAmount: number): string | undefined {
  if (!packageId) return undefined;
  const sessionPackage = store.sessionPackages.find(item => item.id === packageId && scopeMatch(item, store.scope));
  if (!sessionPackage || sessionPackage.patientId !== patientId || !sessionPackage.active || sessionPackage.usedSessions >= sessionPackage.totalSessions) return 'Selecione um pacote ativo deste paciente com sessões disponíveis.';
  const packageTotal = sessionPackage.totalPrice ?? sessionPackage.price;
  if (packageTotal !== undefined && amount(packageTotal) !== chargeAmount) return `A cobrança do pacote deve usar o total de ${formatPsychologyMoney(amount(packageTotal))}.`;
  return undefined;
}

function id(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPsychologyChargeInLedger(store: PsychologyStore, input: PsychologyChargeInput, now = new Date().toISOString()): PsychologyLedgerMutation {
  const actor = String(input.createdBy || store.scope.professionalId).trim();
  const description = String(input.description || '').trim();
  const numericAmount = amount(input.amount);
  if (!store.patients.some(patient => patient.id === input.patientId && patient.active && scopeMatch(patient, store.scope))) return mutation(store, 'Selecione um paciente ativo da Psicologia.');
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) < 0) return mutation(store, 'Informe um valor válido.');
  const packageError = validateChargePackage(store, input.packageId, input.patientId, numericAmount);
  if (packageError) return mutation(store, packageError);
  const charge: PsychologyCharge = {
    id: id('charge'),
    patientId: input.patientId,
    professionalId: store.scope.professionalId,
    context: store.scope.context,
    sessionId: input.sessionId,
    serviceId: input.serviceId,
    packageId: input.packageId,
    description,
    amount: numericAmount,
    dueDate: input.dueDate || undefined,
    status: input.exempt || numericAmount === 0 ? 'exempt' : 'pending',
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    exemptionReason: input.exempt ? input.exemptionReason?.trim() || undefined : undefined,
  };
  return mutation({ ...store, charges: [...store.charges, charge] }, undefined, { charge });
}

export function updatePsychologyChargeInLedger(store: PsychologyStore, chargeId: string, patch: Partial<Pick<PsychologyCharge, 'patientId' | 'description' | 'amount' | 'dueDate' | 'sessionId' | 'serviceId' | 'packageId' | 'exemptionReason'>>, now = new Date().toISOString()): PsychologyLedgerMutation {
  const current = store.charges.find(item => item.id === chargeId && scopeMatch(item, store.scope));
  if (!current) return mutation(store, 'Cobrança não encontrada neste contexto.');
  const next = { ...current, ...patch, description: String(patch.description ?? current.description ?? '').trim(), amount: amount(patch.amount ?? current.amount), updatedAt: now };
  if (next.patientId && !store.patients.some(patient => patient.id === next.patientId && patient.active && scopeMatch(patient, store.scope))) return mutation(store, 'Selecione um paciente ativo da Psicologia.');
  if (!Number.isFinite(Number(next.amount)) || Number(next.amount) < 0) return mutation(store, 'Informe um valor válido.');
  const packageError = next.packageId !== current.packageId ? validateChargePackage(store, next.packageId, next.patientId, next.amount) : undefined;
  if (packageError) return mutation(store, packageError);
  const received = getPsychologyChargeFinancialState(current, store.payments).received;
  if (next.amount < received) return mutation(store, 'O valor da cobrança não pode ser menor que o total já recebido.');
  const updated = { ...next, status: next.amount === 0 ? 'exempt' as const : current.status === 'canceled' || current.status === 'cancelled' ? current.status : received >= next.amount ? 'paid' as const : received > 0 ? 'partial' as const : 'pending' as const };
  return mutation({ ...store, charges: store.charges.map(item => item.id === chargeId ? updated : item) }, undefined, { charge: updated });
}

export function createPsychologyPaymentInLedger(store: PsychologyStore, input: PsychologyPaymentInput, now = new Date().toISOString()): PsychologyLedgerMutation {
  const charge = store.charges.find(item => item.id === input.chargeId && scopeMatch(item, store.scope));
  if (!charge) return mutation(store, 'Cobrança não encontrada neste contexto.');
  const ledger = getPsychologyFinancialLedger(store);
  const entry = ledger.chargeEntries.find(item => item.charge.id === charge.id);
  if (!entry || entry.status === 'CANCELLED' || entry.status === 'EXEMPT') return mutation(store, 'Esta cobrança não possui saldo exigível.');
  if (input.patientId !== charge.patientId) return mutation(store, 'O pagamento não corresponde ao paciente selecionado.');
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) return mutation(store, 'O valor do pagamento deve ser maior que zero.');
  if (amount(input.amount) > entry.balance) return mutation(store, `O pagamento ultrapassa o saldo atual de ${formatPsychologyMoney(entry.balance)}.`);
  if (!input.date) return mutation(store, 'Informe a data do pagamento.');
  if (!PAYMENT_METHODS.has(input.method)) return mutation(store, 'Informe um meio de pagamento válido.');
  const operationKey = input.operationKey?.trim();
  if (operationKey) {
    const existing = store.payments.find(payment => payment.operationKey === operationKey && scopeMatch(payment, store.scope));
    if (existing) return mutation(store, undefined, { payment: existing });
  }
  const actor = String(input.createdBy || store.scope.professionalId).trim();
  const payment: PsychologyPayment = {
    id: id('payment'),
    chargeId: charge.id,
    patientId: charge.patientId,
    professionalId: store.scope.professionalId,
    context: store.scope.context,
    sessionId: input.sessionId,
    amount: amount(input.amount),
    date: String(input.date).slice(0, 10),
    method: input.method,
    status: 'active',
    updatedAt: now,
    operationKey,
    createdAt: now,
    createdBy: actor,
  };
  const payments = [...store.payments, payment];
  const updatedEntry = getPsychologyChargeFinancialState(charge, payments, psychologyCivilDate());
  const charges = store.charges.map(item => item.id === charge.id ? { ...item, status: updatedEntry.status === 'PAID' ? 'paid' : updatedEntry.status === 'PARTIALLY_PAID' ? 'partial' : item.status, updatedAt: now } : item);
  return mutation({ ...store, charges, payments }, undefined, { payment });
}

export function updatePsychologyPaymentInLedger(store: PsychologyStore, paymentId: string, patch: Partial<Pick<PsychologyPayment, 'amount' | 'date' | 'method'>>, now = new Date().toISOString()): PsychologyLedgerMutation {
  const current = store.payments.find(item => item.id === paymentId && scopeMatch(item, store.scope));
  if (!current) return mutation(store, 'Pagamento não encontrado neste contexto.');
  if (!Number.isFinite(Number(patch.amount ?? current.amount)) || Number(patch.amount ?? current.amount) <= 0) return mutation(store, 'O valor do pagamento deve ser maior que zero.');
  if (patch.date !== undefined && !patch.date) return mutation(store, 'Informe a data do pagamento.');
  if (patch.method !== undefined && !PAYMENT_METHODS.has(patch.method)) return mutation(store, 'Informe um meio de pagamento válido.');
  const amountValue = amount(patch.amount ?? current.amount);
  const charge = current.chargeId ? store.charges.find(item => item.id === current.chargeId) : undefined;
  if (charge && isPsychologyPaymentActive(current)) {
    const receivedWithoutCurrent = store.payments.filter(item => item.chargeId === charge.id && item.id !== current.id && isPsychologyPaymentActive(item)).reduce((sum, item) => sum + amount(item.amount), 0);
    if (receivedWithoutCurrent + amountValue > amount(charge.amount)) return mutation(store, 'O pagamento ultrapassa o saldo atual da cobrança.');
  }
  const updated = { ...current, amount: amountValue, date: String(patch.date ?? current.date).slice(0, 10), method: patch.method ?? current.method, updatedAt: now };
  const payments = store.payments.map(item => item.id === paymentId ? updated : item);
  return mutation({ ...store, payments }, undefined, { payment: updated });
}

export function createPsychologyExpenseInLedger(store: PsychologyStore, input: PsychologyExpenseInput, now = new Date().toISOString()): PsychologyLedgerMutation {
  const description = String(input.description || '').trim();
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) return mutation(store, 'O valor da despesa deve ser maior que zero.');
  if (!input.date) return mutation(store, 'Informe a data da despesa.');
  if (!EXPENSE_CATEGORIES.has(input.category)) return mutation(store, 'Informe uma categoria válida.');
  const status = input.status || 'REALIZED';
  if (!['REALIZED', 'PENDING', 'REVERSED'].includes(status)) return mutation(store, 'Informe um status válido.');
  const expense: PsychologyExpense = {
    id: id('expense'),
    professionalId: store.scope.professionalId,
    context: store.scope.context,
    description,
    amount: amount(input.amount),
    date: String(input.date).slice(0, 10),
    category: input.category,
    status,
    createdAt: now,
    updatedAt: now,
    createdBy: String(input.createdBy || store.scope.professionalId).trim(),
  };
  return mutation({ ...store, expenses: [...(store.expenses || []), expense] }, undefined, { expense });
}

export function updatePsychologyExpenseInLedger(store: PsychologyStore, expenseId: string, patch: Partial<Pick<PsychologyExpense, 'description' | 'amount' | 'date' | 'category' | 'status'>>, now = new Date().toISOString()): PsychologyLedgerMutation {
  const current = (store.expenses || []).find(item => item.id === expenseId && scopeMatch(item, store.scope));
  if (!current) return mutation(store, 'Despesa não encontrada neste contexto.');
  const description = String(patch.description ?? current.description ?? '').trim();
  if (!Number.isFinite(Number(patch.amount ?? current.amount)) || Number(patch.amount ?? current.amount) <= 0) return mutation(store, 'O valor da despesa deve ser maior que zero.');
  if (patch.date !== undefined && !patch.date) return mutation(store, 'Informe a data da despesa.');
  if (patch.category !== undefined && !EXPENSE_CATEGORIES.has(patch.category)) return mutation(store, 'Informe uma categoria válida.');
  const updated = { ...current, description, amount: amount(patch.amount ?? current.amount), date: String(patch.date ?? current.date).slice(0, 10), category: patch.category ?? current.category, status: patch.status ?? current.status, updatedAt: now };
  return mutation({ ...store, expenses: (store.expenses || []).map(item => item.id === expenseId ? updated : item) }, undefined, { expense: updated });
}

export function cancelPsychologyCharge(store: PsychologyStore, chargeId: string, reason: string, actor = store.scope.professionalId, now = new Date().toISOString()): PsychologyLedgerMutation {
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) return mutation(store, 'O motivo do cancelamento é obrigatório.');
  const charge = store.charges.find(item => item.id === chargeId && scopeMatch(item, store.scope));
  if (!charge) return mutation(store, 'Cobrança não encontrada neste contexto.');
  const updated = { ...charge, status: 'canceled' as const, canceledAt: now, cancelledAt: now, canceledBy: actor, cancelledBy: actor, cancellationReason: normalizedReason, updatedAt: now };
  return mutation({ ...store, charges: store.charges.map(item => item.id === chargeId ? updated : item) }, undefined, { charge: updated });
}

export function reactivatePsychologyCharge(store: PsychologyStore, chargeId: string, actor = store.scope.professionalId, now = new Date().toISOString()): PsychologyLedgerMutation {
  const charge = store.charges.find(item => item.id === chargeId && scopeMatch(item, store.scope));
  if (!charge) return mutation(store, 'Cobrança não encontrada neste contexto.');
  if (normalizePsychologyChargeStatus(charge) !== 'CANCELLED') return mutation(store, undefined, { charge });
  const refreshed = getPsychologyChargeFinancialState({ ...charge, status: charge.amount === 0 ? 'exempt' : 'pending' }, store.payments);
  const updated = { ...charge, status: refreshed.status === 'PAID' ? 'paid' as const : refreshed.status === 'PARTIALLY_PAID' ? 'partial' as const : refreshed.status === 'EXEMPT' ? 'exempt' as const : 'pending' as const, reactivatedAt: now, reactivatedBy: actor, updatedAt: now };
  return mutation({ ...store, charges: store.charges.map(item => item.id === chargeId ? updated : item) }, undefined, { charge: updated });
}

export function reversePsychologyPayment(store: PsychologyStore, paymentId: string, reason: string, actor = store.scope.professionalId, now = new Date().toISOString()): PsychologyLedgerMutation {
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) return mutation(store, 'O motivo do estorno é obrigatório.');
  const payment = store.payments.find(item => item.id === paymentId && scopeMatch(item, store.scope));
  if (!payment) return mutation(store, 'Pagamento não encontrado neste contexto.');
  if (isPsychologyPaymentReversed(payment)) return mutation(store, undefined, { payment });
  const updated = { ...payment, status: 'voided' as const, reversedAt: now, reversedBy: actor, reversalReason: normalizedReason, voidedAt: now, voidedBy: actor, voidReason: normalizedReason, reactivatedAt: undefined, reactivatedBy: undefined, updatedAt: now };
  const payments = store.payments.map(item => item.id === paymentId ? updated : item);
  const charge = store.charges.find(item => item.id === payment.chargeId);
  const refreshed = charge ? getPsychologyChargeFinancialState(charge, payments, psychologyCivilDate()) : undefined;
  const charges = refreshed && charge
    ? store.charges.map(item => item.id === charge.id ? { ...item, status: refreshed.status === 'PAID' ? 'paid' : refreshed.status === 'PARTIALLY_PAID' ? 'partial' : refreshed.status === 'PENDING' ? 'pending' : item.status, updatedAt: now } : item)
    : store.charges;
  return mutation({ ...store, charges, payments }, undefined, { payment: updated });
}

export function reactivatePsychologyPayment(store: PsychologyStore, paymentId: string, now = new Date().toISOString()): PsychologyLedgerMutation {
  const payment = store.payments.find(item => item.id === paymentId && scopeMatch(item, store.scope));
  if (!payment) return mutation(store, 'Pagamento não encontrado neste contexto.');
  if (isPsychologyPaymentActive(payment)) return mutation(store, undefined, { payment });
  const charge = payment.chargeId ? store.charges.find(item => item.id === payment.chargeId) : undefined;
  if (charge) {
    const activeTotal = store.payments.filter(item => item.chargeId === charge.id && item.id !== payment.id && isPsychologyPaymentActive(item)).reduce((sum, item) => sum + amount(item.amount), 0);
    if (activeTotal + amount(payment.amount) > amount(charge.amount)) return mutation(store, 'A reativação ultrapassaria o valor da cobrança.');
  }
  const updated = { ...payment, status: 'active' as const, reactivatedAt: now, reactivatedBy: store.scope.professionalId, updatedAt: now };
  const payments = store.payments.map(item => item.id === paymentId ? updated : item);
  const charges = charge ? store.charges.map(item => item.id === charge.id ? { ...item, status: getPsychologyChargeFinancialState(item, payments).status === 'PAID' ? 'paid' as const : getPsychologyChargeFinancialState(item, payments).status === 'PARTIALLY_PAID' ? 'partial' as const : 'pending' as const, updatedAt: now } : item) : store.charges;
  return mutation({ ...store, charges, payments }, undefined, { payment: updated });
}

export function reversePsychologyExpense(store: PsychologyStore, expenseId: string, reason: string, actor = store.scope.professionalId, now = new Date().toISOString()): PsychologyLedgerMutation {
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) return mutation(store, 'O motivo do estorno é obrigatório.');
  const expense = (store.expenses || []).find(item => item.id === expenseId && scopeMatch(item, store.scope));
  if (!expense) return mutation(store, 'Despesa não encontrada neste contexto.');
  if (expense.status === 'REVERSED') return mutation(store, undefined, { expense });
  const updated = { ...expense, status: 'REVERSED' as const, reversedAt: now, reversedBy: actor, reversalReason: normalizedReason, reactivatedAt: undefined, reactivatedBy: undefined, updatedAt: now };
  return mutation({ ...store, expenses: (store.expenses || []).map(item => item.id === expenseId ? updated : item) }, undefined, { expense: updated });
}

export function reactivatePsychologyExpense(store: PsychologyStore, expenseId: string, now = new Date().toISOString()): PsychologyLedgerMutation {
  const expense = (store.expenses || []).find(item => item.id === expenseId && scopeMatch(item, store.scope));
  if (!expense) return mutation(store, 'Despesa não encontrada neste contexto.');
  if (expense.status !== 'REVERSED') return mutation(store, undefined, { expense });
  const updated = { ...expense, status: 'REALIZED' as const, reactivatedAt: now, reactivatedBy: store.scope.professionalId, updatedAt: now };
  return mutation({ ...store, expenses: (store.expenses || []).map(item => item.id === expenseId ? updated : item) }, undefined, { expense: updated });
}

export function upsertPsychologySessionPackageInLedger(store: PsychologyStore, input: PsychologySessionPackageInput, packageId?: string, now = new Date().toISOString()): PsychologyLedgerMutation {
  const error = validatePsychologySessionPackage(input, store);
  if (error) return mutation(store, error);
  const next = upsertPsychologySessionPackage(store, input, packageId, now);
  const sessionPackage = next.sessionPackages.find(item => item.id === (packageId || next.sessionPackages[next.sessionPackages.length - 1]?.id));
  return mutation(next, undefined, { sessionPackage });
}

export function createPsychologySessionPackageInLedger(store: PsychologyStore, input: PsychologySessionPackageInput, now = new Date().toISOString()): PsychologyLedgerMutation {
  return upsertPsychologySessionPackageInLedger(store, input, undefined, now);
}

export function formatPsychologyMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount(value));
}
