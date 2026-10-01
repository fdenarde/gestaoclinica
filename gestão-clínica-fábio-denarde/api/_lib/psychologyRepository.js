import crypto from 'node:crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import {
  buildPsychologyChange, capturePsychologyBaseline, validatePsychologyChange,
  assertPsychologyBaseline, applyPsychologyChanges, psychologyField, psychologyStableJson, psychologyPersistenceError,
} from '../../shared/psychologyConcurrency.js';

const PSYCHOLOGY_CONTEXT = 'PSICOLOGIA';
const AGGREGATES = new Set([
  'patients',
  'sessions',
  'sessionRecords',
  'personalAppointments',
  'services',
  'locations',
  'charges',
  'payments',
  'expenses',
  'packages',
  'documents',
  'attachments',
  'settings',
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SELECTIVE_IN_QUERY_CHUNK_SIZE = 30;

function repositoryError(code, message, statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalize(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function assertScope(scope) {
  if (!scope || scope.context !== PSYCHOLOGY_CONTEXT) {
    throw repositoryError('psychology/invalid-scope', 'O escopo Psicologia é inválido.', 422);
  }
  for (const key of ['workspaceId', 'professionalId', 'tenantId']) {
    if (scope[key] !== undefined && (!normalize(scope[key]) || String(scope[key]).includes('/'))) {
      throw repositoryError('psychology/invalid-scope', 'O escopo Psicologia é inválido.', 422);
    }
  }
  for (const key of ['workspaceId', 'professionalId']) {
    if (!normalize(scope[key]) || String(scope[key]).includes('/')) {
      throw repositoryError('psychology/invalid-scope', 'O escopo Psicologia é inválido.', 422);
    }
  }
}

function assertAggregate(aggregate) {
  if (!AGGREGATES.has(aggregate)) {
    throw repositoryError('psychology/aggregate-not-supported', 'O recurso Psicologia não está disponível.', 404);
  }
}

function assertId(id) {
  const normalized = normalize(id, 128);
  if (!normalized || !SAFE_ID_PATTERN.test(normalized) || normalized.includes('/')) {
    throw repositoryError('psychology/invalid-id', 'O identificador enviado é inválido.', 422);
  }
  return normalized;
}

function collectionPath(scope, aggregate) {
  assertScope(scope);
  assertAggregate(aggregate);
  return `workspaces/${scope.workspaceId}/professionals/${scope.professionalId}/contexts/${PSYCHOLOGY_CONTEXT}/${aggregate}`;
}

export function psychologyCollectionPath(scope, aggregate) {
  return collectionPath(scope, aggregate);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
const fingerprint = value => crypto.createHash('sha256').update(psychologyStableJson(value)).digest('hex');
function readRecord(value, raw = value) {
  const record = clone(value);
  delete record.__psychologyVersion;
  return { ...record, __psychologyVersion: fingerprint(raw) };
}


function materializeDocuments(snapshot, runtimeScope) {
  return snapshot.docs
    .map(documentSnapshot => readRecord({ id: documentSnapshot.id, ...clone(documentSnapshot.data() || {}) }, documentSnapshot.data()))
    .filter(item => scopeMatches(item, runtimeScope));
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => normalize(value, 128))
    .filter(value => value && SAFE_ID_PATTERN.test(value) && !value.includes('/')))];
}

async function readSelectiveByField({ collection, runtimeScope, field, value }) {
  const snapshot = await collection.where(field, '==', value).get();
  return materializeDocuments(snapshot, runtimeScope);
}

async function readSelectiveByFieldIn({ collection, runtimeScope, field, values }) {
  const ids = uniqueIds(values);
  if (!ids.length) return [];
  const snapshots = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / SELECTIVE_IN_QUERY_CHUNK_SIZE) }, (_, index) => {
      const chunk = ids.slice(index * SELECTIVE_IN_QUERY_CHUNK_SIZE, (index + 1) * SELECTIVE_IN_QUERY_CHUNK_SIZE);
      return collection.where(field, chunk.length === 1 ? '==' : 'in', chunk.length === 1 ? chunk[0] : chunk).get();
    }),
  );
  return snapshots.flatMap(snapshot => materializeDocuments(snapshot, runtimeScope));
}

function mergeSelectiveResults(...groups) {
  const byId = new Map();
  groups.flat().forEach(item => {
    if (item?.id) byId.set(item.id, item);
  });
  return [...byId.values()];
}

function createSelectiveMethods({ collection, runtimeScope, methods = [] }) {
  const selected = {};
  const readByPatientId = patientId => readSelectiveByField({
    collection,
    runtimeScope,
    field: 'patientId',
    value: assertId(patientId),
  });
  const readBySessionIds = sessionIds => readSelectiveByFieldIn({
    collection,
    runtimeScope,
    field: 'sessionId',
    values: sessionIds,
  });
  const readByChargeIds = chargeIds => readSelectiveByFieldIn({
    collection,
    runtimeScope,
    field: 'chargeId',
    values: chargeIds,
  });
  const readBySessionRecordIds = sessionRecordIds => readSelectiveByFieldIn({
    collection,
    runtimeScope,
    field: 'sessionRecordId',
    values: sessionRecordIds,
  });

  if (methods.includes('listByPatientId')) {
    selected.listByPatientId = readByPatientId;
  }
  if (methods.includes('listByPatientOrSessionIds')) {
    selected.listByPatientOrSessionIds = async (patientId, sessionIds) => mergeSelectiveResults(
      await readByPatientId(patientId),
      await readBySessionIds(sessionIds),
    );
  }
  if (methods.includes('listByPatientOrSessionOrChargeIds')) {
    selected.listByPatientOrSessionOrChargeIds = async (patientId, sessionIds, chargeIds) => mergeSelectiveResults(
      await readByPatientId(patientId),
      await readBySessionIds(sessionIds),
      await readByChargeIds(chargeIds),
    );
  }
  if (methods.includes('listByPatientOrSessionRecordIds')) {
    selected.listByPatientOrSessionRecordIds = async (patientId, sessionRecordIds) => mergeSelectiveResults(
      await readByPatientId(patientId),
      await readBySessionRecordIds(sessionRecordIds),
    );
  }
  return selected;
}

function scopeMatches(value, scope) {
  return value?.workspaceId === scope.workspaceId
    && value?.professionalId === scope.professionalId
    && value?.context === PSYCHOLOGY_CONTEXT
    && (!value?.tenantId || !scope.tenantId || value.tenantId === scope.tenantId);
}

function assertEntityScope(entity, scope) {
  if (!scopeMatches(entity, scope)) {
    throw repositoryError('psychology/scope-conflict', 'O payload não pode alterar o escopo resolvido.', 422);
  }
}

function auditMetadata(runtimeScope, action, aggregate, id, now, requestId, operation, idempotencyKey) {
  return {
    requestId: normalize(requestId, 128) || 'local-request',
    actorUid: runtimeScope.authUid,
    professionalId: runtimeScope.professionalId,
    workspaceId: runtimeScope.workspaceId,
    tenantId: runtimeScope.tenantId,
    context: runtimeScope.context,
    operation: normalize(operation, 160) || `${action}:${aggregate}`,
    status: 'success',
    aggregate,
    action,
    documentId: id,
    ...(idempotencyKey ? { idempotencyKey: normalize(idempotencyKey, 200) } : {}),
    timestamp: now,
  };
}

export function buildPsychologyServerEntity({ runtimeScope, aggregate, entity, existing, now, requestId, operation, idempotencyKey }) {
  assertScope(runtimeScope);
  assertAggregate(aggregate);
  const documentId = assertId(entity?.id);
  assertEntityScope(entity, runtimeScope);
  const value = {
    ...clone(entity),
    id: documentId,
    workspaceId: runtimeScope.workspaceId,
    professionalId: runtimeScope.professionalId,
    ...(runtimeScope.tenantId ? { tenantId: runtimeScope.tenantId } : {}),
    context: PSYCHOLOGY_CONTEXT,
    createdAt: existing ? existing.createdAt : entity.createdAt || now(),
    updatedAt: entity.updatedAt || now(),
    audit: auditMetadata(runtimeScope, existing ? 'update' : 'create', aggregate, documentId, now(), requestId, operation, idempotencyKey),
  };
  delete value.__psychologyVersion;
  if (aggregate === 'sessions' && ('content' in value || 'clinicalContent' in value)) {
    throw repositoryError('psychology/session-clinical-content', 'Session é administrativa; conteúdo clínico usa session-records.', 422);
  }
  if ((aggregate === 'documents' || aggregate === 'attachments') && ['data', 'base64', 'dataUrl', 'bytes', 'contentBase64'].some(key => key in value)) {
    throw repositoryError('psychology/binary-not-allowed', 'Documentos e attachments armazenam somente metadata.', 422);
  }
  return value;
}

function createGenericRepository({ db, runtimeScope, aggregate, now, requestId, operation, idempotencyKey, expectedDelete, selectiveMethods = [] }) {
  const collection = db.collection(collectionPath(runtimeScope, aggregate));
  const repository = {
    aggregate,
    scope: runtimeScope,
    async list() {
      const snapshot = await collection.get();
      return snapshot.docs
        .map(documentSnapshot => readRecord({ id: documentSnapshot.id, ...clone(documentSnapshot.data() || {}) }, documentSnapshot.data()))
        .filter(item => scopeMatches(item, runtimeScope));
    },
    async get(id) {
      const documentId = assertId(id);
      const snapshot = await collection.doc(documentId).get();
      const value = snapshot.exists ? readRecord({ id: snapshot.id, ...clone(snapshot.data() || {}) }, snapshot.data()) : null;
      return value && scopeMatches(value, runtimeScope) ? value : null;
    },
    async upsert(entity, change, project = value => value) {
      const documentId = assertId(entity?.id);
      assertEntityScope(entity, runtimeScope);
      const intent = validatePsychologyChange(change || {
        version: 1, operation: 'create', id: documentId, data: clone(entity),
      });
      if (intent.id !== documentId || intent.operation === 'delete') throw psychologyPersistenceError('psychology/invalid-change');
      const reference = collection.doc(documentId);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? clone(snapshot.data()) : null;
        if (current && !scopeMatches(current, runtimeScope)) throw repositoryError('psychology/scope-conflict', 'O registro não pertence ao escopo resolvido.', 422);
        if (intent.operation === 'create') {
          if (current) {
            if (idempotencyKey && current.audit?.idempotencyKey === normalize(idempotencyKey, 200)
              && !buildPsychologyChange(aggregate, documentId, entity, capturePsychologyBaseline({ ...current }, current)).changes.length) {
              return readRecord({ id: documentId, ...current }, current);
            }
            throw psychologyPersistenceError('psychology/concurrent-change', 409);
          }
          const value = clone(buildPsychologyServerEntity({ runtimeScope, aggregate, entity, now, requestId, operation, idempotencyKey }));
          if (Buffer.byteLength(JSON.stringify(value)) > 900 * 1024) throw psychologyPersistenceError('psychology/change-too-large');
          transaction.create(reference, value);
          return readRecord(value);
        }
        if (!current) throw psychologyPersistenceError('psychology/concurrent-change', 409);
        assertPsychologyBaseline(project(current), intent.changes);
        if (!intent.changes.length) return readRecord({ id: documentId, ...current }, current);
        const fields = [];
        const result = clone(current);
        for (const item of intent.changes) {
          // Persist the domain-prepared value (including existing default/clear rules).
          const value = psychologyField(entity, item.path);
          let parent = result;
          for (const key of item.path.slice(0, -1)) {
            if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {};
            parent = parent[key];
          }
          if (value.present) parent[item.path.at(-1)] = value.value;
          else delete parent[item.path.at(-1)];
          fields.push(new FieldPath(...item.path), value.present ? value.value : FieldValue.delete());
        }
        result.updatedAt = now();
        result.audit = clone(auditMetadata(runtimeScope, 'update', aggregate, documentId, result.updatedAt, requestId, operation, idempotencyKey));
        if (Buffer.byteLength(JSON.stringify(result)) > 900 * 1024) throw psychologyPersistenceError('psychology/change-too-large');
        transaction.update(reference, new FieldPath('updatedAt'), result.updatedAt,
          new FieldPath('audit'), result.audit, ...fields);
        return readRecord({ id: documentId, ...result }, result);
      });
    },
    async update(id, patch) {
      const current = await repository.get(assertId(id));
      return current ? repository.updateKnown(current, patch) : null;
    },
    async delete(id) {
      const current = await repository.get(assertId(id));
      return current ? repository.deleteKnown(current) : null;
    },
    async deleteKnown(current) {
      const documentId = assertId(current?.id);
      assertEntityScope(current, runtimeScope);
      const expected = expectedDelete?.id === documentId ? expectedDelete.fingerprint : current.__psychologyVersion || fingerprint(current);
      const reference = collection.doc(documentId);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists || fingerprint(snapshot.data()) !== expected) throw psychologyPersistenceError('psychology/concurrent-change', 409);
        if (!scopeMatches(snapshot.data(), runtimeScope)) throw repositoryError('psychology/scope-conflict', 'O registro não pertence ao escopo resolvido.', 422);
        transaction.delete(reference);
        return { id: documentId };
      });
    },
    async updateKnown(current, patch) {
      assertEntityScope(current, runtimeScope);
      for (const key of ['id', 'workspaceId', 'professionalId', 'tenantId', 'context', 'createdAt']) {
        if (key in (patch || {}) && patch[key] !== undefined && patch[key] !== current[key]) {
          throw repositoryError('psychology/immutable-scope', 'O escopo e a criação são imutáveis.', 422);
        }
      }
      const baseline = capturePsychologyBaseline({ ...current }, current);
      const intent = buildPsychologyChange(aggregate, assertId(current.id), patch, baseline, true);
      return repository.upsert(applyPsychologyChanges(current, intent.changes), intent);
    },
    ...createSelectiveMethods({ collection, runtimeScope, methods: selectiveMethods }),
  };
  return repository;
}

export function createPsychologyServerRepository({ db, runtimeScope, now = () => new Date().toISOString(), requestId, operation, idempotencyKey, expectedDelete }) {
  assertScope(runtimeScope);
  const selectiveMethodsByAggregate = {
    sessions: ['listByPatientId'],
    sessionRecords: ['listByPatientOrSessionIds'],
    charges: ['listByPatientOrSessionIds'],
    payments: ['listByPatientOrSessionOrChargeIds'],
    packages: ['listByPatientId'],
    documents: ['listByPatientId'],
    attachments: ['listByPatientOrSessionRecordIds'],
  };
  const repositories = Object.fromEntries([...AGGREGATES].map(aggregate => [aggregate, createGenericRepository({
    db,
    runtimeScope,
    aggregate,
    now,
    requestId,
    operation,
    idempotencyKey,
    expectedDelete: expectedDelete?.aggregate === aggregate ? expectedDelete : undefined,
    selectiveMethods: selectiveMethodsByAggregate[aggregate] || [],
  })]));
  const documents = repositories.documents;
  const attachments = repositories.attachments;
  return {
    scope: runtimeScope,
    patients: repositories.patients,
    sessions: repositories.sessions,
    sessionRecords: repositories.sessionRecords,
    personalAppointments: repositories.personalAppointments,
    services: repositories.services,
    locations: repositories.locations,
    packages: repositories.packages,
    settings: repositories.settings,
    documents: {
      ...documents,
      async listAdministrative(patientId) {
        return (await documents.list()).filter(item => item.classification === 'ADMINISTRATIVE' && (!patientId || item.patientId === patientId));
      },
      async listClinical(patientId) {
        return (await documents.list()).filter(item => item.classification === 'CLINICAL' && (!patientId || item.patientId === patientId));
      },
    },
    attachments: {
      ...attachments,
      async listAdministrative(patientId) {
        return (await attachments.list()).filter(item => item.classification === 'ADMINISTRATIVE' && (!patientId || item.patientId === patientId));
      },
      async listClinical(patientId) {
        return (await attachments.list()).filter(item => item.classification === 'CLINICAL' && (!patientId || item.patientId === patientId));
      },
    },
    financial: {
      scope: runtimeScope,
      listCharges: repositories.charges.list,
      getCharge: repositories.charges.get,
      upsertCharge: repositories.charges.upsert,
      updateCharge: repositories.charges.update,
      deleteCharge: repositories.charges.delete,
      updateChargeKnown: repositories.charges.updateKnown,
      deleteChargeKnown: repositories.charges.deleteKnown,
      listChargesByPatientOrSessionIds: repositories.charges.listByPatientOrSessionIds,
      listPayments: repositories.payments.list,
      getPayment: repositories.payments.get,
      createPayment: repositories.payments.upsert,
      updatePayment: repositories.payments.update,
      deletePayment: repositories.payments.delete,
      updatePaymentKnown: repositories.payments.updateKnown,
      deletePaymentKnown: repositories.payments.deleteKnown,
      listPaymentsByPatientOrSessionOrChargeIds: repositories.payments.listByPatientOrSessionOrChargeIds,
      listExpenses: repositories.expenses.list,
      getExpense: repositories.expenses.get,
      upsertExpense: repositories.expenses.upsert,
      updateExpense: repositories.expenses.update,
      deleteExpense: repositories.expenses.delete,
      deleteExpenseKnown: repositories.expenses.deleteKnown,
    },
  };
}
