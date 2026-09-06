import { civilDateFromDate, requiresResponsible } from '../../lib/psychologyPatientAdministrative';
import type { PsychologyClinicalRecordType, PsychologyParentRecordType, PsychologySoapRecord } from './psychologyR2a';
import { getPsychologyPatientDateOfBirth, type PsychologyPatient, type PsychologySessionRecord, type PsychologyStore } from './psychologyDomain';

export type PsychologyClinicalRecordDraft = {
  id?: string;
  patientId: string;
  recordType: PsychologyClinicalRecordType;
  date: string;
  sessionId?: string;
  content: string;
  soap?: PsychologySoapRecord;
  parentRecordType?: PsychologyParentRecordType;
};

export const EMPTY_PSYCHOLOGY_SOAP: PsychologySoapRecord = {
  subjective: '', objective: '', assessment: '', plan: '',
};

export function isPsychologyMinorOrAdolescent(patient: PsychologyPatient, referenceDate = civilDateFromDate(new Date())): boolean {
  return requiresResponsible(getPsychologyPatientDateOfBirth(patient), referenceDate);
}

export function psychologyClinicalRecordLabel(recordType: PsychologyClinicalRecordType | undefined): string {
  return recordType === 'SOAP' ? 'Modelo SOAP' : recordType === 'PARENT_ANAMNESIS_FEEDBACK' ? 'Anamnese / Devolutiva' : 'Acompanhamento Terapêutico';
}

function normalizeSoap(value: PsychologySoapRecord | undefined): PsychologySoapRecord {
  return {
    subjective: String(value?.subjective || '').trim(),
    objective: String(value?.objective || '').trim(),
    assessment: String(value?.assessment || '').trim(),
    plan: String(value?.plan || '').trim(),
  };
}

function assertDraft(draft: PsychologyClinicalRecordDraft, isMinor: boolean): void {
  if (!draft.patientId.trim()) throw new Error('Paciente do prontuário não identificado.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw new Error('Informe uma data válida para o registro.');
  if (draft.recordType === 'SOAP') {
    if (!Object.values(normalizeSoap(draft.soap)).some(Boolean)) throw new Error('Preencha ao menos um campo do Modelo SOAP.');
    return;
  }
  if (draft.recordType === 'PARENT_ANAMNESIS_FEEDBACK') {
    if (!isMinor) throw new Error('Anamnese / Devolutiva é restrita a paciente menor ou adolescente.');
    if (!draft.parentRecordType) throw new Error('Selecione o tipo de Anamnese / Devolutiva.');
  }
  if (!draft.content.trim()) throw new Error('Informe o conteúdo clínico do registro.');
}

/**
 * Applies the same scope, patient and session boundaries used by the Psychology
 * store. It is used only by the local provider; the remote provider repeats
 * these invariants server-side before persistence.
 */
export function upsertPsychologyClinicalRecord(store: PsychologyStore, draft: PsychologyClinicalRecordDraft, now = new Date().toISOString()): PsychologyStore {
  const patient = store.patients.find(item => item.id === draft.patientId && item.professionalId === store.scope.professionalId && item.context === store.scope.context);
  if (!patient) throw new Error('Paciente não encontrado no escopo da Psicologia.');
  assertDraft(draft, isPsychologyMinorOrAdolescent(patient, draft.date));
  const existing = draft.id ? store.sessionRecords.find(item => item.id === draft.id && item.professionalId === store.scope.professionalId && item.context === store.scope.context) : undefined;
  if (existing && (existing.patientId !== draft.patientId || (existing.recordType || 'THERAPEUTIC_FOLLOW_UP') !== draft.recordType)) {
    throw new Error('Paciente e tipo do prontuário não podem ser alterados em uma edição.');
  }
  const session = draft.sessionId ? store.sessions.find(item => item.id === draft.sessionId && item.patientId === draft.patientId && item.professionalId === store.scope.professionalId && item.context === store.scope.context) : undefined;
  if (draft.sessionId && !session) throw new Error('A sessão vinculada não pertence ao paciente neste escopo.');
  const record: PsychologySessionRecord = {
    id: existing?.id || draft.id || `clinical-${crypto.randomUUID()}`,
    patientId: draft.patientId,
    sessionId: session?.id,
    sessionDate: session?.date || draft.date,
    sessionTime: session?.time || '',
    professionalId: store.scope.professionalId,
    context: store.scope.context,
    authorProfessionalId: store.scope.professionalId,
    recordType: draft.recordType,
    ...(draft.recordType === 'SOAP' ? { soap: normalizeSoap(draft.soap), content: '' } : { content: draft.content.trim() }),
    ...(draft.recordType === 'PARENT_ANAMNESIS_FEEDBACK' ? { parentRecordType: draft.parentRecordType } : {}),
    date: draft.date,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { ...store, sessionRecords: existing ? store.sessionRecords.map(item => item.id === record.id ? record : item) : [...store.sessionRecords, record] };
}
