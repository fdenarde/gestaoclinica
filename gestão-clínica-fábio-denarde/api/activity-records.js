import crypto from 'crypto';
import { resolveAccessContext } from './_lib/accessContext.js';
import {
  createSignedActivityUrl,
  deleteActivityPhotoFromDrive,
  fetchActivityPhotoFromDrive,
  getActivityDriveMetadata,
  assertOwnedActivityFile,
  uploadActivityPhotoToDrive,
  createActivityResumableUpload,
  protectActivityUploadSession,
  queryActivityResumableUpload,
  revealActivityUploadSession,
  uploadActivityResumableChunk,
  verifySignedActivityRequest,
} from './_lib/activityRecordsDrive.js';
import {
  activityRecordRef,
  cancelUploadAttempt,
  failActivityUpload,
  finalizeActivityRecord,
  getActivityRecord,
  hasActivityRecords,
  listActivityRecords,
  markActivityFailure,
  requirePatient,
  requirePatientAndSession,
  reserveActivityRecord,
  serializeRecord,
  updateActivityMetadata,
  updateActivityUploadProgress,
} from './_lib/activityRecordsRepository.js';
import {
  ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES,
  ACTIVITY_CATEGORIES,
  ACTIVITY_VISIBILITIES,
  MAX_ACTIVITY_VIDEO_CHUNK_BYTES,
  MAX_ACTIVITY_VIDEO_BYTES,
  activityError,
  buildActivityDedupeKey,
  buildActivityVideoDedupeKey,
  canRecordActivity,
  decodeActivityPhoto,
  decodeActivityVideoChunk,
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
  if (statusCode === 416 && Number(error?.details?.totalSize) > 0) {
    res.setHeader('Content-Range', `bytes */${Number(error.details.totalSize)}`);
  }
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
      const media = await fetchActivityPhotoFromDrive(values.fileId, values, req.headers?.range);
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Length', String(media.buffer.length));
      if (media.acceptsRanges) {
        res.setHeader('Accept-Ranges', 'bytes');
        const vary = String(res.getHeader('Vary') || '');
        res.setHeader('Vary', [vary, 'Range'].filter(Boolean).join(', '));
      }
      if (media.contentRange) res.setHeader('Content-Range', media.contentRange);
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=60');
      return res.status(media.statusCode).send(media.buffer);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return res.status(405).json({ error: { code: 'activity-records/method-not-allowed', message: 'Método não permitido.' } });
    }

    const context = await resolveAccessContext(req);
    const body = parseBody(req);

    if (body.action === 'prepareVideoUpload') {
      const input = validateUploadInput(body);
      if (input.mediaType !== 'video') throw activityError('activity-records/invalid-file-type', 'Esta rota aceita apenas vídeos.');
      const fileSize = Number(body.fileSize || 0);
      const lastModified = Number(body.lastModified || 0);
      if (!Number.isFinite(fileSize) || fileSize <= 0) throw activityError('activity-records/invalid-file-size', 'O tamanho do vídeo é inválido.');
      if (fileSize > MAX_ACTIVITY_VIDEO_BYTES) throw activityError('activity-records/file-too-large', 'O vídeo deve ter no máximo 600 MB.', 413);
      if (!Number.isFinite(lastModified) || lastModified <= 0) throw activityError('activity-records/invalid-file-date', 'A data do arquivo de vídeo é inválida.');

      const { patient, session } = await requirePatientAndSession(context, input.patientId, input.sessionId);
      if (!canRecordActivity(patient)) throw activityError('activity-records/authorization-required', 'O registro interno de mídias não está autorizado para esta criança.', 409);
      if (input.visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }

      const dedupeKey = buildActivityVideoDedupeKey({
        workspaceId: context.workspaceId,
        patientId: input.patientId,
        sessionId: input.sessionId,
        fileName: input.fileName,
        fileSize,
        durationSeconds: input.durationSeconds,
        lastModified,
      });

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
        mediaType: 'video',
        visibility: input.visibility,
        storageProvider: 'google-drive',
        driveFileId: '',
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize,
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds,
        sha256: input.sha256,
        status: 'uploading',
        uploadStatus: 'uploading',
        uploadAttemptId: input.uploadAttemptId,
        dedupeKey,
        shareStatus: 'not_shared',
        authorizationSnapshot,
      });

      try {
        const sessionUpload = await createActivityResumableUpload({
          context,
          patientId: input.patientId,
          sessionId: input.sessionId,
          recordId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize,
          sessionDate: session.date,
          mediaType: 'video',
        });

        await ref.set({
          driveFolderId: sessionUpload.folderId,
          fileName: sessionUpload.fileName,
          driveUploadSession: protectActivityUploadSession(sessionUpload.uploadUrl),
          uploadedBytes: 0,
        }, { merge: true });

        return res.status(200).json({
          recordId,
          uploadAttemptId: input.uploadAttemptId,
          chunkSize: MAX_ACTIVITY_VIDEO_CHUNK_BYTES,
        });
      } catch (error) {
        await ref.delete().catch(async () => {
          await markActivityFailure(ref, 'failed', error?.message);
        });
        throw error;
      }
    }

    if (body.action === 'uploadVideoChunk') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
      const start = Number(body.start);
      const totalSize = Number(body.totalSize);
      if (!patientId || !recordId || !uploadAttemptId) {
        throw activityError('activity-records/invalid-chunk-request', 'Não foi possível identificar a parte do vídeo enviada.');
      }
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(totalSize) || totalSize <= 0 || totalSize > MAX_ACTIVITY_VIDEO_BYTES) {
        throw activityError('activity-records/invalid-chunk-range', 'A posição da parte do vídeo é inválida.');
      }

      const { ref, data } = await getActivityRecord(context, patientId, recordId);
      if (data.mediaType !== 'video') throw activityError('activity-records/invalid-file-type', 'O registro selecionado não é um vídeo.', 409);
      if (data.status === 'active' && data.uploadAttemptId === uploadAttemptId && Number(data.fileSize) === totalSize) {
        return res.status(200).json({
          completed: true,
          nextOffset: totalSize,
          record: { id: recordId, ...serializeRecord(data) },
        });
      }
      if (data.status === 'cancelled') throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
      if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) {
        throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio do vídeo não está mais ativa.', 409);
      }
      if (Number(data.fileSize) !== totalSize) throw activityError('activity-records/invalid-file-size', 'O tamanho total do vídeo não confere.', 409);
      if (!data.driveUploadSession) throw activityError('activity-records/invalid-upload-session', 'A sessão de envio do vídeo não está disponível.', 409);

      const chunkBuffer = decodeActivityVideoChunk(body.dataBase64, data.mimeType, { isFirstChunk: start === 0 });
      const endExclusive = start + chunkBuffer.length;
      if (endExclusive > totalSize) throw activityError('activity-records/invalid-chunk-range', 'A parte do vídeo ultrapassa o tamanho total do arquivo.');
      if (endExclusive < totalSize && chunkBuffer.length % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES !== 0) {
        throw activityError('activity-records/invalid-chunk-size', 'As partes intermediárias do vídeo precisam respeitar blocos de 256 KB.');
      }

      const recordedOffset = Number(data.uploadedBytes || 0);
      if (recordedOffset > start && recordedOffset >= endExclusive) {
        return res.status(200).json({ completed: false, nextOffset: recordedOffset });
      }
      if (recordedOffset !== start) {
        throw activityError('activity-records/chunk-offset-mismatch', `O envio deve continuar a partir do byte ${recordedOffset}.`, 409);
      }

      const uploadResult = await uploadActivityResumableChunk({
        uploadUrl: revealActivityUploadSession(data.driveUploadSession),
        chunkBuffer,
        start,
        totalSize,
        mimeType: data.mimeType,
      });

      if (!uploadResult.completed) {
        if (uploadResult.nextOffset <= start || uploadResult.nextOffset > totalSize) {
          throw activityError('activity-records/invalid-drive-progress', 'O Google Drive retornou um progresso inválido para o vídeo.', 502);
        }
        await updateActivityUploadProgress(ref, uploadAttemptId, uploadResult.nextOffset);
        return res.status(200).json({ completed: false, nextOffset: uploadResult.nextOffset });
      }

      const driveFileId = sanitizeText(uploadResult.file?.id, 256);
      if (!driveFileId) throw activityError('activity-records/upload-failed', 'O Google Drive não confirmou o arquivo final do vídeo.', 502);
      const metadata = await getActivityDriveMetadata(driveFileId);
      assertOwnedActivityFile(metadata, { ownerUserId: context.ownerUserId, patientId, recordId, mediaType: 'video' });
      const driveFolderId = Array.isArray(metadata.parents) ? metadata.parents[0] : '';
      if (!driveFolderId || driveFolderId !== data.driveFolderId) {
        throw activityError('activity-records/forbidden-file', 'O vídeo final não está na pasta privada esperada.', 403);
      }
      if (Number(metadata.size || 0) !== totalSize) {
        throw activityError('activity-records/file-size-mismatch', 'O tamanho do vídeo salvo no Google Drive não confere.', 502);
      }

      const finalValues = {
        driveFileId,
        driveFolderId,
        fileName: metadata.name || data.fileName,
        mimeType: metadata.mimeType || data.mimeType,
        fileSize: totalSize,
      };
      await ref.set(finalValues, { merge: true });
      try {
        const record = await finalizeActivityRecord(ref, finalValues);
        return res.status(201).json({ completed: true, nextOffset: totalSize, record });
      } catch (error) {
        if (['activity-records/upload-cancelled', 'activity-records/record-not-found'].includes(error?.code)) {
          await deleteActivityPhotoFromDrive(driveFileId, { ownerUserId: context.ownerUserId, patientId, recordId }).catch(cleanupError => {
            console.error('[ACTIVITY RECORDS API] rollback video cancelado:', cleanupError);
          });
          await ref.delete().catch(() => undefined);
        }
        throw error;
      }
    }

    if (body.action === 'failVideoUpload') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
      if (!patientId || !recordId || !uploadAttemptId) {
        throw activityError('activity-records/invalid-failure-request', 'Não foi possível identificar o envio que falhou.');
      }
      const { ref, data } = await getActivityRecord(context, patientId, recordId);
      if (data.uploadAttemptId !== uploadAttemptId) {
        throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio do vídeo não está mais ativa.', 409);
      }
      if (data.status === 'active') return res.status(200).json({ failed: false, completed: true });

      let completedFileId = sanitizeText(data.driveFileId, 256);
      if (!completedFileId && data.driveUploadSession && Number(data.fileSize) > 0) {
        const status = await queryActivityResumableUpload({
          uploadUrl: revealActivityUploadSession(data.driveUploadSession),
          totalSize: Number(data.fileSize),
        }).catch(() => null);
        completedFileId = status?.completed ? sanitizeText(status.file?.id, 256) : '';
      }

      if (completedFileId) {
        try {
          await deleteActivityPhotoFromDrive(completedFileId, { ownerUserId: context.ownerUserId, patientId, recordId });
        } catch (cleanupError) {
          await ref.set({ driveFileId: completedFileId }, { merge: true }).catch(() => undefined);
          await markActivityFailure(ref, 'failed', cleanupError?.message || body.message);
          return res.status(200).json({ failed: true, cleanupPending: true });
        }
      }

      await failActivityUpload(context, patientId, recordId, uploadAttemptId, sanitizeText(body.message, 500) || 'O envio do vídeo falhou.');
      return res.status(200).json({ failed: true });
    }

    if (body.action === 'uploadPhoto') {
      const input = validateUploadInput(body);
      if (input.mediaType !== 'photo') throw activityError('activity-records/invalid-file-type', 'Vídeos devem usar o envio resumível em partes.');
      const { patient, session } = await requirePatientAndSession(context, input.patientId, input.sessionId);
      if (!canRecordActivity(patient)) throw activityError('activity-records/authorization-required', 'O registro interno de mídias não está autorizado para esta criança.', 409);
      if (input.visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }
      const fileBuffer = decodeActivityPhoto(body.dataBase64, input.mimeType);
      const actualSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualSha256 !== input.sha256) {
        // Diferença de hash do cliente tolerada; o servidor usa o hash oficial recalculado.
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
        uploaded = await uploadActivityPhotoToDrive({ context, patientId: input.patientId, sessionId: input.sessionId, recordId, fileName: input.fileName, mimeType: input.mimeType, fileBuffer, sessionDate: session.date, mediaType: 'photo' });
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
          throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
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
      if (record && !record.alreadyCompleted && !record.cancellationIgnored) {
        let completedFileId = sanitizeText(record.driveFileId, 256);
        if (!completedFileId && record.mediaType === 'video' && record.driveUploadSession && Number(record.fileSize) > 0) {
          const status = await queryActivityResumableUpload({
            uploadUrl: revealActivityUploadSession(record.driveUploadSession),
            totalSize: Number(record.fileSize),
          }).catch(() => null);
          completedFileId = status?.completed ? sanitizeText(status.file?.id, 256) : '';
        }
        if (completedFileId) {
          try {
            await deleteActivityPhotoFromDrive(completedFileId, { ownerUserId: context.ownerUserId, patientId, recordId: record.id });
          } catch (cleanupError) {
            const ref = activityRecordRef(context, patientId, record.id);
            await ref.set({ driveFileId: completedFileId }, { merge: true }).catch(() => undefined);
            await markActivityFailure(ref, 'cancelled', cleanupError?.message);
            return res.status(200).json({ cancelled: true, completed: false, cleanupPending: true });
          }
        }
        await activityRecordRef(context, patientId, record.id).delete().catch(() => undefined);
      }
      return res.status(200).json({ cancelled: Boolean(record && !record.alreadyCompleted && !record.cancellationIgnored), completed: Boolean(record?.alreadyCompleted) });
    }

    if (body.action === 'getFileUrl') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const { data } = await getActivityRecord(context, patientId, recordId);
      if (data.status !== 'active' && data.status !== 'delete_failed') throw activityError('activity-records/record-unavailable', 'A mídia não está disponível.', 409);
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
