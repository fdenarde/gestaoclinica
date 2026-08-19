export const CLINIC_PACKAGE_VALUE = 1000;

function normalizePatientId(value) {
  return String(value || '').trim();
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizePackageNumber(value) {
  const packageNumber = Number(value);
  return Number.isInteger(packageNumber) && packageNumber > 0 ? packageNumber : 0;
}

function normalizeDateKey(value) {
  const date = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function todayDateKey() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isPaymentActive(payment) {
  return !!payment && String(payment.status || 'active') !== 'voided';
}

export function isExpenseActive(expense) {
  return !!expense && String(expense.status || 'active') !== 'voided';
}

export function isPaymentReceived(payment, { throughDate = todayDateKey() } = {}) {
  if (!isPaymentActive(payment) || normalizePositiveAmount(payment.amount) <= 0) return false;
  const paymentDate = normalizeDateKey(payment.date);
  const normalizedThroughDate = normalizeDateKey(throughDate);
  return !normalizedThroughDate || !paymentDate || paymentDate <= normalizedThroughDate;
}

export function isExpenseRealized(expense, { throughDate = todayDateKey() } = {}) {
  if (!isExpenseActive(expense) || normalizePositiveAmount(expense.amount) <= 0) return false;
  const expenseDate = normalizeDateKey(expense.date);
  const normalizedThroughDate = normalizeDateKey(throughDate);
  return !normalizedThroughDate || !expenseDate || expenseDate <= normalizedThroughDate;
}

function getEligiblePayments(rawPayments, {
  patientId = '',
  throughDate = todayDateKey(),
} = {}) {
  const normalizedPatientId = normalizePatientId(patientId);
  const normalizedThroughDate = normalizeDateKey(throughDate);

  return (Array.isArray(rawPayments) ? rawPayments : [])
    .filter(payment => (
      isPaymentReceived(payment, { throughDate: normalizedThroughDate })
      && (!normalizedPatientId || normalizePatientId(payment.patientId) === normalizedPatientId)
      && normalizePositiveAmount(payment.amount) > 0
    ))
    .filter(payment => {
      const paymentDate = normalizeDateKey(payment.date);
      return !normalizedThroughDate || !paymentDate || paymentDate <= normalizedThroughDate;
    })
    .slice()
    .sort((left, right) => {
      const dateCompare = String(left.date || '').localeCompare(String(right.date || ''));
      return dateCompare || String(left.id || '').localeCompare(String(right.id || ''));
    });
}

function buildPackageAllocations(rawPayments, options = {}) {
  const normalizedPackageValue = Number(options.packageValue) > 0
    ? Number(options.packageValue)
    : CLINIC_PACKAGE_VALUE;
  const resolvePackageValue = typeof options.packageValueResolver === 'function'
    ? packageNumber => {
      const resolved = Number(options.packageValueResolver(packageNumber));
      return Number.isFinite(resolved) && resolved > 0 ? resolved : normalizedPackageValue;
    }
    : () => normalizedPackageValue;
  const payments = getEligiblePayments(rawPayments, options);
  const allocations = new Map();
  const paymentIdsByPackage = new Map();
  let highestExplicitPackage = 0;

  const addAllocation = (packageNumber, amount, payment) => {
    if (amount <= 0) return;
    allocations.set(packageNumber, (allocations.get(packageNumber) || 0) + amount);
    const ids = paymentIdsByPackage.get(packageNumber) || new Set();
    ids.add(String(payment.id || ''));
    paymentIdsByPackage.set(packageNumber, ids);
  };

  for (const payment of payments) {
    const packageNumber = normalizePackageNumber(payment.packageNumber);
    if (!packageNumber) continue;
    highestExplicitPackage = Math.max(highestExplicitPackage, packageNumber);
    const alreadyAllocated = allocations.get(packageNumber) || 0;
    const available = Math.max(resolvePackageValue(packageNumber) - alreadyAllocated, 0);
    addAllocation(
      packageNumber,
      Math.min(normalizePositiveAmount(payment.amount), available),
      payment,
    );
  }

  for (const payment of payments) {
    if (normalizePackageNumber(payment.packageNumber)) continue;
    let remaining = normalizePositiveAmount(payment.amount);
    let packageNumber = 1;

    while (remaining > 0) {
      const alreadyAllocated = allocations.get(packageNumber) || 0;
      const available = Math.max(resolvePackageValue(packageNumber) - alreadyAllocated, 0);
      const allocated = Math.min(remaining, available);
      addAllocation(packageNumber, allocated, payment);
      remaining -= allocated;
      packageNumber += 1;
    }
  }

  return {
    payments,
    allocations,
    paymentIdsByPackage,
    packageValue: normalizedPackageValue,
    resolvePackageValue,
    highestExplicitPackage,
  };
}

export function getPackagePaymentSummary(rawPayments, packageNumber, options = {}) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  const allocation = buildPackageAllocations(rawPayments, options);
  const packageValue = normalizedPackageNumber
    ? allocation.resolvePackageValue(normalizedPackageNumber)
    : allocation.packageValue;
  const paidAmount = normalizedPackageNumber
    ? Math.min(allocation.allocations.get(normalizedPackageNumber) || 0, packageValue)
    : 0;
  const ids = allocation.paymentIdsByPackage.get(normalizedPackageNumber) || new Set();
  const payments = allocation.payments.filter(payment => ids.has(String(payment.id || '')));

  return {
    packageNumber: normalizedPackageNumber,
    packageValue,
    paidAmount,
    pendingAmount: Math.max(packageValue - paidAmount, 0),
    payments,
    installments: payments,
    isPaid: paidAmount >= packageValue,
    financialStatus: paidAmount >= packageValue ? 'quitado' : 'pendente',
  };
}

export function getActivatedPackageNumber(rawPayments, {
  patientId = '',
  packageValue = CLINIC_PACKAGE_VALUE,
  packageValueResolver,
  allowLegacyFirstPackage = true,
  throughDate = todayDateKey(),
} = {}) {
  const allocation = buildPackageAllocations(rawPayments, {
    patientId,
    packageValue,
    packageValueResolver,
    throughDate,
  });
  const highestAllocatedPackage = [...allocation.allocations.entries()]
    .reduce((highest, [packageNumber, amount]) => amount > 0 ? Math.max(highest, packageNumber) : highest, 0);

  return Math.max(
    allowLegacyFirstPackage ? 1 : 0,
    allocation.highestExplicitPackage,
    highestAllocatedPackage,
  );
}

export function isPackageActivated(rawPayments, packageNumber, options = {}) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  if (!normalizedPackageNumber) return false;
  return normalizedPackageNumber <= getActivatedPackageNumber(rawPayments, options);
}
