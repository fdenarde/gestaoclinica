import { getActivatedPackageNumber } from '../../shared/packagePayments.js';

const CONSUMED_STATUSES = new Set(['Realizada', 'Reposição', 'late_cancellation_no_replacement']);
const EXCLUDED_STATUSES = new Set(['Cancelada']);

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeSessionSortKey(session) {
  const date = String(session?.date || '');
  const time = /^\d{2}:\d{2}$/.test(String(session?.time || '')) ? String(session.time) : '00:00';
  return `${date}T${time}|${String(session?.id || '')}`;
}

export function sessionConsumesPackage(session) {
  const status = String(session?.status || '');
  if (CONSUMED_STATUSES.has(status)) return true;
  if (status === 'Falta') {
    return normalizeBoolean(
      session?.consumesPackage
      ?? session?.consumePackageSession
      ?? session?.countsTowardPackage,
    );
  }
  return false;
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

function packageStatus(number, currentPackageNumber) {
  if (number < currentPackageNumber) return 'previous';
  if (number === currentPackageNumber) return 'current';
  return 'future';
}

export function buildResponsiblePackages(rawSessions, {
  today = new Date().toISOString().slice(0, 10),
  payments = [],
} = {}) {
  const sessions = (Array.isArray(rawSessions) ? rawSessions : [])
    .filter(session => session && !session.isBlocked && !EXCLUDED_STATUSES.has(String(session.status || '')))
    .filter(session => /^\d{4}-\d{2}-\d{2}$/.test(String(session.date || '')))
    .sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b)));

  const patientId = String(sessions.find(session => session?.patientId)?.patientId || payments.find(payment => payment?.patientId)?.patientId || '');
  const activatedPackageNumber = getActivatedPackageNumber(payments, { patientId });
  const consumedTotal = sessions.filter(sessionConsumesPackage).length;
  const naturalCurrentPackageNumber = consumedTotal > 0
    ? Math.floor((consumedTotal - 1) / 10) + 1
    : 1;
  const currentPackageNumber = Math.max(1, Math.min(naturalCurrentPackageNumber, activatedPackageNumber));
  const packages = new Map();
  let consumedSeen = 0;
  let plannedSeen = 0;
  let awaitingPaymentSessionCount = 0;

  for (const session of sessions) {
    const consumesPackage = sessionConsumesPackage(session);
    const status = String(session.status || 'Agendada');
    let ordinal;

    if (consumesPackage) {
      ordinal = consumedSeen;
      consumedSeen += 1;
      plannedSeen = 0;
    } else if (status === 'Agendada') {
      ordinal = consumedSeen + plannedSeen;
      plannedSeen += 1;
    } else {
      ordinal = consumedSeen;
    }

    const packageNumber = Math.floor(ordinal / 10) + 1;
    const sessionNumber = (ordinal % 10) + 1;
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
    consumedTotal,
    awaitingPaymentSessionCount,
    packages: visiblePackages,
  };
}

export function getPackageForMedia(media, sessionPackageMap, packages, today = new Date().toISOString().slice(0, 10)) {
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
