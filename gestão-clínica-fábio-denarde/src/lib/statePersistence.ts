import type { AppState, PersonalAppointment } from '../types';
import { sanitizeForFirestore } from './externalRegistration';

type Data = Record<string, unknown>;
type FieldValue = { present: boolean; value?: unknown };
export type PersistenceStatus = 'SUCCESS' | 'VALIDATION_FAILED' | 'CONFLICT' | 'PERSISTENCE_FAILED';
export interface PersistenceResult { status: PersistenceStatus; code: string; operations: number }
export interface FieldChange { path: string[]; before: FieldValue; after: FieldValue }
export interface PersistenceOperation {
  collection: string;
  id: string;
  kind: 'create' | 'update' | 'delete';
  baseline: Data | null;
  data?: Data;
  changes: FieldChange[];
  idempotentCreate: boolean;
}
export interface PersistencePlan { operations: PersistenceOperation[] }
export interface PersistenceTransaction {
  get(operation: PersistenceOperation): Promise<Data | null>;
  write(operation: PersistenceOperation): void;
}
export interface PersistenceDriver {
  /** SDK parsing only: this must not commit or access the database. */
  validate(plan: PersistencePlan): void;
  run(work: (transaction: PersistenceTransaction) => Promise<void>): Promise<void>;
}

// Installed Firestore SDK: runTransaction documents a maximum of 500 writes.
// One logical operation always uses one transaction; never silently chunk it.
export const MAX_ATOMIC_STATE_WRITES = 500;
export const MAX_STATE_PLAN_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 900 * 1024; // Conservative local allowance for wire overhead.
const utf8 = (value: string) => new TextEncoder().encode(value).length;
const plain = (value: unknown): value is Data => Boolean(value) && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

class PlanError extends Error { constructor(readonly code: string) { super(code); } }
class ConflictError extends Error { constructor() { super('concurrent-change'); } }

function copy(value: unknown): unknown {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(copy);
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value; // Firestore Timestamp/GeoPoint/Reference/Bytes are SDK values.
}

export function persistedValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length
    && left.every((value, index) => persistedValuesEqual(value, right[index]));
  if (plain(left) && plain(right)) return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => own(right, key) && persistedValuesEqual(left[key], right[key]));
  if (left && right && typeof left === 'object' && typeof right === 'object'
    && left.constructor === right.constructor && 'isEqual' in left && typeof left.isEqual === 'function') {
    return Boolean(left.isEqual(right));
  }
  return false;
}

function field(data: Data, path: string[]): FieldValue {
  let value: unknown = data;
  for (const key of path) {
    if (!plain(value) || !own(value, key)) return { present: false };
    value = value[key];
  }
  return { present: true, value };
}
const sameField = (left: FieldValue, right: FieldValue) => left.present === right.present
  && (!left.present || persistedValuesEqual(left.value, right.value));

function diff(before: Data, after: Data, prefix: string[] = []): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const path = [...prefix, key];
    const previous: FieldValue = own(before, key) ? { present: true, value: before[key] } : { present: false };
    const next: FieldValue = own(after, key) ? { present: true, value: after[key] } : { present: false };
    if (sameField(previous, next)) continue;
    if (next.present && plain(next.value) && (!previous.present || plain(previous.value))
      && Object.keys(next.value).length > 0) changes.push(...diff(previous.present ? previous.value as Data : {}, next.value, path));
    else changes.push({ path, before: previous, after: next });
  }
  return changes;
}

function validName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('/') || value === '.' || value === '..'
    || /^__.*__$/.test(value) || utf8(value) > 1500) throw new PlanError('invalid-document-identity');
}

function valueBytes(value: unknown, depth = 0, arrayElement = false): number {
  if (depth > 20) throw new PlanError('document-depth-exceeded');
  if (value === null) return 1;
  if (typeof value === 'string') return utf8(value) + 16;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new PlanError('invalid-date-value');
    return 16;
  }
  if (Array.isArray(value)) {
    if (arrayElement) throw new PlanError('nested-array-value');
    return 32 + value.reduce((sum, item) => sum + valueBytes(item, depth + 1, true), 0);
  }
  if (plain(value)) return Object.entries(value).reduce((sum, [key, item]) => {
    if (!key || /^__.*__$/.test(key) || utf8(key) > 1500) throw new PlanError('invalid-field-name');
    return sum + utf8(key) + 32 + valueBytes(item, depth + 1);
  }, 32);
  if (value && typeof value === 'object'
    && ['Timestamp', 'GeoPoint', 'DocumentReference', 'Bytes'].includes(value.constructor?.name)) {
    return 64 + ('path' in value && typeof value.path === 'string' ? utf8(value.path) : 0);
  }
  throw new PlanError('unsupported-field-value');
}

function patchedDocument(before: Data, changes: FieldChange[]): Data {
  const result = copy(before) as Data;
  for (const change of changes) {
    let parent = result;
    for (const key of change.path.slice(0, -1)) {
      if (!plain(parent[key])) parent[key] = {};
      parent = parent[key] as Data;
    }
    const key = change.path[change.path.length - 1];
    if (change.after.present) parent[key] = copy(change.after.value);
    else delete parent[key];
  }
  return result;
}

function validateDocumentSize(data: Data) {
  if (valueBytes(data) > MAX_DOCUMENT_BYTES) throw new PlanError('document-size-limit-exceeded');
}

/** Raw snapshots are associated with the exact UI record, not a mutable latest-ID cache.
 * This preserves the caller's old baseline, including fields hidden by DTO mapping. */
export class PersistenceBaselines {
  private records = new WeakMap<object, { id: string; data: Data | null }>();
  remember<T extends object>(record: T, id: string, data: Data | null): T {
    this.records.set(record, { id, data: copy(data) as Data | null });
    return record;
  }
  get(record: object) { return this.records.get(record); }
  clear() { this.records = new WeakMap(); }
}

function personalData(value: unknown, createdAt?: string): Data {
  const item = value as PersonalAppointment;
  return {
    id: item.id, data: item.date, hora: item.time, tipo_compromisso: item.type,
    observacao: item.notes, recorrencia: item.recurrence, alarme: item.alarmEnabled,
    som_alarme: item.alarmSound || null, antecedencia_alarme: item.alarmAdvance || null,
    volume_alarme: item.alarmVolume ?? 80, fade_in: item.alarmFadeIn ?? false,
    status: item.isDone ? 'concluído' : 'ativo',
    ...(createdAt ? { criado_em: createdAt } : {}),
  };
}

export function buildStatePersistencePlan({ baseline, intended, loaded, baselines, now = new Date().toISOString() }: {
  baseline: AppState; intended: Partial<AppState>; loaded: ReadonlySet<string>; baselines: PersistenceBaselines; now?: string;
}): PersistencePlan {
  const sources = [
    ['patients', 'patients'], ['sessions', 'sessions'], ['payments', 'payments'],
    ['repositions', 'repositions'], ['expenses', 'expenses'], ['evolutions', 'evolutions'],
    ['personalAppointments', 'agenda_pessoal'], ['externalRegistrationForms', 'externalRegistrationForms'],
  ] as const;
  const names = new Map<string, string>([['settings', 'settings'], ...sources]);
  // All touched collections are checked before any SDK write is even staged.
  for (const key of Object.keys(intended)) {
    const collection = names.get(key);
    if (!collection) throw new PlanError('unsupported-state-property');
    if (!loaded.has(collection)) throw new PlanError('collection-not-loaded');
    if (intended[key as keyof AppState] == null) throw new PlanError('invalid-collection-value');
  }
  const operations: PersistenceOperation[] = [];
  const mapData = (collection: string, item: unknown, create = false): Data => {
    if (!plain(item)) throw new PlanError('invalid-document-value');
    const data = collection === 'agenda_pessoal' ? personalData(item, create ? now : undefined)
      : ['patients', 'externalRegistrationForms'].includes(collection) ? sanitizeForFirestore(item) : item;
    valueBytes(data); // Validates even an unchanged or later document.
    return copy(data) as Data;
  };
  const planRecord = (collection: string, id: string, previous: object | undefined, next: unknown) => {
    validName(id);
    const saved = previous ? baselines.get(previous) : undefined;
    if (previous && (!saved || saved.id !== id)) throw new PlanError('baseline-unavailable');
    const raw = saved?.data ?? null;
    if (next === undefined) {
      if (!raw) throw new PlanError('delete-baseline-missing');
      operations.push({ collection, id, kind: 'delete', baseline: copy(raw) as Data, changes: [], idempotentCreate: false });
      return;
    }
    const data = mapData(collection, next, !raw);
    if (collection !== 'settings' && data.id !== id) throw new PlanError('document-identity-mismatch');
    if (!raw) {
      operations.push({ collection, id, kind: 'create', baseline: null, data, changes: [],
        idempotentCreate: ['payments', 'expenses'].includes(collection)
          && typeof data.operationKey === 'string' && data.operationKey.length > 0 });
      return;
    }
    // Compare UI baseline versus intention for the delta, raw baseline for conflicts.
    const changes = diff(mapData(collection, previous), data)
      .map(change => ({ ...change, before: field(raw, change.path) }));
    if (changes.length) {
      validateDocumentSize(patchedDocument(raw, changes));
      operations.push({ collection, id, kind: 'update', baseline: copy(raw) as Data,
        changes, idempotentCreate: false });
    }
  };
  if (own(intended, 'settings')) planRecord('settings', 'config', baseline.settings, intended.settings);
  for (const [property, collection] of sources) {
    if (!own(intended, property)) continue;
    const current = baseline[property] || [];
    const next = intended[property];
    if (!Array.isArray(current) || !Array.isArray(next)) throw new PlanError('invalid-collection-value');
    const index = (items: unknown[]) => {
      const result = new Map<string, Data>();
      for (const item of items) {
        if (!plain(item)) throw new PlanError('invalid-document-value');
        validName(item.id);
        if (result.has(item.id)) throw new PlanError('duplicate-document-identity');
        result.set(item.id, item);
      }
      return result;
    };
    const beforeMap = index(current);
    const afterMap = index(next);
    for (const [id, item] of beforeMap) if (!afterMap.has(id)) planRecord(collection, id, item, undefined);
    for (const [id, item] of afterMap) planRecord(collection, id, beforeMap.get(id), item);
  }
  if (operations.length > MAX_ATOMIC_STATE_WRITES) throw new PlanError('atomic-write-limit-exceeded');
  let bytes = 0;
  for (const operation of operations) {
    const payloadBytes = operation.kind === 'create' ? valueBytes(operation.data)
      : operation.kind === 'delete' ? valueBytes(operation.baseline)
        : operation.changes.reduce((sum, change) => sum + change.path.reduce((n, key) => n + utf8(key) + 32, 0)
          + (change.after.present ? valueBytes(change.after.value) : 16), 0);
    if (payloadBytes > MAX_DOCUMENT_BYTES) throw new PlanError('document-size-limit-exceeded');
    bytes += payloadBytes + utf8(operation.collection) + utf8(operation.id) + 256;
  }
  if (bytes > MAX_STATE_PLAN_BYTES) throw new PlanError('atomic-payload-limit-exceeded');
  return { operations };
}

const safeFailureCode = (cause: unknown) => {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code).replace(/^firestore\//, '') : '';
  return ['permission-denied', 'unavailable', 'deadline-exceeded', 'aborted', 'failed-precondition',
    'resource-exhausted', 'not-found', 'unauthenticated', 'internal', 'cancelled'].includes(code) ? code : 'persistence-failed';
};

export async function persistStateChange(request: Parameters<typeof buildStatePersistencePlan>[0], driver: PersistenceDriver): Promise<PersistenceResult> {
  let plan: PersistencePlan;
  try {
    plan = buildStatePersistencePlan(request);
    driver.validate(plan); // Parse every payload with the SDK, but never commit this dry batch.
  } catch (cause) {
    return { status: 'VALIDATION_FAILED', code: cause instanceof PlanError ? cause.code : 'invalid-persistence-plan', operations: 0 };
  }
  if (!plan.operations.length) return { status: 'SUCCESS', code: 'no-change', operations: 0 };
  try {
    await driver.run(async transaction => {
      // Firestore requires every read before writes. Check the ENTIRE operation
      // against those snapshots before staging even the first transaction write.
      const current = await Promise.all(plan.operations.map(operation => transaction.get(operation)));
      const writes: PersistenceOperation[] = [];
      for (let index = 0; index < plan.operations.length; index++) {
        const operation = plan.operations[index];
        const remote = current[index];
        if (operation.kind === 'create') {
          if (remote) {
            if (operation.idempotentCreate && persistedValuesEqual(remote, operation.data)) continue;
            throw new ConflictError();
          }
        } else {
          if (!remote) throw new ConflictError(); // Never recreate a deleted document.
          if (operation.kind === 'delete') {
            if (!persistedValuesEqual(remote, operation.baseline)) throw new ConflictError();
          } else if (operation.changes.some(change => {
            if (!sameField(field(remote, change.path), change.before)) return true;
            // A missing leaf is not enough: reject a concurrently removed/replaced
            // parent, while allowing another client to add a different leaf.
            for (let depth = 1; depth < change.path.length; depth++) {
              const path = change.path.slice(0, depth);
              const original = field(operation.baseline!, path);
              const current = field(remote, path);
              if (original.present && (!current.present || !plain(current.value))) return true;
              if (!original.present && current.present && !plain(current.value)) return true;
            }
            return false;
          })) {
            throw new ConflictError();
          }
          if (operation.kind === 'update') validateDocumentSize(patchedDocument(remote, operation.changes));
        }
        writes.push(operation);
      }
      for (const operation of writes) transaction.write(operation);
    });
    return { status: 'SUCCESS', code: 'committed', operations: plan.operations.length };
  } catch (cause) {
    if (cause instanceof PlanError) return { status: 'VALIDATION_FAILED', code: cause.code, operations: plan.operations.length };
    return cause instanceof ConflictError
      ? { status: 'CONFLICT', code: 'concurrent-change', operations: plan.operations.length }
      : { status: 'PERSISTENCE_FAILED', code: safeFailureCode(cause), operations: plan.operations.length };
  }
}
