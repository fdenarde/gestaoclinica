import crypto from 'crypto';
import { getGoogleDriveAccessToken } from './googleDrive.js';
import { activityError } from './activityRecordsValidation.js';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SIGNED_URL_TTL_SECONDS = 10 * 60;

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

export async function ensureActivityPhotoFolder({ workspaceId, patientId, sessionDate }) {
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
  const photos = await ensureFolder(accessToken, monthFolder, 'Fotos', { category: 'activity-photos', workspaceId, patientId, year, month });
  return { accessToken, folderId: photos };
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

export async function uploadActivityPhotoToDrive({ context, patientId, sessionId, recordId, fileName, mimeType, fileBuffer, sessionDate }) {
  const { accessToken, folderId } = await ensureActivityPhotoFolder({ workspaceId: context.workspaceId, patientId, sessionDate });
  const extension = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  const driveName = `atividade-${sanitizeName(patientId)}-${sanitizeName(sessionId)}-${Date.now()}-${sanitizeName(fileName).replace(/\.[^.]+$/, '')}${extension}`;
  const metadata = {
    name: driveName,
    parents: [folderId],
    appProperties: {
      category: 'activity-record-photo',
      workspaceId: context.workspaceId,
      ownerUserId: context.ownerUserId,
      patientId,
      sessionId,
      activityRecordId: recordId,
    },
  };
  const multipart = makeMultipartBody(metadata, fileBuffer, mimeType);
  const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,parents,appProperties`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart.boundary}`, 'Content-Length': String(multipart.body.length) },
    body: multipart.body,
  });
  if (!response.ok) throw activityError('activity-records/upload-failed', 'O Google Drive recusou o envio da foto.', 502, await readGoogleError(response));
  const file = await response.json();
  return { ...file, folderId };
}

export async function getActivityDriveMetadata(fileId) {
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,trashed,appProperties`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) throw activityError('activity-records/file-not-found', 'A foto não foi encontrada no Google Drive.', 404);
  if (!response.ok) throw activityError('activity-records/metadata-failed', 'Não foi possível confirmar a foto no Google Drive.', 502, await readGoogleError(response));
  return response.json();
}

export function assertOwnedActivityFile(metadata, { ownerUserId, patientId, recordId }) {
  const props = metadata?.appProperties || {};
  if (metadata?.trashed || props.category !== 'activity-record-photo' || props.ownerUserId !== ownerUserId || props.patientId !== patientId || props.activityRecordId !== recordId) {
    throw activityError('activity-records/forbidden-file', 'Você não tem permissão para acessar esta foto.', 403);
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
  if (!response.ok) throw activityError('activity-records/delete-failed', 'Não foi possível remover a foto do Google Drive.', 502, await readGoogleError(response));
}

function signingSecret() { return requireEnv('DRIVE_FILE_SIGNING_SECRET'); }
function signingPayload({ fileId, ownerUserId, patientId, recordId, expires }) { return `${fileId}:${ownerUserId}:${patientId}:${recordId}:${expires}`; }
function sign(values) { return crypto.createHmac('sha256', signingSecret()).update(signingPayload(values)).digest('hex'); }

export function createSignedActivityUrl({ req, fileId, ownerUserId, patientId, recordId }) {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const signature = sign({ fileId, ownerUserId, patientId, recordId, expires });
  const protocol = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers?.host || 'localhost:3000';
  const query = new URLSearchParams({ mode: 'file', fileId, owner: ownerUserId, patientId, recordId, expires: String(expires), signature });
  return { url: `${protocol}://${host}/api/activity-records?${query}`, expiresAt: expires * 1000 };
}

export function verifySignedActivityRequest(values) {
  const expires = Number(values.expires);
  if (!values.fileId || !values.ownerUserId || !values.patientId || !values.recordId || !Number.isFinite(expires) || !values.signature) throw activityError('activity-records/invalid-signed-url', 'O endereço temporário da foto é inválido.', 403);
  const now = Math.floor(Date.now() / 1000);
  if (expires < now || expires > now + SIGNED_URL_TTL_SECONDS + 60) throw activityError('activity-records/expired-signed-url', 'O endereço temporário da foto expirou.', 403);
  const expected = sign({ ...values, expires });
  const actualBuffer = Buffer.from(String(values.signature), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) throw activityError('activity-records/invalid-signature', 'A assinatura da foto é inválida.', 403);
}

export async function fetchActivityPhotoFromDrive(fileId, ownership) {
  const metadata = await getActivityDriveMetadata(fileId);
  assertOwnedActivityFile(metadata, ownership);
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw activityError('activity-records/download-failed', 'Não foi possível carregar a foto do Google Drive.', 502, await readGoogleError(response));
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType: metadata.mimeType || 'image/jpeg', fileName: metadata.name || 'atividade.jpg' };
}
