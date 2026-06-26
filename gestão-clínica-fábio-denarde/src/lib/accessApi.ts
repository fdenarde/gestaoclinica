import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import type {
  AccessProfile,
  AccessRequestInput,
  AccessRequestRecord,
  ResponsiblePortalActionResult,
  ResponsiblePortalClientContext,
  ResponsiblePortalPlaybackSummary,
  ResponsiblePortalData,
  ResponsiblePortalDocument,
  ResponsiblePortalEventType,
  ResponsiblePortalPatient,
  ResponsiblePortalPatientUpdateInput,
  PatientProfileChangeRequest,
  ProfessionalPortalNotification,
  ProfessionalNotificationAction,
  ProfessionalNotificationBulkScope,
  MonitoringPanelData,
  MonitoringNotificationActionResult,
  MonitoringNotificationTab,
  DirectAccessCreateInput,
  DirectAccessCredentialsResult,
  DirectAccessPasswordResetResult,
  DirectAccessUsernameUpdateResult,
} from '../types/access';

const API_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/access'
    : '/api/access';

const ACTIVITY_RECORDS_API_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/activity-records'
    : '/api/activity-records';

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

interface RequestOptions {
  forceRefreshToken?: boolean;
  activeRole?: AccessProfile['role'] | null;
}

interface AccessProfileResponse {
  profile: AccessProfile | null;
}

interface AccessRequestResponse {
  request: AccessRequestRecord;
  profile: AccessProfile | null;
}

interface AccessRequestsResponse {
  requests: AccessRequestRecord[];
}

interface DeleteAccessRegistrationResponse {
  deleted: true;
  requestId: string;
  role: AccessProfile['role'];
}

export interface ProfessionalPortalNotificationsResponse {
  notifications: ProfessionalPortalNotification[];
  cursor: string | null;
  nextPageCursor: string | null;
  incremental: boolean;
  hasMore: boolean;
}

export interface ProfessionalNotificationManageResponse {
  updated: number;
  deleted: number;
  affectedIds: string[];
  deletedIds: string[];
  skippedIds: string[];
  hasMore: boolean;
}

interface ResponsibleMediaUrlResponse {
  url: string;
  expiresAt: number;
  fileName: string;
}

interface ResponsiblePatientPhotoUrlResponse {
  url: string;
  expiresAt: number;
}

interface ResponsiblePatientUpdateResponse {
  submitted: boolean;
  existingPending: boolean;
  patient: ResponsiblePortalPatient;
  changedFields: string[];
  request: PatientProfileChangeRequest | null;
}

interface PatientProfileChangeRequestsResponse {
  requests: PatientProfileChangeRequest[];
}

interface PatientProfileChangeReviewResponse {
  request: PatientProfileChangeRequest;
  patient: ResponsiblePortalPatient | null;
}

interface ResponsibleDocumentPrepareResponse {
  documentId: string;
  uploadUrl: string;
}

interface ResponsibleDocumentFinalizeResponse {
  document: ResponsiblePortalDocument;
}

interface ResponsibleDocumentUrlResponse {
  url: string;
  expiresAt: number;
  fileName: string;
}

export interface AdminResponsiblePreviewOption {
  uid: string;
  displayName: string;
  username: string;
  accountLabel: string;
  email: string;
}

export interface AdminResponsiblePreviewMeta {
  readOnly: true;
  patientId: string;
  selectedResponsibleUid: string;
  responsibleOptions: AdminResponsiblePreviewOption[];
  hasLinkedResponsible: boolean;
}

export interface AdminResponsiblePortalData extends ResponsiblePortalData {
  adminPreview: AdminResponsiblePreviewMeta;
}


const accessProfileRequests = new Map<string, Promise<AccessProfile | null>>();
const accessProfileBackoffByUid = new Map<string, {
  until: number;
  error: Error & { code: string };
}>();
const ACCESS_PROFILE_QUOTA_BACKOFF_MS = 60 * 1000;
const MONITORING_PANEL_CACHE_MS = 60 * 1000;
const monitoringPanelCache = new Map<string, { value: MonitoringPanelData; expiresAt: number }>();
const monitoringPanelRequests = new Map<string, Promise<MonitoringPanelData>>();

export function clearAccessApiCaches(): void {
  accessProfileRequests.clear();
  accessProfileBackoffByUid.clear();
  monitoringPanelCache.clear();
  monitoringPanelRequests.clear();
}

function getResponsiblePortalSessionId(user?: User): string {
  const currentUser = user || auth.currentUser;
  const uid = currentUser?.uid || 'anonymous';
  const storageKey = `responsible-portal-session:${uid}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return `${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}


function monitoringSessionStorageKey(user?: User): string {
  const currentUser = user || auth.currentUser;
  return `monitoring-session:${currentUser?.uid || 'anonymous'}`;
}

function getMonitoringSessionId(user?: User): string {
  const currentUser = user || auth.currentUser;
  const uid = currentUser?.uid || 'anonymous';
  const storageKey = monitoringSessionStorageKey(currentUser || undefined);
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return `${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function clearMonitoringSessionId(user?: User): void {
  try {
    window.sessionStorage.removeItem(monitoringSessionStorageKey(user));
  } catch {
    // A sessão também é encerrada normalmente quando o armazenamento não está disponível.
  }
}

function monitoringClientContext(tab: MonitoringNotificationTab | 'monitoring') {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { portalTab: tab, actionLocation: `Monitoramento / ${tab}` };
  }
  return {
    portalTab: tab,
    actionLocation: tab === 'monitoring' ? 'Monitoramento / Entrada' : `Monitoramento / ${tab}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    platform: navigator.platform,
  };
}

function inferResponsibleDocumentMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function createApiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function getToken(user?: User, forceRefreshToken = false): Promise<string> {
  const currentUser = user || auth.currentUser;
  if (!currentUser) {
    throw createApiError('access/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente.');
  }
  return currentUser.getIdToken(forceRefreshToken);
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: T & ApiErrorPayload;
  try {
    payload = await response.json();
  } catch {
    throw createApiError('access/invalid-response', 'O servidor retornou uma resposta inválida.');
  }

  if (!response.ok) {
    throw createApiError(
      payload.error?.code || 'access/request-failed',
      payload.error?.message || 'Não foi possível concluir a solicitação.',
    );
  }

  return payload;
}

async function request<T>(
  method: 'GET' | 'POST',
  body?: unknown,
  user?: User | null,
  query = '',
  options: RequestOptions = {},
): Promise<T> {
  try {
    const authenticatedUser = user === undefined ? auth.currentUser : user;
    const response = await fetch(`${API_ENDPOINT}${query}`, {
      method,
      headers: {
        ...(authenticatedUser ? { Authorization: `Bearer ${await getToken(authenticatedUser, options.forceRefreshToken)}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
    });
    return readResponse<T>(response);
  } catch (error) {
    if ((error as { code?: string } | null)?.code) throw error;
    throw createApiError(
      'access/network-error',
      'Não foi possível consultar a autorização de acesso. Verifique sua conexão e tente novamente.',
    );
  }
}

export async function getAccessProfile(user?: User, options: RequestOptions = {}): Promise<AccessProfile | null> {
  const currentUser = user || auth.currentUser;
  const userKey = currentUser?.uid || 'missing-user';
  const requestKey = `${userKey}:${options.forceRefreshToken ? 'refresh' : 'default'}:${options.activeRole || 'selector'}`;
  const backoff = accessProfileBackoffByUid.get(userKey);
  if (backoff && backoff.until > Date.now()) throw backoff.error;
  if (backoff) accessProfileBackoffByUid.delete(userKey);

  const existingRequest = accessProfileRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  let profileRequest: Promise<AccessProfile | null>;
  const query = options.activeRole ? `?activeRole=${encodeURIComponent(options.activeRole)}` : '';
  profileRequest = request<AccessProfileResponse>('GET', undefined, user, query, options)
    .then(result => {
      accessProfileBackoffByUid.delete(userKey);
      return result.profile;
    })
    .catch(error => {
      const apiError = error as Error & { code?: string };
      if (apiError.code === 'access/quota-temporarily-unavailable') {
        accessProfileBackoffByUid.set(userKey, {
          until: Date.now() + ACCESS_PROFILE_QUOTA_BACKOFF_MS,
          error: createApiError(
            'access/quota-temporarily-unavailable',
            'O serviço de acesso está temporariamente indisponível. Aguarde um minuto e tente novamente.',
          ),
        });
      }
      throw error;
    })
    .finally(() => {
      if (accessProfileRequests.get(requestKey) === profileRequest) {
        accessProfileRequests.delete(requestKey);
      }
    });
  accessProfileRequests.set(requestKey, profileRequest);
  return profileRequest;
}

export async function submitAccessRequest(
  input: AccessRequestInput,
  user: User | null,
): Promise<AccessRequestResponse> {
  return request<AccessRequestResponse>('POST', { action: 'requestAccess', ...input }, user);
}

export async function listAccessRequests(): Promise<AccessRequestRecord[]> {
  const result = await request<AccessRequestsResponse>('GET', undefined, undefined, '?mode=requests');
  return result.requests;
}

export async function reviewAccessRequest(
  requestId: string,
  decision: 'approve' | 'reject',
  options: { expiresAt?: string | null } = {},
): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'reviewAccess',
    requestId,
    decision,
    ...options,
  });
  return result.request;
}

export async function revokeAccessRequest(requestId: string): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'revokeAccess',
    requestId,
  });
  return result.request;
}

export async function deleteAccessRegistration(
  requestId: string,
  confirmation: string,
): Promise<DeleteAccessRegistrationResponse> {
  return request<DeleteAccessRegistrationResponse>('POST', {
    action: 'deleteAccessRegistration',
    requestId,
    confirmation,
  });
}

export async function linkResponsiblePatient(
  requestId: string,
  patientId: string,
): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'linkResponsiblePatient',
    requestId,
    patientId,
  });
  return result.request;
}

export async function suspendAccessRequest(
  requestId: string,
  suspensionReason = '',
): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'suspendAccess',
    requestId,
    suspensionReason,
  });
  return result.request;
}

export async function reactivateAccessRequest(requestId: string): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'reactivateAccess',
    requestId,
  });
  return result.request;
}

export async function updateAccessValidity(
  requestId: string,
  expiresAt: string | null,
): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'updateAccessValidity',
    requestId,
    expiresAt,
  });
  return result.request;
}

export async function requestAdditionalAccessInformation(
  requestId: string,
  message: string,
): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'requestAdditionalInformation',
    requestId,
    message,
  });
  return result.request;
}

export async function respondAdditionalAccessInformation(
  responseMessage: string,
  user: User | null,
): Promise<AccessRequestResponse> {
  return request<AccessRequestResponse>('POST', {
    action: 'respondAdditionalInformation',
    responseMessage,
  }, user);
}


export async function createDirectAccess(
  input: DirectAccessCreateInput,
): Promise<DirectAccessCredentialsResult> {
  return request<DirectAccessCredentialsResult>('POST', {
    action: 'createDirectAccess',
    ...input,
  });
}

export async function resetDirectAccessPassword(
  requestId: string,
  password?: string,
): Promise<DirectAccessPasswordResetResult> {
  return request<DirectAccessPasswordResetResult>('POST', {
    action: 'resetDirectAccessPassword',
    requestId,
    ...(password ? { password } : {}),
  });
}

export async function updateDirectAccessUsername(
  requestId: string,
  username: string,
): Promise<DirectAccessUsernameUpdateResult> {
  return request<DirectAccessUsernameUpdateResult>('POST', {
    action: 'updateDirectAccessUsername',
    requestId,
    username,
  });
}

export async function completePasswordChange(
  activeRole: AccessProfile['role'],
  user?: User,
): Promise<AccessProfile> {
  const result = await request<AccessProfileResponse>('POST', {
    action: 'completePasswordChange',
    activeRole,
  }, user);
  if (!result.profile) {
    throw createApiError('access/profile-not-found', 'Não foi possível atualizar o estado da senha.');
  }
  clearAccessApiCaches();
  return result.profile;
}


export async function getProfessionalPortalNotifications(options: {
  updatedAfter?: string | null;
  before?: string | null;
  limit?: number;
} = {}): Promise<ProfessionalPortalNotificationsResponse> {
  const params = new URLSearchParams({ mode: 'professionalNotifications' });
  if (options.updatedAfter) params.set('updatedAfter', options.updatedAfter);
  if (options.before) params.set('before', options.before);
  if (options.limit) params.set('limit', String(options.limit));
  return request<ProfessionalPortalNotificationsResponse>(
    'GET',
    undefined,
    undefined,
    `?${params.toString()}`,
  );
}

export async function manageProfessionalPortalNotifications(input: {
  operation: ProfessionalNotificationAction;
  notificationIds?: string[];
  scope?: ProfessionalNotificationBulkScope;
}): Promise<ProfessionalNotificationManageResponse> {
  return request<ProfessionalNotificationManageResponse>('POST', {
    action: 'manageProfessionalNotifications',
    ...input,
  });
}

export async function markProfessionalPortalNotificationsRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  await manageProfessionalPortalNotifications({
    operation: 'mark_read',
    notificationIds,
  });
}

export async function getResponsiblePortalData(user?: User): Promise<ResponsiblePortalData> {
  const params = new URLSearchParams({
    mode: 'responsiblePortal',
    portalSessionId: getResponsiblePortalSessionId(user),
  });
  return request<ResponsiblePortalData>('GET', undefined, user, `?${params.toString()}`);
}

export async function getAdminResponsiblePortalData(
  patientId: string,
  responsibleUid = '',
  user?: User,
): Promise<AdminResponsiblePortalData> {
  const params = new URLSearchParams({
    mode: 'adminResponsiblePreview',
    patientId,
  });
  if (responsibleUid) params.set('responsibleUid', responsibleUid);
  return request<AdminResponsiblePortalData>('GET', undefined, user, `?${params.toString()}`);
}

export async function getMonitoringPanelData(options: {
  adminPreview?: boolean;
  weekStart?: string;
  weekEnd?: string;
  user?: User;
} = {}): Promise<MonitoringPanelData> {
  const currentUser = options.user || auth.currentUser;
  const cacheKey = [
    currentUser?.uid || 'anonymous',
    options.adminPreview ? 'admin-preview' : 'monitoring',
    options.weekStart || '',
    options.weekEnd || '',
  ].join(':');
  const cached = monitoringPanelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = monitoringPanelRequests.get(cacheKey);
  if (existing) return existing;

  const params = new URLSearchParams({ mode: 'monitoringPanel' });
  if (options.adminPreview) params.set('adminPreview', '1');
  if (options.weekStart) params.set('weekStart', options.weekStart);
  if (options.weekEnd) params.set('weekEnd', options.weekEnd);
  const pending = request<MonitoringPanelData>('GET', undefined, options.user, `?${params.toString()}`)
    .then(value => {
      monitoringPanelCache.set(cacheKey, { value, expiresAt: Date.now() + MONITORING_PANEL_CACHE_MS });
      return value;
    })
    .finally(() => {
      monitoringPanelRequests.delete(cacheKey);
    });
  monitoringPanelRequests.set(cacheKey, pending);
  return pending;
}

export async function recordMonitoringSessionStart(user?: User): Promise<MonitoringNotificationActionResult> {
  return request<MonitoringNotificationActionResult>('POST', {
    action: 'recordMonitoringAction',
    eventType: 'session_start',
    monitoringSessionId: getMonitoringSessionId(user),
    clientContext: monitoringClientContext('monitoring'),
  }, user);
}

export async function recordMonitoringTabAccess(
  tab: MonitoringNotificationTab,
  user?: User,
): Promise<MonitoringNotificationActionResult> {
  return request<MonitoringNotificationActionResult>('POST', {
    action: 'recordMonitoringAction',
    eventType: 'tab_access',
    monitoringSessionId: getMonitoringSessionId(user),
    tab,
    clientContext: monitoringClientContext(tab),
  }, user);
}

export async function recordResponsiblePortalAction(input: {
  eventType: ResponsiblePortalEventType;
  patientId: string;
  patientName?: string;
  recordId?: string;
  comment?: string;
  clientContext?: ResponsiblePortalClientContext;
  playback?: ResponsiblePortalPlaybackSummary;
  interactionSessionId?: string;
}): Promise<ResponsiblePortalActionResult> {
  return request<ResponsiblePortalActionResult>('POST', {
    action: 'recordResponsibleAction',
    portalSessionId: getResponsiblePortalSessionId(),
    ...input,
  });
}

function normalizeMediaUrl(url: string): string {
  if (typeof window === 'undefined' || !url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    const returnedLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (returnedLocal && !['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) {
      return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (returnedLocal && window.location.port === '3000') {
      return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}


export async function getResponsiblePatientPhotoUrl(
  patientId: string,
  options: { adminPreview?: boolean } = {},
): Promise<ResponsiblePatientPhotoUrlResponse> {
  const result = await request<ResponsiblePatientPhotoUrlResponse>('POST', {
    action: options.adminPreview
      ? 'getAdminResponsiblePatientPhotoUrl'
      : 'getResponsiblePatientPhotoUrl',
    patientId,
  });
  return { ...result, url: normalizeMediaUrl(result.url) };
}

export async function requestResponsiblePatientUpdate(
  patientId: string,
  values: ResponsiblePortalPatientUpdateInput,
  declarationAccepted: boolean,
  clientContext?: ResponsiblePortalClientContext,
): Promise<ResponsiblePatientUpdateResponse> {
  return request<ResponsiblePatientUpdateResponse>('POST', {
    action: 'requestResponsiblePatientUpdate',
    patientId,
    values,
    declarationAccepted,
    clientContext,
  });
}

export async function getProfessionalPatientProfileChangeRequests(
  patientId: string,
): Promise<PatientProfileChangeRequest[]> {
  const params = new URLSearchParams({
    action: 'listPatientProfileChangeRequests',
    patientId,
  });
  const result = await request<PatientProfileChangeRequestsResponse>('GET', undefined, undefined, `?${params.toString()}`);
  return result.requests;
}

export async function reviewPatientProfileChangeRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  rejectionReason = '',
): Promise<PatientProfileChangeReviewResponse> {
  return request<PatientProfileChangeReviewResponse>('POST', {
    action: 'reviewPatientProfileChangeRequest',
    requestId,
    decision,
    rejectionReason,
  });
}

export async function uploadResponsibleDocument(input: {
  patientId: string;
  file: File;
  category: string;
  note: string;
  clientContext?: ResponsiblePortalClientContext;
}): Promise<ResponsiblePortalDocument> {
  const prepared = await request<ResponsibleDocumentPrepareResponse>('POST', {
    action: 'prepareResponsibleDocumentUpload',
    patientId: input.patientId,
    fileName: input.file.name,
    mimeType: inferResponsibleDocumentMimeType(input.file),
    sizeBytes: input.file.size,
    category: input.category,
    note: input.note,
    clientContext: input.clientContext,
  });

  const uploadResponse = await fetch(prepared.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': inferResponsibleDocumentMimeType(input.file),
    },
    body: input.file,
  });
  if (!uploadResponse.ok) {
    throw createApiError('access/document-upload-failed', 'O Google Drive não confirmou o envio do documento.');
  }
  const driveFile = await uploadResponse.json().catch(() => null) as { id?: string } | null;
  if (!driveFile?.id) {
    throw createApiError('access/document-upload-incomplete', 'O documento foi enviado, mas não pôde ser confirmado.');
  }

  const finalized = await request<ResponsibleDocumentFinalizeResponse>('POST', {
    action: 'finalizeResponsibleDocumentUpload',
    patientId: input.patientId,
    documentId: prepared.documentId,
    driveFileId: driveFile.id,
    clientContext: input.clientContext,
  });
  return finalized.document;
}

export async function getResponsibleDocumentUrl(
  patientId: string,
  documentId: string,
  options: { adminPreview?: boolean } = {},
): Promise<ResponsibleDocumentUrlResponse> {
  const result = await request<ResponsibleDocumentUrlResponse>('POST', {
    action: options.adminPreview
      ? 'getProfessionalResponsibleDocumentUrl'
      : 'getResponsibleDocumentUrl',
    patientId,
    documentId,
  });
  return { ...result, url: normalizeMediaUrl(result.url) };
}

export async function getProfessionalResponsibleDocumentUrl(
  patientId: string,
  documentId: string,
): Promise<ResponsibleDocumentUrlResponse> {
  const result = await request<ResponsibleDocumentUrlResponse>('POST', {
    action: 'getProfessionalResponsibleDocumentUrl',
    patientId,
    documentId,
  });
  return { ...result, url: normalizeMediaUrl(result.url) };
}

export async function getResponsibleMediaUrl(
  patientId: string,
  recordId: string,
  options: { adminPreview?: boolean } = {},
): Promise<ResponsibleMediaUrlResponse> {
  try {
    const response = await fetch(ACTIVITY_RECORDS_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: options.adminPreview
          ? 'getAdminResponsiblePreviewFileUrl'
          : 'getResponsibleFileUrl',
        patientId,
        recordId,
      }),
    });
    const result = await readResponse<ResponsibleMediaUrlResponse>(response);
    return { ...result, url: normalizeMediaUrl(result.url) };
  } catch (error) {
    if ((error as { code?: string } | null)?.code) throw error;
    throw createApiError(
      'access/media-network-error',
      'Não foi possível carregar a mídia autorizada. Verifique sua conexão e tente novamente.',
    );
  }
}
