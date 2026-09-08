import type { AppState, Patient, Payment, Session } from '../types';
import type { ActivityMediaPackage } from './activityMediaPackages';
import { sessionAllowsActivity } from '../../shared/sessionScheduling.js';

export function getActivityMonitoringStartDate(state: Pick<AppState, 'settings'>): string {
  const configured = String(state.settings?.activityMediaMonitoringStart || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : '';
}
export function selectActivityCandidateSessions(state: Pick<AppState, 'settings' | 'sessions'>): Session[] {
  const monitoringStart = getActivityMonitoringStartDate(state);
  if (!monitoringStart) return [];
  return state.sessions.filter(session => String(session.date || '') >= monitoringStart && sessionAllowsActivity(session));
}

export function selectActivityRefreshPackages(
  packages: ActivityMediaPackage[],
  candidateSessions: Session[],
): ActivityMediaPackage[] {
  const candidateSessionIds = new Set(candidateSessions.map(session => String(session.id || '')).filter(Boolean));
  return packages.filter(pkg => pkg.sessions.some(session => candidateSessionIds.has(String(session.id || ''))));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function relevantSession(session: Session): unknown {
  return {
    id: session.id,
    patientId: session.patientId,
    date: session.date,
    time: session.time,
    type: session.type,
    status: session.status,
    packageNumber: session.packageNumber,
    previousPackageNumber: session.previousPackageNumber,
    isBlocked: session.isBlocked,
    source: session.source,
    consumesPackage: session.consumesPackage,
    packageConsumptionDecidedAt: session.packageConsumptionDecidedAt,
    removedFromAgenda: session.removedFromAgenda,
    logicalSessionPosition: session.logicalSessionPosition,
    logicalSessionNumber: session.logicalSessionNumber,
  };
}

function relevantPatient(patient: Patient): unknown {
  return {
    id: patient.id,
    name: patient.name,
    fullName: patient.fullName,
    guardianName: patient.guardianName,
    doubleSession: patient.doubleSession,
    photoUrl: patient.photoUrl,
    photoStoragePath: patient.photoStoragePath,
    photoDriveFileId: patient.photoDriveFileId,
    packageTolerances: patient.packageTolerances,
  };
}

function relevantPayment(payment: Payment): unknown {
  return {
    id: payment.id,
    patientId: payment.patientId,
    amount: payment.amount,
    date: payment.date,
    installment: payment.installment,
    packageNumber: payment.packageNumber,
    status: payment.status,
  };
}

export function buildActivityRefreshSignature(state: AppState): string {
  const candidateSessions = selectActivityCandidateSessions(state);
  const candidatePatientIds = new Set(candidateSessions.map(session => String(session.patientId || '')).filter(Boolean));
  const sessions = state.sessions
    .filter(session => candidatePatientIds.has(String(session.patientId || '')))
    .map(relevantSession)
    .sort((left, right) => String((left as { id?: string }).id || '').localeCompare(String((right as { id?: string }).id || '')));
  const patients = state.patients
    .filter(patient => candidatePatientIds.has(String(patient.id || '')))
    .map(relevantPatient)
    .sort((left, right) => String((left as { id?: string }).id || '').localeCompare(String((right as { id?: string }).id || '')));
  const payments = state.payments
    .filter(payment => candidatePatientIds.has(String(payment.patientId || '')))
    .map(relevantPayment)
    .sort((left, right) => String((left as { id?: string }).id || '').localeCompare(String((right as { id?: string }).id || '')));
  return JSON.stringify(canonicalize({
    monitoringStart: getActivityMonitoringStartDate(state),
    sessions,
    patients,
    payments,
  }));
}
