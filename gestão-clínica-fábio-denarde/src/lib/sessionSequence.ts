import { Session, SessionStatus } from '../types';

type SequencedSession = Pick<Session, 'id' | 'patientId' | 'date' | 'time' | 'status' | 'isBlocked' | 'consumesPackage'>;

const COUNTED_STATUSES = new Set<string>([
  SessionStatus.REALIZADA,
  SessionStatus.REPOSICAO,
  SessionStatus.LATE_CANCELLATION_NO_REPLACEMENT
]);

const PLANNED_STATUSES = new Set<string>([
  SessionStatus.AGENDADA
]);

const WOULD_BE_STATUSES = new Set<string>([
  SessionStatus.FALTA,
  SessionStatus.FALTA_PROF,
  SessionStatus.CANCELADA
]);

function normalizeTimeForSort(time = '') {
  const [hour = '00', minute = '00'] = time.split(':');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

export function getSessionSequenceSortKey(session: Pick<Session, 'date' | 'time' | 'id'>) {
  return `${session.date || ''}T${normalizeTimeForSort(session.time)}|${session.id || ''}`;
}

export function getSessionCycleNumberFromPosition(position: number) {
  if (position <= 0) return 0;
  return ((position - 1) % 10) + 1;
}

export function isCompletedClinicalSession(session: Pick<Session, 'status' | 'consumesPackage'>) {
  return COUNTED_STATUSES.has(session.status)
    || (session.status === SessionStatus.FALTA && session.consumesPackage === true);
}

export function getCompletedSessions(sessions: SequencedSession[], patientId: string) {
  return sessions
    .filter(session => session.patientId === patientId && !session.isBlocked && isCompletedClinicalSession(session))
    .sort((a, b) => getSessionSequenceSortKey(a).localeCompare(getSessionSequenceSortKey(b)));
}

export function getCompletedSessionCycleNumber(sessions: SequencedSession[], session: SequencedSession) {
  const completed = getCompletedSessions(sessions, session.patientId);
  const index = completed.findIndex(item => item.id === session.id);
  return index >= 0 ? getSessionCycleNumberFromPosition(index + 1) : 0;
}

export function getPlannedSessionCycleNumber(sessions: SequencedSession[], session: SequencedSession) {
  const targetKey = getSessionSequenceSortKey(session);
  const completedBefore = sessions.filter(item =>
    item.patientId === session.patientId &&
    !item.isBlocked &&
    isCompletedClinicalSession(item) &&
    getSessionSequenceSortKey(item) < targetKey
  ).length;

  const plannedUpToTarget = sessions
    .filter(item =>
      item.patientId === session.patientId &&
      !item.isBlocked &&
      PLANNED_STATUSES.has(item.status) &&
      getSessionSequenceSortKey(item) <= targetKey
    )
    .sort((a, b) => getSessionSequenceSortKey(a).localeCompare(getSessionSequenceSortKey(b)));

  const plannedIndex = plannedUpToTarget.findIndex(item => item.id === session.id);
  return getSessionCycleNumberFromPosition(completedBefore + (plannedIndex >= 0 ? plannedIndex + 1 : 1));
}

export function getSessionCycleNumber(sessions: SequencedSession[], session: SequencedSession) {
  if (isCompletedClinicalSession(session)) {
    return getCompletedSessionCycleNumber(sessions, session);
  }

  if (PLANNED_STATUSES.has(session.status)) {
    return getPlannedSessionCycleNumber(sessions, session);
  }

  if (WOULD_BE_STATUSES.has(session.status)) {
    const targetKey = getSessionSequenceSortKey(session);
    const completedBefore = sessions.filter(item =>
      item.patientId === session.patientId &&
      !item.isBlocked &&
      isCompletedClinicalSession(item) &&
      getSessionSequenceSortKey(item) < targetKey
    ).length;
    return getSessionCycleNumberFromPosition(completedBefore + 1);
  }

  return 0;
}

export function getSessionCycleLabel(sessions: SequencedSession[], session: SequencedSession) {
  const number = getSessionCycleNumber(sessions, session);
  if (number <= 0) return '';

  if (isCompletedClinicalSession(session)) return `Sessão foi ${number}`;
  if (PLANNED_STATUSES.has(session.status)) return `Sessão será ${number}`;
  if (WOULD_BE_STATUSES.has(session.status)) return `Sessão seria ${number}`;
  return `Sessão ${number}`;
}

export function getCurrentPackageProgress(sessions: SequencedSession[], patientId: string) {
  const completedCount = getCompletedSessions(sessions, patientId).length;
  return completedCount === 0 ? 0 : getSessionCycleNumberFromPosition(completedCount);
}
