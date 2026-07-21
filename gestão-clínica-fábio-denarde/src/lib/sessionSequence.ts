import { Session } from '../types';
import {
  getCompletedSessionCycleNumber as getCompletedSessionCycleNumberShared,
  getCompletedSessions as getCompletedSessionsShared,
  getCurrentPackageProgress as getCurrentPackageProgressShared,
  buildEffectiveSessionHistory as buildEffectiveSessionHistoryShared,
  getPlannedSessionCycleNumber as getPlannedSessionCycleNumberShared,
  getSessionCycleLabel as getSessionCycleLabelShared,
  getSessionCycleNumber as getSessionCycleNumberShared,
  getSessionCycleNumberFromPosition as getSessionCycleNumberFromPositionShared,
  getSessionLogicalPosition as getSessionLogicalPositionShared,
  getSessionSequenceSortKey as getSessionSequenceSortKeyShared,
  isCompletedClinicalSession as isCompletedClinicalSessionShared,
  isCountedAbsenceSession as isCountedAbsenceSessionShared,
  getPackageConsumptionDecision as getPackageConsumptionDecisionShared,
  getSessionPresentationStatus as getSessionPresentationStatusShared,
  hasExplicitPackageConsumptionDecision as hasExplicitPackageConsumptionDecisionShared,
  mergeSessionSequenceSource as mergeSessionSequenceSourceShared,
  sessionAllowsActivity as sessionAllowsActivityShared,
  sessionConsumesPackage as sessionConsumesPackageShared,
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
  | 'packageConsumptionDecidedAt'
  | 'packageConsumptionDecidedBy'
  | 'removedFromAgenda'
  | 'logicalSessionNumber'
  | 'logicalSessionPosition'
  | 'rescheduledAt'
  | 'rescheduleHistory'
>;

export interface EffectiveSessionHistoryItem {
  id: string;
  sessionId: string;
  patientId: string;
  packageNumber: number | null;
  date: string;
  time: string;
  sessionNumber: number;
  logicalSessionPosition: number;
  originalStatus: string;
  presentationStatus: string;
  consumesPackage: boolean;
  packageConsumptionDecision: boolean | null;
  packageConsumptionDecisionRecorded: boolean;
  hasActivity: boolean;
  activityCount: number;
  sessionKind: 'normal' | 'replacement';
  absenceReason: string;
  reopened: boolean;
  reverted: boolean;
  removed: boolean;
}

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

export function sessionConsumesPackage(session: SequencedSession, throughDate = '') {
  return Boolean(sessionConsumesPackageShared(session, { throughDate }));
}

export function isCountedAbsenceSession(session: SequencedSession, throughDate = '') {
  return Boolean(isCountedAbsenceSessionShared(session, { throughDate }));
}

export function getPackageConsumptionDecision(session: SequencedSession) {
  return getPackageConsumptionDecisionShared(session) as boolean | null;
}

export function hasExplicitPackageConsumptionDecision(session: SequencedSession) {
  return Boolean(hasExplicitPackageConsumptionDecisionShared(session));
}

export function getSessionPresentationStatus(session: SequencedSession) {
  return String(getSessionPresentationStatusShared(session));
}

export function sessionAllowsActivity(session: SequencedSession, throughDate = '') {
  return Boolean(sessionAllowsActivityShared(session, { throughDate }));
}

export function getCompletedSessions(sessions: SequencedSession[], patientId: string, throughDate = '') {
  return getCompletedSessionsShared(sessions, patientId, { throughDate }) as SequencedSession[];
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

export function buildEffectiveSessionHistory(
  sessions: SequencedSession[],
  options: {
    patientId?: string;
    activities?: Array<{ id?: string; sessionId?: string | null; sessionIds?: string[] }>;
    throughDate?: string;
    includeRemoved?: boolean;
  } = {},
) {
  return buildEffectiveSessionHistoryShared(sessions, options) as EffectiveSessionHistoryItem[];
}
