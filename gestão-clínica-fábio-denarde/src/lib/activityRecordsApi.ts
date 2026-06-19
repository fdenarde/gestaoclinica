import { auth } from '../firebase';
import type { Patient, Session } from '../types';
import type { ActivityRecord, ActivityRecordCategory, ActivityRecordVisibility } from '../types/activityRecords';
import type { ActivityGalleryAuditEntry, ActivityGalleryJustificationReason, ActivityGalleryStatusRecord, ProfessionalActivityGalleryFilters, ProfessionalActivityGalleryResponse } from '../types/activityGallery';
import {
  ACTIVITY_DIRECT_UPLOAD_CHUNK_BYTES,
  ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES,
  MAX_ACTIVITY_VIDEO_CHUNK_BYTES,
} from '../../shared/activityMediaLimits.js';
import { isActivityMediaFileReadError, sanitizeActivityMediaErrorMessage } from './activityMediaQueue.js';

export const ACTIVITY_UPLOAD_TIMEOUT_MS = 45_000;
const VIDEO_CHUNK_REQUEST_TIMEOUT_MS = 90_000;
const VIDEO_CHUNK_MAX_ATTEMPTS = 3;
const DIRECT_UPLOAD_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DIRECT_UPLOAD_MAX_ATTEMPTS = 1;
const PROXY_UPLOAD_MAX_ATTEMPTS = 3;
const PROXY_UPLOAD_REQUEST_TIMEOUT_MS = 3 * 60_000;
const ACTIVE_UPLOADS = new Map<string, { abort: () => void; patientId: string }>();
const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
const ACTIVITY_RECORD_LIST_CACHE_TTL_MS = 60_000;
const ACTIVITY_GALLERY_CACHE_TTL_MS = 30_000;
const ACTIVITY_GALLERY_SUMMARY_CACHE_TTL_MS = 5 * 60_000;

type TimedCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const activityRecordListCache = new Map<string, TimedCacheEntry<ActivityRecord[]>>();
const activityRecordListInFlight = new Map<string, Promise<ActivityRecord[]>>();
const activityGalleryCache = new Map<string, TimedCacheEntry<ProfessionalActivityGalleryResponse>>();
const activityGalleryInFlight = new Map<string, Promise<ProfessionalActivityGalleryResponse>>();
let activityGallerySummaryCache: (TimedCacheEntry<ProfessionalActivityGalleryResponse> & { scope: string }) | null = null;
let activityGallerySummaryInFlight: { scope: string; request: Promise<ProfessionalActivityGalleryResponse> } | null = null;

export const ACTIVITY_RECORDS_CHANGED_EVENT = 'activity-records:changed';
export const ACTIVITY_GALLERY_CHANGED_EVENT = 'activity-gallery:changed';

function currentActivityUserScope(): string {
  return auth.currentUser?.uid || 'anonymous';
}

function invalidateActivityCaches(patientId?: string): void {
  if (patientId) {
    const marker = `:${patientId}:`;
    for (const key of activityRecordListCache.keys()) {
      if (key.includes(marker)) activityRecordListCache.delete(key);
    }
  } else {
    activityRecordListCache.clear();
  }
  activityGalleryCache.clear();
  activityGallerySummaryCache = null;
}

function notifyActivityRecordsChanged(patientId: string): void {
  invalidateActivityCaches(patientId);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACTIVITY_RECORDS_CHANGED_EVENT, { detail: { patientId } }));
  window.dispatchEvent(new CustomEvent(ACTIVITY_GALLERY_CHANGED_EVENT, { detail: { patientId } }));
}

const API_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/activity-records'
    : '/api/activity-records';

const ACTIVITY_UPLOAD_CHUNK_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/activity-upload-chunk'
    : '/api/activity-upload-chunk';

interface ApiErrorPayload { error?: { code?: string; message?: string } }
export type ActivityUploadDiagnosticEvent =
  | { event: 'chunk-read-start'; chunkIndex: number; start: number; end: number }
  | { event: 'chunk-read-confirmed'; chunkIndex: number; start: number; end: number }
  | { event: 'chunk-upload-start'; chunkIndex: number; start: number; end: number; attempt: number }
  | { event: 'chunk-upload-confirmed'; chunkIndex: number; nextOffset: number }
  | { event: 'upload-offset-recovered'; nextOffset: number }
  | { event: 'upload-response-recovered' };

function createApiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function getToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw createApiError('activity-records/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente.');
  try {
    return await user.getIdToken();
  } catch {
    throw createApiError('activity-records/authentication-failed', 'Não foi possível validar sua sessão. Entre novamente.');
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: T & ApiErrorPayload;
  try { payload = await response.json(); }
  catch { throw createApiError('activity-records/invalid-response', 'O servidor retornou uma resposta inválida.'); }
  if (!response.ok) throw createApiError(payload.error?.code || 'activity-records/request-failed', payload.error?.message || 'Não foi possível concluir a operação.');
  return payload;
}

const BASE64_BINARY_BLOCK_BYTES = 32 * 1024;
const VIDEO_CHUNK_READ_MAX_ATTEMPTS = 3;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_BINARY_BLOCK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + BASE64_BINARY_BLOCK_BYTES)));
  }
  return window.btoa(binary);
}

async function blobToBase64(blob: Blob, errorMessage: string): Promise<string> {
  try {
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength !== blob.size) throw new Error('Leitura incompleta da mídia.');
    return bytesToBase64(new Uint8Array(buffer));
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(createApiError('activity-records/read-failed', errorMessage));
      reader.onabort = () => reject(createApiError('activity-records/read-failed', errorMessage));
      reader.onload = () => {
        const result = String(reader.result || '');
        const separatorIndex = result.indexOf(',');
        if (separatorIndex < 0) {
          reject(createApiError('activity-records/read-failed', errorMessage));
          return;
        }
        resolve(result.slice(separatorIndex + 1));
      };
      reader.readAsDataURL(blob);
    });
  }
}

async function readVideoChunkBase64(file: File, start: number, end: number): Promise<string> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < VIDEO_CHUNK_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const chunk = file.slice(start, end);
      if (chunk.size !== end - start) {
        throw createApiError('activity-records/read-failed', 'Não foi possível acessar a parte completa do vídeo no celular.');
      }
      return await blobToBase64(chunk, 'Não foi possível ler uma parte do vídeo no celular. Mantenha a tela aberta e tente novamente.');
    } catch (error) {
      lastError = error;
      if (attempt < VIDEO_CHUNK_READ_MAX_ATTEMPTS - 1) await waitBeforeRetry(attempt);
    }
  }

  throw createApiError(
    'activity-records/video-chunk-read-failed',
    `O arquivo original não está mais disponível no celular para ler os bytes ${start}-${end - 1}. Selecione novamente somente este vídeo.`,
  );
}

function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file, 'Não foi possível ler a foto preparada.');
}

export interface UploadActivityPhotoInput {
  patient: Patient;
  session: Session;
  sessions?: Session[];
  file: File;
  width: number;
  height: number;
  sha256: string;
  originalContentHash?: string;
  preparedContentHash?: string;
  originalByteSize?: number;
  mediaType?: 'photo' | 'video';
  durationSeconds?: number;
  lastModified?: number;
  category: ActivityRecordCategory;
  description: string;
  visibility: ActivityRecordVisibility;
  createdByName: string;
  uploadAttemptId?: string;
  onProgress?: (progress: number) => void;
  onDiagnostic?: (event: ActivityUploadDiagnosticEvent) => void;
}

export interface ActivityMediaDuplicateResult {
  duplicate: boolean;
  scope: 'none' | 'same-session' | 'other-session';
  verification: 'complete' | 'inconclusive';
  reason?: string;
  existing: null | {
    recordId: string;
    sessionId: string;
    sessionDate: string;
    sessionTime: string;
  };
}

export async function checkActivityMediaDuplicate(input: {
  patientId: string;
  sessionId: string;
  sha256: string;
  fileSize: number;
  mediaType: 'photo' | 'video';
  mimeType: string;
}): Promise<ActivityMediaDuplicateResult> {
  return post<ActivityMediaDuplicateResult>({
    action: 'checkMediaDuplicate',
    patientId: input.patientId,
    sessionId: input.sessionId,
    sha256: input.sha256,
    fileSize: input.fileSize,
    mediaType: input.mediaType,
    mimeType: input.mimeType,
  });
}

function createUploadAttemptId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const randomBytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(randomBytes);
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

interface VideoChunkResponse {
  completed: boolean;
  nextOffset: number;
  record?: ActivityRecord;
}

interface PrepareVideoUploadResponse {
  completed?: boolean;
  recordId: string;
  uploadAttemptId: string;
  chunkSize: number;
  nextOffset?: number;
  record?: ActivityRecord;
}

export interface PreparedDirectActivityUpload {
  uploadAttemptId: string;
  recordId?: string;
  completed: boolean;
  uploadUrl?: string;
  nextOffset?: number;
  record?: ActivityRecord;
  error?: { code?: string; message?: string };
}

interface PrepareDirectActivityUploadBatchResponse {
  items: PreparedDirectActivityUpload[];
}

interface DirectUploadStatusResponse {
  completed: boolean;
  nextOffset: number;
  driveFileId?: string;
  record?: ActivityRecord;
}

interface DirectUploadChunkResult {
  completed: boolean;
  nextOffset: number;
  driveFileId?: string;
}

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 600 * (2 ** attempt)));
}

function serializeDirectUploadInput(input: UploadActivityPhotoInput): Record<string, unknown> {
  return {
    uploadAttemptId: input.uploadAttemptId || createUploadAttemptId(),
    patientId: input.patient.id,
    sessionId: input.session.id,
    sessionIds: (input.sessions?.length ? input.sessions : [input.session]).map(session => session.id),
    fileName: input.file.name,
    mimeType: input.file.type,
    fileSize: input.file.size,
    width: input.width,
    height: input.height,
    sha256: input.sha256,
    originalContentHash: input.originalContentHash,
    preparedContentHash: input.preparedContentHash,
    originalByteSize: input.originalByteSize,
    mediaType: input.mediaType || (input.file.type.startsWith('video/') ? 'video' : 'photo'),
    durationSeconds: input.durationSeconds,
    lastModified: input.lastModified || input.file.lastModified || Date.now(),
    category: input.category,
    description: input.description,
    visibility: input.visibility,
    createdByName: input.createdByName,
  };
}

export async function prepareActivityUploadBatch(
  inputs: UploadActivityPhotoInput[],
): Promise<Map<string, PreparedDirectActivityUpload>> {
  const normalized = inputs.map(input => ({
    input,
    uploadAttemptId: input.uploadAttemptId || createUploadAttemptId(),
  }));
  const payloadItems = normalized.map(({ input, uploadAttemptId }) => serializeDirectUploadInput({
    ...input,
    uploadAttemptId,
  }));
  const result = await post<PrepareDirectActivityUploadBatchResponse>({
    action: 'prepareDirectUploadBatch',
    items: payloadItems,
  });
  const byAttempt = new Map<string, PreparedDirectActivityUpload>();
  for (const item of Array.isArray(result.items) ? result.items : []) {
    if (item?.uploadAttemptId) byAttempt.set(item.uploadAttemptId, item);
  }
  for (const { uploadAttemptId } of normalized) {
    if (!byAttempt.has(uploadAttemptId)) {
      byAttempt.set(uploadAttemptId, {
        uploadAttemptId,
        completed: false,
        error: {
          code: 'activity-records/invalid-response',
          message: 'O servidor não preparou esta mídia para o envio rápido.',
        },
      });
    }
  }
  return byAttempt;
}

function parseDirectUploadRange(rangeHeader: string | null): number {
  const match = /^bytes=0-(\d+)$/.exec(String(rangeHeader || '').trim());
  return match ? Number(match[1]) + 1 : 0;
}

function putDirectUploadChunk({
  uploadUrl,
  chunk,
  start,
  totalSize,
  mimeType,
  onProgress,
  onXhr,
}: {
  uploadUrl: string;
  chunk: Blob;
  start: number;
  totalSize: number;
  mimeType: string;
  onProgress?: (loaded: number) => void;
  onXhr?: (xhr: XMLHttpRequest | null) => void;
}): Promise<DirectUploadChunkResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    const endExclusive = start + chunk.size;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      xhr.abort();
    }, DIRECT_UPLOAD_REQUEST_TIMEOUT_MS);
    onXhr?.(xhr);
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType || 'application/octet-stream');
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${endExclusive - 1}/${totalSize}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(start + event.loaded);
    };
    xhr.onerror = () => reject(createApiError(
      'activity-records/direct-upload-network-error',
      'A conexão com o Google Drive foi interrompida durante o envio rápido.',
    ));
    xhr.onabort = () => reject(createApiError(
      timedOut ? 'activity-records/direct-upload-timeout' : 'activity-records/upload-cancelled',
      timedOut
        ? 'Uma parte da mídia demorou além do limite e foi interrompida.'
        : 'O envio da mídia foi cancelado.',
    ));
    xhr.onload = () => {
      if (xhr.status === 308) {
        const confirmed = parseDirectUploadRange(xhr.getResponseHeader('Range')) || endExclusive;
        resolve({ completed: false, nextOffset: Math.min(totalSize, confirmed) });
        return;
      }
      if (xhr.status === 200 || xhr.status === 201) {
        let payload: { id?: string } = {};
        try { payload = JSON.parse(xhr.responseText || '{}') as { id?: string }; }
        catch { /* A confirmação final também será verificada pela API. */ }
        resolve({ completed: true, nextOffset: totalSize, driveFileId: payload.id });
        return;
      }
      reject(createApiError(
        'activity-records/direct-upload-rejected',
        `O Google Drive recusou uma parte da mídia (código ${xhr.status || 0}).`,
      ));
    };
    xhr.onloadend = () => {
      window.clearTimeout(timeoutId);
      onXhr?.(null);
    };
    xhr.send(chunk);
  });
}

async function putProxyUploadChunk({
  input,
  prepared,
  chunk,
  start,
  onProgress,
  onXhr,
}: {
  input: UploadActivityPhotoInput;
  prepared: PreparedDirectActivityUpload;
  chunk: Blob;
  start: number;
  onProgress?: (loaded: number) => void;
  onXhr?: (xhr: XMLHttpRequest | null) => void;
}): Promise<DirectUploadChunkResult> {
  if (!prepared.recordId || !input.uploadAttemptId) {
    throw createApiError('activity-records/invalid-upload-session', 'A sessão de envio rápido está incompleta.');
  }
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      xhr.abort();
    }, PROXY_UPLOAD_REQUEST_TIMEOUT_MS);
    onXhr?.(xhr);
    xhr.open('POST', ACTIVITY_UPLOAD_CHUNK_ENDPOINT);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Activity-Patient-Id', input.patient.id);
    xhr.setRequestHeader('X-Activity-Record-Id', prepared.recordId);
    xhr.setRequestHeader('X-Activity-Upload-Attempt-Id', input.uploadAttemptId);
    xhr.setRequestHeader('X-Activity-Start', String(start));
    xhr.setRequestHeader('X-Activity-Total-Size', String(input.file.size));
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(start + event.loaded);
    };
    xhr.onerror = () => reject(createApiError(
      'activity-records/proxy-upload-network-error',
      'A conexão com o servidor foi interrompida durante o envio.',
    ));
    xhr.onabort = () => reject(createApiError(
      timedOut ? 'activity-records/proxy-upload-timeout' : 'activity-records/upload-cancelled',
      timedOut
        ? 'Uma parte da mídia demorou além do limite e foi interrompida.'
        : 'O envio da mídia foi cancelado.',
    ));
    xhr.onload = () => {
      let payload: (DirectUploadChunkResult & { record?: ActivityRecord }) & ApiErrorPayload;
      try {
        payload = JSON.parse(xhr.responseText || '{}') as (DirectUploadChunkResult & { record?: ActivityRecord }) & ApiErrorPayload;
      } catch {
        reject(createApiError('activity-records/invalid-response', 'O servidor retornou uma confirmação inválida durante o envio.'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(createApiError(
          payload.error?.code || 'activity-records/proxy-upload-rejected',
          payload.error?.message || 'O servidor recusou uma parte da mídia.',
        ));
        return;
      }
      resolve({
        completed: Boolean(payload.completed),
        nextOffset: Number(payload.nextOffset || 0),
        driveFileId: payload.driveFileId,
      });
    };
    xhr.onloadend = () => {
      window.clearTimeout(timeoutId);
      onXhr?.(null);
    };
    xhr.send(chunk);
  });
}

async function getDirectUploadStatus(input: UploadActivityPhotoInput, prepared: PreparedDirectActivityUpload): Promise<DirectUploadStatusResponse> {
  if (!prepared.recordId || !input.uploadAttemptId) {
    throw createApiError('activity-records/invalid-upload-session', 'A sessão de envio rápido está incompleta.');
  }
  return post<DirectUploadStatusResponse>({
    action: 'getDirectUploadStatus',
    patientId: input.patient.id,
    recordId: prepared.recordId,
    uploadAttemptId: input.uploadAttemptId,
  });
}

async function touchDirectUploadProgress(
  input: UploadActivityPhotoInput,
  prepared: PreparedDirectActivityUpload,
  uploadedBytes: number,
): Promise<DirectUploadStatusResponse> {
  if (!prepared.recordId || !input.uploadAttemptId) {
    throw createApiError('activity-records/invalid-upload-session', 'A sessão de envio rápido está incompleta.');
  }
  return post<DirectUploadStatusResponse>({
    action: 'touchDirectUpload',
    patientId: input.patient.id,
    recordId: prepared.recordId,
    uploadAttemptId: input.uploadAttemptId,
    uploadedBytes,
  });
}

async function finalizeDirectUpload(
  input: UploadActivityPhotoInput,
  prepared: PreparedDirectActivityUpload,
  driveFileId?: string,
): Promise<DirectUploadStatusResponse> {
  if (!prepared.recordId || !input.uploadAttemptId) {
    throw createApiError('activity-records/invalid-upload-session', 'A sessão de envio rápido está incompleta.');
  }
  return post<DirectUploadStatusResponse>({
    action: 'finalizeDirectUpload',
    patientId: input.patient.id,
    recordId: prepared.recordId,
    uploadAttemptId: input.uploadAttemptId,
    driveFileId,
  });
}

export async function uploadPreparedActivityMediaDirect(
  input: UploadActivityPhotoInput,
  prepared: PreparedDirectActivityUpload,
): Promise<ActivityRecord> {
  if (prepared.error) {
    throw createApiError(
      prepared.error.code || 'activity-records/upload-prepare-failed',
      prepared.error.message || 'Não foi possível preparar esta mídia para envio.',
    );
  }
  if (prepared.completed) {
    if (!prepared.record) throw createApiError('activity-records/invalid-response', 'O servidor não confirmou a mídia já salva.');
    input.onProgress?.(100);
    return prepared.record;
  }
  if (!prepared.uploadUrl || !prepared.recordId || !input.uploadAttemptId) {
    throw createApiError('activity-records/invalid-upload-session', 'O servidor não retornou a sessão de envio rápido.');
  }

  let cancelled = false;
  let currentXhr: XMLHttpRequest | null = null;
  ACTIVE_UPLOADS.set(input.uploadAttemptId, {
    patientId: input.patient.id,
    abort: () => {
      cancelled = true;
      currentXhr?.abort();
    },
  });

  try {
    let offset = Math.max(0, Math.min(input.file.size, Number(prepared.nextOffset || 0)));
    if (offset > 0) input.onProgress?.(Math.round((offset / input.file.size) * 100));
    let completedDriveFileId = '';
    let useProxyFallback = false;

    const reportProgress = (loaded: number) => input.onProgress?.(
      Math.max(1, Math.min(99, Math.round((loaded / input.file.size) * 100))),
    );

    const recoverConfirmedProgress = async (): Promise<DirectUploadChunkResult | ActivityRecord | null> => {
      const status = await getDirectUploadStatus(input, prepared).catch(() => null);
      if (!status) return null;
      if (status.completed) {
        const finalizedStatus = status.record
          ? status
          : await finalizeDirectUpload(input, prepared, status.driveFileId);
        if (!finalizedStatus.record) {
          throw createApiError('activity-records/invalid-response', 'O servidor não confirmou a mídia salva.');
        }
        return finalizedStatus.record;
      }
      if (status.nextOffset > offset) {
        return { completed: false, nextOffset: status.nextOffset };
      }
      return null;
    };

    while (offset < input.file.size) {
      if (cancelled) throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');
      let chunkResult: DirectUploadChunkResult | null = null;
      let lastError: unknown = null;

      if (!useProxyFallback) {
        const directEnd = Math.min(input.file.size, offset + ACTIVITY_DIRECT_UPLOAD_CHUNK_BYTES);
        const directChunk = input.file.slice(offset, directEnd);
        for (let attempt = 0; attempt < DIRECT_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
          try {
            chunkResult = await putDirectUploadChunk({
              uploadUrl: prepared.uploadUrl,
              chunk: directChunk,
              start: offset,
              totalSize: input.file.size,
              mimeType: input.file.type,
              onXhr: xhr => { currentXhr = xhr; },
              onProgress: reportProgress,
            });
            break;
          } catch (error) {
            if (cancelled || (error as { code?: string } | null)?.code === 'activity-records/upload-cancelled') throw error;
            lastError = error;
            const recovered = await recoverConfirmedProgress();
            if (recovered && 'id' in recovered) {
              input.onProgress?.(100);
              notifyActivityRecordsChanged(input.patient.id);
              return recovered;
            }
            if (recovered && !('id' in recovered)) {
              chunkResult = recovered;
              break;
            }
            if (attempt < DIRECT_UPLOAD_MAX_ATTEMPTS - 1) await waitBeforeRetry(attempt);
          }
        }
        if (!chunkResult) useProxyFallback = true;
      }

      if (useProxyFallback && !chunkResult) {
        const proxyEnd = Math.min(input.file.size, offset + ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES);
        const proxyChunk = input.file.slice(offset, proxyEnd);
        for (let attempt = 0; attempt < PROXY_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
          try {
            chunkResult = await putProxyUploadChunk({
              input,
              prepared,
              chunk: proxyChunk,
              start: offset,
              onXhr: xhr => { currentXhr = xhr; },
              onProgress: reportProgress,
            });
            break;
          } catch (error) {
            if (cancelled || (error as { code?: string } | null)?.code === 'activity-records/upload-cancelled') throw error;
            lastError = error;
            const recovered = await recoverConfirmedProgress();
            if (recovered && 'id' in recovered) {
              input.onProgress?.(100);
              notifyActivityRecordsChanged(input.patient.id);
              return recovered;
            }
            if (recovered && !('id' in recovered)) {
              chunkResult = recovered;
              break;
            }
            if (attempt >= PROXY_UPLOAD_MAX_ATTEMPTS - 1) throw lastError;
            await waitBeforeRetry(attempt);
          }
        }
      }

      if (!chunkResult) throw lastError || createApiError('activity-records/upload-failed', 'Não foi possível enviar uma parte da mídia.');
      if (chunkResult.completed) {
        completedDriveFileId = chunkResult.driveFileId || '';
        offset = input.file.size;
        break;
      }
      if (!Number.isSafeInteger(chunkResult.nextOffset) || chunkResult.nextOffset <= offset || chunkResult.nextOffset > input.file.size) {
        throw createApiError('activity-records/invalid-response', 'O Google Drive retornou um progresso inválido.');
      }
      offset = chunkResult.nextOffset;
      await touchDirectUploadProgress(input, prepared, offset);
      reportProgress(offset);
    }

    const finalized = await finalizeDirectUpload(input, prepared, completedDriveFileId);
    if (!finalized.completed || !finalized.record) {
      throw createApiError('activity-records/upload-not-complete', 'O envio terminou sem a confirmação final da mídia.');
    }
    input.onProgress?.(100);
    notifyActivityRecordsChanged(input.patient.id);
    return finalized.record;
  } catch (error) {
    if (cancelled) {
      await cancelActivityUpload(input.patient.id, input.uploadAttemptId).catch(() => undefined);
      throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');
    }
    throw error;
  } finally {
    ACTIVE_UPLOADS.delete(input.uploadAttemptId);
    currentXhr = null;
  }
}

function isRetryableVideoChunkError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return !code || [
    'activity-records/network-error',
    'activity-records/upload-chunk-failed',
    'activity-records/upload-status-failed',
    'activity-records/internal-error',
    'activity-records/invalid-response',
    'activity-records/request-failed',
    'activity-records/chunk-timeout',
  ].includes(code);
}

function createVideoChunkFailure(error: unknown, start: number, chunkSize: number): Error & { code: string } {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'activity-records/missing-auth-token' || code === 'activity-records/authentication-failed') {
    return error as Error & { code: string };
  }
  const partNumber = Math.floor(start / chunkSize) + 1;
  if (code === 'activity-records/chunk-timeout') {
    return createApiError(code, `A parte ${partNumber} do vídeo excedeu o tempo limite.`);
  }
  if (code === 'activity-records/network-error') {
    return createApiError(code, `A conexão falhou durante a parte ${partNumber} do vídeo.`);
  }
  if (code === 'activity-records/upload-chunk-failed') {
    return createApiError(code, `O Google Drive recusou a parte ${partNumber} do vídeo.`);
  }
  return createApiError('activity-records/request-failed', `A API rejeitou a parte ${partNumber} do vídeo.`);
}

async function uploadActivityVideoInChunks(input: UploadActivityPhotoInput): Promise<ActivityRecord> {
  const uploadAttemptId = input.uploadAttemptId || createUploadAttemptId();
  let cancelled = false;
  let currentController: AbortController | null = null;
  let prepared: { recordId: string; uploadAttemptId: string; chunkSize: number } | null = null;

  ACTIVE_UPLOADS.set(uploadAttemptId, {
    patientId: input.patient.id,
    abort: () => {
      cancelled = true;
      currentController?.abort();
    },
  });

  try {
    currentController = new AbortController();
    const prepareResult = await post<PrepareVideoUploadResponse>({
      action: 'prepareVideoUpload',
      uploadAttemptId,
      patientId: input.patient.id,
      sessionId: input.session.id,
      sessionIds: (input.sessions?.length ? input.sessions : [input.session]).map(session => session.id),
      fileName: input.file.name,
      mimeType: input.file.type,
      fileSize: input.file.size,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      originalContentHash: input.originalContentHash,
      preparedContentHash: input.preparedContentHash,
      originalByteSize: input.originalByteSize,
      mediaType: 'video',
      durationSeconds: input.durationSeconds,
      lastModified: input.lastModified || input.file.lastModified || Date.now(),
      category: input.category,
      description: input.description,
      visibility: input.visibility,
      createdByName: input.createdByName,
    }, currentController.signal);

    if (prepareResult.completed) {
      if (!prepareResult.record) throw createApiError('activity-records/invalid-response', 'O servidor não confirmou o vídeo já salvo.');
      input.onProgress?.(100);
      input.onDiagnostic?.({ event: 'upload-response-recovered' });
      notifyActivityRecordsChanged(input.patient.id);
      return prepareResult.record;
    }
    prepared = prepareResult;

    if (!Number.isSafeInteger(prepared.chunkSize) || prepared.chunkSize <= 0 || prepared.chunkSize > MAX_ACTIVITY_VIDEO_CHUNK_BYTES) {
      throw createApiError('activity-records/invalid-response', 'O servidor retornou um tamanho de parte inválido.');
    }

    let offset = Number(prepareResult.nextOffset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > input.file.size) {
      throw createApiError('activity-records/invalid-response', 'O servidor retornou um ponto de retomada inválido para o vídeo.');
    }
    if (offset > 0) {
      input.onDiagnostic?.({ event: 'upload-offset-recovered', nextOffset: offset });
      input.onProgress?.(Math.round((offset / input.file.size) * 100));
    }
    while (offset < input.file.size) {
      if (cancelled) throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');

      const chunkEnd = Math.min(input.file.size, offset + prepared.chunkSize);
      const chunkIndex = Math.floor(offset / prepared.chunkSize) + 1;
      input.onDiagnostic?.({ event: 'chunk-read-start', chunkIndex, start: offset, end: chunkEnd });
      const dataBase64 = await readVideoChunkBase64(input.file, offset, chunkEnd);
      input.onDiagnostic?.({ event: 'chunk-read-confirmed', chunkIndex, start: offset, end: chunkEnd });
      let result: VideoChunkResponse | null = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < VIDEO_CHUNK_MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');
        currentController = new AbortController();
        let timedOut = false;
        const timeoutId = window.setTimeout(() => {
          timedOut = true;
          currentController?.abort();
        }, VIDEO_CHUNK_REQUEST_TIMEOUT_MS);

        try {
          input.onDiagnostic?.({ event: 'chunk-upload-start', chunkIndex, start: offset, end: chunkEnd, attempt: attempt + 1 });
          result = await post<VideoChunkResponse>({
            action: 'uploadVideoChunk',
            patientId: input.patient.id,
            recordId: prepared.recordId,
            uploadAttemptId,
            start: offset,
            totalSize: input.file.size,
            dataBase64,
          }, currentController.signal);
          break;
        } catch (error) {
          if (cancelled) throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');
          lastError = timedOut
            ? createApiError('activity-records/chunk-timeout', 'Uma parte do vídeo excedeu o tempo limite de envio.')
            : error;
          if (attempt >= VIDEO_CHUNK_MAX_ATTEMPTS - 1 || !isRetryableVideoChunkError(lastError)) {
            throw createVideoChunkFailure(lastError, offset, prepared.chunkSize);
          }
          await waitBeforeRetry(attempt);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }

      if (!result) throw lastError || createApiError('activity-records/upload-failed', 'Não foi possível enviar uma parte do vídeo.');
      if (result.completed) {
        if (!result.record) throw createApiError('activity-records/invalid-response', 'O servidor não confirmou o vídeo salvo.');
        input.onProgress?.(100);
        input.onDiagnostic?.({ event: 'chunk-upload-confirmed', chunkIndex, nextOffset: input.file.size });
        notifyActivityRecordsChanged(input.patient.id);
        return result.record;
      }
      if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset || result.nextOffset > input.file.size) {
        throw createApiError('activity-records/invalid-response', 'O servidor retornou um progresso inválido para o vídeo.');
      }

      offset = result.nextOffset;
      input.onDiagnostic?.({ event: 'chunk-upload-confirmed', chunkIndex, nextOffset: offset });
      input.onProgress?.(Math.max(1, Math.min(99, Math.round((offset / input.file.size) * 100))));
    }

    throw createApiError('activity-records/upload-failed', 'O envio terminou sem a confirmação do vídeo salvo.');
  } catch (error) {
    if (prepared) {
      if (cancelled) {
        await cancelActivityUpload(input.patient.id, uploadAttemptId).catch(() => undefined);
      } else {
        await post({
          action: 'failVideoUpload',
          patientId: input.patient.id,
          recordId: prepared.recordId,
          uploadAttemptId,
          message: error instanceof Error ? error.message : 'O envio do vídeo falhou.',
        }).catch(() => undefined);
      }
    }
    if (cancelled) throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');
    throw error;
  } finally {
    ACTIVE_UPLOADS.delete(uploadAttemptId);
    currentController = null;
  }
}

export async function uploadActivityPhoto(input: UploadActivityPhotoInput): Promise<ActivityRecord> {
  if ((input.mediaType || (input.file.type.startsWith('video/') ? 'video' : 'photo')) === 'video') {
    return uploadActivityVideoInChunks(input);
  }
  const uploadAttemptId = input.uploadAttemptId || createUploadAttemptId();
  const dataBase64 = await fileToBase64(input.file);
  const token = await getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    ACTIVE_UPLOADS.set(uploadAttemptId, { abort: () => xhr.abort(), patientId: input.patient.id });
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; xhr.abort(); }, ACTIVITY_UPLOAD_TIMEOUT_MS);
    xhr.open('POST', API_ENDPOINT);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) input.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(createApiError('activity-records/network-error', 'A conexão falhou durante o envio da foto.'));
    xhr.onabort = () => {
      void cancelActivityUpload(input.patient.id, uploadAttemptId).catch(() => undefined);
      reject(createApiError(timedOut ? 'activity-records/upload-timeout' : 'activity-records/upload-cancelled', timedOut ? 'O envio excedeu o tempo limite e foi interrompido.' : 'O envio da foto foi cancelado.'));
    };
    xhr.onload = () => {
      let payload: { record?: ActivityRecord } & ApiErrorPayload;
      try {
        payload = JSON.parse(xhr.responseText || '{}') as { record?: ActivityRecord } & ApiErrorPayload;
      } catch {
        reject(createApiError('activity-records/response-lost', 'O servidor respondeu, mas a confirmação não pôde ser lida. A nova tentativa verificará se a foto já foi salva.'));
        return;
      }
      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(createApiError(payload.error?.code || 'activity-records/upload-failed', payload.error?.message || 'Não foi possível salvar a foto.'));
          return;
        }
        if (!payload.record) throw createApiError('activity-records/invalid-response', 'O servidor não confirmou o registro salvo.');
        input.onProgress?.(100);
        notifyActivityRecordsChanged(input.patient.id);
        resolve(payload.record);
      } catch (error) { reject(error); }
    };
    xhr.onloadend = () => {
      window.clearTimeout(timeoutId);
      ACTIVE_UPLOADS.delete(uploadAttemptId);
    };
    xhr.send(JSON.stringify({
      action: 'uploadPhoto',
      uploadAttemptId,
      patientId: input.patient.id,
      sessionId: input.session.id,
      sessionIds: (input.sessions?.length ? input.sessions : [input.session]).map(session => session.id),
      fileName: input.file.name,
      mimeType: input.file.type,
      mediaType: input.mediaType || (input.file.type.startsWith('video/') ? 'video' : 'photo'),
      durationSeconds: input.durationSeconds,
      dataBase64,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      originalContentHash: input.originalContentHash,
      preparedContentHash: input.preparedContentHash,
      originalByteSize: input.originalByteSize,
      category: input.category,
      description: input.description,
      visibility: input.visibility,
      createdByName: input.createdByName,
    }));
  });
}

export function cancelActiveActivityUpload(): boolean {
  const active = Array.from(ACTIVE_UPLOADS.values());
  if (active.length === 0) return false;
  for (const current of active) current.abort();
  return true;
}

async function post<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return readResponse<T>(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if ((error as { code?: string } | null)?.code) throw error;
    throw createApiError('activity-records/network-error', 'A conexão com o servidor falhou durante o envio.');
  }
}

export async function cancelActivityUpload(patientId: string, uploadAttemptId: string): Promise<void> {
  await post({ action: 'cancelUpload', patientId, uploadAttemptId });
}

function normalizeActivityPhotoUrl(url: string): string {
  if (typeof window === 'undefined' || !url) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    const currentHost = window.location.hostname;
    const returnedHost = parsed.hostname;
    const isReturnedLocalApi = returnedHost === '127.0.0.1' || returnedHost === 'localhost' || returnedHost === '[::1]';
    const isCurrentLanOrHttps = currentHost !== '127.0.0.1' && currentHost !== 'localhost' && currentHost !== '[::1]';

    // Em testes pelo celular, o frontend abre em http://192.168.x.x:3000, mas a API local pode
    // assinar a foto como http://127.0.0.1:3002 por causa do proxy do Vite. No celular, 127.0.0.1
    // aponta para o próprio telefone, então a imagem nunca carrega. A URL precisa usar a mesma
    // origem da tela para passar pelo proxy local corretamente. Em produção, mantemos a URL da API.
    if (isReturnedLocalApi && isCurrentLanOrHttps) {
      return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    // Mesmo no desktop, usar a mesma origem evita depender da porta privada 3002 na interface.
    if (isReturnedLocalApi && window.location.port === '3000') {
      return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export async function getActivityPhotoUrl(recordId: string, patientId: string, forceRefresh = false): Promise<string> {
  const cached = SIGNED_URL_CACHE.get(recordId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  const result = await post<{ url: string; expiresAt: number }>({ action: 'getFileUrl', recordId, patientId });
  const normalizedUrl = normalizeActivityPhotoUrl(result.url);
  const normalizedResult = { ...result, url: normalizedUrl };
  SIGNED_URL_CACHE.set(recordId, normalizedResult);
  return normalizedUrl;
}

export async function listActivityRecords(
  patientId: string,
  sessionId?: string,
  options: { force?: boolean } = {},
): Promise<ActivityRecord[]> {
  const cacheKey = `${currentActivityUserScope()}:${patientId}:${sessionId || '*'}`;
  const cached = activityRecordListCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = activityRecordListInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const result = await post<{ records: ActivityRecord[] }>({ action: 'listRecords', patientId, sessionId });
    const records = Array.isArray(result.records) ? result.records : [];
    activityRecordListCache.set(cacheKey, {
      value: records,
      expiresAt: Date.now() + ACTIVITY_RECORD_LIST_CACHE_TTL_MS,
    });
    return records;
  })();

  activityRecordListInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    activityRecordListInFlight.delete(cacheKey);
  }
}

export async function updateActivityRecordMetadata(record: ActivityRecord, values: { category: ActivityRecordCategory; description: string; visibility: ActivityRecordVisibility }): Promise<void> {
  await post({ action: 'updateMetadata', recordId: record.id, patientId: record.patientId, ...values });
  notifyActivityRecordsChanged(record.patientId);
}

export async function deleteActivityRecord(record: ActivityRecord, reason: string): Promise<void> {
  await post({ action: 'deleteRecord', recordId: record.id, patientId: record.patientId, reason });
  SIGNED_URL_CACHE.delete(record.id);
  notifyActivityRecordsChanged(record.patientId);
}

export async function getProfessionalActivityGallery(
  filters: ProfessionalActivityGalleryFilters = {},
  options: { force?: boolean } = {},
): Promise<ProfessionalActivityGalleryResponse> {
  const cacheKey = `${currentActivityUserScope()}:${JSON.stringify(filters)}`;
  const cached = activityGalleryCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = activityGalleryInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = post<ProfessionalActivityGalleryResponse>({
    action: 'listProfessionalGallery',
    filters,
  }).then(result => {
    activityGalleryCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + ACTIVITY_GALLERY_CACHE_TTL_MS,
    });
    return result;
  });

  activityGalleryInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    activityGalleryInFlight.delete(cacheKey);
  }
}

export async function getProfessionalActivityGallerySummary(
  options: { force?: boolean } = {},
): Promise<ProfessionalActivityGalleryResponse> {
  const scope = currentActivityUserScope();
  if (
    !options.force
    && activityGallerySummaryCache
    && activityGallerySummaryCache.scope === scope
    && activityGallerySummaryCache.expiresAt > Date.now()
  ) {
    return activityGallerySummaryCache.value;
  }
  if (activityGallerySummaryInFlight?.scope === scope) return activityGallerySummaryInFlight.request;

  const request = post<ProfessionalActivityGalleryResponse>({
    action: 'getProfessionalGallerySummary',
  }).then(result => {
    activityGallerySummaryCache = {
      scope,
      value: result,
      expiresAt: Date.now() + ACTIVITY_GALLERY_SUMMARY_CACHE_TTL_MS,
    };
    return result;
  });

  activityGallerySummaryInFlight = { scope, request };
  try {
    return await request;
  } finally {
    if (activityGallerySummaryInFlight?.request === request) {
      activityGallerySummaryInFlight = null;
    }
  }
}

export async function saveActivitySessionNoMediaJustification(input: {
  patientId: string;
  sessionId: string;
  reason: ActivityGalleryJustificationReason;
  note?: string;
}): Promise<ActivityGalleryStatusRecord> {
  const result = await post<{ status: ActivityGalleryStatusRecord }>({
    action: 'saveSessionNoMediaJustification',
    ...input,
  });
  notifyActivityRecordsChanged(input.patientId);
  return result.status;
}

export async function removeActivitySessionNoMediaJustification(input: {
  patientId: string;
  sessionId: string;
}): Promise<ActivityGalleryStatusRecord> {
  const result = await post<{ status: ActivityGalleryStatusRecord }>({
    action: 'removeSessionNoMediaJustification',
    ...input,
  });
  notifyActivityRecordsChanged(input.patientId);
  return result.status;
}

export async function listActivitySessionAudit(input: {
  patientId: string;
  sessionId: string;
}): Promise<ActivityGalleryAuditEntry[]> {
  const result = await post<{ entries: ActivityGalleryAuditEntry[] }>({
    action: 'listSessionActivityAudit',
    ...input,
  });
  return Array.isArray(result.entries) ? result.entries : [];
}

export async function hasPatientActivityRecords(patientId: string): Promise<boolean> {
  const result = await post<{ hasRecords: boolean }>({ action: 'hasRecords', patientId });
  return result.hasRecords;
}

export function getActivityRecordErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const technicalMessage = error instanceof Error ? error.message : '';
  if (isActivityMediaFileReadError(error)) {
    return 'O arquivo original não pôde ser lido pelo celular. Selecione novamente somente este arquivo.';
  }
  const messages: Record<string, string> = {
    'activity-records/authorization-required': 'A autorização para registro interno está pendente ou não foi concedida.',
    'activity-records/duplicate': 'Esta mídia já está na galeria desta sessão e não será enviada novamente.',
    'activity-records/upload-in-progress': 'Esta mídia já está sendo enviada para a sessão selecionada.',
    'activity-records/sharing-not-authorized': 'O compartilhamento com o responsável não está autorizado.',
    'activity-records/hash-mismatch': 'Não foi possível confirmar a integridade desta mídia. Prepare o arquivo novamente.',
    'activity-records/invalid-file-signature': 'O conteúdo do arquivo não corresponde a uma mídia válida.',
    'activity-records/upload-cancelled': 'O envio da mídia foi cancelado.',
    'activity-records/upload-timeout': 'O envio demorou mais do que o esperado e foi interrompido. Tente novamente.',
    'activity-records/chunk-timeout': 'Uma parte do vídeo demorou mais do que o esperado. Tente continuar o envio.',
    'activity-records/network-error': 'A conexão foi interrompida. Tente novamente quando a internet estiver estável.',
    'activity-records/direct-upload-network-error': 'A conexão direta com o Google Drive foi interrompida. O progresso confirmado será retomado na próxima tentativa.',
    'activity-records/direct-upload-timeout': 'A conexão ficou lenta demais durante esta parte do envio. Tente continuar quando a internet estiver mais estável.',
    'activity-records/direct-upload-rejected': 'O Google Drive recusou esta parte do envio. O arquivo continua disponível para nova tentativa.',
    'activity-records/proxy-upload-network-error': 'A conexão com o servidor foi interrompida. O progresso confirmado será retomado na próxima tentativa.',
    'activity-records/proxy-upload-timeout': 'A conexão ficou lenta demais durante esta parte do envio. Tente continuar quando a internet estiver mais estável.',
    'activity-records/proxy-upload-rejected': 'O servidor recusou esta parte do envio. O arquivo continua disponível para nova tentativa.',
    'activity-records/upload-chunk-too-large': 'Uma parte da mídia ultrapassou o limite do servidor. O arquivo continua disponível.',
    'activity-records/upload-not-complete': 'O Google Drive ainda não confirmou a mídia completa. Tente continuar o envio.',
    'activity-records/invalid-upload-session': 'A sessão de envio precisa ser preparada novamente. O arquivo continua disponível.',
    'activity-records/response-lost': 'A confirmação do envio não pôde ser lida. Tente novamente; uma mídia já confirmada não será duplicada.',
    'activity-records/read-failed': 'Não foi possível ler este arquivo no celular.',
    'activity-records/probe-failed': 'Não foi possível verificar o arquivo neste momento. O sistema ainda tentará prepará-lo normalmente.',
    'activity-records/video-chunk-read-failed': 'O navegador não conseguiu ler uma parte do vídeo. Selecione novamente este vídeo.',
    'activity-records/local-file-unavailable': 'O arquivo original não está mais disponível no celular. Selecione novamente somente este arquivo.',
    'activity-records/missing-auth-token': 'Sua sessão não foi identificada. Entre novamente.',
    'activity-records/authentication-failed': 'Não foi possível validar sua sessão. Entre novamente.',
    'activity-records/upload-failed': 'Não foi possível concluir o envio. O arquivo permanece disponível para uma nova tentativa.',
    'activity-records/upload-chunk-failed': 'Não foi possível enviar uma parte do vídeo. O progresso já confirmado foi preservado.',
    'activity-records/upload-session-expired': 'A sessão de envio do vídeo expirou. Tente novamente.',
    'activity-records/file-too-large': 'A mídia excedeu o limite permitido.',
    'activity-records/session-mismatch': 'A sessão selecionada não pertence a esta criança.',
    'activity-records/patient-not-found': 'O cadastro da criança não foi encontrado.',
    'activity-records/session-not-found': 'A sessão selecionada não foi encontrada.',
    'activity-records/patient-access-denied': 'Você não possui autorização para acessar este atendente.',
    'activity-records/justification-note-required': 'Descreva a justificativa selecionada como Outro.',
    'activity-records/justification-access-denied': 'Somente o autor ou o administrador pode alterar esta justificativa.',
    'activity-records/deletion-reason-required': 'Informe o motivo da exclusão da mídia.',
    'activity-records/internal-error': 'Não foi possível registrar esta mídia. O arquivo permanece disponível para nova tentativa.',
    'activity-records/request-failed': 'Não foi possível registrar esta mídia. O arquivo permanece disponível para nova tentativa.',
  };
  if (code && messages[code]) return messages[code];
  return sanitizeActivityMediaErrorMessage(technicalMessage)
    || 'Não foi possível concluir o registro da atividade.';
}

export function activityFileNeedsReselection(error: unknown): boolean {
  return isActivityMediaFileReadError(error);
}
