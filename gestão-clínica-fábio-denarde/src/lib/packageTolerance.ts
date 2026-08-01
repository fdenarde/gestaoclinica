import type { AppState, Patient } from '../types';
import type { PackageFinancialSummary } from './financePackages';
import type {
  PackageToleranceAlert,
  PackageToleranceReasonCode,
  PackageToleranceRecord,
  PackageToleranceResolution,
} from '../types/packageTolerance';
import {
  PACKAGE_TOLERANCE_REASON_CODES,
  addPackageToleranceDays,
  closePackageTolerance,
  closePackageToleranceAfterPayment,
  getLatestPackageTolerance,
  grantPackageTolerance,
  listPackageTolerances,
  resolvePackageTolerance,
  resolvePackageToleranceOffer,
} from '../../shared/packageTolerance.js';

export const DEFAULT_TOLERANCE_DAYS = 5;
export const DEFAULT_TOLERANCE_MAX_SESSIONS = 2;

export const PACKAGE_TOLERANCE_REASON_OPTIONS = Object.entries(PACKAGE_TOLERANCE_REASON_CODES).map(([value, label]) => ({
  value: value as PackageToleranceReasonCode,
  label: String(label),
}));

export function suggestedToleranceDeadline(dateKey: string): string {
  return addPackageToleranceDays(dateKey, DEFAULT_TOLERANCE_DAYS);
}

export function savePackageTolerance(
  patient: Patient,
  input: {
    packageNumber: number;
    reasonCode: PackageToleranceReasonCode;
    reasonText?: string;
    notes?: string;
    promisedPaymentDate: string;
    expiresAt: string;
    maxSessions: number;
    actor: string;
    now?: Date;
  },
): Patient {
  return grantPackageTolerance(patient, input) as Patient;
}

export function endPackageTolerance(
  patient: Patient,
  input: { packageNumber: number; actor: string; reason?: string; now?: Date },
): Patient {
  return closePackageTolerance(patient, input) as Patient;
}

export function endPackageToleranceAfterPayment(
  patient: Patient,
  input: { packageNumber: number; actor: string; now?: Date },
): Patient {
  return closePackageToleranceAfterPayment(patient, input) as Patient;
}

export function latestTolerance(patient: Patient, packageNumber: number): PackageToleranceRecord | null {
  return getLatestPackageTolerance(patient, packageNumber) as PackageToleranceRecord | null;
}

export type PackageToleranceOffer = {
  canOffer: boolean;
  targetPackageNumber: number;
  reason: 'none' | 'existing_tolerance' | 'current_package_unpaid' | 'new_package_without_payment' | 'completed_package_boundary';
  hasCurrentUnpaidPackage: boolean;
};

export function getPackageToleranceOffer(summary: PackageFinancialSummary): PackageToleranceOffer {
  return resolvePackageToleranceOffer(summary, { sessionsPerPackage: 10 }) as PackageToleranceOffer;
}

export function resolvePatientTolerance(
  state: AppState,
  patient: Patient,
  packageNumber: number,
  now = new Date(),
): PackageToleranceResolution {
  return resolvePackageTolerance({
    patient,
    sessions: state.sessions,
    payments: state.payments,
    packageNumber,
    now,
  }) as PackageToleranceResolution;
}

export function buildPackageToleranceAlerts(state: AppState, now = new Date()): PackageToleranceAlert[] {
  const alerts: PackageToleranceAlert[] = [];

  for (const patient of state.patients.filter(item => item.status === 'Ativo')) {
    const toleranceRecords = listPackageTolerances(patient) as PackageToleranceRecord[];
    const packageNumbers: number[] = [...new Set<number>(
      toleranceRecords.map(item => Number(item.packageNumber || 0)).filter(value => value > 0),
    )];
    for (const packageNumber of packageNumbers) {
      const resolution = resolvePatientTolerance(state, patient, packageNumber, now);
      if (!resolution.record || ['none', 'closed', 'paid'].includes(resolution.status)) continue;

      let status: PackageToleranceAlert['status'];
      if (resolution.status === 'limit_reached') status = 'limit_reached';
      else if (resolution.status === 'expired') status = 'expired';
      else if (resolution.daysRemaining === 0) status = 'expires_today';
      else if ((resolution.daysRemaining ?? 99) <= 1) status = 'expiring';
      else status = 'active';

      alerts.push({
        id: `package-tolerance:${patient.id}:${packageNumber}:${resolution.record.id}`,
        patientId: patient.id,
        patientName: patient.name || patient.fullName || 'Atendente',
        guardianName: patient.guardianName || 'Responsável',
        packageNumber,
        status,
        expiresAt: resolution.record.expiresAt,
        promisedPaymentDate: resolution.record.promisedPaymentDate,
        maxSessions: resolution.record.maxSessions,
        sessionsUsed: resolution.sessionsUsed,
        remainingSessions: resolution.remainingSessions,
        daysRemaining: resolution.daysRemaining,
        reasonLabel: PACKAGE_TOLERANCE_REASON_CODES[resolution.record.reasonCode] || PACKAGE_TOLERANCE_REASON_CODES.other,
      });
    }
  }

  const priority: Record<PackageToleranceAlert['status'], number> = {
    limit_reached: 0,
    expired: 1,
    expires_today: 2,
    expiring: 3,
    active: 4,
  };
  return alerts.sort((left, right) => (
    priority[left.status] - priority[right.status]
    || left.expiresAt.localeCompare(right.expiresAt)
    || left.patientName.localeCompare(right.patientName, 'pt-BR')
  ));
}
