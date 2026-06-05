import { calculatePackageFinancialSummary } from '../lib/financePackages';
import { PaymentModal, SessionStatus, SessionType, Patient, Session, Payment } from '../types';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const basePatient: Patient = {
  id: 'paciente-teste',
  name: 'Paciente Teste',
  birthDate: '2016-01-01',
  guardianName: 'Responsavel Teste',
  whatsapp: '27999999999',
  fixedDay: 'terça',
  fixedTime: '08:00',
  paymentModal: PaymentModal.PIX_FULL,
  startDate: '2026-01-01',
  anamnese: { complaint: '', school: '', grade: '', referredBy: '', diagnoses: '', initialNotes: '' },
  clinicalNotes: '',
  status: 'Ativo',
};

function makePatient(name: string, paymentModal = PaymentModal.PIX_FULL): Patient {
  return {
    ...basePatient,
    id: name.toLowerCase(),
    name,
    paymentModal,
  };
}

function makeDate(index: number) {
  const day = String((index % 28) + 1).padStart(2, '0');
  const month = String(Math.floor(index / 28) + 1).padStart(2, '0');
  return `2026-${month}-${day}`;
}

function makeSessions(patient: Patient, count: number, completedCount = count, packageNumbers?: number[]): Session[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${patient.id}-s${index + 1}`,
    patientId: patient.id,
    date: makeDate(index),
    time: '08:00',
    type: SessionType.SIMPLES,
    status: index < completedCount ? SessionStatus.REALIZADA : SessionStatus.AGENDADA,
    packageNumber: packageNumbers?.[index] ?? ((index % 10) + 1),
  }));
}

function makeSession(
  patient: Patient,
  id: string,
  date: string,
  cycleNumber: number,
  status: SessionStatus = SessionStatus.REALIZADA
): Session {
  return {
    id,
    patientId: patient.id,
    date,
    time: '08:00',
    type: SessionType.SIMPLES,
    status,
    packageNumber: cycleNumber,
  };
}

function makePayment(patient: Patient, id: string, amount: number, date: string, packageNumber?: number): Payment {
  return {
    id,
    patientId: patient.id,
    amount,
    date,
    installment: amount >= 1000 ? 'Pagamento integral' : '1ª parcela',
    method: 'Pix',
    packageNumber,
  };
}

const today = new Date('2026-06-05T12:00:00');
const patient = makePatient('Wesley');

const previousPaidNewOpen = calculatePackageFinancialSummary(
  patient,
  makeSessions(patient, 11),
  [makePayment(patient, 'p1', 1000, '2026-01-01', 1)],
  today
);
assertEqual(previousPaidNewOpen.packageNumber, 2, 'new package detected only after completed session 11');
assertEqual(previousPaidNewOpen.completedSessionsInCurrentPackage, 1, 'new package counts only completed session 11');
assertEqual(previousPaidNewOpen.status, 'EM ABERTO', 'previous package payment does not settle new package');
assertEqual(previousPaidNewOpen.pendingGross, 1000, 'new started unpaid package pending gross');

const partial = calculatePackageFinancialSummary(
  patient,
  makeSessions(patient, 11),
  [makePayment(patient, 'p1', 1000, '2026-01-01', 1), makePayment(patient, 'p2', 500, '2026-01-12', 2)],
  today
);
assertEqual(partial.packageNumber, 2, 'current partial package detected');
assertEqual(partial.status, 'PARCIAL', 'current package partial payment');
assertEqual(partial.pendingGross, 500, 'partial pending gross');

const paid = calculatePackageFinancialSummary(
  patient,
  makeSessions(patient, 11),
  [makePayment(patient, 'p1', 1000, '2026-01-01', 1), makePayment(patient, 'p2', 1000, '2026-01-12', 2)],
  today
);
assertEqual(paid.packageNumber, 2, 'paid package remains package 2');
assertEqual(paid.status, 'QUITADO', 'current package paid');
assertEqual(paid.pendingGross, 0, 'paid package has no pending gross');

const noMovement = calculatePackageFinancialSummary(patient, [], [], today);
assertEqual(noMovement.status, 'SEM MOVIMENTAÇÃO', 'no package and no payment');
assertEqual(noMovement.pendingGross, 0, 'no package and no payment has no pending gross');

const futureAgendaOnly = calculatePackageFinancialSummary(patient, makeSessions(patient, 50, 0), [], today);
assertEqual(futureAgendaOnly.status, 'SEM MOVIMENTAÇÃO', 'future agenda alone is not financial debt');
assertEqual(futureAgendaOnly.pendingGross, 0, 'future agenda alone has no pending gross');
assertEqual(futureAgendaOnly.hasCurrentPackage, false, 'future agenda alone does not create current package');

const previousPaidWithFutureAgenda = calculatePackageFinancialSummary(
  patient,
  makeSessions(patient, 20, 10),
  [makePayment(patient, 'p1', 1000, '2026-01-01', 1)],
  today
);
assertEqual(previousPaidWithFutureAgenda.packageNumber, 1, 'future scheduled package is not current debt package');
assertEqual(previousPaidWithFutureAgenda.status, 'QUITADO', 'paid completed package remains paid despite future agenda');
assertEqual(previousPaidWithFutureAgenda.pendingGross, 0, 'paid package with future agenda has no artificial pending gross');

const irregularSessionPackageNumbers = calculatePackageFinancialSummary(
  patient,
  makeSessions(patient, 6, 6, [9, 10, 7, 18, 6, 3]),
  [makePayment(patient, 'wild-paid-p1', 1000, '2026-01-01', 1)],
  today
);
assertEqual(irregularSessionPackageNumbers.packageNumber, 1, 'session packageNumber does not create artificial package 18');
assertEqual(irregularSessionPackageNumbers.completedSessionsInCurrentPackage, 6, 'irregular session packageNumber does not force 1/10');
assertEqual(irregularSessionPackageNumbers.pendingGross, 0, 'irregular session packageNumber does not create artificial R$ 1000');

const eliza = makePatient('Eliza');
const elizaSummary = calculatePackageFinancialSummary(
  eliza,
  makeSessions(eliza, 13, 13, [6, 2, 7, 3, 4, 5, 8, 10, 10, 2, 2, 10, 7]),
  [makePayment(eliza, 'eliza-paid-p2', 1000, '2026-05-21', 2)],
  today
);
assertEqual(elizaSummary.packageNumber, 2, 'Eliza explicit payment package keeps package 2');
assertEqual(elizaSummary.completedSessionsInCurrentPackage, 3, 'Eliza does not become 1/10 from irregular cycle data');
assertEqual(elizaSummary.pendingGross, 0, 'Eliza does not receive artificial pending gross');

const isabelly = makePatient('Isabelly');
const isabellySummary = calculatePackageFinancialSummary(
  isabelly,
  makeSessions(isabelly, 16),
  [makePayment(isabelly, 'isa-paid-p1', 1000, '2026-02-14', 1), makePayment(isabelly, 'isa-paid-unassigned', 1000, '2026-05-07')],
  today
);
assertEqual(isabellySummary.packageNumber, 2, 'Isabelly aggregate payments keep package 2');
assertEqual(isabellySummary.completedSessionsInCurrentPackage, 6, 'Isabelly sessions stay in package 2');
assertEqual(isabellySummary.pendingGross, 0, 'Isabelly does not receive artificial pending gross');

const nicolas = makePatient('Nicolas', PaymentModal.PARCELADO);
const nicolasSummary = calculatePackageFinancialSummary(
  nicolas,
  makeSessions(nicolas, 14),
  [
    makePayment(nicolas, 'nic-paid-1', 500, '2026-02-13'),
    makePayment(nicolas, 'nic-paid-2', 500, '2026-02-28'),
    makePayment(nicolas, 'nic-paid-3', 500, '2026-05-09'),
    makePayment(nicolas, 'nic-paid-p2', 500, '2026-05-23', 2),
  ],
  today
);
assertEqual(nicolasSummary.packageNumber, 2, 'Nicolas aggregate payments keep package 2');
assertEqual(nicolasSummary.completedSessionsInCurrentPackage, 4, 'Nicolas sessions stay in package 2');
assertEqual(nicolasSummary.pendingGross, 0, 'Nicolas does not receive artificial pending gross');

const wesley = makePatient('Wesley');
const wesleyPackageTwoStarted = calculatePackageFinancialSummary(
  wesley,
  [
    ...Array.from({ length: 10 }, (_, index) => makeSession(wesley, `w-p1-${index + 1}`, `2026-05-${String(index + 1).padStart(2, '0')}`, index + 1)),
    makeSession(wesley, 'w-p2-1', '2026-06-03', 1),
    makeSession(wesley, 'w-p2-2-future', '2026-06-10', 2, SessionStatus.AGENDADA),
    makeSession(wesley, 'w-p2-3-future', '2026-06-17', 3, SessionStatus.AGENDADA),
  ],
  [makePayment(wesley, 'w-paid-p1', 1000, '2026-03-23', 1)],
  today
);
assertEqual(wesleyPackageTwoStarted.packageNumber, 2, 'Wesley package 2 detected');
assertEqual(wesleyPackageTwoStarted.currentPackageSessions[0]?.date, '2026-06-03', 'Wesley package 2 starts on 03/06');
assertEqual(wesleyPackageTwoStarted.completedSessionsInCurrentPackage, 1, 'Wesley package 2 counts only completed current sessions');
assertEqual(wesleyPackageTwoStarted.sessionsInCurrentPackage, 1, 'Wesley future agenda is not counted as completed sessions');
assertEqual(wesleyPackageTwoStarted.status, 'EM ABERTO', 'Wesley package 2 remains open without current package payment');
assertEqual(wesleyPackageTwoStarted.pendingGross, 1000, 'Wesley package 2 pending gross');

const luiza = makePatient('Luiza', PaymentModal.PARCELADO);
const luizaPartialSecondPackage = calculatePackageFinancialSummary(
  luiza,
  makeSessions(luiza, 14),
  [
    makePayment(luiza, 'l-paid-p1-a', 500, '2026-02-20', 1),
    makePayment(luiza, 'l-paid-p1-b', 500, '2026-03-17', 1),
    makePayment(luiza, 'l-paid-p2-partial', 500, '2026-04-30', 2),
  ],
  today
);
assertEqual(luizaPartialSecondPackage.packageNumber, 2, 'Luiza package 2 detected');
assertEqual(luizaPartialSecondPackage.completedSessionsInCurrentPackage, 4, 'Luiza package 2 sessions are not reset to 1/10');
assertEqual(luizaPartialSecondPackage.status, 'PARCIAL', 'Luiza package 2 partial status');
assertEqual(luizaPartialSecondPackage.pendingGross, 500, 'Luiza package 2 remaining parcel');

console.log('Finance package validation passed.');
