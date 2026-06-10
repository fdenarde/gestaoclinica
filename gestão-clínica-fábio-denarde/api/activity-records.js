import crypto from 'crypto';
import { resolveAccessContext } from './_lib/accessContext.js';
import {
  createSignedActivityUrl,
  deleteActivityPhotoFromDrive,
  fetchActivityPhotoFromDrive,
  getActivityDriveMetadata,
  assertOwnedActivityFile,
  uploadActivityPhotoToDrive,
  verifySignedActivityRequest,
} from './_lib/activityRecordsDrive.js';
import {
  activityRecordRef,
  cancelUploadAttempt,
  finalizeActivityRecord,
  getActivityRecord,
  hasActivityRecords,
  listActivityRecords,
  markActivityFailure,
  requirePatient,
  requirePatientAndSession,
  reserveActivityRecord,
  updateActivityMetadata,
} from './_lib/activityRecordsRepository.js';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_VISIBILITIES,
  activityError,
  buildActivityDedupeKey,
  canRecordActivity,
  decodeActivityPhoto,
  sanitizeText,
  validateUploadInput,
} from './_lib/activityRecordsValidation.js';

const ALLOWED_ORIGINS = new Set([
  'https://gestaoclinica-solucoes.vercel.app',
  'https://fdenarde.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);

function setSecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  const origin = String(req.headers?.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); }
  catch { throw activityError('activity-records/invalid-json', 'A requisição enviada é inválida.'); }
}

function sendError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const code = error?.code || 'activity-records/internal-error';
  const message = error?.message || 'Ocorreu um erro inesperado no registro de atividades.';
  if (statusCode >= 500) console.error('[ACTIVITY RECORDS API]', code, message, error?.details || '');
  res.status(statusCode).json({ error: { code, message } });
}

function normalizeSessionDate(session) {
  const date = sanitizeText(session.date, 10);
  const time = sanitizeText(session.time, 5) || '00:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw activityError('activity-records/invalid-session-date', 'A data ou o horário da sessão é inválido.', 409);
  }
  const parsed = new Date(`${date}T${time}:00-03:00`);
  if (Number.isNaN(parsed.getTime())) throw activityError('activity-records/invalid-session-date', 'A data ou o horário da sessão é inválido.', 409);
  return parsed;
}

export default async function handler(req, res) {
  setSecurityHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET' && req.query?.mode === 'file') {
      const values = {
        fileId: String(req.query.fileId || ''),
        ownerUserId: String(req.query.owner || ''),
        patientId: String(req.query.patientId || ''),
        recordId: String(req.query.recordId || ''),
        expires: String(req.query.expires || ''),
        signature: String(req.query.signature || ''),
      };
      verifySignedActivityRequest(values);
      const photo = await fetchActivityPhotoFromDrive(values.fileId, values);
      res.setHeader('Content-Type', photo.mimeType);
      res.setHeader('Content-Length', String(photo.buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=60');
      return res.status(200).send(photo.buffer);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return res.status(405).json({ error: { code: 'activity-records/method-not-allowed', message: 'Método não permitido.' } });
    }

    const context = await resolveAccessContext(req);
    const body = parseBody(req);

    if (body.action === 'uploadPhoto') {
      const input = validateUploadInput(body);
      const { patient, session } = await requirePatientAndSession(context, input.patientId, input.sessionId);
      if (!canRecordActivity(patient)) throw activityError('activity-records/authorization-required', 'O registro interno de fotos não está autorizado para esta criança.', 409);
      if (input.visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }
      const fileBuffer = decodeActivityPhoto(body.dataBase64, input.mimeType);
      const actualSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualSha256 !== input.sha256) {
        throw activityError('activity-records/hash-mismatch', 'A integridade da foto não pôde ser confirmada. Prepare o arquivo novamente.', 409);
      }
      const dedupeKey = buildActivityDedupeKey({ workspaceId: context.workspaceId, patientId: input.patientId, sessionId: input.sessionId, sha256: actualSha256 });

      const recordId = dedupeKey;
      const ref = activityRecordRef(context, input.patientId, recordId);
      const activityDate = normalizeSessionDate(session);
      const authorizationSnapshot = patient.activityMediaAuthorization;
      await reserveActivityRecord(context, input.patientId, recordId, {
        id: recordId,
        schemaVersion: 1,
        workspaceId: context.workspaceId,
        ownerUserId: context.ownerUserId,
        patientId: input.patientId,
        sessionId: input.sessionId,
        sessionDate: session.date,
        sessionTime: session.time,
        sessionNumber: Number.isFinite(Number(session.packageNumber)) ? Number(session.packageNumber) : null,
        sessionType: session.type || '',
        sessionStatusSnapshot: session.status || 'Agendada',
        createdByUserId: context.userId,
        createdByName: input.createdByName,
        activityAt: activityDate.toISOString(),
        category: input.category,
        description: input.description,
        mediaType: 'photo',
        visibility: input.visibility,
        storageProvider: 'google-drive',
        driveFileId: '',
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: fileBuffer.length,
        width: input.width,
        height: input.height,
        sha256: actualSha256,
        status: 'uploading',
        uploadStatus: 'uploading',
        uploadAttemptId: input.uploadAttemptId,
        dedupeKey,
        shareStatus: 'not_shared',
        authorizationSnapshot,
      });

      let uploaded = null;
      try {
        uploaded = await uploadActivityPhotoToDrive({ context, patientId: input.patientId, sessionId: input.sessionId, recordId, fileName: input.fileName, mimeType: input.mimeType, fileBuffer, sessionDate: session.date });
        await ref.set({
          driveFileId: uploaded.id,
          driveFolderId: uploaded.folderId,
          fileName: uploaded.name,
          mimeType: uploaded.mimeType,
          fileSize: Number(uploaded.size || fileBuffer.length),
        }, { merge: true });
        const latest = await ref.get();
        if (latest.data()?.status === 'cancelled') {
          await deleteActivityPhotoFromDrive(uploaded.id, { ownerUserId: context.ownerUserId, patientId: input.patientId, recordId });
          throw activityError('activity-records/upload-cancelled', 'O envio da foto foi cancelado.', 409);
        }
        const record = await finalizeActivityRecord(ref, {
          driveFileId: uploaded.id,
          driveFolderId: uploaded.folderId,
          fileName: uploaded.name,
          mimeType: uploaded.mimeType,
          fileSize: Number(uploaded.size || fileBuffer.length),
        });
        return res.status(201).json({ record });
      } catch (error) {
        let rollbackFailed = false;
        if (uploaded?.id) {
          try {
            await deleteActivityPhotoFromDrive(uploaded.id, { ownerUserId: context.ownerUserId, patientId: input.patientId, recordId });
          } catch (cleanupError) {
            rollbackFailed = true;
            console.error('[ACTIVITY RECORDS API] rollback drive:', cleanupError);
          }
        }

        if (rollbackFailed) {
          await ref.set({
            driveFileId: uploaded?.id || '',
            driveFolderId: uploaded?.folderId || '',
            fileName: uploaded?.name || input.fileName,
            mimeType: uploaded?.mimeType || input.mimeType,
            fileSize: Number(uploaded?.size || fileBuffer.length),
          }, { merge: true }).catch(() => undefined);
          await markActivityFailure(ref, error?.code === 'activity-records/upload-cancelled' ? 'cancelled' : 'failed', error?.message);
        } else {
          await ref.delete().catch(async () => {
            await markActivityFailure(ref, error?.code === 'activity-records/upload-cancelled' ? 'cancelled' : 'failed', error?.message);
          });
        }
        throw error;
      }
    }

    if (body.action === 'cancelUpload') {
      const patientId = sanitizeText(body.patientId, 128);
      const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
      if (!patientId || !uploadAttemptId) throw activityError('activity-records/invalid-cancel-request', 'Não foi possível identificar o envio para cancelamento.');
      const record = await cancelUploadAttempt(context, patientId, uploadAttemptId);
      if (record?.driveFileId && !record.alreadyCompleted && !record.cancellationIgnored) {
        await deleteActivityPhotoFromDrive(record.driveFileId, { ownerUserId: context.ownerUserId, patientId, recordId: record.id }).catch(() => undefined);
      }
      return res.status(200).json({ cancelled: Boolean(record && !record.alreadyCompleted && !record.cancellationIgnored), completed: Boolean(record?.alreadyCompleted) });
    }

    if (body.action === 'getFileUrl') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const { data } = await getActivityRecord(context, patientId, recordId);
      if (data.status !== 'active' && data.status !== 'delete_failed') throw activityError('activity-records/record-unavailable', 'A foto não está disponível.', 409);
      const metadata = await getActivityDriveMetadata(data.driveFileId);
      assertOwnedActivityFile(metadata, { ownerUserId: context.ownerUserId, patientId, recordId });
      return res.status(200).json(createSignedActivityUrl({ req, fileId: data.driveFileId, ownerUserId: context.ownerUserId, patientId, recordId }));
    }

    if (body.action === 'updateMetadata') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const category = sanitizeText(body.category, 80);
      const visibility = sanitizeText(body.visibility, 40);
      if (!ACTIVITY_CATEGORIES.has(category)) throw activityError('activity-records/invalid-category', 'Selecione uma categoria válida.');
      if (!ACTIVITY_VISIBILITIES.has(visibility)) throw activityError('activity-records/invalid-visibility', 'Selecione uma visibilidade válida.');
      const patient = await requirePatient(context, patientId);
      if (visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }
      await updateActivityMetadata(context, patientId, recordId, { category, visibility, description: sanitizeText(body.description, 2000), updatedByUserId: context.userId });
      return res.status(200).json({ updated: true });
    }

    if (body.action === 'deleteRecord') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const { ref, data } = await getActivityRecord(context, patientId, recordId);
      await ref.set({ status: 'deleting', uploadStatus: 'deleting' }, { merge: true });
      try {
        if (data.driveFileId) await deleteActivityPhotoFromDrive(data.driveFileId, { ownerUserId: context.ownerUserId, patientId, recordId });
        await ref.delete();
      } catch (error) {
        await ref.set({ status: 'delete_failed', uploadStatus: 'delete_failed', deleteFailureMessage: String(error?.message || '').slice(0, 500) }, { merge: true });
        throw error;
      }
      return res.status(200).json({ deleted: true });
    }

    if (body.action === 'listRecords') {
      const patientId = sanitizeText(body.patientId, 128);
      if (!patientId) throw activityError('activity-records/invalid-patient', 'Não foi possível identificar a criança.');
      return res.status(200).json({ records: await listActivityRecords(context, patientId) });
    }

    if (body.action === 'hasRecords') {
      const patientId = sanitizeText(body.patientId, 128);
      return res.status(200).json({ hasRecords: await hasActivityRecords(context, patientId) });
    }

    throw activityError('activity-records/unknown-action', 'Ação desconhecida.');
  } catch (error) {
    sendError(res, error);
  }
}
