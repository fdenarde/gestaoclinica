import { Payment, PaymentModal, Patient, Session, SessionStatus } from '../types';
import { getActivatedPackageNumber } from '../../shared/packagePayments.js';

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
}

const COUNTED_SESSION_STATUSES = new Set<string>([
  SessionStatus.REALIZADA,
  SessionStatus.REPOSICAO,
  SessionStatus.LATE_CANCELLATION_NO_REPLACEMENT,
]);

function sortSessionsChronologically(a: Session, b: Session) {
  const dateCompare = (a.date || '').localeCompare(b.date || '');
  if (dateCompare !== 0) return dateCompare;
  const timeCompare = (a.time || '').localeCompare(b.time || '');
  if (timeCompare !== 0) return timeCompare;
  return (a.id || '').localeCompare(b.id || '');
}

function sortPaymentsChronologically(a: Payment, b: Payment) {
  const dateCompare = (a.date || '').localeCompare(b.date || '');
  if (dateCompare !== 0) return dateCompare;
  return (a.id || '').localeCompare(b.id || '');
}

function clampCurrency(value: number) {
  return Math.min(Math.max(value, 0), PACKAGE_GROSS_VALUE);
}

function isCountedSession(session: Session) {
  return COUNTED_SESSION_STATUSES.has(session.status)
    || (session.status === SessionStatus.FALTA && session.consumesPackage === true);
}

function getExplicitPackageNumber(payment: Payment) {
  const packageNumber = Number(payment.packageNumber || 0);
  return packageNumber > 0 ? packageNumber : null;
}

export function getPaymentPackageNumber(payment: Payment, _packageStarts: { packageNumber: number; startDate: string }[]) {
  return getExplicitPackageNumber(payment) || 1;
}

function getPaymentsForPackage(patientPayments: Payment[], packageNumber: number) {
  const packagePayments: Payment[] = [];
  let cumulativePaid = 0;

  patientPayments.forEach(payment => {
    const amount = Number(payment.amount) || 0;
    const explicitPackageNumber = getExplicitPackageNumber(payment);

    if (explicitPackageNumber === packageNumber) {
      packagePayments.push(payment);
    } else if (!explicitPackageNumber && amount > 0) {
      const firstCoveredPackage = Math.floor(cumulativePaid / PACKAGE_GROSS_VALUE) + 1;
      const lastCoveredPackage = Math.floor(Math.max(cumulativePaid + amount - 0.01, 0) / PACKAGE_GROSS_VALUE) + 1;

      if (packageNumber >= firstCoveredPackage && packageNumber <= lastCoveredPackage) {
        packagePayments.push(payment);
      }
    }

    cumulativePaid += amount;
  });

  return packagePayments;
}

export function calculatePackageFinancialSummary(
  patient: Patient,
  sessions: Session[],
  payments: Payment[],
  today = new Date()
): PackageFinancialSummary {
  const patientSessions = sessions
    .filter(session => session.patientId === patient.id && !session.isBlocked && session.status !== SessionStatus.CANCELADA)
    .sort(sortSessionsChronologically);

  const completedSessions = patientSessions.filter(isCountedSession);
  const completedPackageNumber = completedSessions.length > 0
    ? Math.floor((completedSessions.length - 1) / SESSIONS_PER_PACKAGE) + 1
    : 0;

  const patientPayments = payments
    .filter(payment => payment.patientId === patient.id)
    .sort(sortPaymentsChronologically);

  const totalPaidGross = patientPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const activatedPackageNumber = getActivatedPackageNumber(patientPayments, { patientId: patient.id });
  const packageNumber = Math.max(1, activatedPackageNumber);
  const hasStartedNextPackageWithoutPayment = completedPackageNumber > activatedPackageNumber && completedPackageNumber > 1;

  const previousPackageNumber = packageNumber > 1 ? packageNumber - 1 : null;
  const currentPackageStartIndex = (packageNumber - 1) * SESSIONS_PER_PACKAGE;
  const currentPackageSessions = completedSessions.slice(currentPackageStartIndex, currentPackageStartIndex + SESSIONS_PER_PACKAGE);
  const completedSessionsInCurrentPackage = currentPackageSessions.length;
  const sessionsInCurrentPackage = completedSessionsInCurrentPackage;
  const remainingSessionsInCurrentPackage = Math.max(SESSIONS_PER_PACKAGE - completedSessionsInCurrentPackage, 0);

  const currentPackagePayments = getPaymentsForPackage(patientPayments, packageNumber);
  const previousPackagePayments = previousPackageNumber ? getPaymentsForPackage(patientPayments, previousPackageNumber) : [];

  const packagePaymentsGross = currentPackagePayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const inferredPaidGrossFromTotal = clampCurrency(totalPaidGross - ((packageNumber - 1) * PACKAGE_GROSS_VALUE));
  const paidGross = Math.max(packagePaymentsGross, inferredPaidGrossFromTotal);
  const packageHasStarted = completedSessionsInCurrentPackage > 0;
  const hasUnpaidStartedPackage = packageHasStarted && paidGross <= 0;
  const hasPartialPayment = paidGross > 0 && paidGross < PACKAGE_GROSS_VALUE;
  const pendingGross = hasUnpaidStartedPackage || hasPartialPayment
    ? Math.max(PACKAGE_GROSS_VALUE - paidGross, 0)
    : 0;

  const dueSessionIndex = patient.paymentModal === PaymentModal.PARCELADO ? 5 : 0;
  const dueSession = currentPackageSessions[dueSessionIndex];
  const dueDate = dueSession?.date || currentPackageSessions[0]?.date || patient.startDate || '';
  const isOverdue = patient.paymentModal === PaymentModal.PARCELADO
    && pendingGross > 0
    && paidGross > 0
    && completedSessionsInCurrentPackage >= 6
    && !!dueDate
    && new Date(`${dueDate}T23:59:59`).getTime() < today.getTime();

  const hasCurrentPackage = packageHasStarted || paidGross > 0 || pendingGross > 0;
  let status: FinancialStatus = 'SEM MOVIMENTAÇÃO';
  if (hasCurrentPackage) {
    if (pendingGross <= 0) status = 'QUITADO';
    else if (isOverdue) status = 'ATRASADO';
    else if (paidGross > 0) status = 'PARCIAL';
    else status = 'EM ABERTO';
  }

  const lastPayment = patientPayments.length > 0 ? patientPayments[patientPayments.length - 1] : null;
  const hasNewPackageWithoutPayment = hasStartedNextPackageWithoutPayment;

  return {
    patient,
    packageNumber,
    previousPackageNumber,
    currentPackageSessions,
    previousPackagePayments,
    currentPackagePayments,
    allPayments: patientPayments,
    sessionsInCurrentPackage,
    completedSessionsInCurrentPackage,
    remainingSessionsInCurrentPackage,
    grossExpected: PACKAGE_GROSS_VALUE,
    partnerShareExpected: PACKAGE_GROSS_VALUE * PARTNER_SHARE_RATE,
    netExpected: PACKAGE_NET_VALUE,
    paidGross,
    pendingGross,
    paidNet: paidGross * (1 - PARTNER_SHARE_RATE),
    pendingNet: pendingGross * (1 - PARTNER_SHARE_RATE),
    overdueGross: isOverdue ? pendingGross : 0,
    overdueNet: isOverdue ? pendingGross * (1 - PARTNER_SHARE_RATE) : 0,
    status,
    lastPayment,
    hasCurrentPackage,
    hasNewPackageWithoutPayment,
  };
}
