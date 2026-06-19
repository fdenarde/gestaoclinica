import type { Session } from '../types';
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
}

export function buildActivityMediaPackageModel({
  patientId,
  sessions,
  now = new Date(),
}: {
  patientId: string;
  sessions: Session[];
  now?: Date;
}): ActivityMediaPackageModel {
  return buildSharedActivityMediaPackageModel(sessions, { patientId, now }) as ActivityMediaPackageModel;
}

export function getCurrentActivityMediaSessions({
  patientId,
  sessions,
  now = new Date(),
}: {
  patientId: string;
  sessions: Session[];
  now?: Date;
}): ActivityMediaPackageSession[] {
  return getSharedCurrentActivityMediaSessions(sessions, { patientId, now }) as ActivityMediaPackageSession[];
}

export function isActivitySessionInProgress(session: Session, now = new Date()): boolean {
  return Boolean(isSharedActivitySessionInProgress(session, now));
}

export function isActivityMediaSelectableSession(session: Session, now = new Date()): boolean {
  return Boolean(isSharedActivityMediaSelectableSession(session, now));
}
