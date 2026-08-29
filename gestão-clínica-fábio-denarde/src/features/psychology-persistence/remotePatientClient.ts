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
import {
  allSettledWithConcurrency,
  PSYCHOLOGY_BULK_DELETE_CONCURRENCY,
} from './bulkDeleteConcurrency';
import type { PsychologyPersistenceScope } from './scope';
import type { ApiPsychologyRepositoryOptions } from './repositories/api';
import type { PsychologyPatientDeletionResult } from './repositoryTypes';
export interface PsychologyRemotePatientClientOptions {
  scope: PsychologyPersistenceScope;
  api?: Omit<ApiPsychologyRepositoryOptions, 'scope'>;
  now?: () => string;
}

export interface PsychologyRemoteBulkDeletionResult {
  summary: { processed: number; deleted: number; failed: number };
  deletedIds: string[];
  failedIds: string[];
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
    const [patients, sessions, personalAppointments, settings] = await Promise.all([
      repositories.patients.list(scope),
      repositories.sessions.list(scope),
      repositories.personalAppointments.list(scope),
      repositories.settings.get(scope, 'settings'),
    ]);
    const next = normalizePsychologyStore({
      patients,
      sessions,
      personalCommitments: personalAppointments,
      settings: settings?.settings,
    }, createPsychologyScope(scope.professionalId));
    return next;
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

  async function reactivatePatient(patientId: string): Promise<PsychologyPatient> {
    const saved = await repositories.patients.update(scope, patientId, { active: true });
    if (!saved) throw new Error('O paciente não foi encontrado no provider remoto.');
    return asPatient(saved);
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

  async function deletePatient(patientId: string): Promise<PsychologyPatientDeletionResult> {
    const deleteWithResult = repositories.patients.deleteWithResult;
    if (deleteWithResult) return deleteWithResult(scope, patientId);
    const deleted = await repositories.patients.delete(scope, patientId);
    return { id: patientId, deleted: Boolean(deleted) };
  }

  async function deletePatients(patientIds: string[]): Promise<PsychologyRemoteBulkDeletionResult> {
    const uniquePatientIds = [...new Set(patientIds.filter(Boolean))];
    const results = await allSettledWithConcurrency(uniquePatientIds, PSYCHOLOGY_BULK_DELETE_CONCURRENCY, deletePatient);
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failed += 1;
        failedIds.push(uniquePatientIds[index]);
      } else if (result.value.deleted) {
        deletedIds.push(result.value.id);
      } else {
        failed += 1;
        failedIds.push(uniquePatientIds[index]);
      }
    });
    return {
      summary: { processed: uniquePatientIds.length, deleted: deletedIds.length, failed },
      deletedIds,
      failedIds,
    };
  }

  return {
    provider,
    scope,
    repositories,
    load,
    loadBackupSnapshot,
    updateSettings,
    updatePatient,
    reactivatePatient,
    updatePatientReview,
    deletePatient,
    deletePatients,
  };
}

export function patientStoreWithUpdates(store: PsychologyStore, patients: PsychologyPatient[]): PsychologyStore {
  const updates = new Map(patients.map(patient => [patient.id, patient]));
  const existingIds = new Set(store.patients.map(patient => patient.id));
  return {
    ...store,
    patients: [
      ...store.patients.map(patient => updates.get(patient.id) || patient),
      ...patients.filter(patient => !existingIds.has(patient.id)),
    ],
  };
}

export function patientStoreWithoutIds(store: PsychologyStore, ids: readonly string[]): PsychologyStore {
  const removed = new Set(ids);
  return {
    ...store,
    patients: store.patients.filter(patient => !removed.has(patient.id)),
    // The server cascade removes these records remotely. Keep the in-memory
    // provider consistent immediately as well, so a successful deletion never
    // leaves an orphan session visible until the next authenticated load.
    sessions: store.sessions.filter(session => !removed.has(session.patientId)),
    sessionRecords: store.sessionRecords.filter(record => !record.patientId || !removed.has(record.patientId)),
    charges: store.charges.filter(charge => !charge.patientId || !removed.has(charge.patientId)),
    payments: store.payments.filter(payment => !payment.patientId || !removed.has(payment.patientId)),
    sessionPackages: store.sessionPackages.filter(item => !removed.has(item.patientId)),
    documents: store.documents.filter(document => !document.patientId || !removed.has(document.patientId)),
    attachments: store.attachments.filter(attachment => !attachment.patientId || !removed.has(attachment.patientId)),
  };
}
