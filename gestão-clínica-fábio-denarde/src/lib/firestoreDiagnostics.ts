type DiagnosticValue = string | number | boolean | null | undefined;
type DiagnosticFields = Record<string, DiagnosticValue>;

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

const viteEnv = import.meta.env as Record<string, string | boolean | undefined>;
const DEFAULT_PROJECT_ID = 'ai-studio-applet-webapp-e3283';
const DEFAULT_DATABASE_ID = 'ai-studio-587970e5-0653-44a5-93a3-be1a74301eda';

function createEphemeralInstanceId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `web-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Fall through to the non-identifying local fallback.
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function sanitizeFields(fields: DiagnosticFields = {}): DiagnosticFields {
  const sanitized: DiagnosticFields = {};
  for (const [key, value] of Object.entries(fields)) {
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

function isEnabled(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

export function createFirestoreDiagnostics({
  enabled = isEnabled(viteEnv.VITE_FIRESTORE_DIAGNOSTICS),
  logger = (label: string, record: DiagnosticFields) => console.info(label, record),
  instanceId = createEphemeralInstanceId(),
  projectId = String(viteEnv.VITE_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID),
  databaseId = String(viteEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID || viteEnv.VITE_FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID),
  environment = String(viteEnv.MODE || 'unknown'),
}: {
  enabled?: boolean;
  logger?: (label: string, record: DiagnosticFields) => void;
  instanceId?: string;
  projectId?: string;
  databaseId?: string;
  environment?: string;
} = {}) {
  const active = enabled === true;
  return {
    enabled: active,
    emit(fields: DiagnosticFields = {}): void {
      if (!active) return;
      try {
        logger('[FIRESTORE-METRIC]', sanitizeFields({
          source: 'frontend',
          projectId,
          databaseId,
          environment,
          timestamp: new Date().toISOString(),
          instanceId,
          ...fields,
        }));
      } catch {
        // Diagnostics must never affect application behavior.
      }
    },
  };
}

export const firestoreDiagnostics = createFirestoreDiagnostics();

export function emitFirestoreMetric(fields: DiagnosticFields = {}): void {
  firestoreDiagnostics.emit(fields);
}
