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

function materializeDocuments(snapshot, runtimeScope) {
  return snapshot.docs
    .map(documentSnapshot => ({ id: documentSnapshot.id, ...clone(documentSnapshot.data() || {}) }))
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
  if (aggregate === 'sessions' && ('content' in value || 'clinicalContent' in value)) {
    throw repositoryError('psychology/session-clinical-content', 'Session é administrativa; conteúdo clínico usa session-records.', 422);
  }
  if ((aggregate === 'documents' || aggregate === 'attachments') && ['data', 'base64', 'dataUrl', 'bytes', 'contentBase64'].some(key => key in value)) {
    throw repositoryError('psychology/binary-not-allowed', 'Documentos e attachments armazenam somente metadata.', 422);
  }
  return value;
}

function createGenericRepository({ db, runtimeScope, aggregate, now, requestId, operation, idempotencyKey, selectiveMethods = [] }) {
  const collection = db.collection(collectionPath(runtimeScope, aggregate));
  return {
    aggregate,
    scope: runtimeScope,
    async list() {
      const snapshot = await collection.get();
      return snapshot.docs
        .map(documentSnapshot => ({ id: documentSnapshot.id, ...clone(documentSnapshot.data() || {}) }))
        .filter(item => scopeMatches(item, runtimeScope));
    },
    async get(id) {
      const documentId = assertId(id);
      const snapshot = await collection.doc(documentId).get();
      const value = snapshot.exists ? { id: snapshot.id, ...clone(snapshot.data() || {}) } : null;
      return value && scopeMatches(value, runtimeScope) ? value : null;
    },
    async upsert(entity) {
      const documentId = assertId(entity?.id);
      assertEntityScope(entity, runtimeScope);
      const existing = await collection.doc(documentId).get();
      if (idempotencyKey && existing.exists && existing.data()?.audit?.idempotencyKey === normalize(idempotencyKey, 200)) {
        return { id: documentId, ...clone(existing.data() || {}) };
      }
      const value = buildPsychologyServerEntity({ runtimeScope, aggregate, entity, existing: existing.exists ? existing.data() : undefined, now, requestId, operation, idempotencyKey });
      await collection.doc(documentId).set(value, { merge: false });
      return clone(value);
    },
    async update(id, patch) {
      const documentId = assertId(id);
      const current = await this.get(documentId);
      if (!current) return null;
      for (const key of ['id', 'workspaceId', 'professionalId', 'context', 'createdAt']) {
        if (key in (patch || {}) && patch[key] !== undefined && patch[key] !== current[key]) {
          throw repositoryError('psychology/immutable-scope', 'O escopo e a criação são imutáveis.', 422);
        }
      }
      return this.upsert({ ...current, ...clone(patch), id: current.id, createdAt: current.createdAt, updatedAt: now() });
    },
    async delete(id) {
      const documentId = assertId(id);
      const current = await this.get(documentId);
      if (!current) return null;
      await collection.doc(documentId).delete();
      return { id: current.id };
    },
    async deleteKnown(current) {
      const documentId = assertId(current?.id);
      assertEntityScope(current, runtimeScope);
      await collection.doc(documentId).delete();
      return { id: documentId };
    },
    async updateKnown(current, patch) {
      const documentId = assertId(current?.id);
      assertEntityScope(current, runtimeScope);
      for (const key of ['id', 'workspaceId', 'professionalId', 'context', 'createdAt']) {
        if (key in (patch || {}) && patch[key] !== undefined && patch[key] !== current[key]) {
          throw repositoryError('psychology/immutable-scope', 'O escopo e a criação são imutáveis.', 422);
        }
      }
      const value = buildPsychologyServerEntity({
        runtimeScope,
        aggregate,
        entity: { ...current, ...clone(patch), id: current.id, createdAt: current.createdAt, updatedAt: now() },
        existing: current,
        now,
        requestId,
        operation,
        idempotencyKey,
      });
      await collection.doc(documentId).set(value, { merge: false });
      return clone(value);
    },
    ...createSelectiveMethods({ collection, runtimeScope, methods: selectiveMethods }),
  };
}

export function createPsychologyServerRepository({ db, runtimeScope, now = () => new Date().toISOString(), requestId, operation, idempotencyKey }) {
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
