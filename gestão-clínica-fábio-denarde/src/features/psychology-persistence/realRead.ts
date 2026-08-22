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
import type { PsychologyLocationRecord, PsychologyPatientRecord, PsychologyServiceRecord, PsychologySessionRecordEntity } from './types';

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
}

export async function readRealPsychologyStore(options: RealPsychologyReadOptions = {}): Promise<RealPsychologyReadResult> {
  const persistenceScope = createRealPsychologyPersistenceScope();
  const repositories = createApiPsychologyRepositories({ scope: persistenceScope, fetchImpl: options.fetchImpl, getToken: options.getToken });
  const [patients, sessions, services, locations] = await Promise.all([
    repositories.patients.list(persistenceScope),
    repositories.sessions.list(persistenceScope),
    repositories.services.list(persistenceScope),
    repositories.locations.list(persistenceScope),
  ]);

  const legacyScope = createPsychologyScope(REAL_PSYCHOLOGY_TARGET.professionalId);
  const base = createEmptyPsychologyStore(legacyScope);
  const normalized = normalizePsychologyStore({
    ...base,
    scope: legacyScope,
    settings: {
      ...base.settings,
      professionalProfile: {
        ...base.settings.professionalProfile,
        displayName: 'Leila Chaves',
        name: 'Leila Chaves',
        professionalTitle: 'Psicologia',
        specialty: 'Psicologia',
      },
      services,
      locations,
    },
    patients,
    sessions,
    services,
    locations,
    // R2B7 is read-only. These aggregates are intentionally not sourced from local storage.
    personalCommitments: [],
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
    counts: {
      patients: (patients as PsychologyPatientRecord[]).length,
      sessions: (sessions as PsychologySessionRecordEntity[]).length,
      services: (services as PsychologyServiceRecord[]).length,
      locations: (locations as PsychologyLocationRecord[]).length,
    },
  };
}
