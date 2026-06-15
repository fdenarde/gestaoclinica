import crypto from 'crypto';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_PHOTO_BYTES = 2_500_000;
const MAX_RESPONSIBLE_DOCUMENT_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 10 * 60;

const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_RESPONSIBLE_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

let accessTokenCache = null;

function createDriveError(code, message, statusCode = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw createDriveError(
      'drive-api/not-configured',
      `A integração com o Google Drive ainda não foi configurada. Variável ausente: ${name}.`,
      503,
    );
  }
  return value;
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function readGoogleError(response) {
  const text = await response.text().catch(() => '');
  const json = safeJson(text);
  return {
    status: response.status,
    message: json?.error?.message || json?.error_description || text || response.statusText,
    raw: json || text,
  };
}

export async function getGoogleDriveAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_DRIVE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
    refresh_token: requireEnv('GOOGLE_DRIVE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError(
      'drive-api/oauth-failed',
      'O Google recusou a autorização do Drive. Refaça a autorização da conta de armazenamento.',
      502,
      googleError,
    );
  }

  const tokenData = await response.json();
  accessTokenCache = {
    token: tokenData.access_token,
    expiresAt: Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000,
  };

  return accessTokenCache.token;
}

function sanitizeFileName(fileName) {
  const normalized = String(fileName || 'foto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'foto';
}

function decodePhotoPayload(dataBase64, mimeType) {
  if (!ALLOWED_PHOTO_TYPES.has(mimeType)) {
    throw createDriveError(
      'drive-api/invalid-file-type',
      'Selecione uma imagem JPG, PNG ou WEBP.',
      400,
    );
  }

  let buffer;
  try {
    buffer = Buffer.from(String(dataBase64 || ''), 'base64');
  } catch {
    throw createDriveError('drive-api/invalid-file', 'O conteúdo da imagem é inválido.', 400);
  }

  if (buffer.length <= 0) {
    throw createDriveError('drive-api/empty-file', 'O arquivo de imagem está vazio.', 400);
  }

  if (buffer.length > MAX_PHOTO_BYTES) {
    throw createDriveError(
      'drive-api/file-too-large',
      'A foto deve ter no máximo 2,5 MB para ser enviada com segurança pela Vercel.',
      413,
    );
  }

  return buffer;
}

function makeMultipartBody(metadata, fileBuffer, mimeType) {
  const boundary = `clinic-${crypto.randomBytes(18).toString('hex')}`;
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    boundary,
    body: Buffer.concat([prefix, fileBuffer, suffix]),
  };
}

export async function uploadPatientPhotoToDrive({ ownerUserId, patientId, fileName, mimeType, dataBase64 }) {
  const rootFolderId = requireEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  const fileBuffer = decodePhotoPayload(dataBase64, mimeType);
  const accessToken = await getGoogleDriveAccessToken();
  const extension = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  const safeOriginalName = sanitizeFileName(fileName).replace(/\.(jpe?g|png|webp)$/i, '');
  const driveName = `atendente-${sanitizeFileName(patientId)}-${Date.now()}-${safeOriginalName}${extension}`;

  const metadata = {
    name: driveName,
    parents: [rootFolderId],
    appProperties: {
      ownerUserId,
      patientId,
      category: 'patient-photo',
    },
  };

  const multipart = makeMultipartBody(metadata, fileBuffer, mimeType);
  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,appProperties`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${multipart.boundary}`,
        'Content-Length': String(multipart.body.length),
      },
      body: multipart.body,
    },
  );

  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError(
      'drive-api/upload-failed',
      'O Google Drive recusou o envio da foto.',
      502,
      googleError,
    );
  }

  return response.json();
}


export async function createResponsibleDocumentUploadSession({
  ownerUserId,
  patientId,
  responsibleUid,
  documentId,
  fileName,
  mimeType,
  fileSize,
  browserOrigin = '',
}) {
  const normalizedType = String(mimeType || '').trim().toLowerCase();
  const normalizedSize = Number(fileSize || 0);
  if (!ALLOWED_RESPONSIBLE_DOCUMENT_TYPES.has(normalizedType)) {
    throw createDriveError(
      'drive-api/invalid-document-type',
      'Envie um documento PDF, DOCX, JPG, PNG, WEBP ou HEIC.',
      400,
    );
  }
  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0) {
    throw createDriveError('drive-api/empty-document', 'O documento selecionado está vazio.', 400);
  }
  if (normalizedSize > MAX_RESPONSIBLE_DOCUMENT_BYTES) {
    throw createDriveError('drive-api/document-too-large', 'O documento deve ter no máximo 20 MB.', 413);
  }

  const rootFolderId = requireEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  const accessToken = await getGoogleDriveAccessToken();
  const safeOriginalName = sanitizeFileName(fileName || 'documento');
  const driveName = `documento-responsavel-${sanitizeFileName(patientId)}-${Date.now()}-${safeOriginalName}`;
  const metadata = {
    name: driveName,
    parents: [rootFolderId],
    appProperties: {
      category: 'responsible-portal-document',
      ownerUserId,
      patientId,
      responsibleUid,
      documentId,
      originalFileName: safeOriginalName.slice(0, 100),
    },
  };

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,mimeType,size,appProperties`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': normalizedType,
        'X-Upload-Content-Length': String(normalizedSize),
        ...(browserOrigin ? { Origin: browserOrigin } : {}),
      },
      body: JSON.stringify(metadata),
    },
  );

  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError(
      'drive-api/document-upload-session-failed',
      'Não foi possível preparar o envio do documento ao Google Drive.',
      502,
      googleError,
    );
  }

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) {
    throw createDriveError(
      'drive-api/document-upload-session-missing',
      'O Google Drive não retornou o endereço temporário para o documento.',
      502,
    );
  }

  return { uploadUrl, driveName };
}

export function assertOwnedResponsibleDocument(metadata, ownerUserId, patientId = '') {
  const app = metadata?.appProperties || {};
  if (
    metadata?.trashed
    || app.category !== 'responsible-portal-document'
    || app.ownerUserId !== ownerUserId
    || (patientId && app.patientId !== patientId)
  ) {
    throw createDriveError('drive-api/forbidden-document', 'Você não tem permissão para acessar este documento.', 403);
  }
}

export async function getDriveFileMetadata(fileId) {
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,trashed,appProperties`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (response.status === 404) {
    throw createDriveError('drive-api/file-not-found', 'A foto não foi encontrada no Google Drive.', 404);
  }

  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError('drive-api/metadata-failed', 'Não foi possível confirmar a foto no Google Drive.', 502, googleError);
  }

  return response.json();
}

export function assertOwnedPatientPhoto(metadata, ownerUserId) {
  if (
    metadata?.trashed ||
    metadata?.appProperties?.category !== 'patient-photo' ||
    metadata?.appProperties?.ownerUserId !== ownerUserId
  ) {
    throw createDriveError('drive-api/forbidden-file', 'Você não tem permissão para acessar esta foto.', 403);
  }
}

export async function deletePatientPhotoFromDrive(fileId, ownerUserId) {
  const metadata = await getDriveFileMetadata(fileId);
  assertOwnedPatientPhoto(metadata, ownerUserId);

  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404 || response.status === 204) return;
  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError('drive-api/delete-failed', 'Não foi possível remover a foto anterior do Google Drive.', 502, googleError);
  }
}

function getSigningSecret() {
  return requireEnv('DRIVE_FILE_SIGNING_SECRET');
}

function signaturePayload({ fileId, ownerUserId, expires }) {
  return `${fileId}:${ownerUserId}:${expires}`;
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
}

function preferredSignedUrlOrigin(req) {
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers?.host || 'localhost:3000';
  const fallback = `${protocol}://${host}`;
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return fallback;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    const isPrivateLan = (
      /^192\.168\./.test(hostname)
      || /^10\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
    const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    const isPrimaryProduction = origin === 'https://gestaoclinica-solucoes.vercel.app';
    if (isPrimaryProduction || (parsed.protocol === 'http:' && (isPrivateLan || isLoopback))) return origin;
  } catch {
    return fallback;
  }
  return fallback;
}

export function createSignedPhotoUrl({ req, fileId, ownerUserId }) {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const signature = signPayload(signaturePayload({ fileId, ownerUserId, expires }));
  const query = new URLSearchParams({
    mode: 'file',
    fileId,
    owner: ownerUserId,
    expires: String(expires),
    signature,
  });

  return {
    url: `${preferredSignedUrlOrigin(req)}/api/drive?${query.toString()}`,
    expiresAt: expires * 1000,
  };
}

export function verifySignedPhotoRequest({ fileId, ownerUserId, expires, signature }) {
  const expiresNumber = Number(expires);
  if (!fileId || !ownerUserId || !Number.isFinite(expiresNumber) || !signature) {
    throw createDriveError('drive-api/invalid-signed-url', 'O endereço temporário da foto é inválido.', 403);
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiresNumber < now || expiresNumber > now + SIGNED_URL_TTL_SECONDS + 60) {
    throw createDriveError('drive-api/expired-signed-url', 'O endereço temporário da foto expirou.', 403);
  }

  const expected = signPayload(signaturePayload({ fileId, ownerUserId, expires: expiresNumber }));
  const actualBuffer = Buffer.from(String(signature), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw createDriveError('drive-api/invalid-signature', 'A assinatura da foto é inválida.', 403);
  }
}


function responsibleDocumentSignaturePayload({ fileId, ownerUserId, expires }) {
  return `responsible-document:${fileId}:${ownerUserId}:${expires}`;
}

export function createSignedResponsibleDocumentUrl({ req, fileId, ownerUserId }) {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const signature = signPayload(responsibleDocumentSignaturePayload({ fileId, ownerUserId, expires }));
  const query = new URLSearchParams({
    mode: 'responsible-document',
    fileId,
    owner: ownerUserId,
    expires: String(expires),
    signature,
  });
  return {
    url: `${preferredSignedUrlOrigin(req)}/api/drive?${query.toString()}`,
    expiresAt: expires * 1000,
  };
}

export function verifySignedResponsibleDocumentRequest({ fileId, ownerUserId, expires, signature }) {
  const expiresNumber = Number(expires);
  if (!fileId || !ownerUserId || !Number.isFinite(expiresNumber) || !signature) {
    throw createDriveError('drive-api/invalid-document-url', 'O endereço temporário do documento é inválido.', 403);
  }
  const now = Math.floor(Date.now() / 1000);
  if (expiresNumber < now || expiresNumber > now + SIGNED_URL_TTL_SECONDS + 60) {
    throw createDriveError('drive-api/expired-document-url', 'O endereço temporário do documento expirou.', 403);
  }
  const expected = signPayload(responsibleDocumentSignaturePayload({
    fileId,
    ownerUserId,
    expires: expiresNumber,
  }));
  const actualBuffer = Buffer.from(String(signature), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw createDriveError('drive-api/invalid-document-signature', 'A assinatura do documento é inválida.', 403);
  }
}

export async function fetchResponsibleDocumentFromDrive(fileId, ownerUserId) {
  const metadata = await getDriveFileMetadata(fileId);
  assertOwnedResponsibleDocument(metadata, ownerUserId);
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError('drive-api/document-download-failed', 'Não foi possível carregar o documento do Google Drive.', 502, googleError);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_RESPONSIBLE_DOCUMENT_BYTES) {
    throw createDriveError('drive-api/document-too-large', 'O documento excede o limite permitido para download.', 413);
  }
  return {
    buffer,
    mimeType: metadata.mimeType || 'application/octet-stream',
    fileName: metadata.appProperties?.originalFileName || metadata.name || 'documento',
  };
}

export async function fetchPatientPhotoFromDrive(fileId, ownerUserId) {
  const metadata = await getDriveFileMetadata(fileId);
  assertOwnedPatientPhoto(metadata, ownerUserId);

  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const googleError = await readGoogleError(response);
    throw createDriveError('drive-api/download-failed', 'Não foi possível carregar a foto do Google Drive.', 502, googleError);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw createDriveError('drive-api/file-too-large', 'A foto excede o limite permitido para exibição.', 413);
  }

  return {
    buffer,
    mimeType: metadata.mimeType || 'application/octet-stream',
    fileName: metadata.name || 'foto',
  };
}
