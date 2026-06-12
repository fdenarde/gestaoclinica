import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import type {
  AccessProfile,
  AccessRequestInput,
  AccessRequestRecord,
  ResponsiblePortalData,
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

interface ResponsibleMediaUrlResponse {
  url: string;
  expiresAt: number;
  fileName: string;
}

function createApiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function getToken(user?: User): Promise<string> {
  const currentUser = user || auth.currentUser;
  if (!currentUser) {
    throw createApiError('access/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente.');
  }
  return currentUser.getIdToken();
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
): Promise<T> {
  try {
    const authenticatedUser = user === undefined ? auth.currentUser : user;
    const response = await fetch(`${API_ENDPOINT}${query}`, {
      method,
      headers: {
        ...(authenticatedUser ? { Authorization: `Bearer ${await getToken(authenticatedUser)}` } : {}),
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

export async function getAccessProfile(user?: User): Promise<AccessProfile | null> {
  const result = await request<AccessProfileResponse>('GET', undefined, user);
  return result.profile;
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
): Promise<AccessRequestRecord> {
  const result = await request<AccessRequestResponse>('POST', {
    action: 'reviewAccess',
    requestId,
    decision,
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

export async function getResponsiblePortalData(user?: User): Promise<ResponsiblePortalData> {
  return request<ResponsiblePortalData>('GET', undefined, user, '?mode=responsiblePortal');
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

export async function getResponsibleMediaUrl(
  patientId: string,
  recordId: string,
): Promise<ResponsibleMediaUrlResponse> {
  try {
    const response = await fetch(ACTIVITY_RECORDS_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'getResponsibleFileUrl',
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
