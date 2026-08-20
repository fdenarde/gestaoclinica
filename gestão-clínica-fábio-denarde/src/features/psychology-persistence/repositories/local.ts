import {
  createEmptyPsychologyStore,
  LOCAL_PSYCHOLOGY_STORAGE_KEY,
  parsePsychologyStore,
  type PsychologyStore,
} from '../../psychology-pilot/psychologyDomain';
import { serializePsychologyStore } from '../../psychology-pilot/psychologyDomain';
import type { PsychologyAggregate } from '../namespace';
import { assertSamePsychologyPersistenceScope, toLegacyPsychologyScope, type PsychologyPersistenceScope } from '../scope';
import type { PsychologyAggregateRecordMap } from '../types';
import {
  createMemoryPsychologyRepositories,
  createPsychologyMemoryState,
  seedPsychologyMemoryState,
  type PsychologyMemoryState,
} from './memory';
import type { PsychologyRepositoryBundle } from '../repositoryTypes';

export const LOCAL_PSYCHOLOGY_CANONICAL_STORAGE_KEY = 'gestao-clinica:psychology-r2d1:canonical:v1';

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface LocalCanonicalEnvelope {
  schemaVersion: 1;
  scope: PsychologyPersistenceScope;
  aggregates: Partial<{ [K in PsychologyAggregate]: readonly PsychologyAggregateRecordMap[K][] }>;
}

export function legacyPsychologyStorageKey(scope: PsychologyPersistenceScope): string {
  return `${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${scope.professionalId}`;
}

export function canonicalPsychologyStorageKey(scope: PsychologyPersistenceScope): string {
  return `${LOCAL_PSYCHOLOGY_CANONICAL_STORAGE_KEY}:${scope.workspaceId}:${scope.professionalId}:${scope.context}`;
}

function scoped<T extends object>(record: T, scope: PsychologyPersistenceScope): T & { workspaceId: string } {
  return { ...record, workspaceId: scope.workspaceId };
}

function stateFromStore(store: PsychologyStore, scope: PsychologyPersistenceScope): PsychologyMemoryState {
  const state = createPsychologyMemoryState();
  seedPsychologyMemoryState(state, {
    patients: store.patients.map(item => scoped(item, scope)),
    sessions: store.sessions.map(item => scoped(item, scope)),
    sessionRecords: store.sessionRecords.map(item => scoped(item, scope)),
    personalAppointments: store.personalCommitments.map(item => scoped(item, scope)),
    services: store.services.map(item => scoped(item, scope)),
    locations: store.locations.map(item => scoped(item, scope)),
    charges: store.charges.map(item => scoped(item, scope)),
    payments: store.payments.map(item => scoped(item, scope)),
    expenses: store.expenses.map(item => scoped(item, scope)),
    packages: store.sessionPackages.map(item => scoped(item, scope)),
    documents: store.documents.map(item => scoped(item, scope)),
    attachments: store.attachments.map(item => scoped(item, scope)),
    settings: [{
      id: 'settings',
      workspaceId: scope.workspaceId,
      professionalId: scope.professionalId,
      context: scope.context,
      settings: store.settings,
      createdAt: store.settings.updatedAt,
      updatedAt: store.settings.updatedAt,
    }],
  } as unknown as Partial<{ [K in PsychologyAggregate]: readonly PsychologyAggregateRecordMap[K][] }>);
  return state;
}

function stateToEnvelope(state: PsychologyMemoryState, scope: PsychologyPersistenceScope): LocalCanonicalEnvelope {
  const aggregates = {} as LocalCanonicalEnvelope['aggregates'];
  for (const aggregate of Object.keys(state) as PsychologyAggregate[]) {
    aggregates[aggregate] = [...state[aggregate].values()].map(item => JSON.parse(JSON.stringify(item))) as never;
  }
  return { schemaVersion: 1, scope, aggregates };
}

function readCanonicalEnvelope(storage: LocalStorageLike, scope: PsychologyPersistenceScope): LocalCanonicalEnvelope | null {
  const raw = storage.getItem(canonicalPsychologyStorageKey(scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalCanonicalEnvelope;
    if (parsed.schemaVersion !== 1 || !parsed.scope) return null;
    assertSamePsychologyPersistenceScope(scope, parsed.scope);
    return parsed;
  } catch {
    return null;
  }
}

function loadState(storage: LocalStorageLike, scope: PsychologyPersistenceScope): PsychologyMemoryState {
  const canonical = readCanonicalEnvelope(storage, scope);
  if (canonical) {
    const state = createPsychologyMemoryState();
    return seedPsychologyMemoryState(state, canonical.aggregates);
  }
  const legacyRaw = storage.getItem(legacyPsychologyStorageKey(scope));
  const legacyStore = legacyRaw
    ? parsePsychologyStore(legacyRaw, toLegacyPsychologyScope(scope))
    : createEmptyPsychologyStore(toLegacyPsychologyScope(scope));
  return stateFromStore(legacyStore, scope);
}

export interface LocalPsychologyRepositoryOptions {
  scope: PsychologyPersistenceScope;
  storage: LocalStorageLike;
  now?: () => string;
}

/**
 * Compatibility adapter: legacy R1 storage is a read fallback. New writes
 * use a namespaced R2D1 envelope, leaving the legacy key untouched.
 */
export function createLocalPsychologyRepositories({ scope, storage, now }: LocalPsychologyRepositoryOptions): PsychologyRepositoryBundle {
  const state = loadState(storage, scope);
  const onChange = (nextState: PsychologyMemoryState): void => {
    storage.setItem(canonicalPsychologyStorageKey(scope), JSON.stringify(stateToEnvelope(nextState, scope)));
  };
  return createMemoryPsychologyRepositories(scope, { state, now, onChange });
}

export function createMemoryStorage(initial: Record<string, string> = {}): LocalStorageLike & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: key => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
  };
}

export function serializeLocalPsychologyLegacyStore(store: PsychologyStore): string {
  return serializePsychologyStore(store);
}
