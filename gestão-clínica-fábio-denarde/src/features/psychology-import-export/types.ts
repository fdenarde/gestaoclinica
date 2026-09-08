import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';

export type ImportSource = 'doctoralia' | 'csv' | 'gestao-clinica-backup' | 'outro-sistema';
export type ImportEntity = 'patients' | 'appointments' | 'personalAppointments' | 'services' | 'documents' | 'attachments' | 'charges' | 'payments' | 'clinicalRecords';
export type ImportSeverity = 'warning' | 'conflict';
export type ImportConflictType =
  | 'possible_duplicate_patient'
  | 'missing_patient_reference'
  | 'invalid_date'
  | 'invalid_time'
  | 'appointment_conflict'
  | 'attachment_without_owner'
  | 'unsupported_field'
  | 'unsupported_record'
  | 'corrupted_file'
  | 'duplicate_source_id';

export interface ImportWarning {
  code: string;
  message: string;
  entity?: ImportEntity;
  sourceRecordId?: string;
}

export interface ImportConflict {
  type: ImportConflictType;
  message: string;
  entity?: ImportEntity;
  sourceRecordId?: string;
  severity: ImportSeverity;
}

export interface ImportFileInput {
  fileName: string;
  mimeType?: string;
  bytes?: Uint8Array;
  text?: string;
  source: ImportSource;
  /** Additional local files used by multi-file adapters such as Doctoralia. */
  relatedFiles?: ImportFileInput[];
}

export interface ImportRecognition {
  recognized: boolean;
  source: ImportSource;
  label: string;
  message: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface NormalizedPatient {
  externalId?: string;
  name: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  status?: string;
  source: ImportSource;
  sourceRecordId?: string;
}

export interface NormalizedAppointment {
  externalId: string;
  patientExternalId?: string;
  patientRef?: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  status?: string;
  modality?: string;
  locationText?: string;
  professionalExternalId?: string;
  notes?: string;
  source: ImportSource;
  sourceRecordId?: string;
}

export interface NormalizedPersonalAppointment {
  externalId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  title: string;
  notes?: string;
  source: ImportSource;
  sourceRecordId?: string;
}

export interface NormalizedService {
  externalId?: string;
  name: string;
  durationMinutes?: number;
  price?: number;
  source: ImportSource;
  sourceRecordId?: string;
}

export interface NormalizedDocument {
  externalId?: string;
  patientExternalId?: string;
  appointmentExternalId?: string;
  fileName: string;
  documentType?: string;
  sourceRecordId?: string;
  source: ImportSource;
}

export interface NormalizedAttachment {
  externalId?: string;
  ownerType: 'patient' | 'appointment' | 'unknown';
  ownerExternalId?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  sourceRecordId?: string;
  source: ImportSource;
}

export interface NormalizedCharge {
  externalId?: string;
  patientExternalId?: string;
  appointmentExternalId?: string;
  description: string;
  amount?: number;
  dueDate?: string;
  status?: string;
  sourceRecordId?: string;
  source: ImportSource;
}

export interface NormalizedPayment {
  externalId?: string;
  chargeExternalId?: string;
  patientExternalId?: string;
  amount?: number;
  date?: string;
  method?: string;
  sourceRecordId?: string;
  source: ImportSource;
}

export interface NormalizedClinicalRecord {
  externalId?: string;
  patientExternalId?: string;
  appointmentExternalId?: string;
  date?: string;
  content?: string;
  sourceRecordId?: string;
  source: ImportSource;
}

export interface PsychologyImportBundle {
  metadata: {
    source: ImportSource;
    sourceLabel: string;
    fileName?: string;
    analyzedAt: string;
    formatVersion: number;
  };
  patients: NormalizedPatient[];
  appointments: NormalizedAppointment[];
  personalAppointments: NormalizedPersonalAppointment[];
  services: NormalizedService[];
  documents: NormalizedDocument[];
  attachments: NormalizedAttachment[];
  charges: NormalizedCharge[];
  payments: NormalizedPayment[];
  clinicalRecords: NormalizedClinicalRecord[];
  warnings: ImportWarning[];
  conflicts: ImportConflict[];
}

export interface ImportEntityCounts {
  patients: number;
  appointments: number;
  personalAppointments: number;
  services: number;
  documents: number;
  attachments: number;
  charges: number;
  payments: number;
  clinicalRecords: number;
}

export interface ImportPreview {
  valid: number;
  warnings: number;
  conflicts: number;
  ignored: number;
  counts: ImportEntityCounts;
  clinical: number;
  administrative: number;
  unlinkedAttachments: number;
}

export interface ImportAnalysis {
  recognition: ImportRecognition;
  fileName: string;
  fileSizeBytes: number;
  rowCount: number;
  bundle: PsychologyImportBundle;
  preview: ImportPreview;
  messages: string[];
  doctoralia?: DoctoraliaImportAnalysis;
}

export type DoctoraliaPatientGroup = 'A_HISTORY_NON_CANCELLED' | 'B_ONLY_CANCELLED' | 'C_NO_APPOINTMENTS';
export type DoctoraliaPatientStatus = 'ACTIVE' | 'INACTIVE';
export type DoctoraliaReviewReason = 'STATUS_NOT_CONFIRMED' | 'ONLY_CANCELLED_APPOINTMENTS' | 'NO_APPOINTMENTS_FOUND' | 'DUPLICATE_EXTERNAL_ID';
export type DoctoraliaAppointmentStatus = 'CANCELLED' | 'SCHEDULED' | 'LEGACY_ATTENDANCE_UNKNOWN';
export type DoctoraliaModality = 'ONLINE' | 'PRESENCIAL';

export interface DoctoraliaAddress {
  street?: string;
  number?: string;
  postalCode?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  province?: string;
  country?: string;
}

export interface DoctoraliaDemographics {
  religion?: string;
  education?: string;
  profession?: string;
  nationality?: string;
}

export interface DoctoraliaExternalReference {
  source: 'DOCTORALIA';
  externalId: string;
}

export interface DoctoraliaMigrationReview {
  required: true;
  reason: DoctoraliaReviewReason;
}

export interface DoctoraliaPatientCandidate {
  externalPatientId: string;
  firstName: string;
  lastName: string;
  name: string;
  phone?: string;
  additionalPhone?: string;
  email?: string;
  birthDate?: string;
  address: DoctoraliaAddress;
  demographics: DoctoraliaDemographics;
  status: DoctoraliaPatientStatus;
  group: Exclude<DoctoraliaPatientGroup, 'C_NO_APPOINTMENTS'>;
  migrationReview?: DoctoraliaMigrationReview;
  importable: true;
  externalReference: DoctoraliaExternalReference;
}

export interface DoctoraliaNotImportedPatient {
  externalPatientId: string;
  name: string;
  reason: 'NO_APPOINTMENTS_FOUND';
  reviewable: true;
}

export interface DoctoraliaClinicalBackground {
  externalPatientId: string;
  medications: string;
  source: 'DOCTORALIA';
  protected: true;
}

export interface DoctoraliaAppointmentCandidate {
  externalEventId: string;
  externalScheduleId?: string;
  externalPatientId: string;
  agenda: string;
  service: string;
  civilDate: string;
  startTime: string;
  durationMinutes: number;
  sourceStatus: string;
  status: DoctoraliaAppointmentStatus;
  modality: DoctoraliaModality;
  locationName?: string;
  importable: boolean;
  historicalAttendanceUnknown: boolean;
  externalReference: DoctoraliaExternalReference;
}

export interface DoctoraliaCatalogItem {
  name: string;
  normalizedKey: string;
  source: 'DOCTORALIA';
  externalReference: DoctoraliaExternalReference;
}

export interface DoctoraliaPatientCounts {
  total: number;
  groupA: number;
  groupB: number;
  groupC: number;
  activeByFutureEvidence: number;
  inactiveReview: number;
  initiallyImportable: number;
  notImportedInitially: number;
}

export interface DoctoraliaAppointmentCounts {
  totalOriginal: number;
  beforeCutoff: number;
  atOrAfterCutoff: number;
  cancelled: number;
  future: number;
  historicalAttendanceUnknown: number;
  importable: number;
}

export interface DoctoraliaDryRunResult {
  patientCounts: DoctoraliaPatientCounts;
  appointmentCounts: DoctoraliaAppointmentCounts;
  patients: DoctoraliaPatientCandidate[];
  notImportedPatients: DoctoraliaNotImportedPatient[];
  appointments: DoctoraliaAppointmentCandidate[];
  clinicalBackgrounds: DoctoraliaClinicalBackground[];
  locations: DoctoraliaCatalogItem[];
  services: DoctoraliaCatalogItem[];
  ignoredFields: string[];
  writesPerformed: false;
  deletesPerformed: false;
  persisted: false;
  details: string[];
}

export interface DoctoraliaImportRecognition {
  recognized: boolean;
  patientsFileRecognized: boolean;
  appointmentsFileRecognized: boolean;
  message: string;
}

export interface DoctoraliaImportAnalysis {
  recognition: DoctoraliaImportRecognition;
  cutoff: '2025-01-01';
  timezone: 'America/Sao_Paulo';
  patientRows: number;
  appointmentRows: number;
  bundle: PsychologyImportBundle;
  dryRun: DoctoraliaDryRunResult;
}

export interface ImportSourceAdapter {
  readonly source: ImportSource;
  readonly label: string;
  identify(input: ImportFileInput): boolean;
  recognize(input: ImportFileInput): ImportRecognition;
  analyze(input: ImportFileInput): ImportAnalysis;
  manifest(input: ImportFileInput): Record<string, unknown> | null;
  entities(input: ImportFileInput): Partial<Record<ImportEntity, unknown[]>>;
  normalize(input: ImportFileInput): PsychologyImportBundle;
  preview(bundle: PsychologyImportBundle, store?: PsychologyStore): ImportPreview;
  conflicts(bundle: PsychologyImportBundle): ImportConflict[];
  warnings(bundle: PsychologyImportBundle): ImportWarning[];
}

export interface DeduplicationSignal {
  sourceRecordId?: string;
  existingPatientId?: string;
  matchedFields: string[];
  requiresReview: boolean;
}

export interface DeduplicationResult {
  bundle: PsychologyImportBundle;
  signals: DeduplicationSignal[];
  conflicts: ImportConflict[];
  warnings: ImportWarning[];
}

export interface DryRunResult {
  creates: number;
  links: number;
  ignores: number;
  conflicts: number;
  warnings: number;
  unlinked: number;
  details: string[];
  persisted: false;
}

export interface BackupSection {
  path: string;
  entity: string;
  count: number;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  format: 'Gestao-Clinica-Backup';
  version: 1 | 2;
  createdAt: string;
  generatedAt?: string;
  applicationVersion: string;
  professionalId: string;
  workspaceId?: string;
  context: 'PSICOLOGIA';
  timezone: string;
  sections: BackupSection[];
  fileCount: number;
  checksumAlgorithm: 'SHA-256';
  source: 'psychology-local-synthetic' | 'psychology-local' | 'psychology-remote';
}

export interface BackupFile {
  path: string;
  bytes: Uint8Array;
}

export interface BackupVerification {
  intact: boolean;
  status: 'intact' | 'problems';
  manifest: BackupManifest | null;
  files: number;
  problems: string[];
  warnings: string[];
}

export const SOURCE_LABELS: Record<ImportSource, string> = {
  doctoralia: 'Doctoralia',
  csv: 'Planilha CSV/XLS/XLSX',
  'gestao-clinica-backup': 'Backup Gestão Clínica',
  'outro-sistema': 'Outro sistema',
};

export const DOCTORALIA_UNRECOGNIZED_MESSAGE = 'Formato Doctoralia ainda não reconhecido. É necessária análise do arquivo exportado.';
export const REAL_IMPORT_DISABLED_MESSAGE = 'A importação real está desabilitada nesta etapa. A análise e a simulação não gravam dados.';
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 10_000;
