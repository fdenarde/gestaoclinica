import { getActivatedPackageNumber } from '../../shared/packagePayments.js';
import { getHighestRecordedTolerancePackageNumber } from '../../shared/packageTolerance.js';
import { resolvePackageContract } from '../../shared/packageContract.js';
import { getSaoPauloDateKey } from '../../shared/clinicalDate.js';
import {
  dedupeSessionsByStableIdentity,
  getSessionPackagePosition,
  sessionConsumesPackage as sharedSessionConsumesPackage,
} from '../../shared/sessionScheduling.js';

const EXCLUDED_STATUSES = new Set(['Cancelada']);

function normalizeSessionSortKey(session) {
  const date = String(session?.date || '');
  const time = /^\d{2}:\d{2}$/.test(String(session?.time || '')) ? String(session.time) : '00:00';
  return `${date}T${time}|${String(session?.id || '')}`;
}

export function sessionConsumesPackage(session) {
  return sharedSessionConsumesPackage(session);
}

function createPackage(number, status = 'future') {
  return {
    number,
    status,
    startDate: '',
    endDate: '',
    consumedCount: 0,
    remainingCount: 10,
    sessions: [],
  };
}

export function applyResponsiblePackagePaymentSummary(pkg, paymentSummary) {
  return Object.assign(pkg, {
    packageNumber: paymentSummary.packageNumber,
    paidAmount: paymentSummary.paidAmount,
    pendingAmount: paymentSummary.pendingAmount,
    payments: paymentSummary.payments,
    installments: paymentSummary.installments,
    isPaid: paymentSummary.isPaid,
    financialStatus: paymentSummary.financialStatus,
  });
}

function packageStatus(number, currentPackageNumber) {
  if (number < currentPackageNumber) return 'previous';
  if (number === currentPackageNumber) return 'current';
  return 'future';
}

export function buildResponsiblePackages(rawSessions, {
  today = getSaoPauloDateKey(),
  payments = [],
  packageTolerances = [],
  patient = null,
} = {}) {
  const sessions = dedupeSessionsByStableIdentity(rawSessions)
    .filter(session => session && !session.isBlocked && !EXCLUDED_STATUSES.has(String(session.status || '')))
    .filter(session => /^\d{4}-\d{2}-\d{2}$/.test(String(session.date || '')))
    .sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b)));

  const patientId = String(sessions.find(session => session?.patientId)?.patientId || payments.find(payment => payment?.patientId)?.patientId || '');
  const packageValueResolver = packageNumber => resolvePackageContract(patient, packageNumber).contractValue;
  const paidActivatedPackageNumber = getActivatedPackageNumber(payments, {
    patientId,
    throughDate: today,
    packageValueResolver,
  });
  const tolerancePackageNumber = getHighestRecordedTolerancePackageNumber(packageTolerances);
  const activatedPackageNumber = Math.max(paidActivatedPackageNumber, tolerancePackageNumber);
  const consumedTotal = sessions.filter(session => sharedSessionConsumesPackage(session, { throughDate: today })).length;
  const naturalCurrentPackageNumber = consumedTotal > 0
    ? Math.floor((consumedTotal - 1) / 10) + 1
    : 1;
  const currentPackageNumber = Math.max(1, Math.min(naturalCurrentPackageNumber, activatedPackageNumber));
  const packages = new Map();
  let awaitingPaymentSessionCount = 0;

  for (const session of sessions) {
    const position = getSessionPackagePosition(sessions, session, { throughDate: today });
    const consumesPackage = position.consumesPackage;
    const packageNumber = position.packageNumber;
    const sessionNumber = position.sessionNumber;
    if (packageNumber <= 0 || sessionNumber <= 0) continue;
    if (packageNumber > activatedPackageNumber) {
      awaitingPaymentSessionCount += 1;
      continue;
    }

    const resolvedStatus = packageStatus(packageNumber, currentPackageNumber);
    const pkg = packages.get(packageNumber) || createPackage(packageNumber, resolvedStatus);
    const enriched = {
      ...session,
      packageNumber,
      sessionNumber,
      positionType: position.positionType,
      consumesPackage,
      isFuture: String(session.date) > today,
    };

    pkg.sessions.push(enriched);
    if (!pkg.startDate || String(session.date) < pkg.startDate) pkg.startDate = String(session.date);
    if (!pkg.endDate || String(session.date) > pkg.endDate) pkg.endDate = String(session.date);
    if (consumesPackage) pkg.consumedCount += 1;
    pkg.remainingCount = Math.max(10 - pkg.consumedCount, 0);
    packages.set(packageNumber, pkg);
  }

  if (!packages.has(currentPackageNumber)) {
    packages.set(currentPackageNumber, createPackage(currentPackageNumber, 'current'));
  }

  const visiblePackages = [...packages.values()]
    .filter(pkg => pkg.number <= activatedPackageNumber)
    .sort((a, b) => a.number - b.number)
    .map(pkg => ({
      ...pkg,
      status: packageStatus(pkg.number, currentPackageNumber),
      sessions: pkg.sessions.sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b))),
    }));

  return {
    currentPackageNumber,
    activatedPackageNumber,
    paidActivatedPackageNumber,
    tolerancePackageNumber,
    consumedTotal,
    awaitingPaymentSessionCount,
    packages: visiblePackages,
  };
}

export function getPackageForMedia(media, sessionPackageMap, packages, today = getSaoPauloDateKey()) {
  const sessionDate = String(media?.sessionDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || sessionDate > today) return null;
  const bySession = sessionPackageMap.get(String(media?.sessionId || ''));
  if (bySession) return bySession;

  return (Array.isArray(packages) ? packages : []).find(pkg => {
    if (!pkg.startDate) return false;
    const rangeEnd = pkg.endDate || today;
    return sessionDate >= pkg.startDate && sessionDate <= rangeEnd;
  })?.number || null;
}
