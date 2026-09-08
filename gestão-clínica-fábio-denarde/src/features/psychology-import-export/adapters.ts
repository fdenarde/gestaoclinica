import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import { csvHasPatientShape, parseCsvText, getCsvValue } from './csv';
import { createEmptyImportBundle, makeAnalysis, previewImport, normalizeCsvRows } from './normalize';
import { extractStoredZip } from './zip';
import { analyzeDoctoraliaFiles, emptyDoctoraliaAnalysis, recognizeDoctoraliaAppointmentsCsv, recognizeDoctoraliaPatientsCsv } from './doctoralia';
import {
  DOCTORALIA_UNRECOGNIZED_MESSAGE,
  SOURCE_LABELS,
  type BackupFile,
  type BackupManifest,
  type ImportAnalysis,
  type ImportConflict,
  type ImportEntity,
  type ImportFileInput,
  type ImportPreview,
  type ImportRecognition,
  type ImportSource,
  type ImportSourceAdapter,
  type ImportWarning,
  type PsychologyImportBundle,
} from './types';

const decoder = new TextDecoder();

function textOf(input: ImportFileInput): string {
  if (input.text != null) return input.text;
  if (input.bytes) return decoder.decode(input.bytes);
  return '';
}

function backupFiles(input: ImportFileInput): BackupFile[] {
  if (input.bytes) return extractStoredZip(input.bytes);
  const parsed = JSON.parse(textOf(input)) as { manifest?: BackupManifest; files?: Record<string, unknown> };
  if (!parsed.manifest || !parsed.files) throw new Error('Backup JSON sem manifest ou arquivos.');
  return [
    { path: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(parsed.manifest, null, 2)) },
    ...Object.entries(parsed.files).map(([path, value]) => ({ path, bytes: new TextEncoder().encode(JSON.stringify(value, null, 2)) })),
  ];
}

function jsonSection<T>(files: BackupFile[], path: string, fallback: T): T {
  const file = files.find(item => item.path === path);
  if (!file) return fallback;
  return JSON.parse(decoder.decode(file.bytes)) as T;
}

function recognizeBackup(input: ImportFileInput): ImportRecognition {
  try {
    const files = backupFiles(input);
    const manifest = jsonSection<BackupManifest | null>(files, 'manifest.json', null);
    const recognized = manifest?.format === 'Gestao-Clinica-Backup' && manifest.context === 'PSICOLOGIA' && manifest.version === 1;
    return { recognized, source: 'gestao-clinica-backup', label: SOURCE_LABELS['gestao-clinica-backup'], confidence: recognized ? 'high' : 'none', message: recognized ? 'Backup Gestão Clínica de Psicologia reconhecido.' : 'O arquivo não corresponde ao backup versionado de Psicologia.' };
  } catch {
    return { recognized: false, source: 'gestao-clinica-backup', label: SOURCE_LABELS['gestao-clinica-backup'], confidence: 'none', message: 'Arquivo de backup corrompido ou não suportado.' };
  }
}

function normalizeBackup(input: ImportFileInput): PsychologyImportBundle {
  const bundle = createEmptyImportBundle('gestao-clinica-backup', input.fileName);
  const files = backupFiles(input);
  const patients = jsonSection<Array<Record<string, unknown>>>(files, 'patients.json', []);
  const appointments = jsonSection<Array<Record<string, unknown>>>(files, 'appointments.json', []);
  const personalAppointments = jsonSection<Array<Record<string, unknown>>>(files, 'personal-appointments.json', []);
  const services = jsonSection<Array<Record<string, unknown>>>(files, 'services.json', []);
  const charges = jsonSection<Array<Record<string, unknown>>>(files, 'financial/charges.json', []);
  const payments = jsonSection<Array<Record<string, unknown>>>(files, 'financial/payments.json', []);
  const clinicalRecords = jsonSection<Array<Record<string, unknown>>>(files, 'clinical/session-records.json', []);
  const documents = jsonSection<Array<Record<string, unknown>>>(files, 'documents/manifest.json', []);
  const attachments = jsonSection<Array<Record<string, unknown>>>(files, 'attachments/manifest.json', []);
  bundle.patients = patients.map(item => ({ externalId: String(item.id || ''), name: String(item.name || ''), birthDate: item.birthDate ? String(item.birthDate) : undefined, phone: item.phone ? String(item.phone) : undefined, email: item.email ? String(item.email) : undefined, status: item.active === false ? 'inactive' : 'active', source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.appointments = appointments.map(item => ({ externalId: String(item.id || ''), patientExternalId: item.patientId ? String(item.patientId) : undefined, date: String(item.date || ''), startTime: String(item.time || ''), durationMinutes: Number(item.durationMinutes || 50), status: item.status ? String(item.status) : undefined, modality: item.modality ? String(item.modality) : undefined, locationText: item.locationId ? String(item.locationId) : undefined, notes: item.administrativeNote ? String(item.administrativeNote) : undefined, source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.personalAppointments = personalAppointments.map(item => ({ externalId: String(item.id || ''), date: String(item.date || ''), startTime: String(item.time || ''), durationMinutes: Number(item.durationMinutes || 30), title: String(item.title || item.type || 'Compromisso pessoal'), notes: item.note ? String(item.note) : undefined, source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.services = services.map(item => ({ externalId: String(item.id || ''), name: String(item.name || ''), durationMinutes: Number(item.defaultDurationMinutes || 0) || undefined, price: Number(item.defaultPrice || 0) || undefined, source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.charges = charges.map(item => ({ externalId: String(item.id || ''), patientExternalId: item.patientId ? String(item.patientId) : undefined, appointmentExternalId: item.sessionId ? String(item.sessionId) : undefined, description: String(item.description || ''), amount: Number(item.amount || 0), dueDate: item.dueDate ? String(item.dueDate) : undefined, status: item.status ? String(item.status) : undefined, source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.payments = payments.map(item => ({ externalId: String(item.id || ''), chargeExternalId: item.chargeId ? String(item.chargeId) : undefined, patientExternalId: item.patientId ? String(item.patientId) : undefined, amount: Number(item.amount || 0), date: item.date ? String(item.date) : undefined, method: item.method ? String(item.method) : undefined, source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.clinicalRecords = clinicalRecords.map(item => ({ externalId: String(item.id || ''), patientExternalId: item.patientId ? String(item.patientId) : undefined, appointmentExternalId: item.sessionId ? String(item.sessionId) : undefined, date: item.sessionDate ? String(item.sessionDate) : undefined, content: item.content ? String(item.content) : undefined, source: bundle.metadata.source, sourceRecordId: String(item.id || '') }));
  bundle.documents = documents.map(item => ({ externalId: item.id ? String(item.id) : undefined, patientExternalId: item.patientId ? String(item.patientId) : undefined, appointmentExternalId: item.sessionId ? String(item.sessionId) : undefined, fileName: String(item.fileName || item.name || 'documento'), documentType: item.documentType ? String(item.documentType) : undefined, sourceRecordId: item.id ? String(item.id) : undefined, source: bundle.metadata.source }));
  bundle.attachments = attachments.map(item => ({ externalId: item.id ? String(item.id) : undefined, ownerType: item.ownerType === 'patient' || item.ownerType === 'appointment' ? item.ownerType : 'unknown', ownerExternalId: item.ownerId ? String(item.ownerId) : undefined, fileName: String(item.fileName || item.name || 'anexo'), mimeType: item.mimeType ? String(item.mimeType) : undefined, sizeBytes: Number(item.sizeBytes || 0) || undefined, sha256: item.sha256 ? String(item.sha256) : undefined, sourceRecordId: item.id ? String(item.id) : undefined, source: bundle.metadata.source }));
  return bundle;
}

function finalize(adapter: ImportSourceAdapter, input: ImportFileInput): ImportAnalysis {
  const recognition = adapter.recognize(input);
  const bundle = adapter.normalize(input);
  return makeAnalysis(recognition, input, bundle, adapter.entities(input).patients?.length || 0, [recognition.message]);
}

export class CsvImportAdapter implements ImportSourceAdapter {
  readonly source = 'csv' as const;
  readonly label = SOURCE_LABELS.csv;
  identify(input: ImportFileInput): boolean { return /\.csv$/i.test(input.fileName) || (input.text != null && input.text.includes(',')); }
  recognize(input: ImportFileInput): ImportRecognition {
    if (!/\.csv$/i.test(input.fileName)) return { recognized: false, source: this.source, label: this.label, confidence: 'none', message: 'Nesta fundação, XLS/XLSX deve ser convertido para CSV antes da análise.' };
    try {
      const parsed = parseCsvText(textOf(input));
      const recognized = csvHasPatientShape(parsed.fields);
      return { recognized, source: this.source, label: this.label, confidence: recognized ? 'high' : 'low', message: recognized ? 'Planilha CSV reconhecida para análise local.' : 'Cabeçalho CSV não reconhecido como planilha de Psicologia.' };
    } catch {
      return { recognized: false, source: this.source, label: this.label, confidence: 'none', message: 'CSV corrompido ou ilegível.' };
    }
  }
  analyze(input: ImportFileInput): ImportAnalysis { return finalize(this, input); }
  manifest(): Record<string, unknown> | null { return null; }
  entities(input: ImportFileInput) { const rows = parseCsvText(textOf(input)).rows; return { patients: rows }; }
  normalize(input: ImportFileInput) { const parsed = parseCsvText(textOf(input)); const bundle = normalizeCsvRows(parsed.rows, input); if (parsed.errors.length) bundle.conflicts.push({ type: 'corrupted_file', severity: 'conflict', message: parsed.errors.join('; ') }); return bundle; }
  preview(bundle: PsychologyImportBundle, store?: PsychologyStore): ImportPreview { return previewImport(bundle, store); }
  conflicts(bundle: PsychologyImportBundle): ImportConflict[] { return bundle.conflicts; }
  warnings(bundle: PsychologyImportBundle): ImportWarning[] { return bundle.warnings; }
}

export class DoctoraliaImportAdapter implements ImportSourceAdapter {
  readonly source: ImportSource = 'doctoralia';
  readonly label = SOURCE_LABELS.doctoralia;
  identify(input: ImportFileInput): boolean { return input.source === 'doctoralia'; }
  private files(input: ImportFileInput): { patients?: ImportFileInput; appointments?: ImportFileInput } {
    const files = [input, ...(input.relatedFiles || [])];
    return {
      patients: files.find(file => /^patients\.csv$/i.test(file.fileName) || recognizeDoctoraliaPatientsCsv(file)),
      appointments: files.find(file => /^patients_appointments\.csv$/i.test(file.fileName) || recognizeDoctoraliaAppointmentsCsv(file)),
    };
  }
  recognize(input: ImportFileInput): ImportRecognition {
    const files = this.files(input);
    const patients = Boolean(files.patients && recognizeDoctoraliaPatientsCsv(files.patients));
    const appointments = Boolean(files.appointments && recognizeDoctoraliaAppointmentsCsv(files.appointments));
    if (!patients && !appointments) return { recognized: false, source: this.source, label: this.label, confidence: 'none', message: DOCTORALIA_UNRECOGNIZED_MESSAGE };
    return { recognized: patients && appointments, source: this.source, label: this.label, confidence: patients && appointments ? 'high' : 'medium', message: patients && appointments ? 'Os dois arquivos Doctoralia foram reconhecidos para dry-run local.' : 'Um schema Doctoralia foi reconhecido; selecione também patients.csv e patients_appointments.csv.' };
  }
  analyze(input: ImportFileInput): ImportAnalysis {
    const files = this.files(input);
    const doctoralia = files.patients && files.appointments
      ? analyzeDoctoraliaFiles({ patients: files.patients, appointments: files.appointments })
      : emptyDoctoraliaAnalysis(input);
    const recognition: ImportRecognition = {
      recognized: doctoralia.recognition.recognized,
      source: this.source,
      label: this.label,
      confidence: doctoralia.recognition.recognized ? 'high' : doctoralia.recognition.patientsFileRecognized || doctoralia.recognition.appointmentsFileRecognized ? 'medium' : 'none',
      message: doctoralia.recognition.message,
    };
    const analysis = makeAnalysis(recognition, input, doctoralia.bundle, doctoralia.patientRows + doctoralia.appointmentRows, [doctoralia.recognition.message]);
    return { ...analysis, doctoralia };
  }
  manifest(input: ImportFileInput): Record<string, unknown> | null {
    const analysis = this.analyze(input).doctoralia;
    return analysis ? { source: 'DOCTORALIA', recognized: analysis.recognition.recognized, cutoff: analysis.cutoff, timezone: analysis.timezone, dryRunOnly: true } : null;
  }
  entities(input: ImportFileInput) {
    const bundle = this.analyze(input).bundle;
    return { patients: bundle.patients, appointments: bundle.appointments, services: bundle.services };
  }
  normalize(input: ImportFileInput) { return this.analyze(input).bundle; }
  preview(bundle: PsychologyImportBundle, store?: PsychologyStore): ImportPreview { return previewImport(bundle, store); }
  conflicts(bundle: PsychologyImportBundle): ImportConflict[] { return bundle.conflicts; }
  warnings(bundle: PsychologyImportBundle): ImportWarning[] { return bundle.warnings; }
}

export class GestaoClinicaBackupAdapter implements ImportSourceAdapter {
  readonly source = 'gestao-clinica-backup' as const;
  readonly label = SOURCE_LABELS['gestao-clinica-backup'];
  identify(input: ImportFileInput): boolean { return input.source === this.source || /\.(zip|json)$/i.test(input.fileName); }
  recognize(input: ImportFileInput): ImportRecognition { return recognizeBackup(input); }
  analyze(input: ImportFileInput): ImportAnalysis { return finalize(this, input); }
  manifest(input: ImportFileInput): Record<string, unknown> | null { try { return jsonSection<Record<string, unknown>>(backupFiles(input), 'manifest.json', {}); } catch { return null; } }
  entities(input: ImportFileInput) { const files = backupFiles(input); return { patients: jsonSection<unknown[]>(files, 'patients.json', []), appointments: jsonSection<unknown[]>(files, 'appointments.json', []), personalAppointments: jsonSection<unknown[]>(files, 'personal-appointments.json', []), services: jsonSection<unknown[]>(files, 'services.json', []) }; }
  normalize(input: ImportFileInput) { return normalizeBackup(input); }
  preview(bundle: PsychologyImportBundle, store?: PsychologyStore): ImportPreview { return previewImport(bundle, store); }
  conflicts(bundle: PsychologyImportBundle): ImportConflict[] { return bundle.conflicts; }
  warnings(bundle: PsychologyImportBundle): ImportWarning[] { return bundle.warnings; }
}

export class OtherSystemImportAdapter extends DoctoraliaImportAdapter {
  readonly source = 'outro-sistema' as const;
  readonly label = SOURCE_LABELS['outro-sistema'];
  identify(input: ImportFileInput): boolean { return input.source === this.source; }
  recognize(_input: ImportFileInput): ImportRecognition { return { recognized: false, source: this.source, label: this.label, confidence: 'none', message: 'Formato do outro sistema ainda não reconhecido. Selecione um arquivo para análise futura.' }; }
  normalize(input: ImportFileInput) { const bundle = createEmptyImportBundle(this.source, input.fileName); bundle.warnings.push({ code: 'other_system_unrecognized', message: 'Formato do outro sistema ainda não reconhecido.' }); bundle.conflicts.push({ type: 'unsupported_record', severity: 'conflict', message: 'Formato do outro sistema ainda não reconhecido.' }); return bundle; }
}

export function adapterFor(source: ImportSource): ImportSourceAdapter {
  if (source === 'csv') return new CsvImportAdapter();
  if (source === 'gestao-clinica-backup') return new GestaoClinicaBackupAdapter();
  if (source === 'outro-sistema') return new OtherSystemImportAdapter();
  return new DoctoraliaImportAdapter();
}

export function analyzeImportInput(input: ImportFileInput): ImportAnalysis {
  return adapterFor(input.source).analyze(input);
}
