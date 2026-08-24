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

function createGenericRepository({ db, runtimeScope, aggregate, now, requestId, operation, idempotencyKey }) {
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
  };
}

export function createPsychologyServerRepository({ db, runtimeScope, now = () => new Date().toISOString(), requestId, operation, idempotencyKey }) {
  assertScope(runtimeScope);
  const repositories = Object.fromEntries([...AGGREGATES].map(aggregate => [aggregate, createGenericRepository({ db, runtimeScope, aggregate, now, requestId, operation, idempotencyKey })]));
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
      listPayments: repositories.payments.list,
      getPayment: repositories.payments.get,
      createPayment: repositories.payments.upsert,
      updatePayment: repositories.payments.update,
      listExpenses: repositories.expenses.list,
      getExpense: repositories.expenses.get,
      upsertExpense: repositories.expenses.upsert,
      updateExpense: repositories.expenses.update,
    },
  };
}
