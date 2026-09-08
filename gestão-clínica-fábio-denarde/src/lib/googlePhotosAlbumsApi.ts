import { auth } from '../firebase';
import type {
  CreateGooglePhotosAlbumInput,
  CreateGooglePhotosAlbumResponse,
  GooglePhotosAlbumPackageInput,
  GooglePhotosAlbumsResponse,
} from '../types/googlePhotosAlbums';
import { buildGooglePhotosAlbumPackageKey } from '../../shared/googlePhotosAlbums.js';

const API_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/google-photos-albums'
    : '/api/google-photos-albums';

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

const responseCache = new Map<string, GooglePhotosAlbumsResponse>();
const responseCacheMeta = new Map<string, {
  profileKey: string;
  ownerUserId: string;
  patientId: string;
  packageKey: string;
  scope: 'manage' | 'portal';
}>();
const responseCacheIndex = new Map<string, string>();
const responseInFlight = new Map<string, Promise<GooglePhotosAlbumsResponse>>();
const responseInFlightMeta = new Map<string, {
  patientId: string;
  packageKey: string;
  scope: 'manage' | 'portal';
}>();
export const GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT = 'googlePhotosAlbums:packageChanged';

function createApiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function getToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw createApiError('google-photos-albums/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente.');
  return user.getIdToken();
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: T & ApiErrorPayload;
  try {
    payload = await response.json();
  } catch {
    throw createApiError('google-photos-albums/invalid-response', 'O servidor retornou uma resposta inválida.');
  }
  if (!response.ok) {
    throw createApiError(
      payload.error?.code || 'google-photos-albums/request-failed',
      payload.error?.message || 'Não foi possível concluir a operação.',
    );
  }
  return payload;
}

async function request<T>(method: 'GET' | 'POST', query = '', body?: unknown): Promise<T> {
  try {
    const response = await fetch(`${API_ENDPOINT}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
    });
    return readResponse<T>(response);
  } catch (error) {
    if ((error as { code?: string } | null)?.code) throw error;
    throw createApiError(
      'google-photos-albums/network-error',
      'Não foi possível acessar os cards da galeria. Verifique sua conexão e tente novamente.',
    );
  }
}

const buildPackageKey = buildGooglePhotosAlbumPackageKey as (options: {
  patientId: string;
  packageNumber: number;
}) => string;

function currentProfileKey(): string {
  return auth.currentUser?.uid || 'anonymous';
}

function lookupCacheKey(patientId: string, packageNumber: number, scope: 'manage' | 'portal'): string {
  return [
    currentProfileKey(),
    scope,
    patientId,
    buildPackageKey({ patientId, packageNumber }),
  ].join(':');
}

function storageCacheKey(options: {
  ownerUserId?: string;
  patientId: string;
  packageNumber: number;
  packageKey?: string;
  scope: 'manage' | 'portal';
}): string {
  const packageKey = options.packageKey || buildPackageKey({
    patientId: options.patientId,
    packageNumber: options.packageNumber,
  });
  return [
    currentProfileKey(),
    options.scope,
    options.ownerUserId || 'owner:unknown',
    options.patientId,
    packageKey,
  ].join(':');
}

function storeGooglePhotosAlbumsCache(
  options: {
    patientId: string;
    packageNumber: number;
    scope: 'manage' | 'portal';
  },
  value: GooglePhotosAlbumsResponse,
): void {
  const packageKey = value.packageKey || buildPackageKey(options);
  const key = storageCacheKey({
    ownerUserId: value.ownerUserId,
    patientId: options.patientId,
    packageNumber: options.packageNumber,
    packageKey,
    scope: options.scope,
  });
  responseCache.set(key, value);
  responseCacheMeta.set(key, {
    profileKey: currentProfileKey(),
    ownerUserId: value.ownerUserId || 'owner:unknown',
    patientId: options.patientId,
    packageKey,
    scope: options.scope,
  });
  responseCacheIndex.set(lookupCacheKey(options.patientId, options.packageNumber, options.scope), key);
}

export function invalidateGooglePhotosAlbumsCache(options?: {
  ownerUserId?: string;
  patientId?: string;
  packageNumber?: number;
  packageKey?: string;
  scope?: 'manage' | 'portal';
}): void {
  if (!options?.patientId) {
    responseCache.clear();
    responseCacheMeta.clear();
    responseCacheIndex.clear();
    responseInFlight.clear();
    responseInFlightMeta.clear();
    return;
  }
  const packageKey = options.packageKey || (options.packageNumber
    ? buildPackageKey({ patientId: options.patientId, packageNumber: options.packageNumber })
    : '');
  const keysToDelete: string[] = [];
  for (const [key, meta] of responseCacheMeta.entries()) {
    const ownerMatches = !options.ownerUserId || meta.ownerUserId === options.ownerUserId;
    const patientMatches = meta.patientId === options.patientId;
    const packageMatches = !packageKey || meta.packageKey === packageKey;
    const scopeMatches = !options.scope || meta.scope === options.scope;
    if (ownerMatches && patientMatches && packageMatches && scopeMatches) keysToDelete.push(key);
  }
  for (const key of keysToDelete) {
    responseCache.delete(key);
    responseCacheMeta.delete(key);
    for (const [lookupKey, storageKey] of responseCacheIndex.entries()) {
      if (storageKey === key) responseCacheIndex.delete(lookupKey);
    }
  }
  for (const [lookupKey, meta] of responseInFlightMeta.entries()) {
    const packageMatches = !packageKey || meta.packageKey === packageKey;
    const scopeMatches = !options.scope || meta.scope === options.scope;
    if (meta.patientId === options.patientId && packageMatches && scopeMatches) {
      responseInFlight.delete(lookupKey);
      responseInFlightMeta.delete(lookupKey);
    }
  }
}

function emitGooglePhotosAlbumsChanged(value: GooglePhotosAlbumsResponse, patientId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT, {
    detail: {
      ownerUserId: value.ownerUserId,
      patientId,
      packageKey: value.packageKey,
      packageNumber: value.packageNumber,
      scope: value.scope,
    },
  }));
}

export function getGooglePhotosAlbumsCacheSize(): number {
  return responseCache.size;
}

export function resetGooglePhotosAlbumsCacheForTests(): void {
  responseCache.clear();
  responseCacheMeta.clear();
  responseCacheIndex.clear();
  responseInFlight.clear();
  responseInFlightMeta.clear();
}

export function getGooglePhotosAlbumsCachedPackageKeysForTests(): string[] {
  return [...responseCacheMeta.values()].map(meta => `${meta.profileKey}:${meta.ownerUserId}:${meta.scope}:${meta.patientId}:${meta.packageKey}`).sort();
}

function readCachedGooglePhotosAlbums(patientId: string, packageNumber: number, scope: 'manage' | 'portal') {
  const indexedKey = responseCacheIndex.get(lookupCacheKey(patientId, packageNumber, scope));
  if (!indexedKey) return null;
  return responseCache.get(indexedKey) || null;
}

declare global {
  interface WindowEventMap {
    [GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT]: CustomEvent<{
      ownerUserId?: string;
      patientId: string;
      packageKey: string;
      packageNumber: number;
      scope: 'manage' | 'portal';
    }>;
  }
}

export async function listGooglePhotosAlbums(options: {
  patientId: string;
  packageNumber: number;
  scope?: 'manage' | 'portal';
  force?: boolean;
}): Promise<GooglePhotosAlbumsResponse> {
  const scope = options.scope === 'portal' ? 'portal' : 'manage';
  const cached = readCachedGooglePhotosAlbums(options.patientId, options.packageNumber, scope);
  if (!options.force && cached) return cached;

  const cacheLookupKey = lookupCacheKey(options.patientId, options.packageNumber, scope);
  const currentRequest = responseInFlight.get(cacheLookupKey);
  if (currentRequest) return currentRequest;

  const params = new URLSearchParams({
    patientId: options.patientId,
    packageNumber: String(options.packageNumber),
    scope,
  });
  let requestPromise: Promise<GooglePhotosAlbumsResponse>;
  requestPromise = request<GooglePhotosAlbumsResponse>('GET', `?${params.toString()}`)
    .then(value => {
      if (responseInFlight.get(cacheLookupKey) === requestPromise) {
        storeGooglePhotosAlbumsCache({ patientId: options.patientId, packageNumber: options.packageNumber, scope }, value);
      }
      return value;
    });
  responseInFlight.set(cacheLookupKey, requestPromise);
  responseInFlightMeta.set(cacheLookupKey, {
    patientId: options.patientId,
    packageKey: buildPackageKey({ patientId: options.patientId, packageNumber: options.packageNumber }),
    scope,
  });
  try {
    return await requestPromise;
  } finally {
    if (responseInFlight.get(cacheLookupKey) === requestPromise) {
      responseInFlight.delete(cacheLookupKey);
      responseInFlightMeta.delete(cacheLookupKey);
    }
  }
}

export async function saveGooglePhotosAlbumPackage(
  payload: GooglePhotosAlbumPackageInput,
): Promise<GooglePhotosAlbumsResponse> {
  const result = await request<GooglePhotosAlbumsResponse>('POST', '', {
    action: 'savePackage',
    package: payload,
  });
  invalidateGooglePhotosAlbumsCache({
    ownerUserId: result.ownerUserId,
    patientId: payload.patientId,
    packageNumber: payload.packageNumber,
    packageKey: result.packageKey,
  });
  storeGooglePhotosAlbumsCache({ patientId: payload.patientId, packageNumber: payload.packageNumber, scope: 'manage' }, result);
  emitGooglePhotosAlbumsChanged(result, payload.patientId);
  return result;
}


export async function createGooglePhotosAlbum(
  payload: CreateGooglePhotosAlbumInput,
): Promise<CreateGooglePhotosAlbumResponse> {
  const result = await request<CreateGooglePhotosAlbumResponse>('POST', '', {
    action: 'createAlbum',
    album: payload,
  });
  invalidateGooglePhotosAlbumsCache({
    ownerUserId: result.ownerUserId,
    patientId: payload.patientId,
    packageNumber: payload.packageNumber,
    packageKey: result.packageKey,
  });
  storeGooglePhotosAlbumsCache({
    patientId: payload.patientId,
    packageNumber: payload.packageNumber,
    scope: 'manage',
  }, result);
  emitGooglePhotosAlbumsChanged(result, payload.patientId);
  return result;
}

export async function listGooglePhotosAlbumPatientOptions(): Promise<Array<{ id: string; name: string }>> {
  const result = await request<{ patients: Array<{ id: string; name: string }> }>('GET', '?mode=patients');
  return result.patients;
}

export async function listGooglePhotosAlbumSessionOptions(patientId: string): Promise<Array<{
  id: string;
  patientId: string;
  date: string;
  time: string;
  type: string;
  status: string;
  packageNumber: number | null;
  isBlocked: boolean;
  consumesPackage?: boolean;
  packageConsumptionDecisionRecorded?: boolean;
  source?: string;
}>> {
  const params = new URLSearchParams({ mode: 'sessions', patientId });
  const result = await request<{ sessions: Array<{
    id: string;
    patientId: string;
    date: string;
    time: string;
    type: string;
    status: string;
    packageNumber: number | null;
    isBlocked: boolean;
    consumesPackage?: boolean;
    packageConsumptionDecisionRecorded?: boolean;
    source?: string;
  }> }>('GET', `?${params.toString()}`);
  return result.sessions;
}
