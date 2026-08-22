import { buildPsychologyCollectionPath, buildPsychologyDocumentPath, type PsychologyAggregate } from '../namespace';
import { assertSamePsychologyPersistenceScope, type PsychologyPersistenceScope } from '../scope';
import type {
  PsychologyAttachmentRecord,
  PsychologyAggregateRecordMap,
  PsychologyChargeRecord,
  PsychologyDocumentRecord,
  PsychologyExpenseRecord,
  PsychologyPaymentRecord,
} from '../types';
import type {
  PsychologyAttachmentRepository,
  PsychologyDocumentRepository,
  PsychologyFinancialRepository,
  PsychologyRepository,
  PsychologyRepositoryBundle,
} from '../repositoryTypes';

/** Minimal injected client. It deliberately has no Firebase SDK dependency. */
export interface FirestorePsychologyEmulatorClient {
  list<T>(collectionPath: string): Promise<readonly T[]>;
  get<T>(documentPath: string): Promise<T | null>;
  upsert<T>(documentPath: string, value: T): Promise<T>;
  update<T>(documentPath: string, patch: Partial<T>): Promise<T | null>;
  delete?(documentPath: string): Promise<void>;
}

export interface FirestorePsychologyRepositoryOptions {
  mode: 'emulator';
  scope: PsychologyPersistenceScope;
  client?: FirestorePsychologyEmulatorClient;
}

function validateEntity(scope: PsychologyPersistenceScope, entity: { id: string; workspaceId: string; professionalId: string; context: 'PSICOLOGIA'; createdAt: string; updatedAt: string }, aggregate: PsychologyAggregate): void {
  if (!entity.id || entity.id.includes('/')) throw new Error('Entidade Psicologia exige ID opaco.');
  assertSamePsychologyPersistenceScope(scope, { workspaceId: entity.workspaceId, professionalId: entity.professionalId, context: entity.context });
  if (!entity.createdAt || !entity.updatedAt) throw new Error('Entidade Psicologia exige createdAt e updatedAt.');
  if ((aggregate === 'documents' || aggregate === 'attachments') && ['data', 'base64', 'dataUrl', 'bytes'].some(key => key in (entity as unknown as Record<string, unknown>))) {
    throw new Error('Attachments e documentos armazenam somente metadata; binário não é permitido.');
  }
  if (aggregate === 'sessions' && ('content' in entity || 'clinicalContent' in entity)) {
    throw new Error('Session é administrativa; conteúdo clínico deve usar sessionRecords.');
  }
}

function createRemoteRepository<K extends PsychologyAggregate>(
  aggregate: K,
  scope: PsychologyPersistenceScope,
  client: FirestorePsychologyEmulatorClient,
): PsychologyRepository<PsychologyAggregateRecordMap[K]> {
  type RecordType = PsychologyAggregateRecordMap[K];
  return {
    aggregate,
    scope,
    list: async requestedScope => {
      assertSamePsychologyPersistenceScope(scope, requestedScope);
      const records = await client.list<RecordType>(buildPsychologyCollectionPath(scope, aggregate));
      return records.filter(item => item.workspaceId === scope.workspaceId && item.professionalId === scope.professionalId && item.context === scope.context);
    },
    get: async (requestedScope, id) => {
      assertSamePsychologyPersistenceScope(scope, requestedScope);
      const value = await client.get<RecordType>(buildPsychologyDocumentPath(scope, aggregate, id));
      if (!value || value.workspaceId !== scope.workspaceId || value.professionalId !== scope.professionalId || value.context !== scope.context) return null;
      return value;
    },
    upsert: async (requestedScope, entity) => {
      assertSamePsychologyPersistenceScope(scope, requestedScope);
      validateEntity(scope, entity, aggregate);
      return client.upsert<RecordType>(buildPsychologyDocumentPath(scope, aggregate, entity.id), entity);
    },
    update: async (requestedScope, id, patch) => {
      assertSamePsychologyPersistenceScope(scope, requestedScope);
      const current = await client.get<RecordType>(buildPsychologyDocumentPath(scope, aggregate, id));
      if (!current || current.workspaceId !== scope.workspaceId || current.professionalId !== scope.professionalId || current.context !== scope.context) return null;
      for (const key of ['id', 'workspaceId', 'professionalId', 'context', 'createdAt'] as const) {
        if (key in patch && patch[key] !== undefined && patch[key] !== current[key]) {
          throw new Error(`Campo imutável de escopo/timestamp não pode ser sobrescrito: ${key}.`);
        }
      }
      const next = { ...current, ...patch, id: current.id, workspaceId: current.workspaceId, professionalId: current.professionalId, context: current.context, createdAt: current.createdAt } as RecordType;
      validateEntity(scope, next, aggregate);
      return client.update<RecordType>(buildPsychologyDocumentPath(scope, aggregate, id), next);
    },
    delete: async (requestedScope, id) => {
      assertSamePsychologyPersistenceScope(scope, requestedScope);
      const current = await client.get<RecordType>(buildPsychologyDocumentPath(scope, aggregate, id));
      if (!current || current.workspaceId !== scope.workspaceId || current.professionalId !== scope.professionalId || current.context !== scope.context) return null;
      if (!client.delete) throw new Error('O client Firestore injetado não implementa delete.');
      await client.delete(buildPsychologyDocumentPath(scope, aggregate, id));
      return { id };
    },
  };
}

function withDocumentQueries<T extends PsychologyDocumentRecord | PsychologyAttachmentRecord>(repository: PsychologyRepository<T>): PsychologyDocumentRepository | PsychologyAttachmentRepository {
  return {
    ...repository,
    listAdministrative: async (scope, patientId) => (await repository.list(scope)).filter(item => item.classification === 'ADMINISTRATIVE' && (!patientId || item.patientId === patientId)),
    listClinical: async (scope, patientId) => (await repository.list(scope)).filter(item => item.classification === 'CLINICAL' && (!patientId || item.patientId === patientId)),
  } as PsychologyDocumentRepository | PsychologyAttachmentRepository;
}

function createFinancialRepository(scope: PsychologyPersistenceScope, client: FirestorePsychologyEmulatorClient): PsychologyFinancialRepository {
  const charges = createRemoteRepository('charges', scope, client) as PsychologyRepository<PsychologyChargeRecord>;
  const payments = createRemoteRepository('payments', scope, client) as PsychologyRepository<PsychologyPaymentRecord>;
  const expenses = createRemoteRepository('expenses', scope, client) as PsychologyRepository<PsychologyExpenseRecord>;
  return {
    scope,
    listCharges: charges.list,
    getCharge: charges.get,
    upsertCharge: charges.upsert,
    updateCharge: charges.update,
    listPayments: payments.list,
    getPayment: payments.get,
    createPayment: async (requestedScope, entity) => {
      assertSamePsychologyPersistenceScope(scope, requestedScope);
      if (entity.operationKey) {
        const existing = (await payments.list(requestedScope)).find(item => item.operationKey === entity.operationKey);
        if (existing) return existing;
      }
      return payments.upsert(requestedScope, entity);
    },
    updatePayment: payments.update,
    listExpenses: expenses.list,
    getExpense: expenses.get,
    upsertExpense: expenses.upsert,
    updateExpense: expenses.update,
  };
}

/**
 * R2D1 intentionally accepts only an explicitly injected emulator client.
 * There is no production mode and no import of src/firebase.ts here.
 */
export function createFirestorePsychologyRepositories(options: FirestorePsychologyRepositoryOptions): PsychologyRepositoryBundle {
  if (options.mode !== 'emulator') throw new Error('O adapter Firestore da Psicologia só pode ser criado em modo emulator.');
  if (!options.client) throw new Error('Adapter Firestore preparado, mas desativado: forneça um client de emulator explicitamente.');
  const { scope, client } = options;
  return {
    scope,
    patients: createRemoteRepository('patients', scope, client),
    sessions: createRemoteRepository('sessions', scope, client),
    sessionRecords: createRemoteRepository('sessionRecords', scope, client),
    personalAppointments: createRemoteRepository('personalAppointments', scope, client),
    financial: createFinancialRepository(scope, client),
    services: createRemoteRepository('services', scope, client),
    locations: createRemoteRepository('locations', scope, client),
    packages: createRemoteRepository('packages', scope, client),
    documents: withDocumentQueries(createRemoteRepository('documents', scope, client)) as PsychologyDocumentRepository,
    attachments: withDocumentQueries(createRemoteRepository('attachments', scope, client)) as PsychologyAttachmentRepository,
    settings: createRemoteRepository('settings', scope, client),
  };
}
