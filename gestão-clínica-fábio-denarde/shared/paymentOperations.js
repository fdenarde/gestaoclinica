import {
  CLINIC_PACKAGE_VALUE,
  getActivatedPackageNumber,
  getPackagePaymentSummary,
  isPaymentActive,
} from './packagePayments.js';

const PARTNER_SHARE_RATE = 0.2;

function requiredText(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${fieldName} é obrigatório.`);
  return normalized;
}

function normalizePackageNumber(value) {
  const packageNumber = Number(value);
  if (!Number.isInteger(packageNumber) || packageNumber <= 0) {
    throw new Error('O pacote informado é inválido.');
  }
  return packageNumber;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('O valor deve ser finito.');
  if (amount <= 0) throw new Error('O valor deve ser maior que zero.');
  return amount;
}

function safeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
}

function paymentFingerprint(payment) {
  return [
    String(payment.patientId || ''),
    String(payment.packageNumber || ''),
    Number(payment.amount),
    String(payment.date || ''),
    String(payment.installment || ''),
    String(payment.method || ''),
  ].join('|');
}

export function createPaymentOperationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function preparePaymentCreation({
  patient,
  sessions = [],
  payments = [],
  expenses = [],
  input = {},
  operationKey,
  actor,
  now = new Date().toISOString(),
} = {}) {
  void sessions;
  const normalizedOperationKey = requiredText(operationKey, 'Chave da operação');
  const normalizedActor = requiredText(actor, 'Responsável pelo lançamento');
  const patientId = requiredText(patient?.id, 'Paciente');
  if (requiredText(input.patientId, 'Paciente') !== patientId) {
    throw new Error('O pagamento não corresponde ao paciente selecionado.');
  }

  const existing = payments.find(payment => String(payment.operationKey || '') === normalizedOperationKey);
  if (existing) {
    return {
      payment: existing,
      expense: expenses.find(expense => expense.pagamento_origem_id === existing.id) || null,
      payments,
      expenses,
      idempotent: true,
    };
  }

  const amount = normalizeAmount(input.amount);
  const packageNumber = normalizePackageNumber(input.packageNumber);
  const date = requiredText(input.date, 'Data do pagamento').slice(0, 10);
  const nowDate = String(now).slice(0, 10);
  if (date > nowDate) throw new Error('A data do pagamento não pode estar no futuro.');

  const activatedPackage = getActivatedPackageNumber(payments, {
    patientId,
    throughDate: nowDate,
  });
  if (packageNumber > activatedPackage + 1) {
    throw new Error('O pagamento não pode ser associado a um pacote futuro.');
  }
  if (packageNumber > 1) {
    const previousSummary = getPackagePaymentSummary(payments, packageNumber - 1, {
      patientId,
      throughDate: nowDate,
    });
    if (previousSummary.pendingAmount > 0) {
      throw new Error('O pacote anterior ainda possui saldo pendente.');
    }
  }
  const summary = getPackagePaymentSummary(payments, packageNumber, {
    patientId,
    throughDate: nowDate,
  });
  if (amount > summary.pendingAmount) {
    throw new Error(`O valor ultrapassa o saldo pendente de R$ ${summary.pendingAmount.toFixed(2)}.`);
  }
  if (
    String(patient.paymentModal || '').includes('Parcelado')
    && (input.installment === '1ª parcela' || input.installment === '2ª parcela')
    && amount > CLINIC_PACKAGE_VALUE / 2
  ) {
    throw new Error('O valor ultrapassa o saldo permitido para esta parcela.');
  }

  const candidate = {
    patientId,
    packageNumber,
    amount,
    date,
    installment: requiredText(input.installment, 'Parcela'),
    method: requiredText(input.method, 'Forma de pagamento'),
  };
  const duplicate = payments.find(payment => (
    isPaymentActive(payment)
    && paymentFingerprint(payment) === paymentFingerprint(candidate)
  ));
  if (duplicate) throw new Error('Este pagamento já foi registrado.');

  const paymentId = `payment-${safeId(normalizedOperationKey)}`;
  const payment = {
    id: paymentId,
    ...candidate,
    status: 'active',
    operationKey: normalizedOperationKey,
    createdAt: String(now),
    createdBy: normalizedActor,
  };
  const expense = {
    id: `repasse-${paymentId}`,
    description: `Repasse Sócia - ${patient.name || 'Paciente'}`,
    amount: amount * PARTNER_SHARE_RATE,
    date,
    category: 'Repasse Sócia',
    auto_gerado: true,
    pagamento_origem_id: paymentId,
    status: 'active',
    operationKey: normalizedOperationKey,
    createdAt: String(now),
    createdBy: normalizedActor,
  };

  return {
    payment,
    expense,
    payments: [...payments, payment],
    expenses: [...expenses, expense],
    idempotent: false,
  };
}

export function preparePaymentVoid({
  payments = [],
  expenses = [],
  paymentId,
  reason,
  actor,
  now = new Date().toISOString(),
} = {}) {
  const normalizedPaymentId = requiredText(paymentId, 'Pagamento');
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) throw new Error('A justificativa do cancelamento é obrigatória.');
  const normalizedActor = requiredText(actor, 'Responsável pelo cancelamento');
  const original = payments.find(payment => String(payment.id || '') === normalizedPaymentId);
  if (!original) throw new Error('Pagamento não encontrado.');
  if (!isPaymentActive(original)) {
    return { payments, expenses, payment: original, idempotent: true };
  }

  const auditFields = {
    status: 'voided',
    voidedAt: String(now),
    voidedBy: normalizedActor,
    voidReason: normalizedReason,
  };
  const updatedPayments = payments.map(payment => (
    String(payment.id || '') === normalizedPaymentId
      ? { ...payment, ...auditFields }
      : payment
  ));
  const updatedExpenses = expenses.map(expense => (
    String(expense.pagamento_origem_id || '') === normalizedPaymentId
      ? { ...expense, ...auditFields }
      : expense
  ));

  return {
    payments: updatedPayments,
    expenses: updatedExpenses,
    payment: updatedPayments.find(payment => payment.id === normalizedPaymentId),
    idempotent: false,
  };
}
