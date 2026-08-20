import { locationForSession, type PsychologyLocation, type PsychologyService } from './psychologyR2a';
import type {
  PsychologyAttachment,
  PsychologyDocument,
  PsychologyPatient,
  PsychologySession,
  PsychologySessionRecord,
  PsychologySessionStatus,
  PsychologyStore,
} from './psychologyDomain';
import { getPsychologyFinancialLedger, psychologyCivilDate, roundPsychologyMoney } from './psychologyFinancialLedger';

export interface PsychologyPatientFinanceSummary {
  totalCharged: number;
  totalReceived: number;
  pending: number;
  overdue: number;
  exempt: number;
}

export interface PsychologyPatientData {
  patient: PsychologyPatient;
  sessions: PsychologySession[];
  records: PsychologySessionRecord[];
  charges: PsychologyStore['charges'];
  payments: PsychologyStore['payments'];
  packages: PsychologyStore['sessionPackages'];
  documents: PsychologyDocument[];
  attachments: PsychologyAttachment[];
}

export interface PsychologyPatientSummaryViewModel {
  nextSession?: PsychologySession;
  lastSession?: PsychologySession;
  finance: PsychologyPatientFinanceSummary;
  activePackage?: PsychologyStore['sessionPackages'][number];
  service?: PsychologyService;
  location?: PsychologyLocation;
}

function inScope(item: { professionalId?: string; context?: string }, store: PsychologyStore): boolean {
  return item.professionalId === store.scope.professionalId && item.context === store.scope.context;
}

function sessionTime(session: PsychologySession): string {
  return `${session.date}T${session.time || '00:00'}`;
}

export function getPsychologyPatientData(store: PsychologyStore, patientId: string): PsychologyPatientData | null {
  const patient = store.patients.find(item => item.id === patientId && inScope(item, store));
  if (!patient) return null;
  return {
    patient,
    sessions: store.sessions.filter(item => item.patientId === patientId && inScope(item, store)).sort((a, b) => sessionTime(a).localeCompare(sessionTime(b))),
    records: store.sessionRecords.filter(item => item.patientId === patientId && inScope(item, store)).sort((a, b) => `${b.date || b.sessionDate}T${b.sessionTime}`.localeCompare(`${a.date || a.sessionDate}T${a.sessionTime}`)),
    charges: store.charges.filter(item => item.patientId === patientId && inScope(item, store)),
    payments: store.payments.filter(item => item.patientId === patientId && inScope(item, store)),
    packages: store.sessionPackages.filter(item => item.patientId === patientId && inScope(item, store)),
    documents: store.documents.filter(item => item.patientId === patientId && inScope(item, store)),
    attachments: store.attachments.filter(item => item.patientId === patientId && inScope(item, store)),
  };
}

export function getPsychologyPatientSummary(store: PsychologyStore, patientId: string, referenceDate = new Date()): PsychologyPatientSummaryViewModel | null {
  const data = getPsychologyPatientData(store, patientId);
  if (!data) return null;
  const reference = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}-${String(referenceDate.getDate()).padStart(2, '0')}T${String(referenceDate.getHours()).padStart(2, '0')}:${String(referenceDate.getMinutes()).padStart(2, '0')}`;
  const nextSession = data.sessions.find(session => session.status === 'agendada' && sessionTime(session) >= reference);
  const lastSession = [...data.sessions].reverse().find(session => sessionTime(session) < reference && session.status !== 'cancelada');
  const activePackage = data.packages.find(item => item.active && item.usedSessions < item.totalSessions);
  const service = nextSession?.serviceId ? store.services.find(item => item.id === nextSession.serviceId && inScope(item, store)) : undefined;
  const location = nextSession ? locationForSession(store.settings, nextSession) : undefined;
  return { nextSession, lastSession, finance: getPsychologyPatientFinanceSummary(store, patientId, reference.slice(0, 10)), activePackage, service, location };
}

export function getPsychologyPatientFinanceSummary(store: PsychologyStore, patientId: string, today = psychologyCivilDate()): PsychologyPatientFinanceSummary {
  const ledger = getPsychologyFinancialLedger(store, today || psychologyCivilDate());
  const charges = ledger.chargeEntries.filter(entry => entry.charge.patientId === patientId);
  const payments = ledger.activePayments.filter(payment => payment.patientId === patientId);
  return {
    totalCharged: roundPsychologyMoney(charges.filter(entry => entry.status !== 'CANCELLED').reduce((sum, entry) => sum + entry.charge.amount, 0)),
    totalReceived: roundPsychologyMoney(payments.reduce((sum, payment) => sum + payment.amount, 0)),
    pending: roundPsychologyMoney(charges.reduce((sum, entry) => sum + entry.balance, 0)),
    overdue: roundPsychologyMoney(charges.filter(entry => entry.overdue).reduce((sum, entry) => sum + entry.balance, 0)),
    exempt: roundPsychologyMoney(charges.filter(entry => entry.status === 'EXEMPT').reduce((sum, entry) => sum + entry.charge.amount, 0)),
  };
}

export function getPsychologyPatientRecordPreview(record: PsychologySessionRecord): string {
  const content = record.content.trim().replace(/\s+/g, ' ');
  return content.length > 120 ? `${content.slice(0, 117)}…` : content;
}

export function formatPsychologyMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function psychologySessionStatusLabel(status: PsychologySessionStatus): string {
  return { agendada: 'Agendada', realizada: 'Realizada', falta: 'Falta', cancelada: 'Cancelada' }[status];
}

export function psychologyDocumentClassificationLabel(value: 'ADMINISTRATIVE' | 'CLINICAL'): string {
  return value === 'CLINICAL' ? 'Clínico' : 'Administrativo';
}
