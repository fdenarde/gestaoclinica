import { calculatePackageFinancialSummary } from '../lib/financePackages';
import { PaymentModal, SessionStatus, SessionType, Patient, Session, Payment } from '../types';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const patient: Patient = {
  id: 'wesley',
  name: 'Wesley',
  birthDate: '2016-01-01',
  guardianName: 'Responsavel Wesley',
  whatsapp: '27999999999',
  fixedDay: 'terça',
  fixedTime: '08:00',
  paymentModal: PaymentModal.PIX_FULL,
  startDate: '2026-01-01',
  anamnese: { complaint: '', school: '', grade: '', referredBy: '', diagnoses: '', initialNotes: '' },
  clinicalNotes: '',
  status: 'Ativo',
};

function makeSessions(count: number): Session[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    patientId: patient.id,
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    time: '08:00',
    type: SessionType.SIMPLES,
    status: index < 11 ? SessionStatus.REALIZADA : SessionStatus.AGENDADA,
    packageNumber: (index % 10) + 1,
  }));
}

function makePayment(id: string, amount: number, date: string, packageNumber?: number): Payment {
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

const today = new Date('2026-01-15T12:00:00');

const previousPaidNewOpen = calculatePackageFinancialSummary(
  patient,
  makeSessions(11),
  [makePayment('p1', 1000, '2026-01-01', 1)],
  today
);
assertEqual(previousPaidNewOpen.packageNumber, 2, 'new package detected');
assertEqual(previousPaidNewOpen.status, 'EM ABERTO', 'previous package payment does not settle new package');
assertEqual(previousPaidNewOpen.pendingGross, 1000, 'new package pending gross');

const partial = calculatePackageFinancialSummary(
  patient,
  makeSessions(11),
  [makePayment('p1', 1000, '2026-01-01', 1), makePayment('p2', 500, '2026-01-12', 2)],
  today
);
assertEqual(partial.status, 'PARCIAL', 'current package partial payment');
assertEqual(partial.pendingGross, 500, 'partial pending gross');

const paid = calculatePackageFinancialSummary(
  patient,
  makeSessions(11),
  [makePayment('p1', 1000, '2026-01-01', 1), makePayment('p2', 1000, '2026-01-12', 2)],
  today
);
assertEqual(paid.status, 'QUITADO', 'current package paid');
assertEqual(paid.pendingGross, 0, 'paid package has no pending gross');

const noMovement = calculatePackageFinancialSummary(patient, [], [], today);
assertEqual(noMovement.status, 'SEM MOVIMENTAÇÃO', 'no package and no payment');

console.log('Finance package validation passed.');
