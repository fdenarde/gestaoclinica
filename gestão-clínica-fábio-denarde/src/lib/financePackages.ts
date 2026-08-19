import { Payment, Patient, Session, type PackageContractSnapshot } from '../types';
import type { PackageToleranceResolution } from '../types/packageTolerance';
import { calculateCanonicalPackageFinancialSummary } from '../../shared/packageFinancialSummary.js';
import { getActivatedPackageNumber } from '../../shared/packagePayments.js';
import { sessionConsumesPackage } from '../../shared/sessionScheduling.js';
import {
  normalizePackageContractValue,
  resolvePackageContract,
  upsertPackageContractSnapshot,
} from '../../shared/packageContract.js';

export const PACKAGE_GROSS_VALUE = 1000;
export const PARTNER_SHARE_RATE = 0.2;
export const PACKAGE_NET_VALUE = PACKAGE_GROSS_VALUE * (1 - PARTNER_SHARE_RATE);
export const SESSIONS_PER_PACKAGE = 10;

export type FinancialStatus = 'QUITADO' | 'PARCIAL' | 'EM ABERTO' | 'ATRASADO' | 'EM TOLERÂNCIA' | 'TOLERÂNCIA VENCIDA' | 'SEM MOVIMENTAÇÃO';

export interface PackageFinancialSummary {
  patient: Patient;
  packageNumber: number;
  consumedSessionTotal: number;
  naturalCurrentPackageNumber: number;
  naturalCurrentPackageConsumedCount: number;
  nextPackageRequiringAuthorization: number;
  paidActivatedPackageNumber: number;
  temporaryAuthorizedPackageNumber: number;
  toleranceDisplayPackageNumber: number;
  packageTolerance: PackageToleranceResolution;
  previousPackageNumber: number | null;
  currentPackageSessions: Session[];
  previousPackagePayments: Payment[];
  currentPackagePayments: Payment[];
  allPayments: Payment[];
  sessionsInCurrentPackage: number;
  completedSessionsInCurrentPackage: number;
  remainingSessionsInCurrentPackage: number;
  contractValue: number;
  contractSource: 'explicit' | 'legacy_fallback';
  packageContract: PackageContractSnapshot | {
    packageNumber: number;
    packageContractValue: number;
    contractValue: number;
    source: 'legacy_fallback';
    snapshot: null;
  };
  grossExpected: number;
  partnerShareExpected: number;
  netExpected: number;
  paidGross: number;
  pendingGross: number;
  paidNet: number;
  pendingNet: number;
  overdueGross: number;
  overdueNet: number;
  status: FinancialStatus;
  lastPayment: Payment | null;
  hasCurrentPackage: boolean;
  hasNewPackageWithoutPayment: boolean;
  dueSessionNumber: number;
  dueDate: string;
}

export function getPaymentPackageNumber(payment: Payment, _packageStarts: { packageNumber: number; startDate: string }[]) {
  const packageNumber = Number(payment.packageNumber || 0);
  return packageNumber > 0 ? packageNumber : 1;
}

export function resolvePatientPackageContract(patient: Patient, packageNumber: number) {
  return resolvePackageContract(patient, packageNumber) as PackageFinancialSummary['packageContract'];
}

export function normalizePatientPackageContractValue(value: unknown): number {
  return normalizePackageContractValue(value);
}

export function setPatientPackageContract(
  patient: Patient,
  input: {
    packageNumber: number;
    packageContractValue: number;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    updatedBy?: string;
    receivedAmount?: number;
  },
): Patient {
  return upsertPackageContractSnapshot(patient, input) as Patient;
}

export function calculatePackageFinancialSummary(
  patient: Patient,
  sessions: Session[],
  payments: Payment[],
  today = new Date(),
): PackageFinancialSummary {
  const patientPayments = payments.filter(payment => payment.patientId === patient.id);
  const packageValueResolver = (packageNumber: number) => resolvePatientPackageContract(patient, packageNumber).contractValue;
  const activatedPackageNumberAtPresent = getActivatedPackageNumber(patientPayments, {
    patientId: patient.id,
    packageValueResolver,
  });
  const calculationDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const present = new Date();
  const presentDate = [
    present.getFullYear(),
    String(present.getMonth() + 1).padStart(2, '0'),
    String(present.getDate()).padStart(2, '0'),
  ].join('-');
  const activatedPackageNumber = calculationDate === presentDate
    ? activatedPackageNumberAtPresent
    : getActivatedPackageNumber(patientPayments, {
      patientId: patient.id,
      throughDate: calculationDate,
      packageValueResolver,
    });
  const completedPackageNumber = Math.ceil(
    sessions.filter(session => (
      session.patientId === patient.id
      && sessionConsumesPackage(session, { throughDate: calculationDate })
    )).length / SESSIONS_PER_PACKAGE,
  );
  const summary = calculateCanonicalPackageFinancialSummary({
    patient,
    sessions,
    payments,
    today,
    activatedPackageNumber,
    sessionConsumesPackageFn: sessionConsumesPackage,
  }) as PackageFinancialSummary;
  return {
    ...summary,
    hasNewPackageWithoutPayment: completedPackageNumber > Math.max(
      activatedPackageNumber,
      summary.toleranceDisplayPackageNumber || 0,
    ) && completedPackageNumber > 1,
  };
}
