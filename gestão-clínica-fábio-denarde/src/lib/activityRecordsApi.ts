import { auth } from '../firebase';
import type { Patient, Session } from '../types';
import type { ActivityRecord, ActivityRecordCategory, ActivityRecordVisibility } from '../types/activityRecords';

export const ACTIVITY_UPLOAD_TIMEOUT_MS = 45_000;
const VIDEO_CHUNK_REQUEST_TIMEOUT_MS = 90_000;
const VIDEO_CHUNK_MAX_ATTEMPTS = 3;
const ACTIVE_UPLOADS = new Map<string, { abort: () => void; patientId: string }>();
const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
export const ACTIVITY_RECORDS_CHANGED_EVENT = 'activity-records:changed';

function notifyActivityRecordsChanged(patientId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACTIVITY_RECORDS_CHANGED_EVENT, { detail: { patientId } }));
}

const API_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/activity-records'
    : '/api/activity-records';

interface ApiErrorPayload { error?: { code?: string; message?: string } }

function createApiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function getToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw createApiError('activity-records/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente.');
  return user.getIdToken();
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: T & ApiErrorPayload;
  try { payload = await response.json(); }
  catch { throw createApiError('activity-records/invalid-response', 'O servidor retornou uma resposta inválida.'); }
  if (!response.ok) throw createApiError(payload.error?.code || 'activity-records/request-failed', payload.error?.message || 'Não foi possível concluir a operação.');
  return payload;
}

function blobToBase64(blob: Blob, errorMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(createApiError('activity-records/read-failed', errorMessage));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file, 'Não foi possível ler a foto preparada.');
}

export interface UploadActivityPhotoInput {
  patient: Patient;
  session: Session;
  file: File;
  width: number;
  height: number;
  sha256: string;
  mediaType?: 'photo' | 'video';
  durationSeconds?: number;
  lastModified?: number;
  category: ActivityRecordCategory;
  description: string;
  visibility: ActivityRecordVisibility;
  createdByName: string;
  onProgress?: (progress: number) => void;
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

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 600 * (2 ** attempt)));
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

async function uploadActivityVideoInChunks(input: UploadActivityPhotoInput): Promise<ActivityRecord> {
  const uploadAttemptId = createUploadAttemptId();
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
    prepared = await post({
      action: 'prepareVideoUpload',
      uploadAttemptId,
      patientId: input.patient.id,
      sessionId: input.session.id,
      fileName: input.file.name,
      mimeType: input.file.type,
      fileSize: input.file.size,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      mediaType: 'video',
      durationSeconds: input.durationSeconds,
      lastModified: input.lastModified || input.file.lastModified || Date.now(),
      category: input.category,
      description: input.description,
      visibility: input.visibility,
      createdByName: input.createdByName,
    }, currentController.signal);

    if (!Number.isSafeInteger(prepared.chunkSize) || prepared.chunkSize <= 0 || prepared.chunkSize > 2 * 1024 * 1024) {
      throw createApiError('activity-records/invalid-response', 'O servidor retornou um tamanho de parte inválido.');
    }

    let offset = 0;
    while (offset < input.file.size) {
      if (cancelled) throw createApiError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.');

      const chunk = input.file.slice(offset, Math.min(input.file.size, offset + prepared.chunkSize));
      const dataBase64 = await blobToBase64(chunk, 'Não foi possível ler uma parte do vídeo.');
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
          if (attempt >= VIDEO_CHUNK_MAX_ATTEMPTS - 1 || !isRetryableVideoChunkError(lastError)) throw lastError;
          await waitBeforeRetry(attempt);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }

      if (!result) throw lastError || createApiError('activity-records/upload-failed', 'Não foi possível enviar uma parte do vídeo.');
      if (result.completed) {
        if (!result.record) throw createApiError('activity-records/invalid-response', 'O servidor não confirmou o vídeo salvo.');
        input.onProgress?.(100);
        notifyActivityRecordsChanged(input.patient.id);
        return result.record;
      }
      if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset || result.nextOffset > input.file.size) {
        throw createApiError('activity-records/invalid-response', 'O servidor retornou um progresso inválido para o vídeo.');
      }

      offset = result.nextOffset;
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
  const uploadAttemptId = createUploadAttemptId();
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
      try {
        const payload = JSON.parse(xhr.responseText || '{}') as { record?: ActivityRecord } & ApiErrorPayload;
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
      fileName: input.file.name,
      mimeType: input.file.type,
      mediaType: input.mediaType || (input.file.type.startsWith('video/') ? 'video' : 'photo'),
      durationSeconds: input.durationSeconds,
      dataBase64,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      category: input.category,
      description: input.description,
      visibility: input.visibility,
      createdByName: input.createdByName,
    }));
  });
}

export function cancelActiveActivityUpload(): boolean {
  const current = Array.from(ACTIVE_UPLOADS.values()).at(-1);
  if (!current) return false;
  current.abort();
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

export async function listActivityRecords(patientId: string): Promise<ActivityRecord[]> {
  const result = await post<{ records: ActivityRecord[] }>({ action: 'listRecords', patientId });
  return Array.isArray(result.records) ? result.records : [];
}

export async function updateActivityRecordMetadata(record: ActivityRecord, values: { category: ActivityRecordCategory; description: string; visibility: ActivityRecordVisibility }): Promise<void> {
  await post({ action: 'updateMetadata', recordId: record.id, patientId: record.patientId, ...values });
  notifyActivityRecordsChanged(record.patientId);
}

export async function deleteActivityRecord(record: ActivityRecord): Promise<void> {
  await post({ action: 'deleteRecord', recordId: record.id, patientId: record.patientId });
  SIGNED_URL_CACHE.delete(record.id);
  notifyActivityRecordsChanged(record.patientId);
}

export async function hasPatientActivityRecords(patientId: string): Promise<boolean> {
  const result = await post<{ hasRecords: boolean }>({ action: 'hasRecords', patientId });
  return result.hasRecords;
}

export function getActivityRecordErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const messages: Record<string, string> = {
    'activity-records/authorization-required': 'A autorização para registro interno está pendente ou não foi concedida.',
    'activity-records/duplicate': 'Esta mesma mídia já foi registrada para a sessão selecionada.',
    'activity-records/upload-in-progress': 'Esta mídia já está sendo enviada para a sessão selecionada.',
    'activity-records/sharing-not-authorized': 'O compartilhamento com o responsável não está autorizado.',
    'activity-records/hash-mismatch': 'A integridade da mídia não pôde ser confirmada. Prepare o arquivo novamente.',
    'activity-records/invalid-file-signature': 'O conteúdo do arquivo não corresponde a uma mídia válida.',
    'activity-records/upload-cancelled': 'O envio da mídia foi cancelado.',
    'activity-records/upload-timeout': 'O envio excedeu o tempo limite e foi interrompido.',
    'activity-records/file-too-large': 'A mídia excedeu o limite permitido.',
    'activity-records/session-mismatch': 'A sessão selecionada não pertence a esta criança.',
    'activity-records/patient-not-found': 'O cadastro da criança não foi encontrado.',
    'activity-records/session-not-found': 'A sessão selecionada não foi encontrada.',
  };
  if (code && messages[code]) return messages[code];
  return error instanceof Error && error.message ? error.message : 'Não foi possível concluir o registro da atividade.';
}
