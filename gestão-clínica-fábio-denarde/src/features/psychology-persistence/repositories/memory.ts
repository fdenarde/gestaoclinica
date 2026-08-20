import {
  assertPsychologyPersistenceScope,
  assertSamePsychologyPersistenceScope,
  type PsychologyPersistenceScope,
} from '../scope';
import { type PsychologyAggregate } from '../namespace';
import type {
  PsychologyAttachmentRecord,
  PsychologyAggregateRecordMap,
  PsychologyChargeRecord,
  PsychologyClinicalSessionRecord,
  PsychologyDocumentRecord,
  PsychologyExpenseRecord,
  PsychologyLocationRecord,
  PsychologyPackageRecord,
  PsychologyPatientRecord,
  PsychologyPaymentRecord,
  PsychologyPersonalAppointmentRecord,
  PsychologyServiceRecord,
  PsychologySessionRecordEntity,
  PsychologySettingsRecord,
} from '../types';
import type {
  PsychologyAttachmentRepository,
  PsychologyDocumentRepository,
  PsychologyFinancialRepository,
  PsychologyLocationRepository,
  PsychologyPackageRepository,
  PsychologyPatientRepository,
  PsychologyPersonalAppointmentRepository,
  PsychologyRepository,
  PsychologyRepositoryBundle,
  PsychologyServiceRepository,
  PsychologySessionRecordRepository,
  PsychologySessionRepository,
  PsychologySettingsRepository,
} from '../repositoryTypes';

export type PsychologyMemoryState = {
  [K in PsychologyAggregate]: Map<string, PsychologyAggregateRecordMap[K]>;
};

export interface MemoryRepositoryOptions {
  state?: PsychologyMemoryState;
  now?: () => string;
  onChange?: (state: PsychologyMemoryState) => void;
}

const AGGREGATES: readonly PsychologyAggregate[] = [
  'patients', 'sessions', 'sessionRecords', 'personalAppointments', 'services', 'locations',
  'charges', 'payments', 'expenses', 'packages', 'documents', 'attachments', 'settings',
];

export function createPsychologyMemoryState(): PsychologyMemoryState {
  return Object.fromEntries(AGGREGATES.map(aggregate => [aggregate, new Map()])) as PsychologyMemoryState;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function entityScope(entity: { workspaceId: string; professionalId: string; context: 'PSICOLOGIA' }): PsychologyPersistenceScope {
  return { workspaceId: entity.workspaceId, professionalId: entity.professionalId, context: entity.context };
}

function assertEntity<T extends { id: string; workspaceId: string; professionalId: string; context: 'PSICOLOGIA'; createdAt: string; updatedAt: string }>(
  scope: PsychologyPersistenceScope,
  entity: T,
): void {
  assertPsychologyPersistenceScope(scope);
  if (!entity || !entity.id || entity.id.includes('/')) throw new Error('Entidade Psicologia exige ID opaco.');
  assertSamePsychologyPersistenceScope(scope, entityScope(entity));
  if (!entity.createdAt || !entity.updatedAt) throw new Error('Entidade Psicologia exige createdAt e updatedAt.');
}

function assertNoBinaryMetadata(entity: Record<string, unknown>): void {
  for (const key of ['data', 'base64', 'dataUrl', 'bytes', 'contentBase64']) {
    if (key in entity) throw new Error('Attachments e documentos armazenam somente metadata; binário não é permitido.');
  }
}

function assertAggregateEntity(aggregate: PsychologyAggregate, entity: Record<string, unknown>): void {
  if (aggregate === 'documents' || aggregate === 'attachments') assertNoBinaryMetadata(entity);
  if (aggregate === 'sessions' && ('content' in entity || 'clinicalContent' in entity)) {
    throw new Error('Session é administrativa; conteúdo clínico deve usar sessionRecords.');
  }
}

function assertRepositoryScope(repositoryScope: PsychologyPersistenceScope, requestedScope: PsychologyPersistenceScope): void {
  assertSamePsychologyPersistenceScope(repositoryScope, requestedScope);
}

function createGenericRepository<K extends PsychologyAggregate>(
  aggregate: K,
  scope: PsychologyPersistenceScope,
  state: PsychologyMemoryState,
  now: () => string,
  onChange?: (state: PsychologyMemoryState) => void,
): PsychologyRepository<PsychologyAggregateRecordMap[K]> {
  type RecordType = PsychologyAggregateRecordMap[K];
  const map = state[aggregate] as Map<string, RecordType>;
  const read = (value: RecordType): RecordType => clone(value);
  const list = async (requestedScope: PsychologyPersistenceScope): Promise<readonly RecordType[]> => {
    assertRepositoryScope(scope, requestedScope);
    return [...map.values()]
      .filter(item => item.workspaceId === scope.workspaceId && item.professionalId === scope.professionalId && item.context === scope.context)
      .map(read);
  };
  const get = async (requestedScope: PsychologyPersistenceScope, id: string): Promise<RecordType | null> => {
    assertRepositoryScope(scope, requestedScope);
    const item = map.get(id);
    return item && item.workspaceId === scope.workspaceId && item.professionalId === scope.professionalId && item.context === scope.context
      ? read(item)
      : null;
  };
  const upsert = async (requestedScope: PsychologyPersistenceScope, entity: RecordType): Promise<RecordType> => {
    assertRepositoryScope(scope, requestedScope);
    assertEntity(scope, entity);
    assertAggregateEntity(aggregate, entity as unknown as Record<string, unknown>);
    const current = map.get(entity.id);
    const value = current ? { ...entity, createdAt: current.createdAt, updatedAt: entity.updatedAt || now() } : entity;
    assertEntity(scope, value);
    map.set(value.id, clone(value));
    onChange?.(state);
    return read(value);
  };
  const update = async (requestedScope: PsychologyPersistenceScope, id: string, patch: Partial<RecordType>): Promise<RecordType | null> => {
    assertRepositoryScope(scope, requestedScope);
    const current = map.get(id);
    if (!current || current.workspaceId !== scope.workspaceId || current.professionalId !== scope.professionalId || current.context !== scope.context) return null;
    for (const key of ['id', 'workspaceId', 'professionalId', 'context', 'createdAt'] as const) {
      if (key in patch && patch[key] !== undefined && patch[key] !== current[key]) {
        throw new Error(`Campo imutável de escopo/timestamp não pode ser sobrescrito: ${key}.`);
      }
    }
    const value = { ...current, ...patch, id: current.id, workspaceId: current.workspaceId, professionalId: current.professionalId, context: current.context, createdAt: current.createdAt, updatedAt: now() } as RecordType;
    assertEntity(scope, value);
    assertAggregateEntity(aggregate, value as unknown as Record<string, unknown>);
    map.set(id, clone(value));
    onChange?.(state);
    return read(value);
  };
  return { aggregate, scope, list, get, upsert, update };
}

function createFinancialRepository(
  scope: PsychologyPersistenceScope,
  state: PsychologyMemoryState,
  now: () => string,
  onChange?: (state: PsychologyMemoryState) => void,
): PsychologyFinancialRepository {
  const charges = createGenericRepository('charges', scope, state, now, onChange) as PsychologyRepository<PsychologyChargeRecord>;
  const payments = createGenericRepository('payments', scope, state, now, onChange) as PsychologyRepository<PsychologyPaymentRecord>;
  const expenses = createGenericRepository('expenses', scope, state, now, onChange) as PsychologyRepository<PsychologyExpenseRecord>;
  return {
    scope,
    listCharges: charges.list,
    getCharge: charges.get,
    upsertCharge: charges.upsert,
    updateCharge: charges.update,
    listPayments: payments.list,
    getPayment: payments.get,
    createPayment: async (requestedScope, entity) => {
      assertRepositoryScope(scope, requestedScope);
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

function withDocumentQueries<T extends PsychologyDocumentRecord | PsychologyAttachmentRecord>(
  repository: PsychologyRepository<T>,
): PsychologyDocumentRepository | PsychologyAttachmentRepository {
  const listByClassification = async (requestedScope: PsychologyPersistenceScope, classification: 'ADMINISTRATIVE' | 'CLINICAL', patientId?: string): Promise<readonly T[]> => (
    (await repository.list(requestedScope)).filter(item => item.classification === classification && (!patientId || item.patientId === patientId))
  );
  return {
    ...repository,
    listAdministrative: (requestedScope, patientId) => listByClassification(requestedScope, 'ADMINISTRATIVE', patientId),
    listClinical: (requestedScope, patientId) => listByClassification(requestedScope, 'CLINICAL', patientId),
  } as PsychologyDocumentRepository | PsychologyAttachmentRepository;
}

export function createMemoryPsychologyRepositories(
  scope: PsychologyPersistenceScope,
  options: MemoryRepositoryOptions = {},
): PsychologyRepositoryBundle {
  assertPsychologyPersistenceScope(scope);
  const state = options.state || createPsychologyMemoryState();
  const now = options.now || (() => new Date().toISOString());
  const patients = createGenericRepository('patients', scope, state, now, options.onChange) as PsychologyPatientRepository;
  const sessions = createGenericRepository('sessions', scope, state, now, options.onChange) as PsychologySessionRepository;
  const sessionRecords = createGenericRepository('sessionRecords', scope, state, now, options.onChange) as PsychologySessionRecordRepository;
  const personalAppointments = createGenericRepository('personalAppointments', scope, state, now, options.onChange) as PsychologyPersonalAppointmentRepository;
  const services = createGenericRepository('services', scope, state, now, options.onChange) as PsychologyServiceRepository;
  const locations = createGenericRepository('locations', scope, state, now, options.onChange) as PsychologyLocationRepository;
  const packages = createGenericRepository('packages', scope, state, now, options.onChange) as PsychologyPackageRepository;
  const documents = withDocumentQueries(createGenericRepository('documents', scope, state, now, options.onChange)) as PsychologyDocumentRepository;
  const attachments = withDocumentQueries(createGenericRepository('attachments', scope, state, now, options.onChange)) as PsychologyAttachmentRepository;
  const settings = createGenericRepository('settings', scope, state, now, options.onChange) as PsychologySettingsRepository;
  return { scope, patients, sessions, sessionRecords, personalAppointments, financial: createFinancialRepository(scope, state, now, options.onChange), services, locations, packages, documents, attachments, settings };
}

export function seedPsychologyMemoryState(
  state: PsychologyMemoryState,
  seed: Partial<{ [K in PsychologyAggregate]: readonly PsychologyAggregateRecordMap[K][] }>,
): PsychologyMemoryState {
  for (const aggregate of AGGREGATES) {
    const records = seed[aggregate];
    if (!records) continue;
    const map = state[aggregate] as Map<string, PsychologyAggregateRecordMap[typeof aggregate]>;
    for (const record of records) map.set(record.id, clone(record));
  }
  return state;
}
