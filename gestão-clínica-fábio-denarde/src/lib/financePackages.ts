import { Payment, Patient, Session } from '../types';
import { calculateCanonicalPackageFinancialSummary } from '../../shared/packageFinancialSummary.js';
import { getActivatedPackageNumber } from '../../shared/packagePayments.js';
import { sessionConsumesPackage } from '../../shared/sessionScheduling.js';

export const PACKAGE_GROSS_VALUE = 1000;
export const PARTNER_SHARE_RATE = 0.2;
export const PACKAGE_NET_VALUE = PACKAGE_GROSS_VALUE * (1 - PARTNER_SHARE_RATE);
export const SESSIONS_PER_PACKAGE = 10;

export type FinancialStatus = 'QUITADO' | 'PARCIAL' | 'EM ABERTO' | 'ATRASADO' | 'SEM MOVIMENTAÇÃO';

export interface PackageFinancialSummary {
  patient: Patient;
  packageNumber: number;
  previousPackageNumber: number | null;
  currentPackageSessions: Session[];
  previousPackagePayments: Payment[];
  currentPackagePayments: Payment[];
  allPayments: Payment[];
  sessionsInCurrentPackage: number;
  completedSessionsInCurrentPackage: number;
  remainingSessionsInCurrentPackage: number;
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

export function calculatePackageFinancialSummary(
  patient: Patient,
  sessions: Session[],
  payments: Payment[],
  today = new Date(),
): PackageFinancialSummary {
  const patientPayments = payments.filter(payment => payment.patientId === patient.id);
  const activatedPackageNumberAtPresent = getActivatedPackageNumber(patientPayments, { patientId: patient.id });
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
    : getActivatedPackageNumber(patientPayments, { patientId: patient.id, throughDate: calculationDate });
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
    hasNewPackageWithoutPayment: completedPackageNumber > activatedPackageNumber
      && completedPackageNumber > 1,
  };
}
