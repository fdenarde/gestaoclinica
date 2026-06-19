import type { Payment, Session } from '../types';
import {
  buildActivityMediaPackageModel as buildSharedActivityMediaPackageModel,
  getCurrentActivityMediaSessions as getSharedCurrentActivityMediaSessions,
  isActivityMediaSelectableSession as isSharedActivityMediaSelectableSession,
  isActivitySessionInProgress as isSharedActivitySessionInProgress,
} from '../../shared/activityMediaPackages.js';

export interface ActivityMediaPackageSession extends Session {
  activityPackageNumber: number;
  activitySessionNumber: number;
  consumesPackage: boolean;
  inProgress: boolean;
  selectableForMedia: boolean;
}

export interface ActivityMediaPackage {
  number: number;
  status: 'current' | 'previous';
  startDate: string;
  endDate: string;
  sessions: ActivityMediaPackageSession[];
}

export interface ActivityMediaPackageModel {
  currentPackageNumber: number;
  consumedSessionCount: number;
  packages: ActivityMediaPackage[];
  currentSessions: ActivityMediaPackageSession[];
  activatedPackageNumber?: number | null;
  awaitingPaymentSessions?: ActivityMediaPackageSession[];
}

export function buildActivityMediaPackageModel({
  patientId,
  sessions,
  now = new Date(),
  payments = null,
}: {
  patientId: string;
  sessions: Session[];
  now?: Date;
  payments?: Payment[] | null;
}): ActivityMediaPackageModel {
  return buildSharedActivityMediaPackageModel(sessions, { patientId, now, payments }) as ActivityMediaPackageModel;
}

export function getCurrentActivityMediaSessions({
  patientId,
  sessions,
  now = new Date(),
  payments = null,
}: {
  patientId: string;
  sessions: Session[];
  now?: Date;
  payments?: Payment[] | null;
}): ActivityMediaPackageSession[] {
  return getSharedCurrentActivityMediaSessions(sessions, { patientId, now, payments }) as ActivityMediaPackageSession[];
}

export function isActivitySessionInProgress(session: Session, now = new Date()): boolean {
  return Boolean(isSharedActivitySessionInProgress(session, now));
}

export function isActivityMediaSelectableSession(session: Session, now = new Date()): boolean {
  return Boolean(isSharedActivityMediaSelectableSession(session, now));
}
