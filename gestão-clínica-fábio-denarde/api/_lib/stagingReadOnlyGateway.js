const STAGING_HOSTNAMES = new Set([
  'gestaoclinica-psicologia-staging.vercel.app',
  'gestaoclinica-psicologia-staging-fabio-s-projects3.vercel.app',
]);

export const STAGING_READ_ONLY_UPSTREAM_ORIGIN = 'https://gestaoclinica-solucoes.vercel.app';

export const DOCTORALIA_STAGING_ALLOWED_READ_PATHS = Object.freeze([
  'patients',
  'sessions',
  'personal-appointments',
  'charges',
  'payments',
  'expenses',
  'packages',
  'services',
  'locations',
  'settings',
]);

const ALLOWED_READ_PATHS = new Set(DOCTORALIA_STAGING_ALLOWED_READ_PATHS);
const STAGING_READ_ONLY_CODE = 'STAGING_READ_ONLY';
const UPSTREAM_TIMEOUT_MS = 7_000;

function headerValue(req, name) {
  const headers = req?.headers || {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+$/, '');
}

export function isDoctoraliaStagingHostname(req) {
  return STAGING_HOSTNAMES.has(normalizeHostname(headerValue(req, 'host')));
}

function requestUrl(req) {
  try {
    return new URL(String(req?.url || '/'), 'http://staging.invalid');
  } catch {
    return new URL('/', 'http://staging.invalid');
  }
}

function queryEntries(req, parsedUrl) {
  const fromUrl = [...parsedUrl.searchParams.entries()];
  if (fromUrl.length > 0 || !req?.query || typeof req.query !== 'object') return fromUrl;

  return Object.entries(req.query).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.map(item => [key, String(item)]);
    if (value === undefined || value === null) return [];
    return [[key, String(value)]];
  });
}

function safePathSegments(value) {
  const raw = String(value || '');
  if (!raw || raw === '/') return [];
  const pieces = raw.replace(/^\/+|\/+$/g, '').split('/');
  if (pieces.some(piece => !piece)) return null;
  try {
    return pieces.map(piece => decodeURIComponent(piece));
  } catch {
    return null;
  }
}

function psychologyPath(req, entries, parsedUrl) {
  const marker = '/api/psychology';
  const pathname = parsedUrl.pathname;
  const suffix = pathname.startsWith(marker) ? pathname.slice(marker.length) : '';
  const urlSegments = safePathSegments(suffix);
  if (urlSegments === null) return null;

  if (urlSegments.length === 1 && ALLOWED_READ_PATHS.has(urlSegments[0])) {
    // The concrete allowlisted path is authoritative. Vercel may expose
    // framework route metadata as query parameters; none of it may alter the
    // fixed upstream path or add an upstream query string.
    return urlSegments;
  }

  const pathEntries = entries.filter(([key]) => key === 'path');
  const unexpectedEntries = entries.filter(([key]) => key !== 'path');
  if (pathEntries.length > 1 || unexpectedEntries.length > 0) return null;

  const querySegments = pathEntries.length === 1 ? safePathSegments(pathEntries[0][1]) : [];
  if (querySegments === null) return null;
  if (urlSegments.length > 0 && querySegments.length > 0 && JSON.stringify(urlSegments) !== JSON.stringify(querySegments)) return null;
  return querySegments.length > 0 ? querySegments : urlSegments;
}

function accessQuery(entries) {
  if (entries.length === 0) return { allowed: true, search: '' };
  if (entries.length !== 1 || entries[0][0] !== 'activeRole' || entries[0][1] !== 'professional') {
    return { allowed: false, search: '' };
  }
  return { allowed: true, search: '?activeRole=professional' };
}

function applyGatewayHeaders(res) {
  res.setHeader('X-Staging-Read-Only', 'true');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, statusCode, payload) {
  applyGatewayHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function') res.status(statusCode);
  if (typeof res.json === 'function') return res.json(payload);
  return res.end(JSON.stringify(payload));
}

function sendReadOnlyBlock(res, statusCode, message) {
  return sendJson(res, statusCode, {
    error: {
      code: STAGING_READ_ONLY_CODE,
      message,
    },
  });
}

async function forwardReadOnlyGet(req, res, pathname, search, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const headers = {
    Accept: headerValue(req, 'accept') || 'application/json',
  };
  const authorization = headerValue(req, 'authorization');
  if (authorization) headers.Authorization = authorization;

  let upstream;
  try {
    upstream = await fetchImpl(`${STAGING_READ_ONLY_UPSTREAM_ORIGIN}${pathname}${search}`, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === 'AbortError') {
      return sendJson(res, 504, { error: { code: 'STAGING_UPSTREAM_TIMEOUT', message: 'O provider operacional demorou para responder.' } });
    }
    return sendJson(res, 502, { error: { code: 'STAGING_UPSTREAM_UNAVAILABLE', message: 'O provider operacional está indisponível.' } });
  }
  clearTimeout(timeout);

  if (upstream.status >= 300 && upstream.status < 400) {
    return sendJson(res, 502, { error: { code: 'STAGING_UPSTREAM_REDIRECT_BLOCKED', message: 'O provider operacional tentou redirecionar a leitura.' } });
  }

  let body;
  try {
    body = await upstream.text();
  } catch {
    return sendJson(res, 502, { error: { code: 'STAGING_UPSTREAM_INVALID_RESPONSE', message: 'O provider operacional retornou uma resposta inválida.' } });
  }

  applyGatewayHeaders(res);
  const contentType = upstream.headers?.get?.('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  if (typeof res.status === 'function') res.status(upstream.status);
  if (typeof res.send === 'function') return res.send(body);
  return res.end(body);
}

export async function handleDoctoraliaStagingReadOnlyGateway(req, res, { fetchImpl = globalThis.fetch } = {}) {
  if (!isDoctoraliaStagingHostname(req)) return false;

  const method = String(req?.method || '').toUpperCase();
  if (method === 'OPTIONS') {
    applyGatewayHeaders(res);
    res.setHeader('Allow', 'GET, OPTIONS');
    if (typeof res.status === 'function') res.status(204);
    return res.end();
  }
  if (method !== 'GET') {
    applyGatewayHeaders(res);
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendReadOnlyBlock(res, 405, 'O staging Doctoralia aceita somente leituras GET.');
  }

  const parsedUrl = requestUrl(req);
  const entries = queryEntries(req, parsedUrl);
  let pathname;
  let search = '';
  if (parsedUrl.pathname === '/api/access') {
    const query = accessQuery(entries);
    if (!query.allowed) return sendReadOnlyBlock(res, 403, 'Esta consulta não faz parte do gateway de acesso read-only do staging.');
    pathname = '/api/access';
    search = query.search;
  } else if (parsedUrl.pathname === '/api/psychology' || parsedUrl.pathname.startsWith('/api/psychology/')) {
    const segments = psychologyPath(req, entries, parsedUrl);
    if (!segments || segments.length !== 1 || !ALLOWED_READ_PATHS.has(segments[0])) {
      return sendReadOnlyBlock(res, 403, 'Esta leitura não está habilitada na allowlist do staging Doctoralia.');
    }
    pathname = `/api/psychology/${segments[0]}`;
  } else {
    return false;
  }

  return forwardReadOnlyGet(req, res, pathname, search, fetchImpl);
}
