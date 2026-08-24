import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import { normalizePhone } from '../../../shared/phoneNormalization.js';
import { getCsvValue, isValidIsoDate, normalizeCsvHeader, normalizeTimeValue, parseDateValue, parseNumberValue, type CsvRow } from './csv';
import {
  SOURCE_LABELS,
  type ImportAnalysis,
  type ImportConflict,
  type ImportEntity,
  type ImportEntityCounts,
  type ImportFileInput,
  type ImportPreview,
  type ImportRecognition,
  type ImportSource,
  type ImportWarning,
  type NormalizedAttachment,
  type NormalizedAppointment,
  type NormalizedCharge,
  type NormalizedClinicalRecord,
  type NormalizedDocument,
  type NormalizedPayment,
  type NormalizedPersonalAppointment,
  type NormalizedPatient,
  type NormalizedService,
  type PsychologyImportBundle,
} from './types';

export function createEmptyImportBundle(source: ImportSource, fileName?: string, analyzedAt = new Date().toISOString()): PsychologyImportBundle {
  return {
    metadata: { source, sourceLabel: SOURCE_LABELS[source], fileName, analyzedAt, formatVersion: 1 },
    patients: [],
    appointments: [],
    personalAppointments: [],
    services: [],
    documents: [],
    attachments: [],
    charges: [],
    payments: [],
    clinicalRecords: [],
    warnings: [],
    conflicts: [],
  };
}

function sourceId(row: CsvRow, fallback: string): string {
  return getCsvValue(row, 'externalId', 'external_id', 'id_externo', 'id', 'codigo', 'código') || fallback;
}

export function normalizeImportedPhoneFields(value: string | undefined): Pick<NormalizedPatient, 'phone' | 'rawImportedPhone' | 'displayPhone' | 'canonicalPhone'> {
  const rawImportedPhone = value || '';
  if (!rawImportedPhone) return { phone: undefined, rawImportedPhone: undefined, displayPhone: undefined, canonicalPhone: undefined };
  try {
    const normalized = normalizePhone(rawImportedPhone);
    return {
      phone: normalized.displayPhone,
      rawImportedPhone: normalized.rawImportedPhone,
      displayPhone: normalized.displayPhone,
      canonicalPhone: normalized.canonicalPhone,
    };
  } catch {
    // The preview remains inspectable, but an invalid value has no canonical form.
    return { phone: rawImportedPhone.trim(), rawImportedPhone, displayPhone: rawImportedPhone.trim(), canonicalPhone: undefined };
  }
}

function entityOf(row: CsvRow): string {
  return normalizeCsvHeader(getCsvValue(row, 'entity', 'entidade', 'tipo', 'type', 'registro'));
}

function addUnsupportedFieldWarnings(row: CsvRow, bundle: PsychologyImportBundle, sourceRecordId: string) {
  for (const key of Object.keys(row)) {
    if (['cpf', 'rg', 'senha', 'password', 'token'].includes(normalizeCsvHeader(key))) {
      bundle.warnings.push({ code: 'unsupported_field', message: `O campo ${key} não é importado nesta etapa.`, sourceRecordId });
    }
  }
}

function pushRowRecord(row: CsvRow, rowIndex: number, bundle: PsychologyImportBundle) {
  const recordId = sourceId(row, `csv-row-${rowIndex + 1}`);
  addUnsupportedFieldWarnings(row, bundle, recordId);
  const entity = entityOf(row);
  const isAppointment = ['appointment', 'appointments', 'consulta', 'sessao', 'sessão', 'session'].includes(entity);
  const isPersonal = ['personal', 'personalappointment', 'compromisso', 'compromissopessoal'].includes(entity);
  const isService = ['service', 'servico', 'serviço'].includes(entity);
  const isCharge = ['charge', 'cobranca', 'cobrança'].includes(entity);
  const isPayment = ['payment', 'pagamento'].includes(entity);
  const isClinical = ['clinicalrecord', 'registroclinico', 'registroclínico', 'evolution', 'evolucao', 'evolução'].includes(entity);
  const isDocument = ['document', 'documento'].includes(entity);
  const isAttachment = ['attachment', 'anexo'].includes(entity);
  if (isAppointment) {
    const dateRaw = getCsvValue(row, 'date', 'data', 'appointmentDate', 'dataConsulta');
    const timeRaw = getCsvValue(row, 'startTime', 'time', 'hora', 'horario', 'horário');
    const date = parseDateValue(dateRaw);
    const startTime = normalizeTimeValue(timeRaw);
    const item: NormalizedAppointment = {
      externalId: recordId,
      patientExternalId: getCsvValue(row, 'patientExternalId', 'patient_id', 'id_paciente', 'paciente_id', 'patientId') || undefined,
      patientRef: getCsvValue(row, 'patient', 'paciente', 'patientName', 'nomePaciente') || undefined,
      date: date || '',
      startTime: startTime || '',
      durationMinutes: parseNumberValue(getCsvValue(row, 'durationMinutes', 'duration', 'duracao', 'duração')) || 50,
      status: getCsvValue(row, 'status', 'situacao', 'situação') || undefined,
      modality: getCsvValue(row, 'modality', 'modalidade') || undefined,
      locationText: getCsvValue(row, 'location', 'local') || undefined,
      professionalExternalId: getCsvValue(row, 'professionalExternalId', 'professional_id', 'id_profissional') || undefined,
      notes: getCsvValue(row, 'notes', 'observacao', 'observação', 'anotacoes', 'anotações') || undefined,
      source: bundle.metadata.source,
      sourceRecordId: recordId,
    };
    bundle.appointments.push(item);
    if (!date || !isValidIsoDate(date)) bundle.conflicts.push({ type: 'invalid_date', severity: 'conflict', entity: 'appointments', sourceRecordId: recordId, message: 'Data da consulta inválida ou ausente.' });
    if (!startTime) bundle.conflicts.push({ type: 'invalid_time', severity: 'conflict', entity: 'appointments', sourceRecordId: recordId, message: 'Horário da consulta inválido ou ausente.' });
    if (!item.patientExternalId && !item.patientRef) bundle.conflicts.push({ type: 'missing_patient_reference', severity: 'conflict', entity: 'appointments', sourceRecordId: recordId, message: 'A consulta não possui referência de paciente.' });
    return;
  }
  if (isPersonal) {
    const date = parseDateValue(getCsvValue(row, 'date', 'data'));
    const startTime = normalizeTimeValue(getCsvValue(row, 'startTime', 'time', 'hora', 'horario', 'horário'));
    const item: NormalizedPersonalAppointment = { externalId: recordId, date: date || '', startTime: startTime || '', durationMinutes: parseNumberValue(getCsvValue(row, 'durationMinutes', 'duration', 'duracao', 'duração')) || 30, title: getCsvValue(row, 'title', 'titulo', 'título', 'nome') || 'Compromisso pessoal', notes: getCsvValue(row, 'notes', 'observacao', 'observação') || undefined, source: bundle.metadata.source, sourceRecordId: recordId };
    bundle.personalAppointments.push(item);
    if (!date) bundle.conflicts.push({ type: 'invalid_date', severity: 'conflict', entity: 'personalAppointments', sourceRecordId: recordId, message: 'Data do compromisso pessoal inválida ou ausente.' });
    if (!startTime) bundle.conflicts.push({ type: 'invalid_time', severity: 'conflict', entity: 'personalAppointments', sourceRecordId: recordId, message: 'Horário do compromisso pessoal inválido ou ausente.' });
    return;
  }
  if (isService) {
    const item: NormalizedService = { externalId: recordId, name: getCsvValue(row, 'name', 'nome', 'service', 'servico', 'serviço') || 'Serviço sem nome', durationMinutes: parseNumberValue(getCsvValue(row, 'durationMinutes', 'duration', 'duracao', 'duração')), price: parseNumberValue(getCsvValue(row, 'price', 'preco', 'preço', 'valor')), source: bundle.metadata.source, sourceRecordId: recordId };
    bundle.services.push(item);
    return;
  }
  if (isCharge) {
    bundle.charges.push({ externalId: recordId, patientExternalId: getCsvValue(row, 'patientExternalId', 'patient_id', 'id_paciente') || undefined, appointmentExternalId: getCsvValue(row, 'appointmentExternalId', 'appointment_id', 'session_id') || undefined, description: getCsvValue(row, 'description', 'descricao', 'descrição') || 'Cobrança sem descrição', amount: parseNumberValue(getCsvValue(row, 'amount', 'valor')), dueDate: parseDateValue(getCsvValue(row, 'dueDate', 'vencimento')), status: getCsvValue(row, 'status', 'situacao', 'situação') || undefined, sourceRecordId: recordId, source: bundle.metadata.source });
    return;
  }
  if (isPayment) {
    bundle.payments.push({ externalId: recordId, chargeExternalId: getCsvValue(row, 'chargeExternalId', 'charge_id', 'cobranca_id') || undefined, patientExternalId: getCsvValue(row, 'patientExternalId', 'patient_id', 'id_paciente') || undefined, amount: parseNumberValue(getCsvValue(row, 'amount', 'valor')), date: parseDateValue(getCsvValue(row, 'date', 'data')), method: getCsvValue(row, 'method', 'metodo', 'método') || undefined, sourceRecordId: recordId, source: bundle.metadata.source });
    return;
  }
  if (isClinical) {
    bundle.clinicalRecords.push({ externalId: recordId, patientExternalId: getCsvValue(row, 'patientExternalId', 'patient_id', 'id_paciente') || undefined, appointmentExternalId: getCsvValue(row, 'appointmentExternalId', 'appointment_id', 'session_id') || undefined, date: parseDateValue(getCsvValue(row, 'date', 'data')), content: getCsvValue(row, 'content', 'conteudo', 'conteúdo', 'texto', 'registro') || undefined, sourceRecordId: recordId, source: bundle.metadata.source });
    return;
  }
  if (isDocument) {
    bundle.documents.push({ externalId: recordId, patientExternalId: getCsvValue(row, 'patientExternalId', 'patient_id', 'id_paciente') || undefined, appointmentExternalId: getCsvValue(row, 'appointmentExternalId', 'appointment_id', 'session_id') || undefined, fileName: getCsvValue(row, 'fileName', 'filename', 'nomeArquivo', 'nome do arquivo') || `documento-${recordId}.txt`, documentType: getCsvValue(row, 'documentType', 'tipoDocumento') || undefined, sourceRecordId: recordId, source: bundle.metadata.source });
    return;
  }
  if (isAttachment) {
    const ownerExternalId = getCsvValue(row, 'ownerExternalId', 'owner_id', 'patient_id', 'appointment_id') || undefined;
    const ownerTypeValue = normalizeCsvHeader(getCsvValue(row, 'ownerType', 'owner_type', 'tipoVinculo'));
    const ownerType: NormalizedAttachment['ownerType'] = ownerTypeValue.includes('patient') || ownerTypeValue.includes('paciente') ? 'patient' : ownerTypeValue.includes('appointment') || ownerTypeValue.includes('consulta') ? 'appointment' : 'unknown';
    bundle.attachments.push({ externalId: recordId, ownerType, ownerExternalId, fileName: getCsvValue(row, 'fileName', 'filename', 'nomeArquivo') || `anexo-${recordId}`, mimeType: getCsvValue(row, 'mimeType', 'mime') || undefined, sizeBytes: parseNumberValue(getCsvValue(row, 'sizeBytes', 'size', 'tamanho')), sha256: getCsvValue(row, 'sha256', 'checksum') || undefined, sourceRecordId: recordId, source: bundle.metadata.source });
    if (!ownerExternalId) bundle.conflicts.push({ type: 'attachment_without_owner', severity: 'conflict', entity: 'attachments', sourceRecordId: recordId, message: 'Anexo sem vínculo. Será mantido na categoria Anexo sem vínculo.' });
    return;
  }
  const name = getCsvValue(row, 'name', 'nome', 'patient', 'paciente', 'patientName', 'nomePaciente');
  if (!name) {
    bundle.conflicts.push({ type: 'unsupported_record', severity: 'conflict', sourceRecordId: recordId, message: 'Registro sem entidade reconhecida nem nome de paciente.' });
    return;
  }
  bundle.patients.push({ externalId: getCsvValue(row, 'patientExternalId', 'patient_id', 'id_paciente', 'externalId', 'external_id', 'id') || undefined, name, birthDate: parseDateValue(getCsvValue(row, 'birthDate', 'dataNascimento', 'data de nascimento', 'nascimento')), ...normalizeImportedPhoneFields(getCsvValue(row, 'phone', 'telefone', 'celular') || undefined), email: getCsvValue(row, 'email', 'e-mail') || undefined, status: getCsvValue(row, 'status', 'situacao', 'situação') || undefined, source: bundle.metadata.source, sourceRecordId: recordId });
}

export function normalizeCsvRows(rows: CsvRow[], input: ImportFileInput): PsychologyImportBundle {
  const bundle = createEmptyImportBundle(input.source, input.fileName);
  rows.forEach((row, index) => pushRowRecord(row, index, bundle));
  const seen = new Set<string>();
  for (const [entity, values] of Object.entries(bundle) as [ImportEntity, unknown[]][]) {
    if (!Array.isArray(values)) continue;
    for (const value of values as Array<{ externalId?: string; sourceRecordId?: string }>) {
      if (!value.externalId) continue;
      const key = `${entity}:${value.externalId}`;
      if (seen.has(key)) bundle.conflicts.push({ type: 'duplicate_source_id', severity: 'conflict', entity, sourceRecordId: value.sourceRecordId, message: `Identificador de origem duplicado em ${entity}.` });
      seen.add(key);
    }
  }
  return bundle;
}

export function entityCounts(bundle: PsychologyImportBundle): ImportEntityCounts {
  return { patients: bundle.patients.length, appointments: bundle.appointments.length, personalAppointments: bundle.personalAppointments.length, services: bundle.services.length, documents: bundle.documents.length, attachments: bundle.attachments.length, charges: bundle.charges.length, payments: bundle.payments.length, clinicalRecords: bundle.clinicalRecords.length };
}

export function previewImport(bundle: PsychologyImportBundle, store?: PsychologyStore): ImportPreview {
  const counts = entityCounts(bundle);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const ignored = bundle.conflicts.filter(conflict => conflict.type === 'unsupported_record' || conflict.type === 'unsupported_field').length;
  const valid = Math.max(0, total - bundle.conflicts.length - ignored);
  const storePatientIds = new Set(store?.patients.map(patient => patient.id) || []);
  const unlinkedAttachments = bundle.attachments.filter(item => !item.ownerExternalId || (item.ownerType === 'unknown' && !storePatientIds.has(item.ownerExternalId))).length;
  return { valid, warnings: bundle.warnings.length, conflicts: bundle.conflicts.length, ignored, counts, clinical: counts.clinicalRecords, administrative: total - counts.clinicalRecords, unlinkedAttachments };
}

export function makeAnalysis(recognition: ImportRecognition, input: ImportFileInput, bundle: PsychologyImportBundle, rowCount: number, messages: string[] = []): ImportAnalysis {
  return { recognition, fileName: input.fileName, fileSizeBytes: input.bytes?.byteLength || new TextEncoder().encode(input.text || '').byteLength, rowCount, bundle, preview: previewImport(bundle), messages };
}
