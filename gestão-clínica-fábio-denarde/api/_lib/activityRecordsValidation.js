import crypto from 'crypto';

export const MAX_ACTIVITY_PHOTO_BYTES = 1_800_000;
export const MAX_ACTIVITY_VIDEO_BYTES = 600 * 1024 * 1024;
export const MAX_ACTIVITY_VIDEO_CHUNK_BYTES = 2 * 1024 * 1024;
export const ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES = 256 * 1024;

export const ACTIVITY_CATEGORIES = new Set([
  'Atividade pedagógica', 'Atenção', 'Memória', 'Linguagem', 'Raciocínio lógico',
  'Coordenação motora', 'Coordenação visuomotora', 'Funções executivas',
  'Atividade lúdica', 'Evolução', 'Devolutiva', 'Outro',
]);

export const ACTIVITY_VISIBILITIES = new Set(['internal_only', 'share_allowed']);

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_TYPES = new Set([...ALLOWED_PHOTO_TYPES, ...ALLOWED_VIDEO_TYPES]);

export function activityError(code, message, statusCode = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

export function sanitizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function getMediaTypeFromMime(mimeType) {
  return String(mimeType || '').startsWith('video/') ? 'video' : 'photo';
}

function hasExpectedMediaSignature(buffer, mimeType) {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return buffer.length >= png.length && png.every((byte, index) => buffer[index] === byte);
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (mimeType === 'video/webm') {
    return buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  return false;
}

function decodeBase64Payload(dataBase64, invalidMessage) {
  const encoded = String(dataBase64 || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw activityError('activity-records/invalid-file', invalidMessage);
  }

  try {
    return Buffer.from(encoded, 'base64');
  } catch {
    throw activityError('activity-records/invalid-file', invalidMessage);
  }
}

export function decodeActivityMedia(dataBase64, mimeType) {
  if (!ALLOWED_TYPES.has(mimeType)) {
    throw activityError('activity-records/invalid-file-type', 'Selecione uma mídia JPG, PNG, WEBP, MP4, WEBM ou MOV.');
  }

  const mediaType = getMediaTypeFromMime(mimeType);
  const buffer = decodeBase64Payload(dataBase64, 'O conteúdo da mídia é inválido.');

  if (buffer.length <= 0) {
    throw activityError('activity-records/empty-file', 'A mídia enviada está vazia.');
  }

  const maxBytes = mediaType === 'video' ? MAX_ACTIVITY_VIDEO_BYTES : MAX_ACTIVITY_PHOTO_BYTES;
  if (buffer.length > maxBytes) {
    throw activityError(
      'activity-records/file-too-large',
      mediaType === 'video'
        ? 'O vídeo deve ter no máximo 600 MB.'
        : 'A foto preparada deve ter no máximo 1,8 MB.',
      413,
    );
  }

  if (!hasExpectedMediaSignature(buffer, mimeType)) {
    throw activityError('activity-records/invalid-file-signature', 'O conteúdo do arquivo não corresponde a uma mídia válida.');
  }

  return buffer;
}

export function decodeActivityPhoto(dataBase64, mimeType) {
  if (!ALLOWED_PHOTO_TYPES.has(mimeType)) {
    throw activityError('activity-records/invalid-file-type', 'Selecione uma imagem JPG, PNG ou WEBP.');
  }
  return decodeActivityMedia(dataBase64, mimeType);
}

export function decodeActivityVideoChunk(dataBase64, mimeType, { isFirstChunk = false } = {}) {
  if (!ALLOWED_VIDEO_TYPES.has(mimeType)) {
    throw activityError('activity-records/invalid-file-type', 'Selecione um vídeo MP4, WEBM ou MOV.');
  }

  const buffer = decodeBase64Payload(dataBase64, 'O conteúdo da parte do vídeo é inválido.');
  if (buffer.length <= 0) {
    throw activityError('activity-records/empty-chunk', 'A parte do vídeo enviada está vazia.');
  }
  if (buffer.length > MAX_ACTIVITY_VIDEO_CHUNK_BYTES) {
    throw activityError('activity-records/chunk-too-large', 'Cada parte do vídeo deve ter no máximo 2 MB.', 413);
  }
  if (isFirstChunk && !hasExpectedMediaSignature(buffer, mimeType)) {
    throw activityError('activity-records/invalid-file-signature', 'O conteúdo do arquivo não corresponde a um vídeo válido.');
  }
  return buffer;
}

export function validateUploadInput(body) {
  const patientId = sanitizeText(body.patientId, 128);
  const sessionId = sanitizeText(body.sessionId, 128);
  const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
  const category = sanitizeText(body.category, 80);
  const visibility = sanitizeText(body.visibility, 40);
  const sha256 = sanitizeText(body.sha256, 64).toLowerCase();
  const mimeType = sanitizeText(body.mimeType, 80);
  const mediaType = getMediaTypeFromMime(mimeType);

  if (!patientId) throw activityError('activity-records/missing-patient-id', 'Criança não identificada.');
  if (!sessionId) throw activityError('activity-records/missing-session-id', 'Sessão não identificada.');
  if (!uploadAttemptId) throw activityError('activity-records/missing-upload-id', 'Tentativa de envio não identificada.');
  if (!ACTIVITY_CATEGORIES.has(category)) throw activityError('activity-records/invalid-category', 'Selecione uma categoria válida.');
  if (!ACTIVITY_VISIBILITIES.has(visibility)) throw activityError('activity-records/invalid-visibility', 'Selecione uma visibilidade válida.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw activityError('activity-records/invalid-hash', 'A assinatura da mídia é inválida.');
  if (!ALLOWED_TYPES.has(mimeType)) throw activityError('activity-records/invalid-file-type', 'Selecione uma mídia JPG, PNG, WEBP, MP4, WEBM ou MOV.');

  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 10000 || height > 10000) {
    throw activityError('activity-records/invalid-dimensions', 'As dimensões da mídia são inválidas.');
  }

  const durationSeconds = Number(body.durationSeconds || 0);
  if (mediaType === 'video' && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 180)) {
    throw activityError('activity-records/invalid-duration', 'A duração do vídeo é inválida.');
  }

  return {
    patientId,
    sessionId,
    uploadAttemptId,
    category,
    visibility,
    sha256,
    width,
    height,
    mediaType,
    durationSeconds: mediaType === 'video' ? Math.round(durationSeconds) : undefined,
    description: sanitizeText(body.description, 2000),
    createdByName: sanitizeText(body.createdByName, 160) || 'Usuário',
    fileName: sanitizeText(body.fileName, 180) || (mediaType === 'video' ? 'atividade.mp4' : 'atividade.jpg'),
    mimeType,
  };
}

export function buildActivityDedupeKey({ workspaceId, patientId, sessionId, sha256 }) {
  return crypto.createHash('sha256').update(`${workspaceId}:${patientId}:${sessionId}:${sha256}`).digest('hex');
}

export function buildActivityVideoDedupeKey({ workspaceId, patientId, sessionId, fileName, fileSize, durationSeconds, lastModified }) {
  return crypto.createHash('sha256')
    .update(`${workspaceId}:${patientId}:${sessionId}:${fileName}:${fileSize}:${durationSeconds}:${lastModified}`)
    .digest('hex');
}

export function canRecordActivity(patient) {
  return patient?.activityMediaAuthorization?.internalRecordingStatus === 'authorized';
}
