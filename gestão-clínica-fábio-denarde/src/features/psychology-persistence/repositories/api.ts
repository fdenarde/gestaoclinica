import {
  buildPsychologyChange, buildPsychologyDelete, capturePsychologyBaseline,
  copyPsychologyBaseline,
} from '../../../../shared/psychologyConcurrency.js';
import { auth } from '../../../firebase';
import type { PsychologyPersistenceScope } from '../scope';
import type {
  PsychologyAttachmentRepository,
  PsychologyDocumentRepository,
  PsychologyFinancialRepository,
  PsychologyPatientRepository,
  PsychologyPatientDeletionResult,
  PsychologyRepository,
  PsychologyRepositoryBundle,
  PsychologyBackupReadBundle,
} from '../repositoryTypes';
import type {
  PsychologyAttachmentRecord,
  PsychologyAggregateRecordMap,
  PsychologyChargeRecord,
  PsychologyDocumentRecord,
  PsychologyExpenseRecord,
  PsychologyPaymentRecord,
} from '../types';
import type { PsychologyAggregate } from '../namespace';

export interface ApiPsychologyRepositoryOptions {
  scope: PsychologyPersistenceScope;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
}

export class ApiPsychologyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly persistenceStatus: string;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'ApiPsychologyError';
    this.code = code;
    this.status = status;
    this.persistenceStatus = status === 409 ? 'CONFLICT' : status === 422 ? 'VALIDATION_FAILED' : 'PERSISTENCE_FAILED';
  }
}

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

function defaultToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new ApiPsychologyError('psychology/missing-auth-token', 'Sua sessão não foi identificada.', 401);
  return user.getIdToken();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withScope<T extends { id: string }>(value: T, scope: PsychologyPersistenceScope): T & PsychologyPersistenceScope {
  return {
    ...value,
    workspaceId: scope.workspaceId,
    professionalId: scope.professionalId,
    context: scope.context,
  } as T & PsychologyPersistenceScope;
}

function adoptResponseScope(scope: PsychologyPersistenceScope, payload: unknown): void {
  const responseScope = payload && typeof payload === 'object' && 'scope' in payload
    ? (payload as { scope?: Partial<PsychologyPersistenceScope> }).scope
    : undefined;
  if (!responseScope || responseScope.context !== 'PSICOLOGIA') return;
  if (typeof responseScope.workspaceId !== 'string' || !responseScope.workspaceId.trim()) return;
  if (typeof responseScope.professionalId !== 'string' || !responseScope.professionalId.trim()) return;
  // The server is authoritative for the resolved access scope. Mutating this
  // shared object lets the already-created provider continue with that scope
  // after the first authenticated read, without a second bootstrap query.
  scope.workspaceId = responseScope.workspaceId;
  scope.professionalId = responseScope.professionalId;
}

async function readApiResponse<T>(response: Response): Promise<T> {
  let payload: T & ApiErrorPayload;
  try {
    payload = await response.json() as T & ApiErrorPayload;
  } catch {
    throw new ApiPsychologyError('psychology/invalid-response', 'A API da Psicologia retornou uma resposta inválida.', response.status || 500);
  }
  if (!response.ok) {
    throw new ApiPsychologyError(
      payload.error?.code || 'psychology/request-failed',
      payload.error?.message || 'Não foi possível concluir a operação da Psicologia.',
      response.status,
    );
  }
  return payload;
}

function unsupported<T extends { id: string }>(aggregate: PsychologyAggregate, scope: PsychologyPersistenceScope): PsychologyRepository<T> {
  const fail = async (): Promise<never> => {
    throw new ApiPsychologyError(
      'psychology/remote-aggregate-not-implemented',
      `O agregado remoto ${aggregate} ainda não está habilitado nesta etapa.`,
      501,
    );
  };
  return {
    aggregate,
    scope,
    list: fail,
    get: fail,
    upsert: fail,
    update: fail,
    delete: fail,
  };
}

export function createApiPsychologyRepositories(options: ApiPsychologyRepositoryOptions): PsychologyRepositoryBundle {
  const scope = options.scope;
  const baseUrl = (options.baseUrl || '/api/psychology').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const getToken = options.getToken || defaultToken;
  let persistenceProtocolReady = false;

  async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, idempotencyKey?: string): Promise<T> {
    if (method !== 'GET' && !persistenceProtocolReady) {
      throw new ApiPsychologyError('psychology/persistence-protocol-required', 'A API da Psicologia precisa ser atualizada antes de salvar. O rascunho foi preservado.', 503);
    }
    const token = await getToken();
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
    });
    const payload = await readApiResponse<T>(response);
    if (method === 'GET') persistenceProtocolReady = response.headers.get('X-Psychology-Persistence-Version') === '1';
    else if (response.headers.get('X-Psychology-Persistence-Version') !== '1'
      || (payload as { persistenceStatus?: string }).persistenceStatus !== 'SUCCESS') {
      throw new ApiPsychologyError('psychology/persistence-unconfirmed', 'A API não confirmou a persistência. O rascunho foi preservado.', 503);
    }
    adoptResponseScope(scope, payload);
    return payload;
  }

  function createApiRepository<K extends PsychologyAggregate>(aggregate: K): PsychologyRepository<PsychologyAggregateRecordMap[K]> {
    type RecordType = PsychologyAggregateRecordMap[K];
    const apiResource = aggregate === 'sessionRecords'
      ? 'session-records'
      : aggregate === 'personalAppointments'
        ? 'personal-appointments'
        : aggregate;
    const snapshots = new Map<string, RecordType>();
    const remember = (wire: RecordType): RecordType => {
      const record = capturePsychologyBaseline(withScope(clone(wire), scope) as RecordType, wire);
      snapshots.set(record.id, record);
      return record;
    };
    const saveResponse = (result: { patient?: RecordType; session?: RecordType; settings?: RecordType; item?: RecordType }): RecordType => {
      const value = result.patient || result.session || result.settings || result.item;
      if (!value) throw new ApiPsychologyError('psychology/invalid-response', 'A API não retornou o registro salvo.', 500);
      return remember(value);
    };
    const assertRequestedScope = (requestedScope: PsychologyPersistenceScope): void => {
      if (requestedScope.workspaceId !== scope.workspaceId || requestedScope.professionalId !== scope.professionalId || requestedScope.context !== scope.context) {
        throw new ApiPsychologyError('psychology/scope-conflict', 'O escopo da requisição não corresponde ao provider.', 422);
      }
    };
    return {
      aggregate,
      scope,
      async list(requestedScope) {
        assertRequestedScope(requestedScope);
        if (aggregate === 'settings') {
          const result = await request<{ settings?: RecordType }>(`/${apiResource}`, 'GET');
          return result.settings ? [remember(result.settings)] : [];
        }
        const result = await request<{ items?: RecordType[] }>(`/${apiResource}`, 'GET');
        return (result.items || []).map(remember);
      },
      async get(requestedScope, id) {
        assertRequestedScope(requestedScope);
        if (aggregate === 'settings') {
          const result = await request<{ settings?: RecordType }>(`/${apiResource}`, 'GET');
          return result.settings ? remember(result.settings) : null;
        }
        const result = await request<{ items?: RecordType[] }>(`/${apiResource}/${encodeURIComponent(id)}`, 'GET');
        return result.items?.[0] ? remember(result.items[0]) : null;
      },
      async upsert(requestedScope, entity) {
        assertRequestedScope(requestedScope);
        const change = buildPsychologyChange(aggregate, entity.id, entity, snapshots.get(entity.id));
        const method = aggregate === 'settings' ? 'PUT' : change.operation === 'create' ? 'POST' : 'PATCH';
        const path = change.operation === 'create' || aggregate === 'settings' ? `/${apiResource}` : `/${apiResource}/${encodeURIComponent(entity.id)}`;
        const result = await request<{ patient?: RecordType; session?: RecordType; settings?: RecordType; item?: RecordType }>(path, method,
          { persistence: change }, `${aggregate}:${entity.id}:${entity.updatedAt}`);
        return saveResponse(result);
      },
      async update(requestedScope, id, patch) {
        assertRequestedScope(requestedScope);
        const baseline = snapshots.get(id);
        const candidate = aggregate === 'settings'
          ? copyPsychologyBaseline({ settings: patch }, patch)
          : patch;
        const change = buildPsychologyChange(aggregate, id, candidate, baseline, true);
        const result = await request<{ patient?: RecordType; session?: RecordType; settings?: RecordType; item?: RecordType }>(
          aggregate === 'settings' ? '/settings' : `/${apiResource}/${encodeURIComponent(id)}`,
          aggregate === 'settings' ? 'PUT' : 'PATCH', { persistence: change },
        );
        return saveResponse(result);
      },
      async delete(requestedScope, id) {
        assertRequestedScope(requestedScope);
        const change = buildPsychologyDelete(id, snapshots.get(id));
        const result = await request<{ deleted?: boolean; id?: string }>(`/${apiResource}/${encodeURIComponent(id)}`, 'DELETE', { persistence: change });
        if (result.deleted) snapshots.delete(id);
        return result.deleted ? { id: result.id || id } : null;
      },
      ...(aggregate === 'patients' ? {
        deleteSafely: async (requestedScope: PsychologyPersistenceScope, id: string): Promise<PsychologyPatientDeletionResult> => {
          assertRequestedScope(requestedScope);
          const change = buildPsychologyDelete(id, snapshots.get(id));
          const result = await request<PsychologyPatientDeletionResult>(`/patients/${encodeURIComponent(id)}`, 'DELETE', { persistence: change });
          if (result.deleted) snapshots.delete(id);
          return result;
        },
      } : {}),
    };
  }

  const patients = createApiRepository('patients') as PsychologyPatientRepository;
  const sessions = createApiRepository('sessions');
  const sessionRecords = createApiRepository('sessionRecords' as 'sessionRecords');
  const settings = createApiRepository('settings');
  const documents = createApiRepository('documents');
  const attachments = createApiRepository('attachments');
  const charges = createApiRepository('charges');
  const payments = createApiRepository('payments');
  const expenses = createApiRepository('expenses');
  const services = createApiRepository('services');
  const locations = createApiRepository('locations');
  const packages = createApiRepository('packages');
  const personalAppointments = createApiRepository('personalAppointments');

  const documentQueries = <T extends PsychologyDocumentRecord | PsychologyAttachmentRecord>(repository: PsychologyRepository<T>) => ({
    ...repository,
    listAdministrative: async (requestedScope: PsychologyPersistenceScope, patientId?: string) => (await repository.list(requestedScope)).filter(item => item.classification === 'ADMINISTRATIVE' && (!patientId || item.patientId === patientId)),
    listClinical: async (requestedScope: PsychologyPersistenceScope, patientId?: string) => (await repository.list(requestedScope)).filter(item => item.classification === 'CLINICAL' && (!patientId || item.patientId === patientId)),
  });

  const financial: PsychologyFinancialRepository = {
    scope,
    listCharges: charges.list,
    getCharge: charges.get,
    upsertCharge: charges.upsert,
    updateCharge: charges.update,
    deleteCharge: charges.delete,
    listPayments: payments.list,
    getPayment: payments.get,
    createPayment: payments.upsert,
    updatePayment: payments.update,
    deletePayment: payments.delete,
    listExpenses: expenses.list,
    getExpense: expenses.get,
    upsertExpense: expenses.upsert,
    updateExpense: expenses.update,
    deleteExpense: expenses.delete,
  };

  const backup: PsychologyBackupReadBundle = {
    patients,
    sessions,
    sessionRecords,
    personalAppointments,
    services,
    locations,
    packages,
    documents: documentQueries(documents) as never,
    attachments: documentQueries(attachments) as never,
    listCharges: charges.list,
    listPayments: payments.list,
    listExpenses: expenses.list,
  };

  return {
    scope,
    patients,
    sessions,
    sessionRecords,
    personalAppointments,
    financial,
    services,
    locations,
    packages,
    documents: documentQueries(documents) as never,
    attachments: documentQueries(attachments) as never,
    settings,
    backup,
  } as PsychologyRepositoryBundle;
}
