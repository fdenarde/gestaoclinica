import { auth } from '../firebase';

export const MAX_PATIENT_PHOTO_SIZE_BYTES = 2_500_000;
export const PATIENT_PHOTO_UPLOAD_TIMEOUT_MS = 30_000;

const ALLOWED_PATIENT_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ACTIVE_UPLOADS = new Map<string, AbortController>();
const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();

const DRIVE_API_ENDPOINT =
  typeof window !== 'undefined' && window.location.hostname === 'fdenarde.github.io'
    ? 'https://gestaoclinica-solucoes.vercel.app/api/drive'
    : '/api/drive';

export interface UploadedPatientPhoto {
  driveFileId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
}

interface DriveApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

function createPhotoError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function validatePatientPhoto(file: File): void {
  if (!ALLOWED_PATIENT_PHOTO_TYPES.has(file.type)) {
    throw createPhotoError('drive-api/invalid-file-type', 'Selecione uma imagem JPG, PNG ou WEBP.');
  }

  if (file.size <= 0) {
    throw createPhotoError('drive-api/empty-file', 'O arquivo de imagem está vazio.');
  }

  if (file.size > MAX_PATIENT_PHOTO_SIZE_BYTES) {
    throw createPhotoError(
      'drive-api/file-too-large',
      'A foto deve ter no máximo 2,5 MB para ser enviada com segurança.',
    );
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw createPhotoError('drive-api/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente no sistema.');
  }

  const idToken = await user.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}

async function readDriveApiResponse<T>(response: Response): Promise<T> {
  let payload: T & DriveApiErrorPayload;
  try {
    payload = await response.json();
  } catch {
    throw createPhotoError(
      'drive-api/invalid-response',
      'O servidor de armazenamento retornou uma resposta inválida.',
    );
  }

  if (!response.ok) {
    throw createPhotoError(
      payload.error?.code || 'drive-api/request-failed',
      payload.error?.message || 'O Google Drive recusou a operação.',
    );
  }

  return payload;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(createPhotoError('drive-api/read-failed', 'Não foi possível ler a imagem selecionada.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function cancelPatientPhotoUpload(patientId: string): boolean {
  const controller = ACTIVE_UPLOADS.get(patientId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function uploadPatientPhoto(
  userId: string,
  patientId: string,
  file: File,
): Promise<UploadedPatientPhoto> {
  if (!userId || auth.currentUser?.uid !== userId) {
    throw createPhotoError('drive-api/user-mismatch', 'Usuário não identificado para enviar a foto.');
  }

  if (!patientId) {
    throw createPhotoError('drive-api/missing-patient-id', 'Atendente não identificado para enviar a foto.');
  }

  if (ACTIVE_UPLOADS.has(patientId)) {
    throw createPhotoError('drive-api/upload-in-progress', 'Já existe um envio de foto em andamento para este atendente.');
  }

  validatePatientPhoto(file);
  const dataBase64 = await fileToBase64(file);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort('timeout'), PATIENT_PHOTO_UPLOAD_TIMEOUT_MS);
  ACTIVE_UPLOADS.set(patientId, controller);

  try {
    const response = await fetch(DRIVE_API_ENDPOINT, {
      method: 'POST',
      headers: await getAuthHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        action: 'uploadPatientPhoto',
        patientId,
        fileName: file.name,
        mimeType: file.type,
        dataBase64,
      }),
    });

    const result = await readDriveApiResponse<{
      fileId: string;
      fileName: string;
      mimeType: string;
    }>(response);

    return {
      driveFileId: result.fileId,
      storagePath: `google-drive:${result.fileId}`,
      fileName: result.fileName,
      mimeType: result.mimeType,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timedOut = controller.signal.reason === 'timeout';
      throw createPhotoError(
        timedOut ? 'drive-api/upload-timeout' : 'drive-api/upload-canceled',
        timedOut
          ? 'O envio da foto excedeu 30 segundos e foi interrompido.'
          : 'O envio da foto foi cancelado.',
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    ACTIVE_UPLOADS.delete(patientId);
  }
}

function extractDriveFileId(fileIdOrPath?: string): string | null {
  if (!fileIdOrPath) return null;
  if (fileIdOrPath.startsWith('google-drive:')) return fileIdOrPath.slice('google-drive:'.length);
  if (fileIdOrPath.includes('/')) return null;
  return fileIdOrPath;
}

export async function deletePatientPhoto(fileIdOrPath?: string): Promise<void> {
  const fileId = extractDriveFileId(fileIdOrPath);
  if (!fileId) return;

  const response = await fetch(DRIVE_API_ENDPOINT, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      action: 'deletePatientPhoto',
      fileId,
    }),
  });

  await readDriveApiResponse<{ deleted: boolean }>(response);
  SIGNED_URL_CACHE.delete(fileId);
}

export async function getPatientPhotoSignedUrl(fileId: string, forceRefresh = false): Promise<string> {
  if (!fileId) return '';

  const cached = SIGNED_URL_CACHE.get(fileId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.url;
  }

  const response = await fetch(DRIVE_API_ENDPOINT, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      action: 'getPatientPhotoUrl',
      fileId,
    }),
  });

  const result = await readDriveApiResponse<{ url: string; expiresAt: number }>(response);
  SIGNED_URL_CACHE.set(fileId, result);
  return result.url;
}

export function getPatientPhotoErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;

  const mappedMessages: Record<string, string> = {
    'drive-api/not-configured': 'O Google Drive ainda não foi configurado no servidor.',
    'drive-api/oauth-failed': 'A autorização do Google Drive expirou ou foi revogada. Refaça a autorização.',
    'drive-api/upload-failed': 'O Google Drive recusou o envio da foto.',
    'drive-api/upload-timeout': 'O envio excedeu 30 segundos e foi interrompido. Verifique a conexão e a configuração do Google Drive.',
    'drive-api/upload-canceled': 'O envio da foto foi cancelado. Nenhum dado do cadastro foi alterado.',
    'drive-api/file-too-large': 'A foto deve ter no máximo 2,5 MB.',
    'drive-api/invalid-file-type': 'Selecione uma imagem JPG, PNG ou WEBP.',
    'drive-api/missing-auth-token': 'Sua sessão não foi identificada. Entre novamente no sistema.',
    'drive-api/invalid-auth-token': 'Sua sessão expirou. Entre novamente no sistema.',
    'drive-api/file-not-found': 'A foto não foi encontrada no Google Drive.',
    'drive-api/forbidden-file': 'Você não tem permissão para acessar esta foto.',
  };

  if (code && mappedMessages[code]) return mappedMessages[code];

  if (error instanceof Error && error.message) {
    if (error.message.trim().startsWith('{')) {
      return 'Não foi possível confirmar a gravação do cadastro. Nenhuma alteração foi dada como concluída.';
    }
    return error.message;
  }

  return 'Não foi possível salvar a foto. Tente novamente.';
}
