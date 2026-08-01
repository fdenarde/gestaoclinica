import crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { resolveAccessContext } from './_lib/accessContext.js';
import { getAdminDb, verifyFirebaseRequest } from './_lib/firebaseAdmin.js';
import {
  createSignedActivityUrl,
  deleteActivityPhotoFromDrive,
  fetchActivityPhotoFromDrive,
  getActivityDriveMetadata,
  assertOwnedActivityFile,
  uploadActivityPhotoToDrive,
  createActivityResumableUpload,
  ensureActivityMediaFolders,
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
  ensureActivityRecordGallerySummary,
  getActivityRecord,
  hasActivityRecords,
  listActivityRecords,
  markActivityFailure,
  requirePatient,
  requirePatientAndSession,
  requirePatientAndSessions,
  reserveActivityRecord,
  setActivityRecordDocument,
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
  canShareActivityWithGuardian,
  canRecordActivity,
  decodeActivityPhoto,
  decodeActivityVideoChunk,
  sanitizeText,
  validateUploadInput,
} from './_lib/activityRecordsValidation.js';
import { checkPatientActivityMediaDuplicate } from './_lib/activityRecordsDuplicateService.js';
import {
  listProfessionalActivityGallery,
  listActivityMediaPresence,
  listActivitySessionAudit,
  reconcileActivitySessionMediaStatus,
  removeActivitySessionJustification,
  saveActivitySessionJustification,
  writeActivityAudit,
} from './_lib/activityGalleryRepository.js';
import {
  MAX_ACTIVITY_MEDIA_ITEMS,
  MAX_ACTIVITY_PHOTO_UPLOAD_BYTES,
} from '../shared/activityMediaLimits.js';

const ALLOWED_ORIGINS = new Set([
  'https://gestaoclinica-solucoes.vercel.app',
  'https://fdenarde.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);
const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';

function getTrustedBrowserOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    const isPrivateLan = (
      /^192\.168\./.test(host)
      || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
    const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
    if (parsed.protocol === 'http:' && (isPrivateLan || isLoopback)) return origin;
  } catch {
    return '';
  }
  return '';
}

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
  const publicMessage = code === 'activity-records/internal-error'
    ? 'Não foi possível registrar esta mídia. O arquivo permanece disponível para nova tentativa.'
    : message;
  res.status(statusCode).json({ error: { code, message: publicMessage } });
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

async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, source.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(source[index], index);
    }
  }));
  return results;
}

function publicActivityError(error) {
  return {
    code: error?.code || 'activity-records/internal-error',
    message: error?.code === 'activity-records/internal-error'
      ? 'Não foi possível preparar esta mídia para envio.'
      : error?.message || 'Não foi possível preparar esta mídia para envio.',
  };
}

function validateDirectUploadFile(input, rawItem) {
  const fileSize = Number(rawItem.fileSize || 0);
  const lastModified = Number(rawItem.lastModified || 0);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw activityError('activity-records/invalid-file-size', 'O tamanho da mídia é inválido.');
  }
  if (input.mediaType === 'video' && fileSize > MAX_ACTIVITY_VIDEO_BYTES) {
    throw activityError('activity-records/file-too-large', 'O vídeo deve ter no máximo 600 MB.', 413);
  }
  if (input.mediaType === 'photo' && fileSize > MAX_ACTIVITY_PHOTO_UPLOAD_BYTES) {
    throw activityError('activity-records/file-too-large', 'A foto preparada ultrapassou o limite permitido.', 413);
  }
  if (!Number.isFinite(lastModified) || lastModified <= 0) {
    throw activityError('activity-records/invalid-file-date', 'A data do arquivo é inválida.');
  }
  return { fileSize, lastModified };
}

function buildDirectUploadReservation({
  context,
  patient,
  session,
  input,
  fileSize,
  recordId,
  dedupeKey,
}) {
  const activityDate = normalizeSessionDate(session);
  return {
    id: recordId,
    schemaVersion: 2,
    workspaceId: context.workspaceId,
    ownerUserId: context.ownerUserId,
    patientId: input.patientId,
    sessionId: input.sessionId,
    sessionIds: input.sessionIds,
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
    mediaType: input.mediaType,
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
    originalContentHash: input.originalContentHash,
    preparedContentHash: input.preparedContentHash,
    originalContentHashAlgorithm: input.originalContentHash ? 'SHA-256' : undefined,
    preparedContentHashAlgorithm: input.preparedContentHash ? 'SHA-256' : undefined,
    originalByteSize: input.originalByteSize || fileSize,
    hashAlgorithm: 'SHA-256',
    status: 'uploading',
    uploadStatus: 'uploading',
    uploadAttemptId: input.uploadAttemptId,
    dedupeKey,
    shareStatus: 'not_shared',
    authorizationSnapshot: patient.activityMediaAuthorization,
  };
}

async function finalizeDirectActivityUpload({ context, patientId, recordId, uploadAttemptId, driveFileId }) {
  const { ref, data } = await getActivityRecord(context, patientId, recordId);
  if (data.status === 'active' && data.uploadAttemptId === uploadAttemptId) {
    return { completed: true, record: { id: recordId, ...serializeRecord(data) } };
  }
  if (data.status === 'cancelled') {
    throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
  }
  if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) {
    throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio não está mais ativa.', 409);
  }

  let completedFileId = sanitizeText(driveFileId, 256);
  if (!completedFileId && data.driveUploadSession && Number(data.fileSize) > 0) {
    const status = await queryActivityResumableUpload({
      uploadUrl: revealActivityUploadSession(data.driveUploadSession),
      totalSize: Number(data.fileSize),
    });
    if (!status.completed) {
      await updateActivityUploadProgress(ref, uploadAttemptId, status.nextOffset);
      return { completed: false, nextOffset: status.nextOffset };
    }
    completedFileId = sanitizeText(status.file?.id, 256);
  }
  if (!completedFileId) {
    throw activityError('activity-records/upload-not-complete', 'O Google Drive ainda não confirmou a mídia completa.', 409);
  }

  const metadata = await getActivityDriveMetadata(completedFileId);
  assertOwnedActivityFile(metadata, {
    ownerUserId: context.ownerUserId,
    patientId,
    recordId,
    mediaType: data.mediaType,
  });
  const driveFolderId = Array.isArray(metadata.parents) ? metadata.parents[0] : '';
  if (!driveFolderId || driveFolderId !== data.driveFolderId) {
    throw activityError('activity-records/forbidden-file', 'A mídia final não está na pasta privada esperada.', 403);
  }
  if (Number(metadata.size || 0) !== Number(data.fileSize || 0)) {
    throw activityError('activity-records/file-size-mismatch', 'O tamanho da mídia salva no Google Drive não confere.', 502);
  }

  const finalValues = {
    driveFileId: completedFileId,
    driveFolderId,
    fileName: metadata.name || data.fileName,
    mimeType: metadata.mimeType || data.mimeType,
    fileSize: Number(metadata.size || data.fileSize),
    driveMd5Checksum: sanitizeText(metadata.md5Checksum, 64),
    driveSha1Checksum: sanitizeText(metadata.sha1Checksum, 64),
    driveSha256Checksum: sanitizeText(metadata.sha256Checksum, 64),
  };
  await setActivityRecordDocument(ref, finalValues, { merge: true });
  try {
    const record = await finalizeActivityRecord(context, ref, finalValues);
    return { completed: true, record };
  } catch (error) {
    if (['activity-records/upload-cancelled', 'activity-records/record-not-found'].includes(error?.code)) {
      await deleteActivityPhotoFromDrive(completedFileId, {
        ownerUserId: context.ownerUserId,
        patientId,
        recordId,
      }).catch(cleanupError => {
        console.error('[ACTIVITY RECORDS API] rollback de mídia cancelada:', cleanupError);
      });
      await ref.delete().catch(() => undefined);
    }
    throw error;
  }
}

async function resolveResponsibleMediaContext(req, patientId) {
  const decodedToken = await verifyFirebaseRequest(req);
  const db = getAdminDb();
  const profileSnapshot = await db.collection('accessProfiles').doc(decodedToken.uid).get();
  if (!profileSnapshot.exists) {
    throw activityError('activity-records/responsible-profile-required', 'Perfil de responsável não encontrado.', 403);
  }

  const profile = profileSnapshot.data();
  const linkedPatientIds = Array.isArray(profile.linkedPatientIds)
    ? profile.linkedPatientIds.filter(value => typeof value === 'string')
    : [];
  if (profile.status !== 'approved' || profile.role !== 'responsible') {
    throw activityError(
      'activity-records/responsible-approved-required',
      'Esta mídia está disponível somente para responsáveis aprovados.',
      403,
    );
  }
  if (!linkedPatientIds.includes(patientId)) {
    throw activityError(
      'activity-records/patient-not-linked',
      'Você não possui vínculo com o paciente desta mídia.',
      403,
    );
  }

  let ownerUserId;
  try {
    ownerUserId = (await getAuth().getUserByEmail(PRIMARY_ADMIN_EMAIL)).uid;
  } catch {
    throw activityError(
      'activity-records/owner-unavailable',
      'O workspace principal da clínica não está disponível.',
      503,
    );
  }

  const patientSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}`).get();
  if (!patientSnapshot.exists) {
    throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  }
  const patient = patientSnapshot.data();
  if (patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
    throw activityError(
      'activity-records/sharing-not-authorized',
      'O compartilhamento de mídias não está autorizado para esta criança.',
      403,
    );
  }

  return {
    patient,
    context: {
      userId: decodedToken.uid,
      ownerUserId,
      workspaceId: ownerUserId,
      role: 'responsible',
      allowedPatientIds: [patientId],
    },
  };
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
      if (String(req.query.download || '') === '1') {
        const fileName = sanitizeText(req.query.fileName, 180) || 'midia-clinica';
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      }
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=60');
      return res.status(media.statusCode).send(media.buffer);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return res.status(405).json({ error: { code: 'activity-records/method-not-allowed', message: 'Método não permitido.' } });
    }

    const body = parseBody(req);

    if (body.action === 'getAdminResponsiblePreviewFileUrl') {
      const decodedToken = await verifyFirebaseRequest(req);
      if (String(decodedToken?.email || '').trim().toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
        throw activityError(
          'activity-records/admin-required',
          'Esta visualização é exclusiva do administrador principal.',
          403,
        );
      }

      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      if (!patientId || !recordId) {
        throw activityError('activity-records/invalid-media-request', 'Não foi possível identificar a mídia.');
      }

      let ownerUserId;
      try {
        ownerUserId = (await getAuth().getUserByEmail(PRIMARY_ADMIN_EMAIL)).uid;
      } catch {
        throw activityError(
          'activity-records/owner-unavailable',
          'O workspace principal da clínica não está disponível.',
          503,
        );
      }

      const db = getAdminDb();
      const patientSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}`).get();
      if (!patientSnapshot.exists) {
        throw activityError('activity-records/patient-not-found', 'O cadastro do atendente não foi encontrado.', 404);
      }

      const patient = patientSnapshot.data();
      if (patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError(
          'activity-records/sharing-not-authorized',
          'O compartilhamento desta mídia não está autorizado para o responsável.',
          403,
        );
      }

      const context = {
        userId: decodedToken.uid,
        ownerUserId,
        workspaceId: ownerUserId,
        role: 'admin',
        allowedPatientIds: [patientId],
      };
      const { data } = await getActivityRecord(context, patientId, recordId);
      if (data.status !== 'active' && data.status !== 'delete_failed') {
        throw activityError('activity-records/record-unavailable', 'A mídia não está disponível.', 409);
      }
      if (data.patientId !== patientId || !canShareActivityWithGuardian(patient, data)) {
        throw activityError(
          'activity-records/sharing-not-authorized',
          'Esta mídia não foi liberada para o responsável.',
          403,
        );
      }

      const metadata = await getActivityDriveMetadata(data.driveFileId);
      assertOwnedActivityFile(metadata, {
        ownerUserId,
        patientId,
        recordId,
      });

      return res.status(200).json({
        ...createSignedActivityUrl({
          req,
          fileId: data.driveFileId,
          ownerUserId,
          patientId,
          recordId,
        }),
        fileName: sanitizeText(data.fileName, 180) || 'mídia',
      });
    }

    if (body.action === 'getResponsibleFileUrl') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      if (!patientId || !recordId) {
        throw activityError('activity-records/invalid-media-request', 'Não foi possível identificar a mídia.');
      }
      const { context, patient } = await resolveResponsibleMediaContext(req, patientId);
      const { data } = await getActivityRecord(context, patientId, recordId);
      if (data.status !== 'active' && data.status !== 'delete_failed') {
        throw activityError('activity-records/record-unavailable', 'A mídia não está disponível.', 409);
      }
      if (data.patientId !== patientId || !canShareActivityWithGuardian(patient, data)) {
        throw activityError(
          'activity-records/sharing-not-authorized',
          'Esta mídia não foi liberada para o responsável.',
          403,
        );
      }
      const metadata = await getActivityDriveMetadata(data.driveFileId);
      assertOwnedActivityFile(metadata, {
        ownerUserId: context.ownerUserId,
        patientId,
        recordId,
      });
      return res.status(200).json({
        ...createSignedActivityUrl({
          req,
          fileId: data.driveFileId,
          ownerUserId: context.ownerUserId,
          patientId,
          recordId,
        }),
        fileName: sanitizeText(data.fileName, 180) || 'mídia',
      });
    }

    const context = await resolveAccessContext(req);

    if (body.action === 'getProfessionalGallerySummary') {
      return res.status(200).json(await listProfessionalActivityGallery(context, {}, { summaryOnly: true }));
    }

    if (body.action === 'listActivityMediaPresence') {
      return res.status(200).json(await listActivityMediaPresence(context, body.sessions));
    }

    if (body.action === 'listProfessionalGallery') {
      return res.status(200).json(await listProfessionalActivityGallery(context, body.filters || {}));
    }

    if (body.action === 'saveSessionNoMediaJustification') {
      return res.status(200).json({
        status: await saveActivitySessionJustification(context, body),
      });
    }

    if (body.action === 'removeSessionNoMediaJustification') {
      return res.status(200).json({
        status: await removeActivitySessionJustification(context, body),
      });
    }

    if (body.action === 'listSessionActivityAudit') {
      return res.status(200).json({
        entries: await listActivitySessionAudit(context, body),
      });
    }

    if (body.action === 'checkMediaDuplicate') {
      const patientId = sanitizeText(body.patientId, 128);
      const sessionId = sanitizeText(body.sessionId, 128);
      const sha256 = sanitizeText(body.sha256, 64).toLowerCase();
      const fileSize = Number(body.fileSize || 0);
      const mediaType = sanitizeText(body.mediaType, 20);
      const mimeType = sanitizeText(body.mimeType, 80);
      if (
        !patientId
        || !sessionId
        || !/^[a-f0-9]{64}$/.test(sha256)
        || !Number.isSafeInteger(fileSize)
        || fileSize <= 0
        || !['photo', 'video'].includes(mediaType)
      ) {
        throw activityError('activity-records/invalid-duplicate-check', 'Não foi possível verificar a duplicidade da mídia.');
      }
      await requirePatient(context, patientId);
      const result = await checkPatientActivityMediaDuplicate({
        context,
        patientId,
        sessionId,
        sha256,
        fileSize,
        mediaType,
        mimeType,
      });
      return res.status(200).json(result);
    }

    if (body.action === 'prepareDirectUploadBatch') {
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length <= 0 || rawItems.length > MAX_ACTIVITY_MEDIA_ITEMS) {
        throw activityError(
          'activity-records/invalid-upload-batch',
          `A remessa deve conter entre 1 e ${MAX_ACTIVITY_MEDIA_ITEMS} mídias.`,
        );
      }

      const parsedItems = rawItems.map(rawItem => {
        const input = validateUploadInput(rawItem || {});
        const file = validateDirectUploadFile(input, rawItem || {});
        return { input, ...file };
      });
      const first = parsedItems[0].input;
      const firstSessionScope = [...first.sessionIds].sort().join('|');
      if (parsedItems.some(item => (
        item.input.patientId !== first.patientId
        || [...item.input.sessionIds].sort().join('|') !== firstSessionScope
      ))) {
        throw activityError(
          'activity-records/mixed-upload-batch',
          'Todas as mídias da remessa devem pertencer à mesma criança e às mesmas sessões.',
        );
      }

      const { patient, session } = await requirePatientAndSessions(context, first.patientId, first.sessionIds);
      if (!canRecordActivity(patient)) {
        throw activityError(
          'activity-records/authorization-required',
          'O registro interno de mídias não está autorizado para esta criança.',
          409,
        );
      }
      if (
        parsedItems.some(item => item.input.visibility === 'share_allowed')
        && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized'
      ) {
        throw activityError(
          'activity-records/sharing-not-authorized',
          'O compartilhamento com o responsável não está autorizado para esta criança.',
          409,
        );
      }

      const requestedMediaTypes = parsedItems.map(item => item.input.mediaType);
      const folderBundle = await ensureActivityMediaFolders({
        workspaceId: context.workspaceId,
        patientId: first.patientId,
        sessionDate: session.date,
        mediaTypes: requestedMediaTypes,
      });
      const browserOrigin = getTrustedBrowserOrigin(req);

      const preparedItems = await mapWithConcurrency(parsedItems, 6, async ({ input, fileSize }) => {
        try {
          const dedupeKey = buildActivityDedupeKey({
            workspaceId: context.workspaceId,
            patientId: input.patientId,
            sessionId: input.sessionId,
            sessionIds: input.sessionIds,
            sha256: input.sha256,
          });
          const recordId = dedupeKey;
          const ref = activityRecordRef(context, input.patientId, recordId);
          const reservationData = buildDirectUploadReservation({
            context,
            patient,
            session,
            input,
            fileSize,
            recordId,
            dedupeKey,
          });
          const reservation = await reserveActivityRecord(
            context,
            input.patientId,
            recordId,
            reservationData,
          );

          if (reservation.existingRecord?.status === 'active') {
            const existingRecord = await ensureActivityRecordGallerySummary(context, ref) || reservation.existingRecord;
            return {
              uploadAttemptId: input.uploadAttemptId,
              recordId,
              completed: true,
              record: existingRecord,
              nextOffset: fileSize,
            };
          }

          if (reservation.existingRecord?.driveUploadSession) {
            const uploadUrl = revealActivityUploadSession(reservation.existingRecord.driveUploadSession);
            const status = await queryActivityResumableUpload({ uploadUrl, totalSize: fileSize });
            if (status.completed) {
              const finalized = await finalizeDirectActivityUpload({
                context,
                patientId: input.patientId,
                recordId,
                uploadAttemptId: input.uploadAttemptId,
                driveFileId: status.file?.id,
              });
              return {
                uploadAttemptId: input.uploadAttemptId,
                recordId,
                ...finalized,
                nextOffset: fileSize,
              };
            }
            await updateActivityUploadProgress(ref, input.uploadAttemptId, status.nextOffset);
            return {
              uploadAttemptId: input.uploadAttemptId,
              recordId,
              completed: false,
              uploadUrl,
              nextOffset: status.nextOffset,
            };
          }

          const sessionUpload = await createActivityResumableUpload({
            context,
            patientId: input.patientId,
            sessionId: input.sessionId,
            recordId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileSize,
            sessionDate: session.date,
            mediaType: input.mediaType,
            accessToken: folderBundle.accessToken,
            folderId: folderBundle.folders[input.mediaType],
            browserOrigin,
          });
          await setActivityRecordDocument(ref, {
            driveFolderId: sessionUpload.folderId,
            fileName: sessionUpload.fileName,
            driveUploadSession: protectActivityUploadSession(sessionUpload.uploadUrl),
            uploadedBytes: 0,
          }, { merge: true });
          return {
            uploadAttemptId: input.uploadAttemptId,
            recordId,
            completed: false,
            uploadUrl: sessionUpload.uploadUrl,
            nextOffset: 0,
          };
        } catch (error) {
          return {
            uploadAttemptId: input.uploadAttemptId,
            completed: false,
            error: publicActivityError(error),
          };
        }
      });

      return res.status(200).json({ items: preparedItems });
    }

    if (body.action === 'finalizeDirectUpload') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
      const driveFileId = sanitizeText(body.driveFileId, 256);
      if (!patientId || !recordId || !uploadAttemptId) {
        throw activityError(
          'activity-records/invalid-finalize-request',
          'Não foi possível identificar a mídia concluída.',
        );
      }
      const result = await finalizeDirectActivityUpload({
        context,
        patientId,
        recordId,
        uploadAttemptId,
        driveFileId,
      });
      return res.status(result.completed ? 201 : 200).json(result);
    }

    if (body.action === 'getDirectUploadStatus') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
      if (!patientId || !recordId || !uploadAttemptId) {
        throw activityError(
          'activity-records/invalid-status-request',
          'Não foi possível identificar o envio em andamento.',
        );
      }
      const { ref, data } = await getActivityRecord(context, patientId, recordId);
      if (data.status === 'active' && data.uploadAttemptId === uploadAttemptId) {
        return res.status(200).json({
          completed: true,
          nextOffset: Number(data.fileSize || 0),
          record: { id: recordId, ...serializeRecord(data) },
          driveFileId: data.driveFileId,
        });
      }
      if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) {
        throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio não está mais ativa.', 409);
      }
      if (!data.driveUploadSession || Number(data.fileSize || 0) <= 0) {
        throw activityError('activity-records/invalid-upload-session', 'A sessão de envio não está disponível.', 409);
      }
      const status = await queryActivityResumableUpload({
        uploadUrl: revealActivityUploadSession(data.driveUploadSession),
        totalSize: Number(data.fileSize),
      });
      if (!status.completed) {
        await updateActivityUploadProgress(ref, uploadAttemptId, status.nextOffset);
        return res.status(200).json({ completed: false, nextOffset: status.nextOffset });
      }
      return res.status(200).json({
        completed: true,
        nextOffset: Number(data.fileSize),
        driveFileId: sanitizeText(status.file?.id, 256),
      });
    }

    if (body.action === 'touchDirectUpload') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const uploadAttemptId = sanitizeText(body.uploadAttemptId, 128);
      const uploadedBytes = Number(body.uploadedBytes || 0);
      if (
        !patientId
        || !recordId
        || !uploadAttemptId
        || !Number.isSafeInteger(uploadedBytes)
        || uploadedBytes < 0
      ) {
        throw activityError(
          'activity-records/invalid-progress-request',
          'Não foi possível atualizar o andamento do envio.',
        );
      }
      const { ref, data } = await getActivityRecord(context, patientId, recordId);
      if (data.status === 'active' && data.uploadAttemptId === uploadAttemptId) {
        return res.status(200).json({
          completed: true,
          nextOffset: Number(data.fileSize || uploadedBytes),
          record: { id: recordId, ...serializeRecord(data) },
        });
      }
      if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) {
        throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio não está mais ativa.', 409);
      }
      const safeUploadedBytes = Math.min(Number(data.fileSize || uploadedBytes), uploadedBytes);
      await updateActivityUploadProgress(ref, uploadAttemptId, safeUploadedBytes);
      return res.status(200).json({ completed: false, nextOffset: safeUploadedBytes });
    }

    if (body.action === 'prepareVideoUpload') {
      const input = validateUploadInput(body);
      if (input.mediaType !== 'video') throw activityError('activity-records/invalid-file-type', 'Esta rota aceita apenas vídeos.');
      const fileSize = Number(body.fileSize || 0);
      const lastModified = Number(body.lastModified || 0);
      if (!Number.isFinite(fileSize) || fileSize <= 0) throw activityError('activity-records/invalid-file-size', 'O tamanho do vídeo é inválido.');
      if (fileSize > MAX_ACTIVITY_VIDEO_BYTES) throw activityError('activity-records/file-too-large', 'O vídeo deve ter no máximo 600 MB.', 413);
      if (!Number.isFinite(lastModified) || lastModified <= 0) throw activityError('activity-records/invalid-file-date', 'A data do arquivo de vídeo é inválida.');

      const { patient, session } = await requirePatientAndSessions(context, input.patientId, input.sessionIds);
      if (!canRecordActivity(patient)) throw activityError('activity-records/authorization-required', 'O registro interno de mídias não está autorizado para esta criança.', 409);
      if (input.visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }

      const dedupeKey = buildActivityVideoDedupeKey({
        workspaceId: context.workspaceId,
        patientId: input.patientId,
        sessionId: input.sessionId,
        sessionIds: input.sessionIds,
        sha256: input.sha256,
        fileName: input.fileName,
        fileSize,
        durationSeconds: input.durationSeconds,
        lastModified,
      });

      const recordId = dedupeKey;
      const ref = activityRecordRef(context, input.patientId, recordId);
      const activityDate = normalizeSessionDate(session);
      const authorizationSnapshot = patient.activityMediaAuthorization;

      const reservation = await reserveActivityRecord(context, input.patientId, recordId, {
        id: recordId,
        schemaVersion: 2,
        workspaceId: context.workspaceId,
        ownerUserId: context.ownerUserId,
        patientId: input.patientId,
        sessionId: input.sessionId,
        sessionIds: input.sessionIds,
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
        originalContentHash: input.originalContentHash,
        preparedContentHash: input.preparedContentHash,
        originalContentHashAlgorithm: input.originalContentHash ? 'SHA-256' : undefined,
        preparedContentHashAlgorithm: input.preparedContentHash ? 'SHA-256' : undefined,
        originalByteSize: input.originalByteSize || fileSize,
        hashAlgorithm: 'SHA-256',
        status: 'uploading',
        uploadStatus: 'uploading',
        uploadAttemptId: input.uploadAttemptId,
        dedupeKey,
        shareStatus: 'not_shared',
        authorizationSnapshot,
      });
      if (reservation.existingRecord) {
        const completed = reservation.existingRecord.status === 'active';
        return res.status(200).json({
          completed,
          recordId,
          uploadAttemptId: input.uploadAttemptId,
          chunkSize: MAX_ACTIVITY_VIDEO_CHUNK_BYTES,
          nextOffset: completed ? fileSize : Number(reservation.existingRecord.uploadedBytes || 0),
          record: completed ? reservation.existingRecord : undefined,
        });
      }

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

        await setActivityRecordDocument(ref, {
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
        driveMd5Checksum: sanitizeText(metadata.md5Checksum, 64),
        driveSha1Checksum: sanitizeText(metadata.sha1Checksum, 64),
        driveSha256Checksum: sanitizeText(metadata.sha256Checksum, 64),
      };
      await setActivityRecordDocument(ref, finalValues, { merge: true });
      try {
        const record = await finalizeActivityRecord(context, ref, finalValues);
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
          await setActivityRecordDocument(ref, { driveFileId: completedFileId }, { merge: true }).catch(() => undefined);
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
      const { patient, session } = await requirePatientAndSessions(context, input.patientId, input.sessionIds);
      if (!canRecordActivity(patient)) throw activityError('activity-records/authorization-required', 'O registro interno de mídias não está autorizado para esta criança.', 409);
      if (input.visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }
      const fileBuffer = decodeActivityPhoto(body.dataBase64, input.mimeType);
      const actualSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualSha256 !== input.sha256) {
        // Diferença de hash do cliente tolerada; o servidor usa o hash oficial recalculado.
      }
      const dedupeKey = buildActivityDedupeKey({ workspaceId: context.workspaceId, patientId: input.patientId, sessionId: input.sessionId, sessionIds: input.sessionIds, sha256: actualSha256 });

      const recordId = dedupeKey;
      const ref = activityRecordRef(context, input.patientId, recordId);
      const activityDate = normalizeSessionDate(session);
      const authorizationSnapshot = patient.activityMediaAuthorization;
      const reservation = await reserveActivityRecord(context, input.patientId, recordId, {
        id: recordId,
        schemaVersion: 2,
        workspaceId: context.workspaceId,
        ownerUserId: context.ownerUserId,
        patientId: input.patientId,
        sessionId: input.sessionId,
        sessionIds: input.sessionIds,
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
        originalContentHash: input.originalContentHash,
        preparedContentHash: actualSha256,
        originalContentHashAlgorithm: input.originalContentHash ? 'SHA-256' : undefined,
        preparedContentHashAlgorithm: 'SHA-256',
        originalByteSize: input.originalByteSize || fileBuffer.length,
        hashAlgorithm: 'SHA-256',
        status: 'uploading',
        uploadStatus: 'uploading',
        uploadAttemptId: input.uploadAttemptId,
        dedupeKey,
        shareStatus: 'not_shared',
        authorizationSnapshot,
      });
      if (reservation.existingRecord) {
        return res.status(200).json({ record: reservation.existingRecord, idempotent: true });
      }

      let uploaded = null;
      try {
        uploaded = await uploadActivityPhotoToDrive({ context, patientId: input.patientId, sessionId: input.sessionId, recordId, fileName: input.fileName, mimeType: input.mimeType, fileBuffer, sessionDate: session.date, mediaType: 'photo' });
        await setActivityRecordDocument(ref, {
          driveFileId: uploaded.id,
          driveFolderId: uploaded.folderId,
          fileName: uploaded.name,
          mimeType: uploaded.mimeType,
          fileSize: Number(uploaded.size || fileBuffer.length),
          driveMd5Checksum: sanitizeText(uploaded.md5Checksum, 64),
          driveSha1Checksum: sanitizeText(uploaded.sha1Checksum, 64),
          driveSha256Checksum: sanitizeText(uploaded.sha256Checksum, 64),
        }, { merge: true });
        const latest = await ref.get();
        if (latest.data()?.status === 'cancelled') {
          await deleteActivityPhotoFromDrive(uploaded.id, { ownerUserId: context.ownerUserId, patientId: input.patientId, recordId });
          throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
        }
        const record = await finalizeActivityRecord(context, ref, {
          driveFileId: uploaded.id,
          driveFolderId: uploaded.folderId,
          fileName: uploaded.name,
          mimeType: uploaded.mimeType,
          fileSize: Number(uploaded.size || fileBuffer.length),
          driveMd5Checksum: sanitizeText(uploaded.md5Checksum, 64),
          driveSha1Checksum: sanitizeText(uploaded.sha1Checksum, 64),
          driveSha256Checksum: sanitizeText(uploaded.sha256Checksum, 64),
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
          await setActivityRecordDocument(ref, {
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
        if (!completedFileId && record.driveUploadSession && Number(record.fileSize) > 0) {
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
            await setActivityRecordDocument(ref, { driveFileId: completedFileId }, { merge: true }).catch(() => undefined);
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
      const description = sanitizeText(body.description, 2000);
      if (!ACTIVITY_CATEGORIES.has(category)) throw activityError('activity-records/invalid-category', 'Selecione uma categoria válida.');
      if (!ACTIVITY_VISIBILITIES.has(visibility)) throw activityError('activity-records/invalid-visibility', 'Selecione uma visibilidade válida.');
      const patient = await requirePatient(context, patientId);
      if (visibility === 'share_allowed' && patient.activityMediaAuthorization?.guardianSharingStatus !== 'authorized') {
        throw activityError('activity-records/sharing-not-authorized', 'O compartilhamento com o responsável não está autorizado para esta criança.', 409);
      }
      const current = await getActivityRecord(context, patientId, recordId);
      await updateActivityMetadata(context, patientId, recordId, { category, visibility, description, updatedByUserId: context.userId });
      await writeActivityAudit(context, {
        patientId,
        sessionIds: Array.isArray(current.data.sessionIds) ? current.data.sessionIds : [current.data.sessionId],
        recordId,
        action: 'metadata_updated',
        details: {
          previousCategory: current.data.category || '',
          category,
          previousVisibility: current.data.visibility || '',
          visibility,
          descriptionChanged: String(current.data.description || '') !== description,
        },
      });
      return res.status(200).json({ updated: true });
    }

    if (body.action === 'deleteRecord') {
      const patientId = sanitizeText(body.patientId, 128);
      const recordId = sanitizeText(body.recordId, 128);
      const reason = sanitizeText(body.reason, 500);
      if (!reason) throw activityError('activity-records/delete-reason-required', 'Informe o motivo da exclusão.');
      const { ref, data } = await getActivityRecord(context, patientId, recordId);
      const sessionIds = [...new Set((Array.isArray(data.sessionIds) ? data.sessionIds : [data.sessionId])
        .map(value => sanitizeText(value, 128))
        .filter(Boolean))];
      await setActivityRecordDocument(ref, {
        status: 'deleting',
        uploadStatus: 'deleting',
        deletionRequestedByUserId: context.userId,
        deletionRequestedByName: context.actorName,
        deletionReason: reason,
      }, { merge: true });
      try {
        if (data.driveFileId) await deleteActivityPhotoFromDrive(data.driveFileId, { ownerUserId: context.ownerUserId, patientId, recordId });
        await ref.delete();
      } catch (error) {
        await setActivityRecordDocument(ref, { status: 'delete_failed', uploadStatus: 'delete_failed', deleteFailureMessage: String(error?.message || '').slice(0, 500) }, { merge: true });
        throw error;
      }
      let summaryReconciled = true;
      try {
        await reconcileActivitySessionMediaStatus(context, patientId, sessionIds, {
          action: 'media_deleted',
          details: {
            recordId,
            reason,
            mediaType: data.mediaType || '',
            fileName: data.fileName || '',
            affectedSessionCount: sessionIds.length,
          },
        });
      } catch (summaryError) {
        summaryReconciled = false;
        console.error('[ACTIVITY RECORDS API] Falha ao recalcular pendências após exclusão:', summaryError?.message || summaryError);
      }
      return res.status(200).json({ deleted: true, summaryReconciled });
    }

    if (body.action === 'listRecords') {
      const patientId = sanitizeText(body.patientId, 128);
      const sessionId = sanitizeText(body.sessionId, 128);
      if (!patientId) throw activityError('activity-records/invalid-patient', 'Não foi possível identificar a criança.');
      return res.status(200).json({ records: await listActivityRecords(context, patientId, sessionId) });
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
