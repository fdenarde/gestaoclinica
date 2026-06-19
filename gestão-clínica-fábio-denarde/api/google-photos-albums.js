import { resolveAccessContext } from './_lib/accessContext.js';
import {
  listGooglePhotosAlbumPatientOptions,
  listGooglePhotosAlbumSessionOptions,
  listGooglePhotosAlbums,
  saveGooglePhotosAlbumPackage,
} from './_lib/googlePhotosAlbumsRepository.js';

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
    const error = new Error('A requisição enviada é inválida.');
    error.code = 'google-photos-albums/invalid-json';
    error.statusCode = 400;
    throw error;
  }
}

function sendError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const code = error?.code || 'google-photos-albums/internal-error';
  const message = code === 'google-photos-albums/internal-error'
    ? 'Não foi possível concluir a operação com o álbum do Google Fotos.'
    : error?.message || 'Não foi possível concluir a operação.';
  if (statusCode >= 500) console.error('[GOOGLE PHOTOS ALBUMS API]', code, error?.message || error);
  return res.status(statusCode).json({ error: { code, message } });
}

export default async function handler(req, res) {
  setSecurityHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      const error = new Error('Método não permitido.');
      error.code = 'google-photos-albums/method-not-allowed';
      error.statusCode = 405;
      throw error;
    }

    const context = await resolveAccessContext(req, {
      allowedRoles: ['admin', 'professional', 'responsible', 'monitoring'],
    });

    if (req.method === 'GET') {
      if (req.query?.mode === 'patients') {
        return res.status(200).json(await listGooglePhotosAlbumPatientOptions(context));
      }
      if (req.query?.mode === 'sessions') {
        return res.status(200).json(await listGooglePhotosAlbumSessionOptions(context, req.query?.patientId));
      }
      return res.status(200).json(await listGooglePhotosAlbums(context, {
        patientId: req.query?.patientId,
        packageNumber: req.query?.packageNumber,
        scope: req.query?.scope,
      }));
    }

    const body = parseBody(req);
    if (body.action === 'savePackage') {
      return res.status(200).json(await saveGooglePhotosAlbumPackage(context, body.package));
    }

    const error = new Error('A ação solicitada é inválida.');
    error.code = 'google-photos-albums/invalid-action';
    error.statusCode = 400;
    throw error;
  } catch (error) {
    return sendError(res, error);
  }
}
