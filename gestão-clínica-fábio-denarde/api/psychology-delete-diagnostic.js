const MAX_DIAGNOSTIC_BODY_BYTES = 4096;
const DIAGNOSTIC_ROUTE = '/api/psychology/patients/:id';
const DIAGNOSTIC_METHOD = 'DELETE';
const DIAGNOSTIC_PREFIX = '[PSYCHOLOGY DELETE DIAGNOSTIC]';
const ALLOWED_STAGES = new Set([
  'confirm_start',
  'before_repository',
  'before_token',
  'token_ok',
  'token_error',
  'before_fetch',
  'fetch_response',
  'catch',
]);
const ALLOWED_KEYS = new Set([
  'DELETE_PATIENT_STAGE',
  'correlationId',
  'method',
  'routeTemplate',
  'authUserPresent',
  'authorizationPresent',
  'errorName',
  'errorCode',
  'httpStatus',
  'mutationLockPresent',
  'repositoryPresent',
  'patientSelectionPresent',
]);
const YES_NO_FIELDS = new Set([
  'authUserPresent',
  'authorizationPresent',
  'mutationLockPresent',
  'repositoryPresent',
  'patientSelectionPresent',
]);
const SAFE_VALUE = /^[A-Za-z0-9._:/-]{1,128}$/;

function header(req, name) {
  const headers = req?.headers || {};
  const matchingKey = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return matchingKey ? headers[matchingKey] : undefined;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function reject(res, status, code) {
  res.status(status).json({ error: { code, message: 'Evento diagnóstico inválido.' } });
}

function bodySize(req) {
  const contentLength = Number(header(req, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_DIAGNOSTIC_BODY_BYTES) return MAX_DIAGNOSTIC_BODY_BYTES + 1;
  if (typeof req?.body === 'string') return new TextEncoder().encode(req.body).byteLength;
  return 0;
}

function parseBody(req) {
  if (bodySize(req) > MAX_DIAGNOSTIC_BODY_BYTES) throw new Error('body-too-large');
  if (req?.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req?.body === 'string') return JSON.parse(req.body);
  throw new Error('body-missing');
}

function safeString(value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && SAFE_VALUE.test(value);
}

function sanitizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('body-invalid');
  const keys = Object.keys(input);
  if (keys.some(key => !ALLOWED_KEYS.has(key))) throw new Error('field-not-allowed');
  if (!ALLOWED_STAGES.has(input.DELETE_PATIENT_STAGE)) throw new Error('stage-invalid');
  if (!safeString(input.correlationId)) throw new Error('correlation-invalid');
  if (input.method !== DIAGNOSTIC_METHOD || input.routeTemplate !== DIAGNOSTIC_ROUTE) throw new Error('route-invalid');

  const event = {
    DELETE_PATIENT_STAGE: input.DELETE_PATIENT_STAGE,
    correlationId: input.correlationId,
    method: DIAGNOSTIC_METHOD,
    routeTemplate: DIAGNOSTIC_ROUTE,
  };
  for (const key of YES_NO_FIELDS) {
    if (input[key] !== undefined) {
      if (input[key] !== 'YES' && input[key] !== 'NO') throw new Error('flag-invalid');
      event[key] = input[key];
    }
  }
  for (const key of ['errorName', 'errorCode']) {
    if (input[key] !== undefined) {
      if (!safeString(input[key], 80)) throw new Error('error-field-invalid');
      event[key] = input[key];
    }
  }
  if (input.httpStatus !== undefined) {
    if (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599) throw new Error('status-invalid');
    event.httpStatus = input.httpStatus;
  }
  return event;
}

export default function handler(req, res) {
  setSecurityHeaders(res);
  if (req?.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'diagnostic/method-not-allowed', message: 'Método não permitido.' } });
  }
  if (!String(header(req, 'content-type') || '').toLowerCase().startsWith('application/json')) {
    return reject(res, 415, 'diagnostic/content-type-required');
  }
  try {
    const event = sanitizeEvent(parseBody(req));
    console.info(DIAGNOSTIC_PREFIX, event);
    return res.status(204).end();
  } catch {
    return reject(res, 400, 'diagnostic/invalid-event');
  }
}
