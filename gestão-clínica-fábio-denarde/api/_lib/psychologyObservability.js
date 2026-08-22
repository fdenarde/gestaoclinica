import crypto from 'node:crypto';
import { shortAuthUidHash } from './sanitizedAccessAudit.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function normalize(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

export function createPsychologyRequestId(req) {
  const supplied = normalize(req?.headers?.['x-request-id'] || req?.headers?.['X-Request-Id'], 80);
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

export function buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status, timestamp, code }) {
  const event = {
    requestId: normalize(requestId, 80) || 'unknown-request',
    actorUidHash: shortAuthUidHash(runtimeScope?.authUid),
    context: normalize(runtimeScope?.context, 40) || 'PSICOLOGIA',
    operation: normalize(operation, 160) || 'unknown',
    status: normalize(status, 40) || 'unknown',
    timestamp: normalize(timestamp, 64) || new Date().toISOString(),
  };
  if (code) event.code = normalize(code, 120);
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined));
}

export function logPsychologyAuditEvent(event) {
  console.info('[psychology.audit]', JSON.stringify(event));
}
