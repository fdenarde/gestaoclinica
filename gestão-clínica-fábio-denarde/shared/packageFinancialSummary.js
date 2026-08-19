import {
  CLINIC_PACKAGE_VALUE,
  getActivatedPackageNumber,
  getPackagePaymentSummary,
} from './packagePayments.js';
import { sessionConsumesPackage } from './sessionScheduling.js';
import {
  getTemporaryAuthorizedPackageNumber,
  getToleranceDisplayPackageNumber,
  resolvePackageTolerance,
} from './packageTolerance.js';
import { resolvePackageContract } from './packageContract.js';

export const CLINIC_PARTNER_SHARE_RATE = 0.2;
export const CLINIC_SESSIONS_PER_PACKAGE = 10;

function normalizeDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function sortSessions(left, right) {
  const leftKey = `${String(left.date || '')}T${String(left.time || '')}|${String(left.id || '')}`;
  const rightKey = `${String(right.date || '')}T${String(right.time || '')}|${String(right.id || '')}`;
  return leftKey.localeCompare(rightKey);
}

export function calculateCanonicalPackageFinancialSummary({
  patient,
  sessions = [],
  payments = [],
  today = new Date(),
  activatedPackageNumber: suppliedActivatedPackageNumber,
  sessionConsumesPackageFn = sessionConsumesPackage,
  packageContractResolver,
} = {}) {
  if (!patient?.id) throw new Error('Paciente é obrigatório para calcular o pacote financeiro.');

  const throughDate = normalizeDateKey(today) || normalizeDateKey(new Date());
  const resolveContract = typeof packageContractResolver === 'function'
    ? packageContractResolver
    : packageNumber => resolvePackageContract(patient, packageNumber);
  const packageValueResolver = packageNumber => {
    const resolved = resolveContract(packageNumber);
    const value = Number(resolved?.contractValue ?? resolved?.packageContractValue);
    return Number.isFinite(value) && value > 0 ? value : CLINIC_PACKAGE_VALUE;
  };
  const completedSessions = (Array.isArray(sessions) ? sessions : [])
    .filter(session => (
      String(session?.patientId || '') === String(patient.id)
      && sessionConsumesPackageFn(session, { throughDate })
    ))
    .slice()
    .sort(sortSessions);
  const paidActivatedPackageNumber = Number.isInteger(suppliedActivatedPackageNumber)
    && suppliedActivatedPackageNumber > 0
    ? suppliedActivatedPackageNumber
    : getActivatedPackageNumber(payments, {
      patientId: patient.id,
      throughDate,
      packageValueResolver,
    });
  const temporaryAuthorizedPackageNumber = getTemporaryAuthorizedPackageNumber({
    patient,
    sessions,
    payments,
    now: today,
    packageValueResolver,
  });
  const toleranceDisplayPackageNumber = getToleranceDisplayPackageNumber({
    patient,
    sessions,
    payments,
    now: today,
    packageValueResolver,
  });
  const completedPackageNumber = completedSessions.length > 0
    ? Math.floor((completedSessions.length - 1) / CLINIC_SESSIONS_PER_PACKAGE) + 1
    : 0;
  const consumedSessionTotal = completedSessions.length;
  const naturalCurrentPackageNumber = consumedSessionTotal > 0
    ? Math.ceil(consumedSessionTotal / CLINIC_SESSIONS_PER_PACKAGE)
    : 1;
  const naturalCurrentPackageConsumedCount = consumedSessionTotal > 0
    ? ((consumedSessionTotal - 1) % CLINIC_SESSIONS_PER_PACKAGE) + 1
    : 0;
  const nextPackageRequiringAuthorization = consumedSessionTotal > 0
    && consumedSessionTotal % CLINIC_SESSIONS_PER_PACKAGE === 0
    ? naturalCurrentPackageNumber + 1
    : naturalCurrentPackageNumber;
  const packageNumber = Math.max(1, paidActivatedPackageNumber, toleranceDisplayPackageNumber);
  const previousPackageNumber = packageNumber > 1 ? packageNumber - 1 : null;
  const startIndex = (packageNumber - 1) * CLINIC_SESSIONS_PER_PACKAGE;
  const currentPackageSessions = completedSessions.slice(
    startIndex,
    startIndex + CLINIC_SESSIONS_PER_PACKAGE,
  );
  const current = getPackagePaymentSummary(payments, packageNumber, {
    patientId: patient.id,
    throughDate,
    packageValueResolver,
  });
  const previous = previousPackageNumber
    ? getPackagePaymentSummary(payments, previousPackageNumber, {
      patientId: patient.id,
      throughDate,
      packageValueResolver,
    })
    : { payments: [] };
  const paidGross = current.paidAmount;
  const packageTolerance = resolvePackageTolerance({
    patient,
    sessions,
    payments,
    packageNumber,
    now: today,
    sessionConsumesPackageFn,
    packageValueResolver,
  });
  const packageHasStarted = currentPackageSessions.length > 0;
  const pendingGross = packageHasStarted || paidGross > 0 || packageTolerance.record
    ? current.pendingAmount
    : 0;
  const dueSessionIndex = String(patient.paymentModal || '').includes('Parcelado') ? 4 : 0;
  const dueSession = currentPackageSessions[dueSessionIndex];
  const dueDate = dueSession?.date || currentPackageSessions[0]?.date || patient.startDate || '';
  const isOverdue = String(patient.paymentModal || '').includes('Parcelado')
    && paidGross > 0
    && pendingGross > 0
    && currentPackageSessions.length >= 5
    && !!dueDate
    && dueDate < throughDate;
  const allPayments = [...new Set([...previous.payments, ...current.payments])]
    .slice()
    .sort((left, right) => (
      String(left.date || '').localeCompare(String(right.date || ''))
      || String(left.id || '').localeCompare(String(right.id || ''))
    ));
  const lastPayment = current.payments.length > 0
    ? current.payments[current.payments.length - 1]
    : null;
  const hasCurrentPackage = packageHasStarted || paidGross > 0 || pendingGross > 0 || Boolean(packageTolerance.record);
  const packageContract = resolveContract(packageNumber);
  const contractValue = current.packageValue;

  let status = 'SEM MOVIMENTAÇÃO';
  if (hasCurrentPackage) {
    if (pendingGross <= 0) status = 'QUITADO';
    else if (packageTolerance.status === 'active') status = 'EM TOLERÂNCIA';
    else if (packageTolerance.status === 'expired' || packageTolerance.status === 'limit_reached') status = 'TOLERÂNCIA VENCIDA';
    else if (isOverdue) status = 'ATRASADO';
    else if (paidGross > 0) status = 'PARCIAL';
    else status = 'EM ABERTO';
  }

  return {
    patient,
    packageNumber,
    consumedSessionTotal,
    naturalCurrentPackageNumber,
    naturalCurrentPackageConsumedCount,
    nextPackageRequiringAuthorization,
    paidActivatedPackageNumber,
    temporaryAuthorizedPackageNumber,
    toleranceDisplayPackageNumber,
    packageTolerance,
    previousPackageNumber,
    currentPackageSessions,
    previousPackagePayments: previous.payments,
    currentPackagePayments: current.payments,
    allPayments,
    sessionsInCurrentPackage: currentPackageSessions.length,
    completedSessionsInCurrentPackage: currentPackageSessions.length,
    remainingSessionsInCurrentPackage: Math.max(
      CLINIC_SESSIONS_PER_PACKAGE - currentPackageSessions.length,
      0,
    ),
    contractValue,
    contractSource: packageContract?.source || 'legacy_fallback',
    packageContract,
    grossExpected: contractValue,
    partnerShareExpected: contractValue * CLINIC_PARTNER_SHARE_RATE,
    netExpected: contractValue * (1 - CLINIC_PARTNER_SHARE_RATE),
    paidGross,
    pendingGross,
    paidNet: paidGross * (1 - CLINIC_PARTNER_SHARE_RATE),
    pendingNet: pendingGross * (1 - CLINIC_PARTNER_SHARE_RATE),
    overdueGross: isOverdue ? pendingGross : 0,
    overdueNet: isOverdue ? pendingGross * (1 - CLINIC_PARTNER_SHARE_RATE) : 0,
    status,
    lastPayment,
    hasCurrentPackage,
    hasNewPackageWithoutPayment: completedPackageNumber > Math.max(paidActivatedPackageNumber, toleranceDisplayPackageNumber)
      && completedPackageNumber > 1,
    dueSessionNumber: dueSessionIndex + 1,
    dueDate,
  };
}
