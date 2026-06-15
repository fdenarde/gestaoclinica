import { resolveAccessContext } from './_lib/accessContext.js';
import {
  getActivityRecord,
  serializeRecord,
  updateActivityUploadProgress,
} from './_lib/activityRecordsRepository.js';
import {
  queryActivityResumableUpload,
  revealActivityUploadSession,
  uploadActivityResumableChunk,
} from './_lib/activityRecordsDrive.js';
import {
  ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES,
  activityError,
  sanitizeText,
} from './_lib/activityRecordsValidation.js';
import { ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES } from '../shared/activityMediaLimits.js';

const ALLOWED_ORIGINS = new Set([
  'https://gestaoclinica-solucoes.vercel.app',
  'https://fdenarde.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);

export const config = {
  api: {
    bodyParser: false,
  },
};

function setSecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const origin = String(req.headers?.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Activity-Patient-Id, X-Activity-Record-Id, X-Activity-Upload-Attempt-Id, X-Activity-Start, X-Activity-Total-Size',
    );
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
}

function sendError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const code = error?.code || 'activity-records/internal-error';
  const message = code === 'activity-records/internal-error'
    ? 'Não foi possível encaminhar esta parte da mídia.'
    : error?.message || 'Não foi possível encaminhar esta parte da mídia.';
  if (statusCode >= 500) {
    console.error('[ACTIVITY UPLOAD CHUNK API]', code, error?.message || error, error?.details || '');
  }
  res.status(statusCode).json({ error: { code, message } });
}

function headerValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : String(value || '');
}

async function readRawRequestBody(req) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES) {
      throw activityError('activity-records/upload-chunk-too-large', 'A parte da mídia ultrapassou o limite permitido.', 413);
    }
    return req.body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES) {
      throw activityError('activity-records/upload-chunk-too-large', 'A parte da mídia ultrapassou o limite permitido.', 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function parseSafeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw activityError('activity-records/invalid-upload-range', `${label} da mídia é inválido.`);
  }
  return parsed;
}

export default async function handler(req, res) {
  setSecurityHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: {
        code: 'activity-records/method-not-allowed',
        message: 'Método não permitido.',
      },
    });
  }

  try {
    const context = await resolveAccessContext(req);
    const patientId = sanitizeText(headerValue(req, 'x-activity-patient-id'), 128);
    const recordId = sanitizeText(headerValue(req, 'x-activity-record-id'), 128);
    const uploadAttemptId = sanitizeText(headerValue(req, 'x-activity-upload-attempt-id'), 128);
    const start = parseSafeInteger(headerValue(req, 'x-activity-start'), 'O início');
    const totalSize = parseSafeInteger(headerValue(req, 'x-activity-total-size'), 'O tamanho total');

    if (!patientId || !recordId || !uploadAttemptId || totalSize <= 0) {
      throw activityError('activity-records/invalid-upload-request', 'Não foi possível identificar a parte da mídia.');
    }

    const chunkBuffer = await readRawRequestBody(req);
    if (chunkBuffer.length <= 0) {
      throw activityError('activity-records/empty-upload-chunk', 'A parte da mídia está vazia.');
    }
    const endExclusive = start + chunkBuffer.length;
    if (endExclusive > totalSize) {
      throw activityError('activity-records/invalid-upload-range', 'A parte da mídia ultrapassa o tamanho total esperado.');
    }
    const isFinalChunk = endExclusive === totalSize;
    if (
      start % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES !== 0
      || (!isFinalChunk && chunkBuffer.length % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES !== 0)
    ) {
      throw activityError('activity-records/invalid-upload-range', 'A parte da mídia não está alinhada para retomada segura.');
    }

    const { ref, data } = await getActivityRecord(context, patientId, recordId);
    if (data.status === 'active' && data.uploadAttemptId === uploadAttemptId) {
      return res.status(200).json({
        completed: true,
        nextOffset: Number(data.fileSize || totalSize),
        record: { id: recordId, ...serializeRecord(data) },
        driveFileId: data.driveFileId,
      });
    }
    if (data.status === 'cancelled') {
      throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
    }
    if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) {
      throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio não está mais ativa.', 409);
    }
    if (Number(data.fileSize || 0) !== totalSize) {
      throw activityError('activity-records/file-size-mismatch', 'O tamanho total da mídia não confere.', 409);
    }
    if (!data.driveUploadSession) {
      throw activityError('activity-records/invalid-upload-session', 'A sessão de envio não está disponível.', 409);
    }

    const uploadUrl = revealActivityUploadSession(data.driveUploadSession);
    let result;
    try {
      result = await uploadActivityResumableChunk({
        uploadUrl,
        chunkBuffer,
        start,
        totalSize,
        mimeType: data.mimeType || 'application/octet-stream',
      });
    } catch (error) {
      if (error?.code !== 'activity-records/upload-chunk-failed') throw error;
      const status = await queryActivityResumableUpload({ uploadUrl, totalSize }).catch(() => null);
      if (!status || (status.nextOffset <= start && !status.completed)) throw error;
      result = status;
    }

    if (!result.completed) {
      await updateActivityUploadProgress(ref, uploadAttemptId, result.nextOffset);
      return res.status(200).json({
        completed: false,
        nextOffset: result.nextOffset,
      });
    }

    return res.status(201).json({
      completed: true,
      nextOffset: totalSize,
      driveFileId: sanitizeText(result.file?.id, 256),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
