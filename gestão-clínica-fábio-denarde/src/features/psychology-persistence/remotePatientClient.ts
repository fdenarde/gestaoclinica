import {
  createPsychologyScope,
  normalizePsychologyStore,
  type PsychologyPatient,
  type PsychologyStore,
} from '../psychology-pilot/psychologyDomain';
import { normalizePsychologySettings, type PsychologySettings } from '../psychology-pilot/psychologyR2a';
import {
  createPsychologyPersistenceProvider,
  type PsychologyPersistenceProvider,
} from './provider';
import type { PsychologyPersistenceScope } from './scope';
import type { ApiPsychologyRepositoryOptions } from './repositories/api';
import type { PsychologyPatientDeletionResult } from './repositoryTypes';
import { createClosedPsychologyCapabilities, normalizePsychologyCapabilities, type PsychologyCapabilities } from './capabilities';

export interface PsychologyRemotePatientClientOptions {
  scope: PsychologyPersistenceScope;
  api?: Omit<ApiPsychologyRepositoryOptions, 'scope'>;
  now?: () => string;
}

export interface PsychologyRemoteBulkDeletionResult {
  summary: { processed: number; deleted: number; preserved: number; failed: number };
  deletedIds: string[];
  preservedIds: string[];
}

function asPatient(value: unknown): PsychologyPatient {
  return value as PsychologyPatient;
}

export function createPsychologyRemotePatientClient(options: PsychologyRemotePatientClientOptions) {
  const now = options.now || (() => new Date().toISOString());
  const provider: PsychologyPersistenceProvider = createPsychologyPersistenceProvider({
    scope: options.scope,
    backend: 'remote',
    api: options.api,
    remoteCanaryEnabled: true,
  });
  const scope = provider.scope;
  const repositories = provider.repositories;

  async function load(): Promise<PsychologyStore> {
    const [patients, sessions, settings] = await Promise.all([
      repositories.patients.list(scope),
      repositories.sessions.list(scope),
      repositories.settings.get(scope, 'settings'),
    ]);
    const next = normalizePsychologyStore({
      patients,
      sessions,
      settings: settings?.settings,
    }, createPsychologyScope(scope.professionalId));
    return next;
  }

  function getCapabilities(): PsychologyCapabilities {
    return normalizePsychologyCapabilities(repositories.getCapabilities?.() || createClosedPsychologyCapabilities());
  }

  async function loadBackupSnapshot(): Promise<PsychologyStore> {
    const backup = repositories.backup;
    if (!backup) throw new Error('O provider remoto não expõe a leitura estruturada necessária para o backup.');
    const [patients, sessions, personalAppointments, sessionRecords, services, locations, charges, payments, expenses, packages, documents, attachments, settings] = await Promise.all([
      backup.patients.list(scope),
      backup.sessions.list(scope),
      backup.personalAppointments.list(scope),
      backup.sessionRecords.list(scope),
      backup.services.list(scope),
      backup.locations.list(scope),
      backup.listCharges(scope),
      backup.listPayments(scope),
      backup.listExpenses(scope),
      backup.packages.list(scope),
      backup.documents.list(scope),
      backup.attachments.list(scope),
      repositories.settings.get(scope, 'settings'),
    ]);
    return normalizePsychologyStore({
      patients,
      sessions,
      personalCommitments: personalAppointments,
      sessionRecords,
      services,
      locations,
      charges,
      payments,
      expenses,
      sessionPackages: packages,
      documents,
      attachments,
      settings: settings?.settings,
    }, createPsychologyScope(scope.professionalId));
  }

  async function updateSettings(patch: Partial<PsychologySettings>): Promise<PsychologySettings> {
    const saved = await repositories.settings.update(scope, 'settings', patch as never);
    if (!saved) throw new Error('Os Ajustes da Psicologia não foram encontrados no provider remoto.');
    return normalizePsychologySettings(saved.settings, createPsychologyScope(scope.professionalId), now());
  }

  async function updatePatient(patient: PsychologyPatient): Promise<PsychologyPatient> {
    const saved = await repositories.patients.upsert(scope, {
      ...patient,
      workspaceId: scope.workspaceId,
      professionalId: scope.professionalId,
      context: scope.context,
      createdAt: patient.createdAt || now(),
      updatedAt: now(),
    });
    const savedPatient = asPatient(saved);
    return savedPatient;
  }

  async function updatePatientReview(patientIds: string[], inReview: boolean): Promise<PsychologyPatient[]> {
    const markedAt = now();
    const saved = await Promise.all(patientIds.map(id => repositories.patients.update(scope, id, {
      inReview,
      reviewMarkedAt: inReview ? markedAt : undefined,
    })));
    if (saved.some(value => !value)) throw new Error('Um ou mais pacientes selecionados não foram encontrados no provider remoto.');
    return saved.filter(Boolean).map(asPatient);
  }

  async function updatePatientActive(patientId: string, active: boolean): Promise<PsychologyPatient> {
    const saved = await repositories.patients.update(scope, patientId, { active });
    if (!saved) throw new Error('Paciente não encontrado no provider remoto.');
    return asPatient(saved);
  }

  async function deletePatient(patientId: string): Promise<PsychologyPatientDeletionResult> {
    const deleteSafely = repositories.patients.deleteSafely;
    if (deleteSafely) return deleteSafely(scope, patientId);
    const deleted = await repositories.patients.delete(scope, patientId);
    return { id: patientId, deleted: Boolean(deleted), preserved: false };
  }

  async function deletePatients(patientIds: string[]): Promise<PsychologyRemoteBulkDeletionResult> {
    const results = await Promise.allSettled(patientIds.map(id => deletePatient(id)));
    const deletedIds: string[] = [];
    const preservedIds: string[] = [];
    let failed = 0;
    results.forEach(result => {
      if (result.status === 'rejected') {
        failed += 1;
      } else if (result.value.deleted) {
        deletedIds.push(result.value.id);
      } else if (result.value.preserved) {
        preservedIds.push(result.value.id);
      } else {
        failed += 1;
      }
    });
    return {
      summary: { processed: patientIds.length, deleted: deletedIds.length, preserved: preservedIds.length, failed },
      deletedIds,
      preservedIds,
    };
  }

  return {
    provider,
    scope,
    repositories,
    load,
    getCapabilities,
    loadBackupSnapshot,
    updateSettings,
    updatePatient,
    updatePatientReview,
    updatePatientActive,
    deletePatient,
    deletePatients,
  };
}

export function patientStoreWithUpdates(store: PsychologyStore, patients: PsychologyPatient[]): PsychologyStore {
  const updates = new Map(patients.map(patient => [patient.id, patient]));
  return { ...store, patients: store.patients.map(patient => updates.get(patient.id) || patient) };
}

export function patientStoreWithoutIds(store: PsychologyStore, ids: readonly string[]): PsychologyStore {
  const removed = new Set(ids);
  return { ...store, patients: store.patients.filter(patient => !removed.has(patient.id)) };
}
