import { normalizeGooglePhotosAlbumUrl } from '../../shared/googlePhotosAlbums.js';

export const GOOGLE_PHOTOS_APPEND_ONLY_SCOPE = 'https://www.googleapis.com/auth/photoslibrary.appendonly';
export const GOOGLE_PHOTOS_ALBUMS_ENDPOINT = 'https://photoslibrary.googleapis.com/v1/albums';
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TITLE_LENGTH = 120;

function googlePhotosClientError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = Number(options.statusCode) || 502;
  error.creationOutcome = options.creationOutcome === 'unknown' ? 'unknown' : 'not_created';
  return error;
}

function sanitizeTitle(value) {
  return String(value || '').trim().slice(0, MAX_TITLE_LENGTH);
}

export function getGooglePhotosCredentialPresence(env = process.env) {
  return Object.freeze({
    clientId: Boolean(String(env.GOOGLE_PHOTOS_CLIENT_ID || '').trim()),
    clientSecret: Boolean(String(env.GOOGLE_PHOTOS_CLIENT_SECRET || '').trim()),
    refreshToken: Boolean(String(env.GOOGLE_PHOTOS_REFRESH_TOKEN || '').trim()),
  });
}

function readGooglePhotosConfiguration(env = process.env) {
  const clientId = String(env.GOOGLE_PHOTOS_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_PHOTOS_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_PHOTOS_REFRESH_TOKEN || '').trim();

  if (!clientId || !refreshToken) {
    throw googlePhotosClientError(
      'google-photos-albums/oauth-not-configured',
      'A criação de álbuns ainda não foi configurada no servidor.',
      { statusCode: 503, creationOutcome: 'not_created' },
    );
  }

  return { clientId, clientSecret, refreshToken };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, timeoutOutcome) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw googlePhotosClientError(
      timeoutOutcome === 'unknown'
        ? 'google-photos-albums/google-create-unknown'
        : 'google-photos-albums/oauth-unavailable',
      timeoutOutcome === 'unknown'
        ? 'O Google não confirmou se o álbum foi criado. Para evitar duplicidade, uma nova tentativa automática foi bloqueada.'
        : 'Não foi possível autenticar a criação do álbum no Google Fotos.',
      {
        statusCode: 503,
        creationOutcome: timeoutOutcome,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response, code, message, creationOutcome) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw googlePhotosClientError(code, message, {
      statusCode: 502,
      creationOutcome,
    });
  }
  return payload;
}

async function getAccessToken({ fetchImpl, env, timeoutMs }) {
  const { clientId, clientSecret, refreshToken } = readGooglePhotosConfiguration(env);
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const response = await fetchWithTimeout(fetchImpl, GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, timeoutMs, 'not_created');

  if (!response.ok) {
    throw googlePhotosClientError(
      'google-photos-albums/oauth-refresh-failed',
      'A autorização do Google Fotos precisa ser renovada no servidor.',
      { statusCode: 503, creationOutcome: 'not_created' },
    );
  }

  const payload = await readJsonResponse(
    response,
    'google-photos-albums/oauth-invalid-response',
    'O servidor do Google retornou uma autorização inválida.',
    'not_created',
  );
  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) {
    throw googlePhotosClientError(
      'google-photos-albums/oauth-invalid-response',
      'O servidor do Google não retornou uma autorização válida.',
      { statusCode: 503, creationOutcome: 'not_created' },
    );
  }
  return accessToken;
}

function classifyCreateHttpFailure(status) {
  if (status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) {
    return 'not_created';
  }
  return 'unknown';
}

export async function createEmptyGooglePhotosAlbum({
  title,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedTitle = sanitizeTitle(title);
  if (!normalizedTitle) {
    throw googlePhotosClientError(
      'google-photos-albums/missing-title',
      'Informe o título do álbum.',
      { statusCode: 400, creationOutcome: 'not_created' },
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw googlePhotosClientError(
      'google-photos-albums/fetch-unavailable',
      'O servidor não possui suporte para acessar o Google Fotos.',
      { statusCode: 503, creationOutcome: 'not_created' },
    );
  }

  const accessToken = await getAccessToken({ fetchImpl, env, timeoutMs });
  const response = await fetchWithTimeout(fetchImpl, GOOGLE_PHOTOS_ALBUMS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ album: { title: normalizedTitle } }),
  }, timeoutMs, 'unknown');

  if (!response.ok) {
    const creationOutcome = classifyCreateHttpFailure(Number(response.status) || 500);
    throw googlePhotosClientError(
      creationOutcome === 'unknown'
        ? 'google-photos-albums/google-create-unknown'
        : 'google-photos-albums/google-create-rejected',
      creationOutcome === 'unknown'
        ? 'O Google não confirmou se o álbum foi criado. Para evitar duplicidade, uma nova tentativa automática foi bloqueada.'
        : 'O Google recusou a criação do álbum. Revise a autorização configurada no servidor.',
      {
        statusCode: creationOutcome === 'unknown' ? 503 : 502,
        creationOutcome,
      },
    );
  }

  const payload = await readJsonResponse(
    response,
    'google-photos-albums/google-create-unknown',
    'O Google não confirmou os dados do álbum criado. Para evitar duplicidade, uma nova tentativa automática foi bloqueada.',
    'unknown',
  );
  const id = String(payload?.id || '').trim();
  const productUrl = normalizeGooglePhotosAlbumUrl(payload?.productUrl);
  if (!id || !productUrl) {
    throw googlePhotosClientError(
      'google-photos-albums/google-create-unknown',
      'O Google não confirmou os dados do álbum criado. Para evitar duplicidade, uma nova tentativa automática foi bloqueada.',
      { statusCode: 503, creationOutcome: 'unknown' },
    );
  }

  return {
    id,
    productUrl,
    title: normalizedTitle,
  };
}
