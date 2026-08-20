import type { PsychologyRepositoryBundle } from './repositoryTypes';
import type { PsychologyPersistenceScope } from './scope';
import { createFirestorePsychologyRepositories, type FirestorePsychologyEmulatorClient } from './repositories/firestore';
import { createLocalPsychologyRepositories, type LocalStorageLike } from './repositories/local';
import { createMemoryPsychologyRepositories, type PsychologyMemoryState } from './repositories/memory';
import { createApiPsychologyRepositories, type ApiPsychologyRepositoryOptions } from './repositories/api';
import { isPsychologyRemoteCanaryEnabled } from './remoteCanary';

export type PsychologyPersistenceBackend = 'local' | 'memory' | 'emulator' | 'remote';

export interface PsychologyPersistenceProviderOptions {
  scope: PsychologyPersistenceScope;
  backend?: PsychologyPersistenceBackend | string;
  storage?: LocalStorageLike;
  memoryState?: PsychologyMemoryState;
  emulatorClient?: FirestorePsychologyEmulatorClient;
  api?: Omit<ApiPsychologyRepositoryOptions, 'scope'>;
  /** Explicit local test gate; environment is not read or changed automatically. */
  remoteCanaryEnabled?: boolean | string;
}

export interface PsychologyPersistenceProvider {
  readonly backend: PsychologyPersistenceBackend;
  readonly scope: PsychologyPersistenceScope;
  readonly productionEnabled: false;
  readonly repositories: PsychologyRepositoryBundle;
}

function browserStorage(): LocalStorageLike | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  return window.localStorage;
}

export function createPsychologyPersistenceProvider(options: PsychologyPersistenceProviderOptions): PsychologyPersistenceProvider {
  const backend = options.backend || 'local';
  if (backend !== 'local' && backend !== 'memory' && backend !== 'emulator' && backend !== 'remote') {
    throw new Error(`Backend Psicologia não permitido: ${backend}.`);
  }
  let repositories: PsychologyRepositoryBundle;
  if (backend === 'local') {
    const storage = options.storage || browserStorage();
    if (!storage) throw new Error('Backend local da Psicologia exige localStorage injetado ou disponível no navegador.');
    repositories = createLocalPsychologyRepositories({ scope: options.scope, storage });
  } else if (backend === 'memory') {
    repositories = createMemoryPsychologyRepositories(options.scope, { state: options.memoryState });
  } else if (backend === 'emulator') {
    repositories = createFirestorePsychologyRepositories({ mode: 'emulator', scope: options.scope, client: options.emulatorClient });
  } else {
    if (!options.api) throw new Error('Backend remote da Psicologia exige configuração explícita de API.');
    if (!isPsychologyRemoteCanaryEnabled(options.remoteCanaryEnabled)) {
      throw new Error('Backend remote da Psicologia exige o gate remoto explícito habilitado.');
    }
    repositories = createApiPsychologyRepositories({ ...options.api, scope: options.scope });
  }
  return { backend, scope: options.scope, productionEnabled: false, repositories };
}
