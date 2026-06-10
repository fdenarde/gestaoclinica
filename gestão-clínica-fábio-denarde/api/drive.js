import { verifyFirebaseRequest } from './_lib/firebaseAdmin.js';
import {
  assertOwnedPatientPhoto,
  createSignedPhotoUrl,
  deletePatientPhotoFromDrive,
  fetchPatientPhotoFromDrive,
  getDriveFileMetadata,
  uploadPatientPhotoToDrive,
  verifySignedPhotoRequest,
} from './_lib/googleDrive.js';

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
  try {
    return JSON.parse(req.body);
  } catch {
    const error = new Error('A requisição enviada ao armazenamento é inválida.');
    error.code = 'drive-api/invalid-json';
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, statusCode, body) {
  res.status(statusCode).json(body);
}

function sendError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const code = error?.code || 'drive-api/internal-error';
  const message = error?.message || 'Ocorreu um erro inesperado no armazenamento.';

  if (statusCode >= 500) {
    console.error('[DRIVE API]', code, message, error?.details || '');
  }

  sendJson(res, statusCode, { error: { code, message } });
}

export default async function handler(req, res) {
  setSecurityHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === 'GET' && req.query?.mode === 'file') {
      const fileId = String(req.query.fileId || '');
      const ownerUserId = String(req.query.owner || '');
      const expires = String(req.query.expires || '');
      const signature = String(req.query.signature || '');

      verifySignedPhotoRequest({ fileId, ownerUserId, expires, signature });
      const photo = await fetchPatientPhotoFromDrive(fileId, ownerUserId);

      res.setHeader('Content-Type', photo.mimeType);
      res.setHeader('Content-Length', String(photo.buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=60');
      res.status(200).send(photo.buffer);
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      sendJson(res, 405, { error: { code: 'drive-api/method-not-allowed', message: 'Método não permitido.' } });
      return;
    }

    const decodedToken = await verifyFirebaseRequest(req);
    const ownerUserId = decodedToken.uid;
    const body = parseBody(req);

    if (body.action === 'uploadPatientPhoto') {
      if (!body.patientId) {
        const error = new Error('Atendente não identificado para enviar a foto.');
        error.code = 'drive-api/missing-patient-id';
        error.statusCode = 400;
        throw error;
      }

      const file = await uploadPatientPhotoToDrive({
        ownerUserId,
        patientId: String(body.patientId),
        fileName: String(body.fileName || 'foto'),
        mimeType: String(body.mimeType || ''),
        dataBase64: String(body.dataBase64 || ''),
      });

      sendJson(res, 201, {
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        size: Number(file.size || 0),
      });
      return;
    }

    if (body.action === 'getPatientPhotoUrl') {
      const fileId = String(body.fileId || '');
      const metadata = await getDriveFileMetadata(fileId);
      assertOwnedPatientPhoto(metadata, ownerUserId);
      sendJson(res, 200, createSignedPhotoUrl({ req, fileId, ownerUserId }));
      return;
    }

    if (body.action === 'deletePatientPhoto') {
      const fileId = String(body.fileId || '');
      if (fileId) {
        await deletePatientPhotoFromDrive(fileId, ownerUserId);
      }
      sendJson(res, 200, { deleted: true });
      return;
    }

    const error = new Error('Ação de armazenamento desconhecida.');
    error.code = 'drive-api/unknown-action';
    error.statusCode = 400;
    throw error;
  } catch (error) {
    sendError(res, error);
  }
}
