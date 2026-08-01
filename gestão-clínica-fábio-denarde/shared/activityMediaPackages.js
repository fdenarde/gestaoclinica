import {
  getActivitySessionEndAt,
  getActivitySessionStartAt,
} from './activityGalleryStatus.js';
import { getActivatedPackageNumber } from './packagePayments.js';
import {
  getHighestRecordedTolerancePackageNumber,
  getTemporaryAuthorizedPackageNumber,
} from './packageTolerance.js';
import {
  dedupeSessionsByStableIdentity,
  sessionAllowsActivity,
  sessionConsumesPackage,
} from './sessionScheduling.js';

function normalizePatientId(value) {
  return String(value || '').trim();
}

function normalizeSessionSortKey(session) {
  const date = String(session?.date || '');
  const time = /^\d{2}:\d{2}$/.test(String(session?.time || '')) ? String(session.time) : '00:00';
  return `${date}T${time}|${String(session?.id || '')}`;
}

function normalizeNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function localDateKey(value) {
  const normalized = normalizeNow(value);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, '0');
  const day = String(normalized.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function activitySessionConsumesPackage(session) {
  return sessionConsumesPackage(session);
}

export function isActivitySessionInProgress(session, now = new Date()) {
  if (String(session?.status || '') !== 'Agendada' || Boolean(session?.isBlocked)) return false;
  const nowAt = normalizeNow(now);
  const startAt = getActivitySessionStartAt(session);
  const endAt = getActivitySessionEndAt(session);
  if (!startAt || !endAt) return false;
  return startAt.getTime() <= nowAt.getTime() && nowAt.getTime() < endAt.getTime();
}

export function isActivityMediaSelectableSession(session, now = new Date()) {
  if (!session || Boolean(session.isBlocked)) return false;
  const startAt = getActivitySessionStartAt(session);
  if (!startAt || startAt.getTime() > normalizeNow(now).getTime()) return false;
  return sessionAllowsActivity(session) || isActivitySessionInProgress(session, now);
}

export function buildActivityMediaPackageModel(rawSessions, {
  patientId = '',
  now = new Date(),
  payments = null,
  packageTolerances = [],
} = {}) {
  const normalizedPatientId = normalizePatientId(patientId);
  const nowAt = normalizeNow(now);
  const sessions = dedupeSessionsByStableIdentity(rawSessions)
    .filter(session => session && !session.isBlocked)
    .filter(session => !normalizedPatientId || normalizePatientId(session.patientId) === normalizedPatientId)
    .filter(session => /^\d{4}-\d{2}-\d{2}$/.test(String(session.date || '')))
    .sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b)));

  const paymentGateEnabled = Array.isArray(payments);
  const activatedPackageNumber = paymentGateEnabled
    ? getActivatedPackageNumber(payments, { patientId: normalizedPatientId })
    : Number.POSITIVE_INFINITY;
  const temporarilyAuthorizedPackageNumber = paymentGateEnabled
    ? getTemporaryAuthorizedPackageNumber({
        patient: { id: normalizedPatientId, packageTolerances },
        packageTolerances,
        sessions,
        payments,
        now: nowAt,
      })
    : Number.POSITIVE_INFINITY;
  const historicallyAuthorizedPackageNumber = paymentGateEnabled
    ? getHighestRecordedTolerancePackageNumber(packageTolerances)
    : Number.POSITIVE_INFINITY;
  let consumedPosition = 0;
  let naturalInProgressPackageNumber = 0;
  const packageCandidates = [];

  for (const session of sessions) {
    const consumesPackage = sessionConsumesPackage(session, { throughDate: localDateKey(nowAt) });
    const inProgress = isActivitySessionInProgress(session, nowAt);
    let packageNumber = null;
    let sessionNumber = null;

    if (consumesPackage) {
      consumedPosition += 1;
      packageNumber = Math.floor((consumedPosition - 1) / 10) + 1;
      sessionNumber = ((consumedPosition - 1) % 10) + 1;
    } else if (inProgress) {
      packageNumber = Math.floor(consumedPosition / 10) + 1;
      sessionNumber = (consumedPosition % 10) + 1;
      naturalInProgressPackageNumber = Math.max(naturalInProgressPackageNumber, packageNumber);
    }

    if (packageNumber) {
      const enrichedSession = {
        ...session,
        packageNumber,
        activityPackageNumber: packageNumber,
        activitySessionNumber: sessionNumber,
        consumesPackage,
        inProgress,
        selectableForMedia: isActivityMediaSelectableSession(session, nowAt),
      };
      packageCandidates.push(enrichedSession);
    }
  }

  const consumedPackageNumber = consumedPosition > 0
    ? Math.floor((consumedPosition - 1) / 10) + 1
    : 1;
  const fullyConsumedPackageNumber = Math.floor(consumedPosition / 10);
  const visiblePackageLimit = paymentGateEnabled
    ? Math.max(
        1,
        activatedPackageNumber,
        temporarilyAuthorizedPackageNumber,
        historicallyAuthorizedPackageNumber,
        fullyConsumedPackageNumber,
      )
    : Number.POSITIVE_INFINITY;
  const enriched = packageCandidates.filter(session => session.activityPackageNumber <= visiblePackageLimit);
  const awaitingPaymentSessions = packageCandidates.filter(session => session.activityPackageNumber > visiblePackageLimit);
  const startedSessions = enriched.filter(session => session.selectableForMedia);
  const naturalCurrentPackageNumber = Math.max(consumedPackageNumber, naturalInProgressPackageNumber || 1);
  const currentPackageNumber = paymentGateEnabled
    ? Math.max(1, Math.min(naturalCurrentPackageNumber, visiblePackageLimit))
    : naturalCurrentPackageNumber;

  const packagesByNumber = new Map();
  for (const session of startedSessions) {
    const number = Number(session.activityPackageNumber || 0);
    if (!number || number > currentPackageNumber) continue;
    const pkg = packagesByNumber.get(number) || {
      number,
      status: number === currentPackageNumber ? 'current' : 'previous',
      sessions: [],
      startDate: '',
      endDate: '',
    };
    pkg.sessions.push(session);
    const date = String(session.date || '');
    if (!pkg.startDate || date < pkg.startDate) pkg.startDate = date;
    if (!pkg.endDate || date > pkg.endDate) pkg.endDate = date;
    packagesByNumber.set(number, pkg);
  }

  if (!packagesByNumber.has(currentPackageNumber)) {
    packagesByNumber.set(currentPackageNumber, {
      number: currentPackageNumber,
      status: 'current',
      sessions: [],
      startDate: '',
      endDate: '',
    });
  }

  const packages = [...packagesByNumber.values()]
    .sort((a, b) => b.number - a.number)
    .map(pkg => ({
      ...pkg,
      status: pkg.number === currentPackageNumber ? 'current' : 'previous',
      sessions: pkg.sessions
        .slice()
        .sort((a, b) => normalizeSessionSortKey(b).localeCompare(normalizeSessionSortKey(a))),
    }));

  return {
    currentPackageNumber,
    consumedSessionCount: consumedPosition,
    packages,
    currentSessions: packages.find(pkg => pkg.number === currentPackageNumber)?.sessions || [],
    activatedPackageNumber: Number.isFinite(activatedPackageNumber) ? activatedPackageNumber : null,
    temporarilyAuthorizedPackageNumber: Number.isFinite(temporarilyAuthorizedPackageNumber) ? temporarilyAuthorizedPackageNumber : null,
    historicallyAuthorizedPackageNumber: Number.isFinite(historicallyAuthorizedPackageNumber) ? historicallyAuthorizedPackageNumber : null,
    visiblePackageLimit: Number.isFinite(visiblePackageLimit) ? visiblePackageLimit : null,
    awaitingPaymentSessions,
  };
}

export function getCurrentActivityMediaSessions(rawSessions, options = {}) {
  return buildActivityMediaPackageModel(rawSessions, options).currentSessions;
}
