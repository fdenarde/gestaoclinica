import { createEmptyImportBundle, previewImport } from './normalize';
import { getCsvValue, normalizeCsvHeader, parseCsvText, parseDateValue, type CsvRow } from './csv';
import type {
  DoctoraliaAddress,
  DoctoraliaAppointmentCandidate,
  DoctoraliaAppointmentCounts,
  DoctoraliaAppointmentStatus,
  DoctoraliaCatalogItem,
  DoctoraliaClinicalBackground,
  DoctoraliaDemographics,
  DoctoraliaDryRunResult,
  DoctoraliaExternalReference,
  DoctoraliaImportAnalysis,
  DoctoraliaImportRecognition,
  DoctoraliaModality,
  DoctoraliaNotImportedPatient,
  DoctoraliaPatientCandidate,
  DoctoraliaPatientCounts,
  DoctoraliaReviewReason,
  ImportFileInput,
  PsychologyImportBundle,
} from './types';

export const DOCTORALIA_APPOINTMENT_CUTOFF = '2025-01-01' as const;
export const DOCTORALIA_TIMEZONE = 'America/Sao_Paulo' as const;
export const DOCTORALIA_CANCELLED_STATUSES = ['CanceledByUser', 'CanceledByPatient'] as const;
export const DOCTORALIA_IGNORED_FIELDS = [
  'observations',
  'precedents',
  'allergies',
  'other information',
  'fiscal fields',
  'insurance',
  'SUS/nation healthcare number',
  'signed data privacy',
  'signed data marketing',
  'comments',
  'recurrency type',
  'marketing metadata',
] as const;

interface ParsedDoctoraliaFile {
  input: ImportFileInput;
  fields: string[];
  rows: CsvRow[];
  errors: string[];
}

export interface DoctoraliaFilesInput {
  patients: ImportFileInput;
  appointments: ImportFileInput;
  now?: string | Date;
}

interface CivilDateTime {
  civilDate: string;
  time: string;
  epochMs: number;
}

interface InternalAppointment {
  externalEventId: string;
  externalScheduleId?: string;
  externalPatientId: string;
  agenda: string;
  service: string;
  start?: CivilDateTime;
  end?: CivilDateTime;
  sourceStatus: string;
  modality: DoctoraliaModality;
  locationName?: string;
  rawRow: CsvRow;
}

const decoder = new TextDecoder();

function textOf(input: ImportFileInput): string {
  if (input.text != null) return input.text;
  return input.bytes ? decoder.decode(input.bytes) : '';
}

function parseFile(input: ImportFileInput): ParsedDoctoraliaFile {
  const parsed = parseCsvText(textOf(input));
  return { input, fields: parsed.fields, rows: parsed.rows, errors: parsed.errors };
}

function hasField(fields: string[], ...aliases: string[]): boolean {
  const normalized = new Set(fields.map(normalizeCsvHeader));
  return aliases.some(alias => normalized.has(normalizeCsvHeader(alias)));
}

function doctoraliaValue(row: CsvRow, ...aliases: string[]): string {
  return getCsvValue(row, ...aliases);
}

function requiredPatientSchema(fields: string[]): boolean {
  return hasField(fields, 'id', 'patient id', 'patient_id')
    && (hasField(fields, 'first name', 'first_name', 'firstname', 'nome')
      || hasField(fields, 'last name', 'last_name', 'lastname', 'sobrenome'));
}

function requiredAppointmentSchema(fields: string[]): boolean {
  return hasField(fields, 'eventId', 'event id', 'event_id')
    && hasField(fields, 'start time', 'start_time', 'startTime')
    && hasField(fields, 'patient id', 'patient_id', 'patientId');
}

export function recognizeDoctoraliaPatientsCsv(input: ImportFileInput): boolean {
  return /.csv$/i.test(input.fileName) && requiredPatientSchema(parseFile(input).fields);
}

export function recognizeDoctoraliaAppointmentsCsv(input: ImportFileInput): boolean {
  return /.csv$/i.test(input.fileName) && requiredAppointmentSchema(parseFile(input).fields);
}

function normalizeText(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function externalReference(externalId: string): DoctoraliaExternalReference {
  return { source: 'DOCTORALIA', externalId };
}

function normalizedKey(value: string): string {
  return normalizeCsvHeader(value);
}

function addressFrom(row: CsvRow): DoctoraliaAddress {
  return Object.fromEntries([
    ['street', normalizeText(doctoraliaValue(row, 'address street', 'address_street', 'street'))],
    ['number', normalizeText(doctoraliaValue(row, 'address number', 'address_number', 'number'))],
    ['postalCode', normalizeText(doctoraliaValue(row, 'address postal code', 'address_postal_code', 'postal code', 'zipcode'))],
    // Doctoralia's source typo is intentionally accepted here and normalized in-domain.
    ['neighborhood', normalizeText(doctoraliaValue(row, 'address neighbordhood', 'address neighborhood', 'address_neighborhood', 'neighborhood'))],
    ['city', normalizeText(doctoraliaValue(row, 'address city', 'address_city', 'city'))],
    ['state', normalizeText(doctoraliaValue(row, 'address state', 'address_state', 'state'))],
    ['province', normalizeText(doctoraliaValue(row, 'address province', 'address_province', 'province'))],
    ['country', normalizeText(doctoraliaValue(row, 'address country', 'address_country', 'country'))],
  ].filter(([, value]) => value !== undefined)) as DoctoraliaAddress;
}

function demographicsFrom(row: CsvRow): DoctoraliaDemographics {
  return Object.fromEntries([
    ['religion', normalizeText(doctoraliaValue(row, 'religion'))],
    ['education', normalizeText(doctoraliaValue(row, 'education'))],
    ['profession', normalizeText(doctoraliaValue(row, 'profession'))],
    ['nationality', normalizeText(doctoraliaValue(row, 'nationality'))],
  ].filter(([, value]) => value !== undefined)) as DoctoraliaDemographics;
}

function statusKey(value: string): string {
  return normalizeCsvHeader(value);
}

function isCancelled(value: string): boolean {
  return DOCTORALIA_CANCELLED_STATUSES.some(status => statusKey(status) === statusKey(value));
}

function dateParts(value: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DOCTORALIA_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { year: map.year, month: map.month, day: map.day, hour: map.hour, minute: map.minute };
}

function parseCivilDateTime(value: string, fallbackDate?: string): CivilDateTime | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (hasZone) {
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return undefined;
    const parts = dateParts(parsed);
    return { civilDate: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, epochMs: parsed.getTime() };
  }

  const dateTime = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2})[:h](\d{2}))?/);
  const brazilian = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[ T]+(\d{1,2})[:h](\d{2}))?/);
  const timeOnly = raw.match(/^(\d{1,2})[:h](\d{2})/i);
  let year: number;
  let month: number;
  let day: number;
  let hour = 0;
  let minute = 0;
  if (dateTime) {
    year = Number(dateTime[1]); month = Number(dateTime[2]); day = Number(dateTime[3]); hour = Number(dateTime[4] || 0); minute = Number(dateTime[5] || 0);
  } else if (brazilian) {
    year = Number(brazilian[3]); month = Number(brazilian[2]); day = Number(brazilian[1]); hour = Number(brazilian[4] || 0); minute = Number(brazilian[5] || 0);
  } else if (timeOnly && fallbackDate) {
    const date = parseDateValue(fallbackDate);
    if (!date) return undefined;
    [year, month, day] = date.split('-').map(Number);
    hour = Number(timeOnly[1]); minute = Number(timeOnly[2]);
  } else return undefined;
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const civilDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  // America/Sao_Paulo is UTC-03:00 for the supported migration period. The civil
  // representation remains the source of truth; epochMs is only for ordering.
  const epochMs = Date.UTC(year, month - 1, day, hour + 3, minute);
  return { civilDate, time, epochMs };
}

function parseNow(value?: string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (value) return new Date(value).getTime();
  return Date.now();
}

function modalityFrom(row: CsvRow): DoctoraliaModality {
  const raw = doctoraliaValue(row, 'agenda', 'calendar', 'schedule', 'location', 'modality', 'modalidade');
  return normalizedKey(raw).includes('teleatendimento') || normalizedKey(raw).includes('online') || normalizedKey(raw).includes('on line')
    ? 'ONLINE'
    : 'PRESENCIAL';
}

function agendaFrom(row: CsvRow): string {
  return normalizeText(doctoraliaValue(row, 'agenda', 'calendar', 'schedule', 'location', 'local')) || 'Agenda não informada';
}

function serviceFrom(row: CsvRow): string {
  return normalizeText(doctoraliaValue(row, 'service', 'serviço', 'servico')) || 'Serviço não informado';
}

function parsePatientRows(file: ParsedDoctoraliaFile): { rows: Array<{ id: string; row: CsvRow }>; duplicateIds: string[]; conflicts: string[] } {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const conflicts: string[] = [];
  const rows: Array<{ id: string; row: CsvRow }> = [];
  file.rows.forEach((row, index) => {
    const id = normalizeText(doctoraliaValue(row, 'id', 'patient id', 'patient_id', 'patientId'));
    if (!id) {
      conflicts.push(`Paciente sem ID externo na linha ${index + 2}.`);
      return;
    }
    if (seen.has(id)) {
      duplicateIds.push(id);
      conflicts.push(`ID externo de paciente duplicado: ${id}.`);
      return;
    }
    seen.add(id);
    rows.push({ id, row });
  });
  return { rows, duplicateIds, conflicts };
}

function parseAppointmentRows(file: ParsedDoctoraliaFile): { rows: InternalAppointment[]; duplicateIds: string[]; conflicts: string[] } {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const conflicts: string[] = [];
  const rows: InternalAppointment[] = [];
  file.rows.forEach((row, index) => {
    const externalEventId = normalizeText(doctoraliaValue(row, 'eventId', 'event id', 'event_id', 'id'));
    const externalPatientId = normalizeText(doctoraliaValue(row, 'patient id', 'patient_id', 'patientId', 'patient'));
    if (!externalEventId || !externalPatientId) {
      conflicts.push(`Consulta sem eventId ou paciente externo na linha ${index + 2}.`);
      return;
    }
    if (seen.has(externalEventId)) {
      duplicateIds.push(externalEventId);
      conflicts.push(`eventId Doctoralia duplicado: ${externalEventId}.`);
      return;
    }
    seen.add(externalEventId);
    const startRaw = doctoraliaValue(row, 'start time', 'start_time', 'startTime', 'start', 'data início', 'data inicio');
    const start = parseCivilDateTime(startRaw);
    const endRaw = doctoraliaValue(row, 'end time', 'end_time', 'endTime', 'end', 'data fim', 'data final');
    const end = parseCivilDateTime(endRaw, start?.civilDate);
    rows.push({
      externalEventId,
      externalScheduleId: normalizeText(doctoraliaValue(row, 'schedule id', 'schedule_id', 'scheduleId')),
      externalPatientId,
      agenda: agendaFrom(row),
      service: serviceFrom(row),
      start,
      end,
      sourceStatus: normalizeText(doctoraliaValue(row, 'appointment status', 'appointment_status', 'status', 'situação', 'situacao')) || 'UNKNOWN',
      modality: modalityFrom(row),
      locationName: modalityFrom(row) === 'PRESENCIAL' ? agendaFrom(row) : undefined,
      rawRow: row,
    });
    if (!start) conflicts.push(`Consulta sem data/hora inicial válida: ${externalEventId}.`);
    if (start && end && end.epochMs < start.epochMs) conflicts.push(`Consulta com end time anterior ao start time: ${externalEventId}.`);
  });
  return { rows, duplicateIds, conflicts };
}

function patientCandidate(id: string, row: CsvRow, group: 'A_HISTORY_NON_CANCELLED' | 'B_ONLY_CANCELLED', futureEvidence: boolean): DoctoraliaPatientCandidate {
  const firstName = normalizeText(doctoraliaValue(row, 'first name', 'first_name', 'firstname', 'nome')) || '';
  const lastName = normalizeText(doctoraliaValue(row, 'last name', 'last_name', 'lastname', 'sobrenome')) || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || id;
  const reviewReason: DoctoraliaReviewReason | undefined = group === 'B_ONLY_CANCELLED'
    ? 'ONLY_CANCELLED_APPOINTMENTS'
    : futureEvidence ? undefined : 'STATUS_NOT_CONFIRMED';
  return {
    externalPatientId: id,
    firstName,
    lastName,
    name,
    phone: normalizeText(doctoraliaValue(row, 'phone', 'telephone', 'telefone', 'mobile')),
    additionalPhone: normalizeText(doctoraliaValue(row, 'additional phone', 'additional_phone', 'secondary phone', 'telefone adicional')),
    email: normalizeText(doctoraliaValue(row, 'email', 'e-mail')),
    birthDate: parseDateValue(doctoraliaValue(row, 'date of birth', 'date_of_birth', 'birth date', 'birthDate', 'data de nascimento')),
    address: addressFrom(row),
    demographics: demographicsFrom(row),
    status: group === 'A_HISTORY_NON_CANCELLED' && futureEvidence ? 'ACTIVE' : 'INACTIVE',
    group,
    ...(reviewReason ? { migrationReview: { required: true, reason: reviewReason } } : {}),
    importable: true,
    externalReference: externalReference(id),
  };
}

function catalog(items: Array<{ name: string; externalId: string }>): DoctoraliaCatalogItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalizedKey(item.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => ({ name: item.name, normalizedKey: normalizedKey(item.name), source: 'DOCTORALIA', externalReference: externalReference(item.externalId) }));
}

function bundleFrom(
  patients: DoctoraliaPatientCandidate[],
  appointments: DoctoraliaAppointmentCandidate[],
  services: DoctoraliaCatalogItem[],
  now: string,
): PsychologyImportBundle {
  const bundle = createEmptyImportBundle('doctoralia', 'patients.csv');
  bundle.patients = patients.map(patient => ({
    externalId: patient.externalPatientId,
    name: patient.name,
    birthDate: patient.birthDate,
    phone: patient.phone || patient.additionalPhone || '',
    email: patient.email,
    status: patient.status.toLowerCase(),
    source: 'doctoralia',
    sourceRecordId: patient.externalPatientId,
  }));
  bundle.appointments = appointments.filter(item => item.importable).map(item => ({
    externalId: item.externalEventId,
    patientExternalId: item.externalPatientId,
    date: item.civilDate,
    startTime: item.startTime,
    durationMinutes: item.durationMinutes,
    status: item.status === 'CANCELLED' ? 'cancelada' : item.status === 'LEGACY_ATTENDANCE_UNKNOWN' ? 'LEGACY_ATTENDANCE_UNKNOWN' : 'agendada',
    modality: item.modality === 'ONLINE' ? 'online' : 'presencial',
    locationText: item.locationName,
    source: 'doctoralia',
    sourceRecordId: item.externalEventId,
  }));
  bundle.services = services.map(item => ({
    externalId: item.normalizedKey,
    name: item.name,
    source: 'doctoralia',
    sourceRecordId: item.externalReference.externalId,
  }));
  bundle.metadata = { ...bundle.metadata, analyzedAt: now, sourceLabel: 'Doctoralia' };
  return bundle;
}

function dryRunDetails(patientCounts: DoctoraliaPatientCounts, appointmentCounts: DoctoraliaAppointmentCounts): string[] {
  return [
    `${patientCounts.total} paciente(s) lido(s); ${patientCounts.initiallyImportable} candidato(s) na primeira importação e ${patientCounts.notImportedInitially} recuperável(is) sem agendamento.`,
    `Grupos A/B/C: ${patientCounts.groupA}/${patientCounts.groupB}/${patientCounts.groupC}.`,
    `${appointmentCounts.totalOriginal} consulta(s) lida(s); ${appointmentCounts.beforeCutoff} anterior(es) ao corte e ${appointmentCounts.importable} elegível(is) para análise futura.`,
    `${appointmentCounts.historicalAttendanceUnknown} histórico(s) não cancelado(s) sem comparecimento informado; nenhum foi convertido em realizada/falta.`,
    'writesPerformed=false; deletesPerformed=false; nenhum registro foi persistido.',
  ];
}

export function analyzeDoctoraliaFiles(input: DoctoraliaFilesInput): DoctoraliaImportAnalysis {
  const patientFile = parseFile(input.patients);
  const appointmentFile = parseFile(input.appointments);
  const patientsRecognized = requiredPatientSchema(patientFile.fields);
  const appointmentsRecognized = requiredAppointmentSchema(appointmentFile.fields);
  const recognition: DoctoraliaImportRecognition = {
    recognized: patientsRecognized && appointmentsRecognized,
    patientsFileRecognized: patientsRecognized,
    appointmentsFileRecognized: appointmentsRecognized,
    message: patientsRecognized && appointmentsRecognized
      ? 'Arquivos patients.csv e patients_appointments.csv reconhecidos para dry-run local.'
      : 'Os dois schemas Doctoralia são obrigatórios: patients.csv e patients_appointments.csv.',
  };

  const parsedPatients = parsePatientRows(patientFile);
  const parsedAppointments = parseAppointmentRows(appointmentFile);
  const allAppointmentsByPatient = new Map<string, InternalAppointment[]>();
  for (const appointment of parsedAppointments.rows) {
    const list = allAppointmentsByPatient.get(appointment.externalPatientId) || [];
    list.push(appointment);
    allAppointmentsByPatient.set(appointment.externalPatientId, list);
  }
  const nowEpoch = parseNow(input.now);
  const now = input.now instanceof Date ? input.now.toISOString() : String(input.now || new Date().toISOString());
  const patients: DoctoraliaPatientCandidate[] = [];
  const notImportedPatients: DoctoraliaNotImportedPatient[] = [];
  const clinicalBackgrounds: DoctoraliaClinicalBackground[] = [];
  const patientCounts: DoctoraliaPatientCounts = { total: patientFile.rows.length, groupA: 0, groupB: 0, groupC: 0, activeByFutureEvidence: 0, inactiveReview: 0, initiallyImportable: 0, notImportedInitially: 0 };
  const conflictMessages = [...patientFile.errors, ...appointmentFile.errors, ...parsedPatients.conflicts, ...parsedAppointments.conflicts];

  for (const patient of parsedPatients.rows) {
    const patientAppointments = allAppointmentsByPatient.get(patient.id) || [];
    const hasNonCancelled = patientAppointments.some(item => !isCancelled(item.sourceStatus));
    const hasFutureNonCancelled = patientAppointments.some(item => !isCancelled(item.sourceStatus) && Boolean(item.start) && item.start!.epochMs >= nowEpoch);
    const group = patientAppointments.length === 0 ? 'C_NO_APPOINTMENTS' : hasNonCancelled ? 'A_HISTORY_NON_CANCELLED' : 'B_ONLY_CANCELLED';
    if (group === 'C_NO_APPOINTMENTS') {
      patientCounts.groupC += 1;
      const firstName = normalizeText(doctoraliaValue(patient.row, 'first name', 'first_name', 'firstname', 'nome')) || '';
      const lastName = normalizeText(doctoraliaValue(patient.row, 'last name', 'last_name', 'lastname', 'sobrenome')) || '';
      notImportedPatients.push({ externalPatientId: patient.id, name: [firstName, lastName].filter(Boolean).join(' ') || patient.id, reason: 'NO_APPOINTMENTS_FOUND', reviewable: true });
      continue;
    }
    const candidate = patientCandidate(patient.id, patient.row, group, hasFutureNonCancelled);
    patients.push(candidate);
    patientCounts[group === 'A_HISTORY_NON_CANCELLED' ? 'groupA' : 'groupB'] += 1;
    patientCounts.initiallyImportable += 1;
    if (candidate.status === 'ACTIVE') patientCounts.activeByFutureEvidence += 1;
    if (candidate.migrationReview) patientCounts.inactiveReview += 1;
    const medications = normalizeText(doctoraliaValue(patient.row, 'medications', 'medication', 'medicamentos'));
    if (medications) clinicalBackgrounds.push({ externalPatientId: patient.id, medications, source: 'DOCTORALIA', protected: true });
  }
  patientCounts.notImportedInitially = notImportedPatients.length;

  const patientIds = new Set(parsedPatients.rows.map(item => item.id));
  const appointments: DoctoraliaAppointmentCandidate[] = [];
  const appointmentCounts: DoctoraliaAppointmentCounts = { totalOriginal: appointmentFile.rows.length, beforeCutoff: 0, atOrAfterCutoff: 0, cancelled: 0, future: 0, historicalAttendanceUnknown: 0, importable: 0 };
  for (const item of parsedAppointments.rows) {
    const start = item.start;
    const status: DoctoraliaAppointmentStatus = isCancelled(item.sourceStatus) ? 'CANCELLED' : start && start.epochMs >= nowEpoch ? 'SCHEDULED' : 'LEGACY_ATTENDANCE_UNKNOWN';
    const historicalAttendanceUnknown = status === 'LEGACY_ATTENDANCE_UNKNOWN';
    const beforeCutoff = !start || start.civilDate < DOCTORALIA_APPOINTMENT_CUTOFF;
    if (beforeCutoff) appointmentCounts.beforeCutoff += 1;
    else appointmentCounts.atOrAfterCutoff += 1;
    if (status === 'CANCELLED') appointmentCounts.cancelled += 1;
    if (start && start.epochMs >= nowEpoch) appointmentCounts.future += 1;
    if (historicalAttendanceUnknown) appointmentCounts.historicalAttendanceUnknown += 1;
    const durationMinutes = start && item.end ? Math.max(0, Math.round((item.end.epochMs - start.epochMs) / 60000)) : 0;
    const importable = Boolean(start && !beforeCutoff && patientIds.has(item.externalPatientId) && durationMinutes > 0);
    if (!patientIds.has(item.externalPatientId)) conflictMessages.push(`Consulta ${item.externalEventId} referencia paciente inexistente.`);
    if (importable) appointmentCounts.importable += 1;
    if (!start || beforeCutoff || !patientIds.has(item.externalPatientId) || durationMinutes <= 0) continue;
    appointments.push({
      externalEventId: item.externalEventId,
      externalScheduleId: item.externalScheduleId,
      externalPatientId: item.externalPatientId,
      agenda: item.agenda,
      service: item.service,
      civilDate: start.civilDate,
      startTime: start.time,
      durationMinutes,
      sourceStatus: item.sourceStatus,
      status,
      modality: item.modality,
      locationName: item.locationName,
      importable: true,
      historicalAttendanceUnknown,
      externalReference: externalReference(item.externalEventId),
    });
  }
  const locations = catalog(appointments.filter(item => item.modality === 'PRESENCIAL' && item.locationName).map(item => ({ name: item.locationName!, externalId: item.externalEventId })));
  const services = catalog(appointments.filter(item => item.service && item.service !== 'Serviço não informado').map(item => ({ name: item.service, externalId: item.externalEventId })));
  const bundle = bundleFrom(patients, appointments, services, now);
  bundle.conflicts.push(...conflictMessages.map(message => ({ type: 'unsupported_record' as const, severity: 'conflict' as const, message })));
  bundle.warnings.push({ code: 'doctoralia_conservative_status', message: 'Status operacional foi inferido somente por appointment futuro não cancelado; histórico passado não foi marcado como realizado ou falta.' });
  const dryRun: DoctoraliaDryRunResult = {
    patientCounts,
    appointmentCounts,
    patients,
    notImportedPatients,
    appointments,
    clinicalBackgrounds,
    locations,
    services,
    ignoredFields: [...DOCTORALIA_IGNORED_FIELDS],
    writesPerformed: false,
    deletesPerformed: false,
    persisted: false,
    details: dryRunDetails(patientCounts, appointmentCounts),
  };
  return { recognition, cutoff: DOCTORALIA_APPOINTMENT_CUTOFF, timezone: DOCTORALIA_TIMEZONE, patientRows: patientFile.rows.length, appointmentRows: appointmentFile.rows.length, bundle, dryRun };
}

export function buildDoctoraliaDryRunReport(analysis: DoctoraliaImportAnalysis): string {
  const { patientCounts, appointmentCounts } = analysis.dryRun;
  return [
    'DOCTORALIA DRY-RUN — RESUMO AGREGADO',
    `FILES RECOGNIZED: patients=${analysis.recognition.patientsFileRecognized ? 'SIM' : 'NÃO'}; appointments=${analysis.recognition.appointmentsFileRecognized ? 'SIM' : 'NÃO'}`,
    `PATIENT COUNTS: total=${patientCounts.total}; groupA=${patientCounts.groupA}; groupB=${patientCounts.groupB}; groupC=${patientCounts.groupC}; activeByFutureEvidence=${patientCounts.activeByFutureEvidence}; inactiveReview=${patientCounts.inactiveReview}; notImportedInitially=${patientCounts.notImportedInitially}`,
    `APPOINTMENT CUTOFF: ${analysis.cutoff}; timezone=${analysis.timezone}`,
    `APPOINTMENT COUNTS: original=${appointmentCounts.totalOriginal}; beforeCutoff=${appointmentCounts.beforeCutoff}; atOrAfter=${appointmentCounts.atOrAfterCutoff}; cancelled=${appointmentCounts.cancelled}; future=${appointmentCounts.future}; attendanceUnknown=${appointmentCounts.historicalAttendanceUnknown}; importable=${appointmentCounts.importable}`,
    'PII: relatório agregado sem nomes, telefones, e-mails, endereços, medicamentos ou IDs externos individuais.',
    'DRY-RUN: writesPerformed=false; deletesPerformed=false; persisted=false.',
  ].join('\n');
}

export function emptyDoctoraliaAnalysis(input: ImportFileInput): DoctoraliaImportAnalysis {
  const bundle = createEmptyImportBundle('doctoralia', input.fileName);
  const patientCounts: DoctoraliaPatientCounts = { total: 0, groupA: 0, groupB: 0, groupC: 0, activeByFutureEvidence: 0, inactiveReview: 0, initiallyImportable: 0, notImportedInitially: 0 };
  const appointmentCounts: DoctoraliaAppointmentCounts = { totalOriginal: 0, beforeCutoff: 0, atOrAfterCutoff: 0, cancelled: 0, future: 0, historicalAttendanceUnknown: 0, importable: 0 };
  return {
    recognition: { recognized: false, patientsFileRecognized: false, appointmentsFileRecognized: false, message: 'Os dois arquivos Doctoralia ainda não foram selecionados.' },
    cutoff: DOCTORALIA_APPOINTMENT_CUTOFF,
    timezone: DOCTORALIA_TIMEZONE,
    patientRows: 0,
    appointmentRows: 0,
    bundle,
    dryRun: { patientCounts, appointmentCounts, patients: [], notImportedPatients: [], appointments: [], clinicalBackgrounds: [], locations: [], services: [], ignoredFields: [...DOCTORALIA_IGNORED_FIELDS], writesPerformed: false, deletesPerformed: false, persisted: false, details: [] },
  };
}

export function doctoraliaPreview(analysis: DoctoraliaImportAnalysis) {
  return previewImport(analysis.bundle);
}
