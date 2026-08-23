import { auth } from '../../../firebase';
import type { PsychologyPersistenceScope } from '../scope';
import type {
  PsychologyAttachmentRepository,
  PsychologyDocumentRepository,
  PsychologyFinancialRepository,
  PsychologyRepository,
  PsychologyRepositoryBundle,
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

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'ApiPsychologyError';
    this.code = code;
    this.status = status;
  }
}

type ApiPsychologyRepository<T extends { id: string }> = PsychologyRepository<T> & {
  deleteWithDiagnostic(
    scope: PsychologyPersistenceScope,
    id: string,
    diagnostic?: PsychologyDeleteDiagnosticContext,
  ): Promise<{ id: string } | null>;
};

export interface PsychologyDeleteDiagnosticContext {
  correlationId: string;
}

export type PsychologyDeleteDiagnosticStage =
  | 'confirm_start'
  | 'before_repository'
  | 'before_token'
  | 'token_ok'
  | 'token_error'
  | 'before_fetch'
  | 'fetch_response'
  | 'catch';

export interface PsychologyDeleteDiagnosticEvent {
  DELETE_PATIENT_STAGE: PsychologyDeleteDiagnosticStage;
  correlationId: string;
  method: 'DELETE';
  routeTemplate: '/api/psychology/patients/:id';
  authUserPresent?: 'YES' | 'NO';
  authorizationPresent?: 'YES' | 'NO';
  errorName?: string;
  errorCode?: string;
  httpStatus?: number;
  mutationLockPresent?: 'YES' | 'NO';
  repositoryPresent?: 'YES' | 'NO';
  patientSelectionPresent?: 'YES' | 'NO';
}

const DELETE_DIAGNOSTIC_ROUTE: PsychologyDeleteDiagnosticEvent['routeTemplate'] = '/api/psychology/patients/:id';
const DELETE_DIAGNOSTIC_ENDPOINT = '/api/psychology-delete-diagnostic';

function sanitizeDeleteDiagnosticValue(value: unknown, fallback = 'unknown'): string {
  const sanitized = String(value || '').replace(/[^A-Za-z0-9._:/-]/g, '').slice(0, 80);
  return sanitized || fallback;
}

export function deleteDiagnosticErrorFields(error: unknown): Pick<PsychologyDeleteDiagnosticEvent, 'errorName' | 'errorCode' | 'httpStatus'> {
  const candidate = error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } | null;
  const status = Number(candidate?.status ?? candidate?.statusCode);
  return {
    errorName: sanitizeDeleteDiagnosticValue(candidate?.name),
    ...(candidate?.code ? { errorCode: sanitizeDeleteDiagnosticValue(candidate.code) } : {}),
    ...(Number.isFinite(status) && status > 0 ? { httpStatus: status } : {}),
  };
}

export function createPsychologyDeleteDiagnosticCorrelationId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // The fallback remains opaque and contains no application identifier.
  }
  return `delete-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function logPsychologyDeleteDiagnostic(event: PsychologyDeleteDiagnosticEvent): void {
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[PSYCHOLOGY DELETE DIAGNOSTIC]', event);
  }

  const payload: Record<string, string | number> = {
    DELETE_PATIENT_STAGE: event.DELETE_PATIENT_STAGE,
    correlationId: event.correlationId,
    method: event.method,
    routeTemplate: event.routeTemplate,
  };
  for (const key of [
    'authUserPresent',
    'authorizationPresent',
    'errorName',
    'errorCode',
    'httpStatus',
    'mutationLockPresent',
    'repositoryPresent',
    'patientSelectionPresent',
  ] as const) {
    const value = event[key];
    if (value !== undefined) payload[key] = value;
  }

  try {
    const diagnosticFetch = globalThis.fetch;
    if (typeof diagnosticFetch !== 'function') return;
    const request = diagnosticFetch(DELETE_DIAGNOSTIC_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      credentials: 'omit',
      keepalive: true,
    });
    void Promise.resolve(request).catch(() => undefined);
  } catch {
    // Diagnostic transport failures must never change the delete result.
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
    ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    professionalId: scope.professionalId,
    context: scope.context,
  } as T & PsychologyPersistenceScope;
}

function assertResponseScope(payload: unknown, scope: PsychologyPersistenceScope): void {
  const responseScope = payload && typeof payload === 'object' && 'scope' in payload
    ? (payload as { scope?: Partial<PsychologyPersistenceScope> }).scope
    : undefined;
  if (!responseScope) return;
  if (
    responseScope.workspaceId !== scope.workspaceId
    || (scope.tenantId && responseScope.tenantId !== scope.tenantId)
    || responseScope.professionalId !== scope.professionalId
    || responseScope.context !== scope.context
  ) {
    throw new ApiPsychologyError('psychology/scope-conflict', 'A API retornou dados fora do escopo Psicologia selecionado.', 422);
  }
}

async function readApiResponse<T>(response: Response, scope?: PsychologyPersistenceScope): Promise<T> {
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
  if (scope) assertResponseScope(payload, scope);
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

  async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, idempotencyKey?: string, diagnostic?: PsychologyDeleteDiagnosticContext): Promise<T> {
    const isDiagnosticDelete = method === 'DELETE' && Boolean(diagnostic);
    if (isDiagnosticDelete && diagnostic) {
      logPsychologyDeleteDiagnostic({
        DELETE_PATIENT_STAGE: 'before_token',
        correlationId: diagnostic.correlationId,
        method: 'DELETE',
        routeTemplate: DELETE_DIAGNOSTIC_ROUTE,
        authUserPresent: auth.currentUser ? 'YES' : 'NO',
      });
    }
    let token: string;
    try {
      token = await getToken();
      if (isDiagnosticDelete && diagnostic) {
        logPsychologyDeleteDiagnostic({
          DELETE_PATIENT_STAGE: 'token_ok',
          correlationId: diagnostic.correlationId,
          method: 'DELETE',
          routeTemplate: DELETE_DIAGNOSTIC_ROUTE,
        });
      }
    } catch (error) {
      if (isDiagnosticDelete && diagnostic) {
        logPsychologyDeleteDiagnostic({
          DELETE_PATIENT_STAGE: 'token_error',
          correlationId: diagnostic.correlationId,
          method: 'DELETE',
          routeTemplate: DELETE_DIAGNOSTIC_ROUTE,
          ...deleteDiagnosticErrorFields(error),
        });
      }
      throw error;
    }
    if (isDiagnosticDelete && diagnostic) {
      logPsychologyDeleteDiagnostic({
        DELETE_PATIENT_STAGE: 'before_fetch',
        correlationId: diagnostic.correlationId,
        method: 'DELETE',
        routeTemplate: DELETE_DIAGNOSTIC_ROUTE,
        authorizationPresent: token ? 'YES' : 'NO',
      });
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(method === 'GET' || method === 'DELETE' ? { cache: 'no-store' } : {}),
    });
    if (isDiagnosticDelete && diagnostic) {
      logPsychologyDeleteDiagnostic({
        DELETE_PATIENT_STAGE: 'fetch_response',
        correlationId: diagnostic.correlationId,
        method: 'DELETE',
        routeTemplate: DELETE_DIAGNOSTIC_ROUTE,
        httpStatus: response.status,
      });
    }
    return readApiResponse<T>(response, scope);
  }

  function createApiRepository<K extends PsychologyAggregate>(aggregate: K): ApiPsychologyRepository<PsychologyAggregateRecordMap[K]> {
    type RecordType = PsychologyAggregateRecordMap[K];
    const apiResource = aggregate === 'sessionRecords'
      ? 'session-records'
      : aggregate === 'personalAppointments'
        ? 'personal-appointments'
        : aggregate;
    const responseKey = aggregate === 'settings'
      ? 'settings'
      : aggregate === 'patients'
        ? 'patient'
        : aggregate === 'sessions'
          ? 'session'
          : aggregate === 'services'
            ? 'service'
            : aggregate === 'locations'
              ? 'location'
              : aggregate === 'personalAppointments'
                ? 'personalAppointment'
                : undefined;
    const assertRequestedScope = (requestedScope: PsychologyPersistenceScope): void => {
      if (
        requestedScope.workspaceId !== scope.workspaceId
        || requestedScope.tenantId !== scope.tenantId
        || requestedScope.professionalId !== scope.professionalId
                || requestedScope.context !== scope.context
      ) {
        throw new ApiPsychologyError('psychology/scope-conflict', 'O escopo da requisição não corresponde ao provider.', 422);
      }
    };
    const deleteRecord = async (requestedScope: PsychologyPersistenceScope, id: string, diagnostic?: PsychologyDeleteDiagnosticContext): Promise<{ id: string } | null> => {
      assertRequestedScope(requestedScope);
      const result = await request<{ id?: string; deleted?: boolean }>(`/${apiResource}/${encodeURIComponent(id)}`, 'DELETE', undefined, undefined, diagnostic);
      return result.deleted === false ? null : { id: result.id || id };
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
        const requestBody = aggregate === 'settings' ? { settings: (entity as unknown as { settings?: unknown }).settings || {} } : entity;
        const idempotencyKey = `${aggregate}:${entity.id}:${entity.updatedAt}`;
        const result = await request<Record<string, RecordType | undefined>>(`/${apiResource}`, method, requestBody, idempotencyKey);
        const value = responseKey ? result[responseKey] : undefined;
        if (!value) throw new ApiPsychologyError('psychology/invalid-response', 'A API não retornou o registro salvo.', 500);
        return withScope(clone(value), scope) as RecordType;
      },
      async update(requestedScope, id, patch) {
        assertRequestedScope(requestedScope);
        if (aggregate === 'settings') {
          const result = await request<{ settings?: RecordType }>('/settings', 'PUT', patch);
          return result.settings ? withScope(clone(result.settings), scope) as RecordType : null;
        }
        const result = await request<Record<string, RecordType | undefined>>(`/${apiResource}/${encodeURIComponent(id)}`, 'PATCH', patch);
        const value = responseKey ? result[responseKey] : undefined;
        return value ? withScope(clone(value), scope) as RecordType : null;
      },
      async delete(requestedScope, id) {
        return deleteRecord(requestedScope, id);
      },
      async deleteWithDiagnostic(requestedScope, id, diagnostic) {
        return deleteRecord(requestedScope, id, diagnostic);
      },
    };
  }

  const patients = createApiRepository('patients');
  const sessions = createApiRepository('sessions');
  const sessionRecords = createApiRepository('sessionRecords' as 'sessionRecords');
  const settings = createApiRepository('settings');
  const documents = unsupported<PsychologyDocumentRecord>('documents', scope);
  const attachments = unsupported<PsychologyAttachmentRecord>('attachments', scope);
  const charges = unsupported<PsychologyChargeRecord>('charges', scope);
  const payments = unsupported<PsychologyPaymentRecord>('payments', scope);
  const expenses = unsupported<PsychologyExpenseRecord>('expenses', scope);
  const services = createApiRepository('services');
  const locations = createApiRepository('locations');
  const unsupportedPackage = unsupported<never>('packages', scope);
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
    listPayments: payments.list,
    getPayment: payments.get,
    createPayment: payments.upsert,
    updatePayment: payments.update,
    listExpenses: expenses.list,
    getExpense: expenses.get,
    upsertExpense: expenses.upsert,
    updateExpense: expenses.update,
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
    packages: unsupportedPackage,
    documents: documentQueries(documents),
    attachments: documentQueries(attachments),
    settings,
  } as PsychologyRepositoryBundle;
}
