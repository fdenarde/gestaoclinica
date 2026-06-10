import crypto from 'crypto';

export const MAX_ACTIVITY_PHOTO_BYTES = 1_800_000;
export const ACTIVITY_CATEGORIES = new Set([
  'Atividade pedagógica', 'Atenção', 'Memória', 'Linguagem', 'Raciocínio lógico',
  'Coordenação motora', 'Coordenação visuomotora', 'Funções executivas',
  'Atividade lúdica', 'Evolução', 'Devolutiva', 'Outro',
]);
export const ACTIVITY_VISIBILITIES = new Set(['internal_only', 'share_allowed', 'do_not_share']);
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

function hasExpectedImageSignature(buffer, mimeType) {
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
  return false;
}

export function decodeActivityPhoto(dataBase64, mimeType) {
  if (!ALLOWED_TYPES.has(mimeType)) throw activityError('activity-records/invalid-file-type', 'Selecione uma imagem JPG, PNG ou WEBP.');
  let buffer;
  try { buffer = Buffer.from(String(dataBase64 || ''), 'base64'); }
  catch { throw activityError('activity-records/invalid-file', 'O conteúdo da foto é inválido.'); }
  if (buffer.length <= 0) throw activityError('activity-records/empty-file', 'A foto enviada está vazia.');
  if (buffer.length > MAX_ACTIVITY_PHOTO_BYTES) throw activityError('activity-records/file-too-large', 'A foto preparada deve ter no máximo 1,8 MB.', 413);
  if (!hasExpectedImageSignature(buffer, mimeType)) {
    throw activityError('activity-records/invalid-file-signature', 'O conteúdo do arquivo não corresponde a uma imagem válida.');
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
  if (!patientId) throw activityError('activity-records/missing-patient-id', 'Criança não identificada.');
  if (!sessionId) throw activityError('activity-records/missing-session-id', 'Sessão não identificada.');
  if (!uploadAttemptId) throw activityError('activity-records/missing-upload-id', 'Tentativa de envio não identificada.');
  if (!ACTIVITY_CATEGORIES.has(category)) throw activityError('activity-records/invalid-category', 'Selecione uma categoria válida.');
  if (!ACTIVITY_VISIBILITIES.has(visibility)) throw activityError('activity-records/invalid-visibility', 'Selecione uma visibilidade válida.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw activityError('activity-records/invalid-hash', 'A assinatura da foto é inválida.');
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 5000 || height > 5000) {
    throw activityError('activity-records/invalid-dimensions', 'As dimensões da foto são inválidas.');
  }
  return {
    patientId, sessionId, uploadAttemptId, category, visibility, sha256, width, height,
    description: sanitizeText(body.description, 2000),
    createdByName: sanitizeText(body.createdByName, 160) || 'Usuário',
    fileName: sanitizeText(body.fileName, 180) || 'atividade.jpg',
    mimeType: sanitizeText(body.mimeType, 80),
  };
}

export function buildActivityDedupeKey({ workspaceId, patientId, sessionId, sha256 }) {
  return crypto.createHash('sha256').update(`${workspaceId}:${patientId}:${sessionId}:${sha256}`).digest('hex');
}

export function canRecordActivity(patient) {
  return patient?.activityMediaAuthorization?.internalRecordingStatus === 'authorized';
}
