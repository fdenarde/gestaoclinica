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
import { normalizePsychologyCapabilities, type PsychologyCapabilities } from '../capabilities';

export interface ApiPsychologyRepositoryOptions {
  scope: PsychologyPersistenceScope;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
}

export class ApiPsychologyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'ApiPsychologyError';
    this.code = code;
    this.status = status;
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
  let latestCapabilities: PsychologyCapabilities | null = null;

  async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, idempotencyKey?: string): Promise<T> {
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
    adoptResponseScope(scope, payload);
    if (payload && typeof payload === 'object' && 'capabilities' in payload) {
      latestCapabilities = normalizePsychologyCapabilities((payload as T & { capabilities?: unknown }).capabilities);
    }
    return payload;
  }

  function createApiRepository<K extends PsychologyAggregate>(aggregate: K): PsychologyRepository<PsychologyAggregateRecordMap[K]> {
    type RecordType = PsychologyAggregateRecordMap[K];
    const apiResource = aggregate === 'sessionRecords'
      ? 'session-records'
      : aggregate === 'personalAppointments'
        ? 'personal-appointments'
        : aggregate;
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
          return result.settings ? [withScope(clone(result.settings), scope) as RecordType] : [];
        }
        const result = await request<{ items?: RecordType[] }>(`/${apiResource}`, 'GET');
        return (result.items || []).map(item => withScope(clone(item), scope) as RecordType);
      },
      async get(requestedScope, id) {
        assertRequestedScope(requestedScope);
        if (aggregate === 'settings') {
          const result = await request<{ settings?: RecordType }>(`/${apiResource}`, 'GET');
          return result.settings ? withScope(clone(result.settings), scope) as RecordType : null;
        }
        const result = await request<{ items?: RecordType[] }>(`/${apiResource}/${encodeURIComponent(id)}`, 'GET');
        return result.items?.[0] ? withScope(clone(result.items[0]), scope) as RecordType : null;
      },
      async upsert(requestedScope, entity) {
        assertRequestedScope(requestedScope);
        const method = aggregate === 'settings' ? 'PUT' : 'POST';
        const requestBody = aggregate === 'settings'
          ? { settings: (entity as unknown as { settings?: unknown }).settings || {} }
          : withScope(entity, scope);
        const idempotencyKey = `${aggregate}:${entity.id}:${entity.updatedAt}`;
        const result = await request<{ patient?: RecordType; settings?: RecordType; item?: RecordType }>(`/${apiResource}`, method, requestBody, idempotencyKey);
        const value = result.patient || result.settings || result.item;
        if (!value) throw new ApiPsychologyError('psychology/invalid-response', 'A API não retornou o registro salvo.', 500);
        return withScope(clone(value), scope) as RecordType;
      },
      async update(requestedScope, id, patch) {
        assertRequestedScope(requestedScope);
        if (aggregate === 'settings') {
          const result = await request<{ settings?: RecordType }>('/settings', 'PUT', patch);
          return result.settings ? withScope(clone(result.settings), scope) as RecordType : null;
        }
        const result = await request<{ patient?: RecordType; item?: RecordType }>(`/${apiResource}/${encodeURIComponent(id)}`, 'PATCH', patch);
        const value = result.patient || result.item;
        return value ? withScope(clone(value), scope) as RecordType : null;
      },
      async delete(requestedScope, id) {
        assertRequestedScope(requestedScope);
        const result = await request<{ deleted?: boolean; id?: string }>(`/${apiResource}/${encodeURIComponent(id)}`, 'DELETE');
        return result.deleted ? { id: result.id || id } : null;
      },
      ...(aggregate === 'patients' ? {
        deleteSafely: async (requestedScope: PsychologyPersistenceScope, id: string): Promise<PsychologyPatientDeletionResult> => {
          assertRequestedScope(requestedScope);
          return request<PsychologyPatientDeletionResult>(`/patients/${encodeURIComponent(id)}`, 'DELETE');
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
    listCharges: unsupported<PsychologyChargeRecord>('charges', scope).list,
    getCharge: unsupported<PsychologyChargeRecord>('charges', scope).get,
    upsertCharge: unsupported<PsychologyChargeRecord>('charges', scope).upsert,
    updateCharge: unsupported<PsychologyChargeRecord>('charges', scope).update,
    listPayments: unsupported<PsychologyPaymentRecord>('payments', scope).list,
    getPayment: unsupported<PsychologyPaymentRecord>('payments', scope).get,
    createPayment: unsupported<PsychologyPaymentRecord>('payments', scope).upsert,
    updatePayment: unsupported<PsychologyPaymentRecord>('payments', scope).update,
    listExpenses: unsupported<PsychologyExpenseRecord>('expenses', scope).list,
    getExpense: unsupported<PsychologyExpenseRecord>('expenses', scope).get,
    upsertExpense: unsupported<PsychologyExpenseRecord>('expenses', scope).upsert,
    updateExpense: unsupported<PsychologyExpenseRecord>('expenses', scope).update,
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
    getCapabilities: () => latestCapabilities,
  } as PsychologyRepositoryBundle;
}
