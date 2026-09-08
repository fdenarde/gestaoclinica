import crypto from 'crypto';

function triState(value) {
  if (value === true || value === 'YES') return 'YES';
  if (value === false || value === 'NO') return 'NO';
  return 'NOT_OBSERVED';
}

function tokenVerificationResult(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return new Set(['PASS', 'EXPIRED', 'INVALID', 'MISSING', 'PROJECT_MISMATCH', 'NOT_REACHED', 'OTHER']).has(normalized)
    ? normalized
    : 'NOT_REACHED';
}

export function shortAuthUidHash(value) {
  const normalized = String(value || '').trim();
  return normalized
    ? crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8)
    : 'NOT_OBSERVED';
}

export function authorizationPresent(req) {
  const authorization = req?.headers?.authorization || req?.headers?.Authorization || '';
  return /^Bearer\s+.+$/i.test(String(authorization)) ? 'YES' : 'NO';
}

export function buildSanitizedAccessAuditEvent(req, fields = {}) {
  return {
    timestamp: new Date().toISOString(),
    endpoint: fields.endpoint || '/api/access',
    method: req?.method || 'UNKNOWN',
    statusHttp: Number.isFinite(Number(fields.statusHttp)) ? Number(fields.statusHttp) : 'NOT_OBSERVED',
    technicalCode: String(fields.technicalCode || 'NOT_OBSERVED'),
    authorizationPresent: authorizationPresent(req),
    tokenVerificationResult: tokenVerificationResult(fields.tokenVerificationResult),
    authUidHash: shortAuthUidHash(fields.authUid),
    accessProfileFound: triState(fields.accessProfileFound),
    accessProfileApproved: triState(fields.accessProfileApproved),
    accessRole: fields.accessRole ? String(fields.accessRole) : 'NOT_OBSERVED',
    professionalResolved: triState(fields.professionalResolved),
    psychologyRouteAllowed: triState(fields.psychologyRouteAllowed),
    requestAccessScreenCause: fields.requestAccessScreenCause
      ? String(fields.requestAccessScreenCause)
      : 'NOT_OBSERVED',
  };
}

export function logSanitizedAccessAudit(req, fields = {}) {
  const prefix = fields.auditPrefix || '[ACCESS AUDIT]';
  const event = buildSanitizedAccessAuditEvent(req, fields);
  console.info(prefix, JSON.stringify(event));
  return event;
}
