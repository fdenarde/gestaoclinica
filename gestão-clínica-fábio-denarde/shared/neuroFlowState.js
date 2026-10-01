import {
  getActivitySessionStartAt,
  getActivitySessionEndAt,
} from './activityGalleryStatus.js';
import {
  getSessionSequenceSortKey,
  isSessionRemovedOrBlocked,
  sessionAllowsActivity,
  sessionConsumesPackage,
} from './sessionScheduling.js';

export const ABSENCE_STATUSES = new Set([
  'Falta',
  'Falta.Prof',
  'Cancelada',
  'late_cancellation_no_replacement',
]);

function hasText(value) {
  return Boolean(String(value || '').trim());
}

function localDateKey(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date(value || Date.now());
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

export function isExplicitSessionAbsence(session = {}) {
  if (!session || isSessionRemovedOrBlocked(session)) return false;
  const canonicalAbsenceFields = [
    session.noReplacementReasonCode,
    session.noReplacementReasonText,
    session.noReplacementObservation,
  ].some(hasText);
  return ABSENCE_STATUSES.has(String(session.status || '')) || canonicalAbsenceFields;
}

function isStartedOrInProgress(session, now) {
  const startAt = getActivitySessionStartAt(session);
  const endAt = getActivitySessionEndAt(session);
  if (!startAt || startAt.getTime() > now.getTime()) return false;
  return String(session.status || '') !== 'Agendada'
    || !endAt
    || now.getTime() < endAt.getTime();
}

export function buildPackageTimeline(rawSessions = [], patientId = '', packageNumber = 0, now = new Date()) {
  const normalizedPatientId = String(patientId || '').trim();
  const normalizedPackageNumber = Number(packageNumber) || 1;
  const nowAt = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date(now || Date.now());
  let consumedPosition = 0;

  return (Array.isArray(rawSessions) ? rawSessions : [])
    .filter(session => (
      session
      && String(session.patientId || '').trim() === normalizedPatientId
      && !isSessionRemovedOrBlocked(session)
    ))
    .slice()
    .sort((left, right) => getSessionSequenceSortKey(left).localeCompare(getSessionSequenceSortKey(right)))
    .flatMap(session => {
      const consumes = sessionConsumesPackage(session, { throughDate: localDateKey(nowAt) });
      const absence = isExplicitSessionAbsence(session);
      const started = isStartedOrInProgress(session, nowAt);
      if (consumes) consumedPosition += 1;
      const activityPackageNumber = consumes
        ? Math.floor((consumedPosition - 1) / 10) + 1
        : Math.floor(consumedPosition / 10) + 1;
      const activitySessionNumber = consumes
        ? ((consumedPosition - 1) % 10) + 1
        : (consumedPosition % 10) + 1;
      if (activityPackageNumber !== normalizedPackageNumber || !started) return [];
      if (!sessionAllowsActivity(session, { throughDate: localDateKey(nowAt) }) && !absence) return [];
      return [{
        ...session,
        activityPackageNumber,
        activitySessionNumber,
        consumesPackage: consumes,
      }];
    });
}
