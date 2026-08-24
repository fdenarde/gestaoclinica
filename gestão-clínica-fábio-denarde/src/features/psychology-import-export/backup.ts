import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  type PsychologyStore,
} from '../psychology-pilot/psychologyDomain';
import type { BackupFile, BackupManifest, BackupSection, BackupVerification } from './types';
import { isSafeArchivePath, createStoredZip, extractStoredZip } from './zip';
import { selectPsychologyBackupData } from '../psychology-persistence/psychologyBackup';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BACKUP_APPLICATION_VERSION = '1.7.0';
const REQUIRED_BACKUP_PATHS = [
  'patients.json',
  'appointments.json',
  'personal-appointments.json',
  'services.json',
  'locations.json',
  'session-packages.json',
  'financial/charges.json',
  'financial/payments.json',
  'financial/expenses.json',
  'clinical/session-records.json',
  'documents/manifest.json',
  'attachments/manifest.json',
  'settings.json',
];

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 não está disponível neste ambiente.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2));
}

function section(path: string, entity: string, value: unknown): { path: string; entity: string; value: unknown; bytes: Uint8Array } {
  return { path, entity, value, bytes: jsonBytes(value) };
}

export interface PsychologyBackupBuildOptions {
  source?: BackupManifest['source'];
  workspaceId?: string;
  version?: BackupManifest['version'];
}

export async function buildPsychologyBackupFiles(store: PsychologyStore, createdAt = new Date().toISOString(), options: PsychologyBackupBuildOptions = {}): Promise<BackupFile[]> {
  const data = selectPsychologyBackupData(store);
  const values = [
    section('patients.json', 'patients', data.patients),
    section('appointments.json', 'appointments', data.appointments),
    section('personal-appointments.json', 'personalAppointments', data.personalAppointments),
    section('services.json', 'services', data.services),
    section('locations.json', 'locations', data.locations),
    section('session-packages.json', 'sessionPackages', data.sessionPackages),
    section('financial/charges.json', 'charges', data.charges),
    section('financial/payments.json', 'payments', data.payments),
    section('financial/expenses.json', 'expenses', data.expenses),
    section('clinical/session-records.json', 'clinicalRecords', data.clinicalRecords),
    section('documents/manifest.json', 'documents', data.documents),
    section('attachments/manifest.json', 'attachments', data.attachments),
    section('settings.json', 'settings', data.settings),
  ];
  const sections: BackupSection[] = await Promise.all(values.map(async item => ({
    path: item.path,
    entity: item.entity,
    count: Array.isArray(item.value) ? item.value.length : 1,
    bytes: item.bytes.byteLength,
    sha256: await sha256Hex(item.bytes),
  })));
  const manifest: BackupManifest = {
    format: 'Gestao-Clinica-Backup',
    version: options.version || 1,
    createdAt,
    generatedAt: createdAt,
    applicationVersion: BACKUP_APPLICATION_VERSION,
    professionalId: store.scope.professionalId,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    context: 'PSICOLOGIA',
    timezone: 'America/Sao_Paulo',
    sections,
    fileCount: sections.length + 1,
    checksumAlgorithm: 'SHA-256',
    source: options.source || 'psychology-local-synthetic',
  };
  return [
    { path: 'manifest.json', bytes: jsonBytes(manifest) },
    ...values.map(item => ({ path: item.path, bytes: item.bytes })),
  ];
}

export interface PsychologyBackupJsonResult {
  fileName: string;
  json: string;
  source: Exclude<BackupManifest['source'], 'psychology-local-synthetic'>;
  counts: Record<string, number>;
}

export async function buildPsychologyBackupJson(store: PsychologyStore, options: { source: 'psychology-local' | 'psychology-remote'; workspaceId?: string; generatedAt?: string }): Promise<PsychologyBackupJsonResult> {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const files = await buildPsychologyBackupFiles(store, generatedAt, { ...options, version: 2 });
  const manifest = JSON.parse(decoder.decode(files[0].bytes)) as BackupManifest;
  const fileValues = Object.fromEntries(files.slice(1).map(file => [file.path, readJson<unknown>(file.bytes)]));
  const date = generatedAt.slice(0, 10);
  const time = generatedAt.slice(11, 16).replace(':', '');
  return {
    fileName: `backup-psicologia-${date}-${time}.json`,
    json: JSON.stringify({ manifest, files: fileValues }, null, 2),
    source: options.source,
    counts: Object.fromEntries(files.slice(1).map(file => {
      const value = readJson<unknown>(file.bytes);
      return [file.path, Array.isArray(value) ? value.length : 1];
    })),
  };
}

export async function createPsychologyBackupZip(store: PsychologyStore, createdAt?: string): Promise<Uint8Array> {
  return createStoredZip(await buildPsychologyBackupFiles(store, createdAt));
}

export interface PsychologyPatientBackupSelection {
  profile: boolean;
  sessions: boolean;
  finance: boolean;
  clinical: boolean;
  documents: boolean;
}

export async function createPsychologyPatientBackupZip(store: PsychologyStore, patientId: string, selection: PsychologyPatientBackupSelection): Promise<Uint8Array> {
  const patient = store.patients.find(item => item.id === patientId);
  const scoped = {
    ...store,
    patients: selection.profile && patient ? [patient] : [],
    sessions: selection.sessions ? store.sessions.filter(item => item.patientId === patientId) : [],
    charges: selection.finance ? store.charges.filter(item => item.patientId === patientId) : [],
    payments: selection.finance ? store.payments.filter(item => item.patientId === patientId) : [],
    sessionPackages: selection.profile ? store.sessionPackages.filter(item => item.patientId === patientId) : [],
    sessionRecords: selection.clinical ? store.sessionRecords.filter(item => item.patientId === patientId) : [],
    documents: selection.documents ? store.documents.filter(item => item.patientId === patientId && (selection.clinical || item.classification === 'ADMINISTRATIVE')) : [],
    attachments: selection.documents ? store.attachments.filter(item => item.patientId === patientId && (selection.clinical || item.classification === 'ADMINISTRATIVE')) : [],
  };
  return createPsychologyBackupZip(scoped);
}

function readJson<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

export async function verifyPsychologyBackupFiles(files: BackupFile[]): Promise<BackupVerification> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const paths = new Set<string>();
  for (const file of files) {
    if (!isSafeArchivePath(file.path)) problems.push(`Caminho inseguro: ${file.path}`);
    if (paths.has(file.path)) problems.push(`Arquivo duplicado: ${file.path}`);
    paths.add(file.path);
  }
  const manifestFile = files.find(file => file.path === 'manifest.json');
  let manifest: BackupManifest | null = null;
  if (!manifestFile) {
    problems.push('manifest.json não encontrado.');
  } else {
    try {
      manifest = readJson<BackupManifest>(manifestFile.bytes);
    } catch {
      problems.push('manifest.json está corrompido.');
    }
  }
  if (manifest) {
    if (manifest.format !== 'Gestao-Clinica-Backup') problems.push('Formato de backup não reconhecido.');
    if (manifest.version !== 1 && manifest.version !== 2) problems.push('Versão de backup não suportada.');
    if (manifest.context !== 'PSICOLOGIA') problems.push('O backup não pertence ao contexto Psicologia.');
    if (manifest.checksumAlgorithm !== 'SHA-256') problems.push('Algoritmo de checksum não suportado.');
    for (const requiredPath of REQUIRED_BACKUP_PATHS) if (!paths.has(requiredPath)) problems.push(`Arquivo obrigatório ausente: ${requiredPath}`);
    for (const entry of manifest.sections || []) {
      const file = files.find(candidate => candidate.path === entry.path);
      if (!file) { problems.push(`Seção ausente: ${entry.path}`); continue; }
      if (file.bytes.byteLength !== entry.bytes) problems.push(`Tamanho divergente: ${entry.path}`);
      try {
        const checksum = await sha256Hex(file.bytes);
        if (checksum !== entry.sha256) problems.push(`Checksum divergente: ${entry.path}`);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : `Não foi possível verificar ${entry.path}.`);
      }
    }
    if (manifest.fileCount !== files.length) problems.push('A quantidade de arquivos não corresponde ao manifesto.');
    const extraFiles = files.filter(file => file.path !== 'manifest.json' && !(manifest?.sections || []).some(section => section.path === file.path));
    if (extraFiles.length) warnings.push(`${extraFiles.length} arquivo(s) adicional(is) não listado(s) no manifesto.`);
  }
  return { intact: problems.length === 0, status: problems.length === 0 ? 'intact' : 'problems', manifest, files: files.length, problems, warnings };
}

export async function verifyPsychologyBackupZip(bytes: Uint8Array): Promise<BackupVerification> {
  try {
    return await verifyPsychologyBackupFiles(extractStoredZip(bytes));
  } catch (error) {
    return {
      intact: false,
      status: 'problems',
      manifest: null,
      files: 0,
      problems: [error instanceof Error ? error.message : 'Não foi possível ler o backup ZIP.'],
      warnings: [],
    };
  }
}

export function createSyntheticPsychologyStore() : PsychologyStore {
  const store = createEmptyPsychologyStore(createPsychologyScope('psychology-synthetic-professional'));
  const now = '2026-01-15T12:00:00.000Z';
  const patient = {
    id: 'synthetic-patient-001',
    professionalId: store.scope.professionalId,
    context: 'PSICOLOGIA' as const,
    name: 'Paciente Sintético',
    birthDate: '1990-05-10',
    phone: '(27) 99999-0000',
    email: 'sintetico@example.test',
    preferredModality: 'online' as const,
    administrativeNote: 'Registro sintético para teste local.',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const serviceId = store.services[0]?.id;
  const locationId = store.locations[0]?.id;
  const session = {
    id: 'synthetic-session-001',
    professionalId: store.scope.professionalId,
    context: 'PSICOLOGIA' as const,
    patientId: patient.id,
    date: '2026-01-16',
    time: '09:00',
    durationMinutes: 50,
    modality: 'online' as const,
    serviceId,
    locationId,
    status: 'agendada' as const,
    administrativeNote: 'Sessão sintética.',
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...store,
    patients: [patient],
    sessions: [session],
    personalCommitments: [{
      id: 'synthetic-personal-001',
      professionalId: store.scope.professionalId,
      context: 'PSICOLOGIA' as const,
      date: '2026-01-16',
      time: '12:00',
      durationMinutes: 30,
      type: 'Outro',
      title: 'Compromisso sintético',
      note: 'Sem dados reais.',
      recurrence: 'Não repetir',
      alarmEnabled: false,
      isDone: false,
      createdAt: now,
      updatedAt: now,
    }],
    sessionRecords: [{
      id: 'synthetic-record-001',
      patientId: patient.id,
      sessionId: session.id,
      professionalId: store.scope.professionalId,
      context: 'PSICOLOGIA' as const,
      content: 'Registro clínico sintético para validação.',
      authorProfessionalId: store.scope.professionalId,
      sessionDate: session.date,
      sessionTime: session.time,
      createdAt: now,
      updatedAt: now,
    }],
  };
}
