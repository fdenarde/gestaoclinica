import crypto from 'crypto';
import { getGoogleDriveAccessToken } from './googleDrive.js';
import { activityError } from './activityRecordsValidation.js';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const UPLOAD_SESSION_CIPHER = 'aes-256-gcm';
export const MAX_ACTIVITY_MEDIA_RANGE_BYTES = 2 * 1024 * 1024;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw activityError('activity-records/not-configured', `Configuração ausente no servidor: ${name}.`, 503);
  return value;
}

async function readGoogleError(response) {
  const text = await response.text().catch(() => '');
  try { return JSON.parse(text); } catch { return text; }
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(accessToken, parentId, name) {
  const q = `mimeType='${FOLDER_MIME}' and name='${escapeDriveQuery(name)}' and '${escapeDriveQuery(parentId)}' in parents and trashed=false`;
  const response = await fetch(`${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw activityError('activity-records/folder-query-failed', 'Não foi possível localizar a pasta de armazenamento.', 502, await readGoogleError(response));
  const data = await response.json();
  return data.files?.[0]?.id || null;
}

async function createFolder(accessToken, parentId, name, appProperties = {}) {
  const response = await fetch(`${DRIVE_API_BASE}/files?fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties }),
  });
  if (!response.ok) throw activityError('activity-records/folder-create-failed', 'Não foi possível criar a pasta privada da atividade.', 502, await readGoogleError(response));
  return (await response.json()).id;
}

async function ensureFolder(accessToken, parentId, name, appProperties) {
  return (await findFolder(accessToken, parentId, name)) || createFolder(accessToken, parentId, name, appProperties);
}

export async function ensureActivityMediaFolders({
  workspaceId,
  patientId,
  sessionDate,
  mediaTypes = ['photo'],
}) {
  const accessToken = await getGoogleDriveAccessToken();
  const root = requireEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sessionDate || ''));
  if (!dateMatch) throw activityError('activity-records/invalid-session-date', 'A data da sessão é inválida.', 409);
  const [, year, month] = dateMatch;
  const workspaces = await ensureFolder(accessToken, root, 'Workspaces', { category: 'activity-root' });
  const workspace = await ensureFolder(accessToken, workspaces, workspaceId, { category: 'workspace', workspaceId });
  const patients = await ensureFolder(accessToken, workspace, 'Pacientes', { category: 'patients-root', workspaceId });
  const patient = await ensureFolder(accessToken, patients, patientId, { category: 'patient', workspaceId, patientId });
  const records = await ensureFolder(accessToken, patient, 'Registros de atividades', { category: 'activity-records-root', workspaceId, patientId });
  const yearFolder = await ensureFolder(accessToken, records, year, { category: 'activity-year', workspaceId, patientId, year });
  const monthFolder = await ensureFolder(accessToken, yearFolder, month, { category: 'activity-month', workspaceId, patientId, year, month });
  const normalizedTypes = Array.from(new Set(
    Array.from(mediaTypes || []).map(type => (type === 'video' ? 'video' : 'photo')),
  ));
  const folders = {};
  for (const mediaType of normalizedTypes) {
    const folderName = mediaType === 'video' ? 'Vídeos' : 'Fotos';
    folders[mediaType] = await ensureFolder(accessToken, monthFolder, folderName, {
      category: mediaType === 'video' ? 'activity-videos' : 'activity-photos',
      workspaceId,
      patientId,
      year,
      month,
    });
  }
  return { accessToken, folders };
}

export async function ensureActivityMediaFolder({ workspaceId, patientId, sessionDate, mediaType = 'photo' }) {
  const { accessToken, folders } = await ensureActivityMediaFolders({
    workspaceId,
    patientId,
    sessionDate,
    mediaTypes: [mediaType],
  });
  return { accessToken, folderId: folders[mediaType === 'video' ? 'video' : 'photo'] };
}

export async function ensureActivityPhotoFolder(args) {
  return ensureActivityMediaFolder({ ...args, mediaType: 'photo' });
}

function makeMultipartBody(metadata, fileBuffer, mimeType) {
  const boundary = `activity-${crypto.randomBytes(18).toString('hex')}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8');
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, body: Buffer.concat([prefix, fileBuffer, suffix]) };
}

function sanitizeName(value) {
  return String(value || 'atividade').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'atividade';
}

function extensionFromMime(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType === 'video/quicktime') return '.mov';
  if (mimeType === 'video/mp4') return '.mp4';
  return '.jpg';
}

export async function uploadActivityPhotoToDrive({ context, patientId, sessionId, recordId, fileName, mimeType, fileBuffer, sessionDate, mediaType }) {
  const resolvedMediaType = mediaType || (String(mimeType || '').startsWith('video/') ? 'video' : 'photo');
  const { accessToken, folderId } = await ensureActivityMediaFolder({ workspaceId: context.workspaceId, patientId, sessionDate, mediaType: resolvedMediaType });
  const extension = extensionFromMime(mimeType);
  const driveName = `atividade-${sanitizeName(patientId)}-${sanitizeName(sessionId)}-${Date.now()}-${sanitizeName(fileName).replace(/\.[^.]+$/, '')}${extension}`;
  const metadata = {
    name: driveName,
    parents: [folderId],
    appProperties: {
      category: 'activity-record-media',
      mediaType: resolvedMediaType,
      workspaceId: context.workspaceId,
      ownerUserId: context.ownerUserId,
      patientId,
      sessionId,
      activityRecordId: recordId,
    },
  };
  const multipart = makeMultipartBody(metadata, fileBuffer, mimeType);
  const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,parents,appProperties,md5Checksum,sha1Checksum,sha256Checksum`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart.boundary}`, 'Content-Length': String(multipart.body.length) },
    body: multipart.body,
  });
  if (!response.ok) throw activityError('activity-records/upload-failed', 'O Google Drive recusou o envio da mídia.', 502, await readGoogleError(response));
  const file = await response.json();
  return { ...file, folderId };
}

export async function createActivityResumableUpload({
  context,
  patientId,
  sessionId,
  recordId,
  fileName,
  mimeType,
  fileSize,
  sessionDate,
  mediaType,
  accessToken: preparedAccessToken,
  folderId: preparedFolderId,
  browserOrigin = '',
}) {
  const resolvedMediaType = mediaType || (String(mimeType || '').startsWith('video/') ? 'video' : 'photo');
  const preparedFolder = preparedAccessToken && preparedFolderId
    ? { accessToken: preparedAccessToken, folderId: preparedFolderId }
    : await ensureActivityMediaFolder({ workspaceId: context.workspaceId, patientId, sessionDate, mediaType: resolvedMediaType });
  const { accessToken, folderId } = preparedFolder;
  const extension = extensionFromMime(mimeType);
  const driveName = `atividade-${sanitizeName(patientId)}-${sanitizeName(sessionId)}-${Date.now()}-${sanitizeName(fileName).replace(/\.[^.]+$/, '')}${extension}`;
  const metadata = {
    name: driveName,
    parents: [folderId],
    appProperties: {
      category: 'activity-record-media',
      mediaType: resolvedMediaType,
      workspaceId: context.workspaceId,
      ownerUserId: context.ownerUserId,
      patientId,
      sessionId,
      activityRecordId: recordId,
    },
  };

  const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,mimeType,size,parents,appProperties,md5Checksum,sha1Checksum,sha256Checksum`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(fileSize),
      ...(browserOrigin ? { Origin: browserOrigin } : {}),
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) throw activityError('activity-records/upload-session-failed', 'Não foi possível iniciar o envio resumível da mídia no Google Drive.', 502, await readGoogleError(response));

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) throw activityError('activity-records/upload-session-missing', 'O Google Drive não retornou o endereço temporário de envio.', 502);

  return { uploadUrl, folderId, fileName: driveName };
}

function uploadSessionEncryptionKey() {
  return crypto.createHash('sha256').update(`activity-upload-session:${signingSecret()}`).digest();
}

export function protectActivityUploadSession(uploadUrl) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(UPLOAD_SESSION_CIPHER, uploadSessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(uploadUrl), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
}

export function revealActivityUploadSession(protectedValue) {
  try {
    const [ivValue, tagValue, encryptedValue] = String(protectedValue || '').split('.');
    if (!ivValue || !tagValue || !encryptedValue) throw new Error('invalid protected upload session');
    const decipher = crypto.createDecipheriv(UPLOAD_SESSION_CIPHER, uploadSessionEncryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw activityError('activity-records/invalid-upload-session', 'A sessão de envio do vídeo não pôde ser recuperada.', 409);
  }
}

export function parseActivityResumableRange(rangeHeader) {
  const match = /^bytes=0-(\d+)$/.exec(String(rangeHeader || '').trim());
  return match ? Number(match[1]) + 1 : 0;
}

async function parseResumableUploadResponse(response, totalSize) {
  if (response.status === 308) {
    return {
      completed: false,
      nextOffset: Math.min(totalSize, parseActivityResumableRange(response.headers.get('range'))),
      file: null,
    };
  }
  if (response.status === 200 || response.status === 201) {
    return { completed: true, nextOffset: totalSize, file: await response.json() };
  }
  if (response.status === 404 || response.status === 410) {
    throw activityError('activity-records/upload-session-expired', 'A sessão de envio do vídeo expirou. Inicie o envio novamente.', 409);
  }
  throw activityError('activity-records/upload-chunk-failed', 'O Google Drive recusou uma parte do vídeo.', 502, await readGoogleError(response));
}

export async function queryActivityResumableUpload({ uploadUrl, totalSize }) {
  let response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${totalSize}`,
      },
    });
  } catch (error) {
    throw activityError('activity-records/upload-status-failed', 'Não foi possível confirmar o andamento do vídeo no Google Drive.', 502, String(error?.message || error));
  }
  return parseResumableUploadResponse(response, totalSize);
}

export async function uploadActivityResumableChunk({ uploadUrl, chunkBuffer, start, totalSize, mimeType }) {
  const end = start + chunkBuffer.length - 1;
  let response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'Content-Length': String(chunkBuffer.length),
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      },
      body: chunkBuffer,
    });
  } catch (error) {
    const status = await queryActivityResumableUpload({ uploadUrl, totalSize }).catch(() => null);
    if (status && status.nextOffset > start) return status;
    throw activityError('activity-records/upload-chunk-failed', 'Falha de rede ao encaminhar uma parte do vídeo ao Google Drive.', 502, String(error?.message || error));
  }

  if (![200, 201, 308, 404, 410].includes(response.status) && !response.ok) {
    const status = await queryActivityResumableUpload({ uploadUrl, totalSize }).catch(() => null);
    if (status && status.nextOffset > start) return status;
  }
  return parseResumableUploadResponse(response, totalSize);
}

export async function getActivityDriveMetadata(fileId) {
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,trashed,appProperties,md5Checksum,sha1Checksum,sha256Checksum`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) throw activityError('activity-records/file-not-found', 'A mídia não foi encontrada no Google Drive.', 404);
  if (!response.ok) throw activityError('activity-records/metadata-failed', 'Não foi possível confirmar a mídia no Google Drive.', 502, await readGoogleError(response));
  return response.json();
}

export async function calculateActivityDriveFingerprint({
  fileId,
  ownership,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
  metadataLoader = getActivityDriveMetadata,
  accessTokenLoader = getGoogleDriveAccessToken,
}) {
  const metadata = await metadataLoader(fileId);
  assertOwnedActivityFile(metadata, ownership);
  const driveSha256 = String(metadata.sha256Checksum || '').toLowerCase();
  if (/^[a-f0-9]{64}$/.test(driveSha256)) {
    return {
      sha256: driveSha256,
      byteSize: Number(metadata.size || 0),
      source: 'drive-sha256',
      streamed: false,
      driveChecksums: {
        md5: String(metadata.md5Checksum || ''),
        sha1: String(metadata.sha1Checksum || ''),
        sha256: driveSha256,
      },
    };
  }

  const accessToken = await accessTokenLoader();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    );
  } catch (error) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      throw activityError(
        'activity-records/hash-verification-timeout',
        'A verificação da mídia antiga excedeu o tempo limite.',
        504,
      );
    }
    throw activityError(
      'activity-records/hash-verification-download-failed',
      'Não foi possível ler a mídia antiga para verificar duplicidade.',
      502,
      String(error?.message || error),
    );
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeoutId);
    throw activityError(
      'activity-records/hash-verification-download-failed',
      'Não foi possível ler a mídia antiga para verificar duplicidade.',
      502,
      response.body ? await readGoogleError(response) : undefined,
    );
  }

  const hasher = crypto.createHash('sha256');
  const reader = response.body.getReader();
  let byteSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      hasher.update(bytes);
      byteSize += bytes.byteLength;
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw activityError(
        'activity-records/hash-verification-timeout',
        'A verificação da mídia antiga excedeu o tempo limite.',
        504,
      );
    }
    throw activityError(
      'activity-records/hash-verification-read-failed',
      'A leitura da mídia antiga foi interrompida antes da verificação.',
      502,
      String(error?.message || error),
    );
  } finally {
    clearTimeout(timeoutId);
    reader.releaseLock();
  }

  const expectedSize = Number(metadata.size || 0);
  if (expectedSize > 0 && byteSize !== expectedSize) {
    throw activityError(
      'activity-records/hash-verification-size-mismatch',
      'A leitura da mídia antiga não retornou o tamanho completo esperado.',
      502,
    );
  }

  return {
    sha256: hasher.digest('hex'),
    byteSize,
    source: 'server-stream',
    streamed: true,
    driveChecksums: {
      md5: String(metadata.md5Checksum || ''),
      sha1: String(metadata.sha1Checksum || ''),
      sha256: '',
    },
  };
}

export function assertOwnedActivityFile(metadata, { ownerUserId, patientId, recordId, mediaType }) {
  const props = metadata?.appProperties || {};
  const allowedCategory = props.category === 'activity-record-media' || props.category === 'activity-record-photo';
  const mediaTypeMatches = !mediaType
    || (props.category === 'activity-record-photo' && mediaType === 'photo')
    || props.mediaType === mediaType;
  if (metadata?.trashed || !allowedCategory || !mediaTypeMatches || props.ownerUserId !== ownerUserId || props.patientId !== patientId || props.activityRecordId !== recordId) {
    throw activityError('activity-records/forbidden-file', 'Você não tem permissão para acessar esta mídia.', 403);
  }
}

export async function deleteActivityPhotoFromDrive(fileId, ownership) {
  let metadata;
  try {
    metadata = await getActivityDriveMetadata(fileId);
  } catch (error) {
    if (error?.code === 'activity-records/file-not-found') return;
    throw error;
  }
  assertOwnedActivityFile(metadata, ownership);
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404 || response.status === 204) return;
  if (!response.ok) throw activityError('activity-records/delete-failed', 'Não foi possível remover a mídia do Google Drive.', 502, await readGoogleError(response));
}

function signingSecret() { return requireEnv('DRIVE_FILE_SIGNING_SECRET'); }
function signingPayload({ fileId, ownerUserId, patientId, recordId, expires }) { return `${fileId}:${ownerUserId}:${patientId}:${recordId}:${expires}`; }
function sign(values) { return crypto.createHmac('sha256', signingSecret()).update(signingPayload(values)).digest('hex'); }

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

export function createSignedActivityUrl({ req, fileId, ownerUserId, patientId, recordId }) {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const signature = sign({ fileId, ownerUserId, patientId, recordId, expires });
  const query = new URLSearchParams({ mode: 'file', fileId, owner: ownerUserId, patientId, recordId, expires: String(expires), signature });
  return { url: `${preferredSignedUrlOrigin(req)}/api/activity-records?${query}`, expiresAt: expires * 1000 };
}

export function verifySignedActivityRequest(values) {
  const expires = Number(values.expires);
  if (!values.fileId || !values.ownerUserId || !values.patientId || !values.recordId || !Number.isFinite(expires) || !values.signature) throw activityError('activity-records/invalid-signed-url', 'O endereço temporário da mídia é inválido.', 403);
  const now = Math.floor(Date.now() / 1000);
  if (expires < now || expires > now + SIGNED_URL_TTL_SECONDS + 60) throw activityError('activity-records/expired-signed-url', 'O endereço temporário da mídia expirou.', 403);
  const expected = sign({ ...values, expires });
  const actualBuffer = Buffer.from(String(values.signature), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) throw activityError('activity-records/invalid-signature', 'A assinatura da mídia é inválida.', 403);
}

export function resolveActivityMediaRange(rangeHeader, totalSize, maxBytes = MAX_ACTIVITY_MEDIA_RANGE_BYTES) {
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw activityError('activity-records/invalid-media-size', 'O tamanho da mídia no Google Drive é inválido.', 502);
  }

  const value = String(rangeHeader || '').trim();
  if (!value) return { start: 0, end: Math.min(totalSize - 1, maxBytes - 1) };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    throw activityError('activity-records/invalid-range', 'A faixa solicitada para o vídeo é inválida.', 416, { totalSize });
  }

  let start;
  let requestedEnd;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw activityError('activity-records/invalid-range', 'A faixa solicitada para o vídeo é inválida.', 416, { totalSize });
    }
    const boundedLength = Math.min(suffixLength, maxBytes, totalSize);
    start = totalSize - boundedLength;
    requestedEnd = totalSize - 1;
  } else {
    start = Number(match[1]);
    requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= totalSize || requestedEnd < start) {
    throw activityError('activity-records/invalid-range', 'A faixa solicitada para o vídeo é inválida.', 416, { totalSize });
  }
  return {
    start,
    end: Math.min(requestedEnd, totalSize - 1, start + maxBytes - 1),
  };
}

export async function fetchActivityPhotoFromDrive(fileId, ownership, rangeHeader = '') {
  const metadata = await getActivityDriveMetadata(fileId);
  assertOwnedActivityFile(metadata, ownership);
  const mimeType = metadata.mimeType || 'application/octet-stream';
  const isVideo = mimeType.startsWith('video/');
  const totalSize = Number(metadata.size || 0);
  const shouldUseRange = isVideo && (Boolean(rangeHeader) || totalSize > MAX_ACTIVITY_MEDIA_RANGE_BYTES);
  const range = shouldUseRange ? resolveActivityMediaRange(rangeHeader, totalSize) : null;
  const accessToken = await getGoogleDriveAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (range) headers.Range = `bytes=${range.start}-${range.end}`;
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
  if (!response.ok) throw activityError('activity-records/download-failed', 'Não foi possível carregar a mídia do Google Drive.', 502, await readGoogleError(response));
  if (range && response.status !== 206) {
    throw activityError('activity-records/range-unsupported', 'O Google Drive não respeitou a faixa solicitada para o vídeo.', 502);
  }
  const responseLength = Number(response.headers.get('content-length') || 0);
  if (range && responseLength > MAX_ACTIVITY_MEDIA_RANGE_BYTES) {
    throw activityError('activity-records/range-too-large', 'O Google Drive retornou uma faixa de vídeo maior que o limite seguro.', 502);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (range && buffer.length > MAX_ACTIVITY_MEDIA_RANGE_BYTES) {
    throw activityError('activity-records/range-too-large', 'O Google Drive retornou uma faixa de vídeo maior que o limite seguro.', 502);
  }
  return {
    buffer,
    mimeType,
    fileName: metadata.name || 'atividade',
    statusCode: range ? 206 : 200,
    totalSize,
    contentRange: range ? `bytes ${range.start}-${range.start + buffer.length - 1}/${totalSize}` : '',
    acceptsRanges: isVideo,
  };
}
