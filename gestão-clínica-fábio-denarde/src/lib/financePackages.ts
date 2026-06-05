import { Payment, PaymentModal, Patient, Session, SessionStatus } from '../types';

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
]);

const ACTIVE_PACKAGE_SESSION_STATUSES = new Set<string>([
  SessionStatus.AGENDADA,
  SessionStatus.REALIZADA,
  SessionStatus.REPOSICAO,
  SessionStatus.FALTA,
  SessionStatus.FALTA_PROF,
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

function getPackageNumberForSession(session: Session, chronologicalIndex: number) {
  void session;
  // Session.packageNumber stores the session number inside the cycle (1-10), not the package index.
  return Math.floor(chronologicalIndex / SESSIONS_PER_PACKAGE) + 1;
}

export function getPaymentPackageNumber(payment: Payment, packageStarts: { packageNumber: number; startDate: string }[]) {
  if (payment.packageNumber && payment.packageNumber > 0) return payment.packageNumber;
  if (packageStarts.length === 0) return 1;

  const paymentDate = payment.date || '';
  let inferred = packageStarts[0].packageNumber;
  for (const pkg of packageStarts) {
    if (pkg.startDate <= paymentDate) inferred = pkg.packageNumber;
  }
  return inferred;
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

  const sessionsByPackage = new Map<number, Session[]>();
  patientSessions.forEach((session, index) => {
    const packageNumber = getPackageNumberForSession(session, index);
    const current = sessionsByPackage.get(packageNumber) || [];
    current.push(session);
    sessionsByPackage.set(packageNumber, current);
  });

  const packageNumbers = Array.from(sessionsByPackage.keys()).sort((a, b) => a - b);
  const activePackageNumbers = packageNumbers.filter(packageNumber =>
    (sessionsByPackage.get(packageNumber) || []).some(session => ACTIVE_PACKAGE_SESSION_STATUSES.has(session.status))
  );

  const explicitPaymentPackages = payments
    .filter(payment => payment.patientId === patient.id && payment.packageNumber && payment.packageNumber > 0)
    .map(payment => payment.packageNumber || 1);

  const packageNumber = Math.max(1, ...packageNumbers, ...activePackageNumbers, ...explicitPaymentPackages);
  const previousPackageNumber = packageNumber > 1 ? packageNumber - 1 : null;

  const packageStarts = packageNumbers.map(number => ({
    packageNumber: number,
    startDate: (sessionsByPackage.get(number) || [])[0]?.date || patient.startDate || '',
  }));

  const patientPayments = payments
    .filter(payment => payment.patientId === patient.id)
    .sort(sortPaymentsChronologically);

  const paymentsByPackage = new Map<number, Payment[]>();
  patientPayments.forEach(payment => {
    const paymentPackage = getPaymentPackageNumber(payment, packageStarts);
    const current = paymentsByPackage.get(paymentPackage) || [];
    current.push(payment);
    paymentsByPackage.set(paymentPackage, current);
  });

  const currentPackageSessions = sessionsByPackage.get(packageNumber) || [];
  const currentPackagePayments = paymentsByPackage.get(packageNumber) || [];
  const previousPackagePayments = previousPackageNumber ? paymentsByPackage.get(previousPackageNumber) || [] : [];
  const paidGross = currentPackagePayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const pendingGross = Math.max(PACKAGE_GROSS_VALUE - paidGross, 0);
  const completedSessionsInCurrentPackage = currentPackageSessions.filter(session => COUNTED_SESSION_STATUSES.has(session.status)).length;
  const sessionsInCurrentPackage = currentPackageSessions.length;
  const remainingSessionsInCurrentPackage = Math.max(SESSIONS_PER_PACKAGE - sessionsInCurrentPackage, 0);
  const hasCurrentPackage = sessionsInCurrentPackage > 0 || currentPackagePayments.length > 0;
  const hasNewPackageWithoutPayment = packageNumber > 1 && sessionsInCurrentPackage > 0 && paidGross <= 0;

  const dueSessionIndex = patient.paymentModal === PaymentModal.PARCELADO ? 5 : 0;
  const dueSession = currentPackageSessions[dueSessionIndex];
  const dueDate = dueSession?.date || currentPackageSessions[0]?.date || patient.startDate || '';
  const isOverdue = patient.paymentModal === PaymentModal.PARCELADO
    && pendingGross > 0
    && paidGross > 0
    && completedSessionsInCurrentPackage >= 6
    && !!dueDate
    && new Date(`${dueDate}T23:59:59`).getTime() < today.getTime();

  let status: FinancialStatus = 'SEM MOVIMENTAÇÃO';
  if (hasCurrentPackage) {
    if (pendingGross <= 0) status = 'QUITADO';
    else if (isOverdue) status = 'ATRASADO';
    else if (paidGross > 0) status = 'PARCIAL';
    else status = 'EM ABERTO';
  }

  const lastPayment = patientPayments.length > 0 ? patientPayments[patientPayments.length - 1] : null;

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
