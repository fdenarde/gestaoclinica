import type {
  PsychologyExternalReference,
  PsychologyPatient,
  PsychologySession,
} from '../psychology-pilot/psychologyDomain';

export type DoctoraliaPreviewModality = 'PRESENCIAL' | 'ONLINE';
export type DoctoraliaPatientMatch = 'MATCH_EXACT' | 'MATCH_PROBABLE_REVIEW' | 'PATIENT_NOT_FOUND' | 'CONFLICT';
export type DoctoraliaSessionState = 'ALREADY_EXISTS' | 'NOT_FOUND' | 'SCHEDULE_CONFLICT' | 'UNKNOWN';
export type DoctoraliaServiceState = 'SERVICE_MATCHED' | 'SERVICE_REVIEW';
export type DoctoraliaModalityState = 'MODALITY_CONFIRMED' | 'MODALITY_REVIEW';
export type DoctoraliaFinalState =
  | 'READY_TO_IMPORT'
  | 'ALREADY_EXISTS'
  | 'PATIENT_REVIEW'
  | 'PATIENT_NOT_FOUND'
  | 'SERVICE_REVIEW'
  | 'MODALITY_REVIEW'
  | 'SCHEDULE_CONFLICT'
  | 'CANCELLED_DO_NOT_IMPORT'
  | 'BLOCKED';

export interface DoctoraliaPreviewEvent {
  id: string;
  date: string;
  startTime: string;
  endTime?: string;
  patientName: string;
  serviceName: string;
  modality?: DoctoraliaPreviewModality;
  externalPatientReference?: string;
  externalEventId?: string;
  externalScheduleId?: string;
  cancelled?: boolean;
}

export interface DoctoraliaPreviewRow {
  event: DoctoraliaPreviewEvent;
  patientMatch: DoctoraliaPatientMatch;
  matchedPatientId?: string;
  sessionState: DoctoraliaSessionState;
  serviceState: DoctoraliaServiceState;
  serviceId?: string;
  modalityState: DoctoraliaModalityState;
  finalState: DoctoraliaFinalState;
  conflictSessionId?: string;
}

export interface DoctoraliaPreviewResult {
  rows: DoctoraliaPreviewRow[];
  importableRows: DoctoraliaPreviewRow[];
}

export interface DoctoraliaReadOnlySnapshot {
  patients: Array<Pick<PsychologyPatient, 'id' | 'name' | 'externalReferences' | 'active'>>;
  sessions: Array<Pick<
    PsychologySession,
    'id' | 'patientId' | 'date' | 'time' | 'durationMinutes' | 'status' | 'externalSource' | 'externalEventId' | 'externalScheduleId'
  >>;
}

const INVISIBLE_CHARACTERS = /[\u0000-\u001F\u007F\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const EMAIL_SUFFIX = /\s*(?:<[^<>\s]+@[^<>\s]+>|[^\s<>]+@[^\s<>]+)\s*$/u;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(INVISIBLE_CHARACTERS, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function normalizeDoctoraliaPatientName(value: string): string {
  return normalizeText(value.replace(EMAIL_SUFFIX, ''));
}

function normalizeReference(value: unknown): string {
  return normalizeText(value).replace(/\s/g, '');
}

function patientExternalReferenceMatches(patient: Pick<PsychologyPatient, 'externalReferences'>, reference: string): boolean {
  const expected = normalizeReference(reference);
  if (!expected) return false;
  return (patient.externalReferences || []).some((item: PsychologyExternalReference) =>
    normalizeText(item.source) === 'doctoralia' && normalizeReference(item.externalId) === expected,
  );
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function findPatient(event: DoctoraliaPreviewEvent, patients: DoctoraliaReadOnlySnapshot['patients']): { state: DoctoraliaPatientMatch; patient?: DoctoraliaReadOnlySnapshot['patients'][number] } {
  if (event.externalPatientReference) {
    const byReference = patients.filter(patient => patientExternalReferenceMatches(patient, event.externalPatientReference || ''));
    if (byReference.length === 1) return { state: 'MATCH_EXACT', patient: byReference[0] };
    if (byReference.length > 1) return { state: 'CONFLICT' };
  }

  const eventName = normalizeDoctoraliaPatientName(event.patientName);
  const byName = patients.filter(patient => normalizeDoctoraliaPatientName(patient.name) === eventName);
  if (byName.length === 1) return { state: 'MATCH_EXACT', patient: byName[0] };
  if (byName.length > 1) return { state: 'CONFLICT' };

  const probable = patients.filter(patient => tokenSimilarity(normalizeDoctoraliaPatientName(patient.name), eventName) >= 0.66);
  if (probable.length === 1) return { state: 'MATCH_PROBABLE_REVIEW', patient: probable[0] };
  if (probable.length > 1) return { state: 'CONFLICT' };
  return { state: 'PATIENT_NOT_FOUND' };
}

function normalizeService(value: string): string {
  return normalizeText(value);
}

export function classifyDoctoraliaService(serviceName: string): { state: DoctoraliaServiceState; serviceId?: string } {
  const normalized = normalizeService(serviceName);
  if (normalized.includes('consulta psicologica do adolescente') || normalized.includes('psicoterapia adolescente')) {
    return { state: 'SERVICE_MATCHED', serviceId: 'psychotherapy-adolescent' };
  }
  if (normalized.includes('teste de eneagrama') && normalized.includes('presencial') && normalized.includes('tgp')) {
    return { state: 'SERVICE_MATCHED', serviceId: 'eneagram-test' };
  }
  return { state: 'SERVICE_REVIEW' };
}

export function classifyDoctoraliaModality(modality?: DoctoraliaPreviewModality): DoctoraliaModalityState {
  return modality === 'PRESENCIAL' || modality === 'ONLINE' ? 'MODALITY_CONFIRMED' : 'MODALITY_REVIEW';
}

function timeToMinutes(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function eventEndMinutes(event: DoctoraliaPreviewEvent): number | null {
  const start = timeToMinutes(event.startTime);
  if (start === null) return null;
  const explicitEnd = timeToMinutes(event.endTime);
  return explicitEnd === null ? start + 50 : explicitEnd;
}

function sessionEndMinutes(session: Pick<PsychologySession, 'time' | 'durationMinutes'>): number | null {
  const start = timeToMinutes(session.time);
  return start === null ? null : start + Math.max(1, Number(session.durationMinutes) || 0);
}

function sharesExternalIdentity(event: DoctoraliaPreviewEvent, session: DoctoraliaReadOnlySnapshot['sessions'][number]): boolean {
  return Boolean(
    (event.externalEventId && session.externalEventId && normalizeReference(event.externalEventId) === normalizeReference(session.externalEventId)) ||
    (event.externalScheduleId && session.externalScheduleId && normalizeReference(event.externalScheduleId) === normalizeReference(session.externalScheduleId)),
  );
}

function sessionEquivalent(event: DoctoraliaPreviewEvent, patientId: string | undefined, session: DoctoraliaReadOnlySnapshot['sessions'][number]): boolean {
  if (sharesExternalIdentity(event, session)) return true;
  return Boolean(
    patientId && session.patientId === patientId && session.date === event.date &&
    timeToMinutes(session.time) === timeToMinutes(event.startTime),
  );
}

function findSessionState(event: DoctoraliaPreviewEvent, patientId: string | undefined, sessions: DoctoraliaReadOnlySnapshot['sessions']): { state: DoctoraliaSessionState; conflictSessionId?: string } {
  const equivalent = sessions.find(session => sessionEquivalent(event, patientId, session));
  if (equivalent) return { state: 'ALREADY_EXISTS' };

  const start = timeToMinutes(event.startTime);
  const end = eventEndMinutes(event);
  if (start === null || end === null || end <= start) return { state: 'UNKNOWN' };

  const conflict = sessions.find(session => {
    if (session.date !== event.date || session.status === 'cancelada') return false;
    const sessionStart = timeToMinutes(session.time);
    const sessionEnd = sessionEndMinutes(session);
    return sessionStart !== null && sessionEnd !== null && start < sessionEnd && sessionStart < end;
  });
  return conflict ? { state: 'SCHEDULE_CONFLICT', conflictSessionId: conflict.id } : { state: 'NOT_FOUND' };
}

function finalState(row: Omit<DoctoraliaPreviewRow, 'finalState'>): DoctoraliaFinalState {
  if (row.event.cancelled) return 'CANCELLED_DO_NOT_IMPORT';
  if (row.patientMatch === 'PATIENT_NOT_FOUND') return 'PATIENT_NOT_FOUND';
  if (row.patientMatch === 'CONFLICT' || row.patientMatch === 'MATCH_PROBABLE_REVIEW') return 'PATIENT_REVIEW';
  if (row.sessionState === 'ALREADY_EXISTS') return 'ALREADY_EXISTS';
  if (row.sessionState === 'SCHEDULE_CONFLICT') return 'SCHEDULE_CONFLICT';
  if (row.serviceState === 'SERVICE_REVIEW') return 'SERVICE_REVIEW';
  if (row.modalityState === 'MODALITY_REVIEW') return 'MODALITY_REVIEW';
  if (row.sessionState !== 'NOT_FOUND') return 'BLOCKED';
  return 'READY_TO_IMPORT';
}

export function classifyDoctoraliaPreview(events: DoctoraliaPreviewEvent[], snapshot: DoctoraliaReadOnlySnapshot): DoctoraliaPreviewResult {
  const rows = events.map(event => {
    const patient = findPatient(event, snapshot.patients);
    const session = findSessionState(event, patient.patient?.id, snapshot.sessions);
    const service = classifyDoctoraliaService(event.serviceName);
    const rowWithoutFinal: Omit<DoctoraliaPreviewRow, 'finalState'> = {
      event,
      patientMatch: patient.state,
      matchedPatientId: patient.patient?.id,
      sessionState: session.state,
      serviceState: service.state,
      serviceId: service.serviceId,
      modalityState: classifyDoctoraliaModality(event.modality),
      conflictSessionId: session.conflictSessionId,
    };
    return { ...rowWithoutFinal, finalState: finalState(rowWithoutFinal) };
  });
  return { rows, importableRows: rows.filter(row => row.finalState === 'READY_TO_IMPORT') };
}

export function parseDoctoraliaPreviewInput(input: string): { events: DoctoraliaPreviewEvent[]; error?: string } {
  const events: DoctoraliaPreviewEvent[] = [];
  const lines = input.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const fields = line.split('|').map(value => value.trim());
    if (fields.length < 4) return { events: [], error: `Linha ${index + 1}: use data|horário|paciente|serviço|modalidade opcional.` };
    const [date, timeRange, patientName, serviceName, modality] = fields;
    const [startTime, endTime] = timeRange.split(/\s*(?:-|–|—|até)\s*/u);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || timeToMinutes(startTime) === null || (endTime && timeToMinutes(endTime) === null)) {
      return { events: [], error: `Linha ${index + 1}: data ou horário inválido.` };
    }
    if (!patientName || !serviceName) return { events: [], error: `Linha ${index + 1}: paciente e serviço são obrigatórios.` };
    const normalizedModality = normalizeText(modality).toUpperCase();
    if (normalizedModality && normalizedModality !== 'PRESENCIAL' && normalizedModality !== 'ONLINE') {
      return { events: [], error: `Linha ${index + 1}: modalidade deve ser PRESENCIAL ou ONLINE.` };
    }
    events.push({
      id: `doctoralia-preview-${events.length + 1}`,
      date,
      startTime,
      endTime: endTime || undefined,
      patientName,
      serviceName,
      modality: normalizedModality ? normalizedModality as DoctoraliaPreviewModality : undefined,
    });
  }
  if (!events.length) return { events: [], error: 'Cole os eventos no formato indicado.' };
  return { events };
}

export const doctoraliaPreviewStatusLabels: Record<DoctoraliaFinalState, string> = {
  READY_TO_IMPORT: 'Pronto para futura importação',
  ALREADY_EXISTS: 'Sessão já existe',
  PATIENT_REVIEW: 'Revisar paciente',
  PATIENT_NOT_FOUND: 'Paciente não encontrado',
  SERVICE_REVIEW: 'Revisar serviço',
  MODALITY_REVIEW: 'Revisar modalidade',
  SCHEDULE_CONFLICT: 'Conflito de horário',
  CANCELLED_DO_NOT_IMPORT: 'Cancelado — não importar',
  BLOCKED: 'Bloqueado',
};

export const doctoraliaPreviewPatientMatchLabels: Record<DoctoraliaPatientMatch, string> = {
  MATCH_EXACT: 'Paciente encontrado',
  MATCH_PROBABLE_REVIEW: 'Correspondência provável — revisar',
  PATIENT_NOT_FOUND: 'Paciente não encontrado',
  CONFLICT: 'Conflito entre correspondências',
};

export const doctoraliaPreviewSessionLabels: Record<DoctoraliaSessionState, string> = {
  ALREADY_EXISTS: 'Sessão já existe',
  NOT_FOUND: 'Não encontrada',
  SCHEDULE_CONFLICT: 'Conflito de horário',
  UNKNOWN: 'Não verificada',
};
