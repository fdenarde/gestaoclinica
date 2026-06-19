import {
  getActivitySessionEndAt,
  getActivitySessionStartAt,
} from './activityGalleryStatus.js';

const COMPLETED_MEDIA_STATUSES = new Set(['Realizada', 'Reposição']);

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

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

export function activitySessionConsumesPackage(session) {
  const status = String(session?.status || '');
  if (COMPLETED_MEDIA_STATUSES.has(status)) return true;
  if (status === 'Falta') {
    return normalizeBoolean(
      session?.consumesPackage
      ?? session?.consumePackageSession
      ?? session?.countsTowardPackage,
    );
  }
  return false;
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
  const status = String(session.status || '');
  return COMPLETED_MEDIA_STATUSES.has(status) || isActivitySessionInProgress(session, now);
}

export function buildActivityMediaPackageModel(rawSessions, {
  patientId = '',
  now = new Date(),
} = {}) {
  const normalizedPatientId = normalizePatientId(patientId);
  const nowAt = normalizeNow(now);
  const sessions = (Array.isArray(rawSessions) ? rawSessions : [])
    .filter(session => session && !session.isBlocked)
    .filter(session => !normalizedPatientId || normalizePatientId(session.patientId) === normalizedPatientId)
    .filter(session => /^\d{4}-\d{2}-\d{2}$/.test(String(session.date || '')))
    .sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b)));

  let consumedPosition = 0;
  const enriched = [];

  for (const session of sessions) {
    const consumesPackage = activitySessionConsumesPackage(session);
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
    }

    if (packageNumber) {
      enriched.push({
        ...session,
        packageNumber,
        activityPackageNumber: packageNumber,
        activitySessionNumber: sessionNumber,
        consumesPackage,
        inProgress,
        selectableForMedia: isActivityMediaSelectableSession(session, nowAt),
      });
    }
  }

  const startedSessions = enriched.filter(session => session.selectableForMedia);
  const inProgressPackageNumber = enriched
    .filter(session => session.inProgress)
    .reduce((highest, session) => Math.max(highest, Number(session.activityPackageNumber || 0)), 0);
  const consumedPackageNumber = consumedPosition > 0
    ? Math.floor((consumedPosition - 1) / 10) + 1
    : 1;
  const currentPackageNumber = Math.max(consumedPackageNumber, inProgressPackageNumber || 1);

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
  };
}

export function getCurrentActivityMediaSessions(rawSessions, options = {}) {
  return buildActivityMediaPackageModel(rawSessions, options).currentSessions;
}
