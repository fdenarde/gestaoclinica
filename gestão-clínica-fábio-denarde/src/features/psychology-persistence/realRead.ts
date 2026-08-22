import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  normalizePsychologyStore,
  type PsychologyStore,
} from '../psychology-pilot/psychologyDomain';
import {
  createPsychologyPersistenceScope,
  type PsychologyPersistenceScope,
} from './scope';
import { createApiPsychologyRepositories } from './repositories/api';
import type { PsychologyLocationRecord, PsychologyPatientRecord, PsychologyPersonalAppointmentRecord, PsychologyServiceRecord, PsychologySessionRecordEntity, PsychologySettingsRecord } from './types';
import type { PsychologyRepositoryBundle } from './repositoryTypes';

export const REAL_PSYCHOLOGY_TARGET = Object.freeze({
  projectId: 'ai-studio-applet-webapp-e3283',
  databaseId: 'ai-studio-587970e5-0653-44a5-93a3-be1a74301eda',
  workspaceId: 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3',
  tenantId: 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3',
  professionalId: 'prof-2232f031-c409-4a5d-a56b-f696d284f447',
  context: 'PSICOLOGIA' as const,
});

export function createRealPsychologyPersistenceScope(): PsychologyPersistenceScope {
  return createPsychologyPersistenceScope(
    REAL_PSYCHOLOGY_TARGET.professionalId,
    REAL_PSYCHOLOGY_TARGET.workspaceId,
    REAL_PSYCHOLOGY_TARGET.tenantId,
  );
}

export interface RealPsychologyReadResult {
  store: PsychologyStore;
  persistenceScope: PsychologyPersistenceScope;
  repositories: PsychologyRepositoryBundle;
  counts: {
    patients: number;
    sessions: number;
    services: number;
    locations: number;
  };
}

export interface RealPsychologyReadOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
  includeOperationalSettings?: boolean;
}

export async function readRealPsychologyStore(options: RealPsychologyReadOptions = {}): Promise<RealPsychologyReadResult> {
  const persistenceScope = createRealPsychologyPersistenceScope();
  const repositories = createApiPsychologyRepositories({ scope: persistenceScope, fetchImpl: options.fetchImpl, getToken: options.getToken });
  const operationalReads = options.includeOperationalSettings
    ? Promise.all([
      repositories.settings.get(persistenceScope, 'settings'),
      repositories.personalAppointments.list(persistenceScope),
    ])
    : Promise.resolve([null, []] as const);
  const [patients, sessions, services, locations, [settingsRecord, personalAppointments]] = await Promise.all([
    repositories.patients.list(persistenceScope),
    repositories.sessions.list(persistenceScope),
    repositories.services.list(persistenceScope),
    repositories.locations.list(persistenceScope),
    operationalReads,
  ]);

  const legacyScope = createPsychologyScope(REAL_PSYCHOLOGY_TARGET.professionalId);
  const base = createEmptyPsychologyStore(legacyScope);
  const remoteSettings = (settingsRecord as PsychologySettingsRecord | null)?.settings || {};
  const normalized = normalizePsychologyStore({
    ...base,
    scope: legacyScope,
    settings: {
      ...base.settings,
      ...(remoteSettings as Partial<PsychologyStore['settings']>),
      professionalProfile: {
        ...base.settings.professionalProfile,
        ...(remoteSettings as Partial<PsychologyStore['settings']>).professionalProfile,
        displayName: (remoteSettings as Partial<PsychologyStore['settings']>).professionalProfile?.displayName || 'Leila Chaves',
        name: (remoteSettings as Partial<PsychologyStore['settings']>).professionalProfile?.name || 'Leila Chaves',
        professionalTitle: (remoteSettings as Partial<PsychologyStore['settings']>).professionalProfile?.professionalTitle || 'Psicologia',
        specialty: (remoteSettings as Partial<PsychologyStore['settings']>).professionalProfile?.specialty || 'Psicologia',
      },
      services,
      locations,
      scope: legacyScope,
    },
    patients,
    sessions,
    services,
    locations,
    // Clinical records and financial aggregates remain separate from this operational write surface.
    personalCommitments: personalAppointments,
    sessionRecords: [],
    charges: [],
    payments: [],
    expenses: [],
    sessionPackages: [],
    documents: [],
    attachments: [],
  }, legacyScope);

  // normalizePsychologySettings has legacy defaults for empty local stores. Remote reads
  // must never inherit those defaults, so the remote arrays replace them explicitly.
  const store: PsychologyStore = {
    ...normalized,
    patients: normalized.patients,
    sessions: normalized.sessions,
    services: services as PsychologyServiceRecord[],
    locations: locations as PsychologyLocationRecord[],
    settings: {
      ...normalized.settings,
      services: services as PsychologyServiceRecord[],
      locations: locations as PsychologyLocationRecord[],
    },
  };

  return {
    store,
    persistenceScope,
    repositories,
    counts: {
      patients: (patients as PsychologyPatientRecord[]).length,
      sessions: (sessions as PsychologySessionRecordEntity[]).length,
      services: (services as PsychologyServiceRecord[]).length,
      locations: (locations as PsychologyLocationRecord[]).length,
    },
  };
}
