import crypto from 'node:crypto';

const DEFAULT_PROJECT_ID = 'ai-studio-applet-webapp-e3283';
const DEFAULT_DATABASE_ID = 'ai-studio-587970e5-0653-44a5-93a3-be1a74301eda';
const SENSITIVE_KEY_PATTERN = /(uid|sessionid|patientid|phone|email|name|message|token|credential|payment|clinical|content|password|secret|authorization)/i;
const SENSITIVE_VALUE_PATTERN = /(Bearer\s+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d\s().-]{7,}\d)/i;
const ALLOWED_KEYS = new Set([
  'source', 'operation', 'logicalOperation', 'collection', 'event', 'docs', 'documentChanges', 'metadataOnly',
  'fromCache', 'hasPendingWrites', 'billedRead', 'timestamp', 'instanceId', 'visibility', 'focus', 'online', 'userChanged',
  'endpoint', 'logicalMode', 'cache', 'cacheHit', 'inFlightDedupe', 'dedupeHit', 'durationMs', 'status', 'preview',
  'patientsReturned', 'sessionsReturned', 'countOperations', 'documentsReturned', 'returnedCount', 'operations',
  'environment', 'projectId', 'databaseId', 'routine', 'invocationReason', 'configSnapshots', 'accounts',
  'patientsRead', 'sessionsRead', 'reminders', 'writeAttempted', 'writeCompleted', 'attempted', 'persisted',
  'skippedSameHash', 'reason',
]);

function createEphemeralInstanceId() {
  try {
    return `api-${crypto.randomUUID()}`;
  } catch {
    return `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
function sanitizeFields(fields = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (!ALLOWED_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string') {
      if (SENSITIVE_VALUE_PATTERN.test(value)) continue;
      sanitized[key] = value.slice(0, 160);
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) sanitized[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isEnabled(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

export function createFirestoreDiagnostics({
  enabled = isEnabled(process.env.FIRESTORE_DIAGNOSTICS),
  logger = (label, record) => console.info(label, record),
  instanceId = createEphemeralInstanceId(),
  projectId = String(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID),
  databaseId = String(process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID),
  environment = String(process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'),
} = {}) {
  const active = enabled === true;
  return {
    enabled: active,
    emit(fields = {}) {
      if (!active) return;
      try {
        logger('[FIRESTORE-METRIC]', sanitizeFields({
          source: 'backend',
          projectId,
          databaseId,
          environment,
          timestamp: new Date().toISOString(),
          instanceId,
          ...fields,
        }));
      } catch {
        // Diagnostics must never affect the API or runtime.
      }
    },
  };
}

export const firestoreDiagnostics = createFirestoreDiagnostics();

function returnedCount(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload;
  for (const key of ['items', 'patients', 'sessions', 'records', 'notifications', 'results']) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  return undefined;
}

export function attachFirestoreDiagnostics(res, fields = {}) {
  if (!firestoreDiagnostics.enabled) return;
  const startedAt = Date.now();
  firestoreDiagnostics.emit({ ...fields, event: 'request-start' });
  if (!res || typeof res.json !== 'function') return;
  const originalJson = res.json.bind(res);
  res.json = payload => {
    firestoreDiagnostics.emit({
      ...fields,
      event: 'request-finish',
      status: Number(res.statusCode) || 200,
      durationMs: Date.now() - startedAt,
      returnedCount: returnedCount(payload),
      writeCompleted: fields.writeAttempted === true ? (Number(res.statusCode) || 200) < 400 : undefined,
    });
    return originalJson(payload);
  };
}

export function emitFirestoreMetric(fields = {}) {
  firestoreDiagnostics.emit(fields);
}
