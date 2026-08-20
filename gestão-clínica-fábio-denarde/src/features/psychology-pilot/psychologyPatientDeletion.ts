import type { PsychologyPatient, PsychologyStore } from './psychologyDomain';

export interface PsychologyPatientDeletionImpact {
  sessions: number;
  records: number;
  charges: number;
  payments: number;
  expenses: number;
  packages: number;
  documents: number;
  attachments: number;
}

export interface PsychologyPatientDeletionAssessment {
  patient: PsychologyPatient;
  isApprovedSyntheticTest: boolean;
  hasExternalReference: boolean;
  impact: PsychologyPatientDeletionImpact;
  canDelete: boolean;
  reason?: string;
}

export interface PsychologyPatientDeletionResult {
  store: PsychologyStore;
  assessment: PsychologyPatientDeletionAssessment;
  removed: boolean;
}

const approvedSyntheticFingerprints = [
  { name: 'fabiano', phone: '27999072659' },
  { name: 'gertrudes', phone: '27999999999' },
];

export function normalizePsychologyPhone(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}

export function isApprovedSyntheticTestPatient(patient: PsychologyPatient): boolean {
  if (patient.externalReferences?.length) return false;
  const name = normalizedName(patient.name);
  const phone = normalizePsychologyPhone(patient.phone);
  return approvedSyntheticFingerprints.some(fingerprint => fingerprint.name === name && fingerprint.phone === phone);
}

function paymentIsCompleted(payment: PsychologyStore['payments'][number]): boolean {
  return payment.status === 'active' && !payment.reversedAt && !payment.voidedAt;
}

export function getPsychologyPatientDeletionAssessment(store: PsychologyStore, patientId: string): PsychologyPatientDeletionAssessment | null {
  const patient = store.patients.find(item => item.id === patientId);
  if (!patient) return null;
  const sessionIds = new Set(store.sessions.filter(session => session.patientId === patientId).map(session => session.id));
  const recordIds = new Set(store.sessionRecords.filter(record => record.patientId === patientId || (record.sessionId ? sessionIds.has(record.sessionId) : false)).map(record => record.id));
  const chargeIds = new Set(store.charges.filter(charge => charge.patientId === patientId || (charge.sessionId ? sessionIds.has(charge.sessionId) : false)).map(charge => charge.id));
  const impact: PsychologyPatientDeletionImpact = {
    sessions: sessionIds.size,
    records: recordIds.size,
    charges: chargeIds.size,
    payments: store.payments.filter(payment => payment.patientId === patientId || chargeIds.has(payment.chargeId) || (payment.sessionId ? sessionIds.has(payment.sessionId) : false)).length,
    expenses: 0,
    packages: store.sessionPackages.filter(item => item.patientId === patientId).length,
    documents: store.documents.filter(document => document.patientId === patientId).length,
    attachments: store.attachments.filter(attachment => attachment.patientId === patientId || (attachment.sessionRecordId ? recordIds.has(attachment.sessionRecordId) : false)).length,
  };
  const hasExternalReference = Boolean(patient.externalReferences?.length);
  const isApprovedSyntheticTest = isApprovedSyntheticTestPatient(patient);
  const canDelete = true;
  return {
    patient,
    isApprovedSyntheticTest,
    hasExternalReference,
    impact,
    canDelete,
    reason: undefined,
  };
}

export function deletePsychologyPatientLocally(store: PsychologyStore, patientId: string, now = new Date().toISOString()): PsychologyPatientDeletionResult {
  const assessment = getPsychologyPatientDeletionAssessment(store, patientId);
  if (!assessment || !assessment.canDelete) return { store, assessment: assessment || { patient: store.patients[0]!, isApprovedSyntheticTest: false, hasExternalReference: false, impact: { sessions: 0, records: 0, charges: 0, payments: 0, expenses: 0, packages: 0, documents: 0, attachments: 0 }, canDelete: false, reason: 'Paciente não encontrado.' }, removed: false };
  const sessionIds = new Set(store.sessions.filter(session => session.patientId === patientId).map(session => session.id));
  const recordIds = new Set(store.sessionRecords.filter(record => record.patientId === patientId || (record.sessionId ? sessionIds.has(record.sessionId) : false)).map(record => record.id));
  const chargeIds = new Set(store.charges.filter(charge => charge.patientId === patientId || (charge.sessionId ? sessionIds.has(charge.sessionId) : false)).map(charge => charge.id));
  const relatedPayments = store.payments.filter(payment => payment.patientId === patientId || (payment.chargeId ? chargeIds.has(payment.chargeId) : false) || (payment.sessionId ? sessionIds.has(payment.sessionId) : false));
  const preservedChargeIds = new Set(store.charges
    .filter(charge => chargeIds.has(charge.id))
    .filter(charge => relatedPayments.some(payment => payment.chargeId === charge.id && paymentIsCompleted(payment)))
    .map(charge => charge.id));
  const preservedPaymentIds = new Set(relatedPayments.filter(payment => paymentIsCompleted(payment)).map(payment => payment.id));
  const documentIds = new Set(store.documents.filter(document => document.patientId === patientId).map(document => document.id));
  return {
    assessment,
    removed: true,
    store: {
      ...store,
      patients: store.patients.filter(patient => patient.id !== patientId),
      sessions: store.sessions.filter(session => !sessionIds.has(session.id)),
      sessionRecords: store.sessionRecords.filter(record => !recordIds.has(record.id)),
      charges: store.charges
        .filter(charge => !chargeIds.has(charge.id) || preservedChargeIds.has(charge.id))
        .map(charge => preservedChargeIds.has(charge.id)
          ? { ...charge, patientId: null, sessionId: undefined, packageId: undefined, description: 'Cobrança concluída — paciente excluído', updatedAt: now }
          : charge),
      payments: store.payments
        .filter(payment => !relatedPayments.some(related => related.id === payment.id) || preservedPaymentIds.has(payment.id))
        .map(payment => preservedPaymentIds.has(payment.id)
          ? { ...payment, patientId: null, chargeId: preservedChargeIds.has(payment.chargeId || '') ? payment.chargeId : null, sessionId: undefined, updatedAt: now }
          : payment),
      sessionPackages: store.sessionPackages.filter(item => item.patientId !== patientId),
      documents: store.documents.filter(document => !documentIds.has(document.id)),
      attachments: store.attachments.filter(attachment => attachment.patientId !== patientId && !(attachment.sessionRecordId && recordIds.has(attachment.sessionRecordId)) && !(attachment.documentId && documentIds.has(attachment.documentId))),
    },
  };
}
