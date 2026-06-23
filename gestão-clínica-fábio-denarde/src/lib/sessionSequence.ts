import { Session } from '../types';
import {
  getCompletedSessionCycleNumber as getCompletedSessionCycleNumberShared,
  getCompletedSessions as getCompletedSessionsShared,
  getCurrentPackageProgress as getCurrentPackageProgressShared,
  getPlannedSessionCycleNumber as getPlannedSessionCycleNumberShared,
  getSessionCycleLabel as getSessionCycleLabelShared,
  getSessionCycleNumber as getSessionCycleNumberShared,
  getSessionCycleNumberFromPosition as getSessionCycleNumberFromPositionShared,
  getSessionLogicalPosition as getSessionLogicalPositionShared,
  getSessionSequenceSortKey as getSessionSequenceSortKeyShared,
  isCompletedClinicalSession as isCompletedClinicalSessionShared,
  mergeSessionSequenceSource as mergeSessionSequenceSourceShared,
} from '../../shared/sessionScheduling.js';

type SequencedSession = Pick<
  Session,
  | 'id'
  | 'patientId'
  | 'date'
  | 'time'
  | 'status'
  | 'isBlocked'
  | 'consumesPackage'
  | 'removedFromAgenda'
  | 'logicalSessionNumber'
  | 'logicalSessionPosition'
  | 'rescheduledAt'
  | 'rescheduleHistory'
>;

export function getSessionSequenceSortKey(session: Pick<Session, 'date' | 'time' | 'id'>) {
  return getSessionSequenceSortKeyShared(session);
}

export function mergeSessionSequenceSource(
  sessions: SequencedSession[],
  supplementalSessions: SequencedSession[],
) {
  return mergeSessionSequenceSourceShared(sessions, supplementalSessions) as SequencedSession[];
}

export function getSessionCycleNumberFromPosition(position: number) {
  return getSessionCycleNumberFromPositionShared(position);
}

export function isCompletedClinicalSession(session: Pick<Session, 'status' | 'consumesPackage' | 'isBlocked' | 'removedFromAgenda'>) {
  return isCompletedClinicalSessionShared(session);
}

export function getCompletedSessions(sessions: SequencedSession[], patientId: string) {
  return getCompletedSessionsShared(sessions, patientId) as SequencedSession[];
}

export function getCompletedSessionCycleNumber(sessions: SequencedSession[], session: SequencedSession) {
  return getCompletedSessionCycleNumberShared(sessions, session);
}

export function getPlannedSessionCycleNumber(sessions: SequencedSession[], session: SequencedSession) {
  return getPlannedSessionCycleNumberShared(sessions, session);
}

export function getSessionLogicalPosition(sessions: SequencedSession[], session: SequencedSession) {
  return getSessionLogicalPositionShared(sessions, session);
}

export function getSessionCycleNumber(sessions: SequencedSession[], session: SequencedSession) {
  return getSessionCycleNumberShared(sessions, session);
}

export function getSessionCycleLabel(sessions: SequencedSession[], session: SequencedSession) {
  return getSessionCycleLabelShared(sessions, session);
}

export function getCurrentPackageProgress(sessions: SequencedSession[], patientId: string) {
  return getCurrentPackageProgressShared(sessions, patientId);
}
