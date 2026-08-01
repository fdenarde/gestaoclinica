import type { Payment, Session } from '../types';
import type { PackageToleranceRecord } from '../types/packageTolerance';
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
  temporarilyAuthorizedPackageNumber?: number | null;
  historicallyAuthorizedPackageNumber?: number | null;
  visiblePackageLimit?: number | null;
  awaitingPaymentSessions?: ActivityMediaPackageSession[];
}

export function buildActivityMediaPackageModel({
  patientId,
  sessions,
  now = new Date(),
  payments = null,
  packageTolerances = [],
}: {
  patientId: string;
  sessions: Session[];
  now?: Date;
  payments?: Payment[] | null;
  packageTolerances?: PackageToleranceRecord[];
}): ActivityMediaPackageModel {
  return buildSharedActivityMediaPackageModel(sessions, { patientId, now, payments, packageTolerances }) as ActivityMediaPackageModel;
}

export function getCurrentActivityMediaSessions({
  patientId,
  sessions,
  now = new Date(),
  payments = null,
  packageTolerances = [],
}: {
  patientId: string;
  sessions: Session[];
  now?: Date;
  payments?: Payment[] | null;
  packageTolerances?: PackageToleranceRecord[];
}): ActivityMediaPackageSession[] {
  return getSharedCurrentActivityMediaSessions(sessions, { patientId, now, payments, packageTolerances }) as ActivityMediaPackageSession[];
}

export function isActivitySessionInProgress(session: Session, now = new Date()): boolean {
  return Boolean(isSharedActivitySessionInProgress(session, now));
}

export function isActivityMediaSelectableSession(session: Session, now = new Date()): boolean {
  return Boolean(isSharedActivityMediaSelectableSession(session, now));
}
