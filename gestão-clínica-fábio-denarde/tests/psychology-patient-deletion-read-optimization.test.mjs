import assert from 'node:assert/strict';
import test from 'node:test';
import { createPsychologyServerRepository } from '../api/_lib/psychologyRepository.js';
import { deletePsychologyPatientSafely } from '../api/_lib/psychologyPatientDeletion.js';

const scope = {
  workspaceId: 'workspace-synthetic',
  professionalId: 'professional-synthetic',
  tenantId: 'tenant-synthetic',
  context: 'PSICOLOGIA',
  authUid: 'actor-synthetic',
};
const now = '2026-08-25T12:00:00.000Z';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function base(id, extra = {}, overrideScope = scope) {
  return {
    id,
    workspaceId: overrideScope.workspaceId,
    professionalId: overrideScope.professionalId,
    tenantId: overrideScope.tenantId,
    context: overrideScope.context,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function createFakeDb(seed) {
  const collections = new Map(Object.entries(seed).map(([aggregate, records]) => [
    aggregate,
    new Map(records.map(record => [record.id, clone(record)])),
  ]));
  const calls = {
    collectionGets: [],
    documentGets: [],
    queries: [],
    deletes: [],
    writes: [],
  };

  function snapshot(records) {
    return {
      docs: [...records].map(record => ({
        id: record.id,
        data: () => clone(record),
      })),
    };
  }

  function collectionFor(path) {
    const aggregate = path.split('/').pop();
    if (!collections.has(aggregate)) collections.set(aggregate, new Map());
    const records = collections.get(aggregate);
    return {
      get: async () => {
        calls.collectionGets.push(aggregate);
        throw new Error('full collection scan proibido: ' + aggregate);
      },
      where: (field, operator, value) => {
        calls.queries.push({ aggregate, field, operator, value: clone(value) });
        return {
          get: async () => snapshot([...records.values()].filter(record => (
            operator === '=='
              ? record[field] === value
              : Array.isArray(value) && value.includes(record[field])
          ))),
        };
      },
      doc: id => ({
        get: async () => {
          calls.documentGets.push({ aggregate, id });
          const record = records.get(id);
          return {
            exists: Boolean(record),
            id,
            data: () => clone(record || {}),
          };
        },
        set: async value => {
          calls.writes.push({ aggregate, id, value: clone(value) });
          records.set(id, clone(value));
        },
        delete: async () => {
          calls.deletes.push({ aggregate, id });
          records.delete(id);
        },
      }),
    };
  }

  return {
    calls,
    collections,
    collection: collectionFor,
  };
}

function createRepository(seed) {
  const db = createFakeDb(seed);
  return {
    db,
    repository: createPsychologyServerRepository({ db, runtimeScope: scope, now: () => now }),
  };
}

test('R2 leitura 01 — exclusão usa somente consultas seletivas e não chama collection.get', async () => {
  const { db, repository } = createRepository({
    patients: [
      base('patient-a', { name: 'Paciente A', active: false }),
      base('patient-b', { name: 'Paciente B', active: true }),
      base('patient-foreign', { name: 'Fora do escopo' }, { ...scope, workspaceId: 'workspace-other', professionalId: 'professional-other' }),
    ],
    sessions: [
      base('session-a', { patientId: 'patient-a' }),
      base('session-b', { patientId: 'patient-b' }),
    ],
    sessionRecords: [
      base('record-a', { patientId: 'patient-a', sessionId: 'session-a' }),
      base('record-linked', { sessionId: 'session-a' }),
      base('record-b', { patientId: 'patient-b', sessionId: 'session-b' }),
    ],
    charges: [
      base('charge-a', { patientId: 'patient-a', sessionId: 'session-a', status: 'paid' }),
      base('charge-linked', { sessionId: 'session-a', status: 'paid' }),
      base('charge-b', { patientId: 'patient-b', sessionId: 'session-b', status: 'pending' }),
    ],
    payments: [
      base('payment-a', { patientId: 'patient-a', sessionId: 'session-a', chargeId: 'charge-a', status: 'active' }),
      base('payment-linked', { chargeId: 'charge-linked', status: 'active' }),
      base('payment-b', { patientId: 'patient-b', sessionId: 'session-b', chargeId: 'charge-b', status: 'active' }),
    ],
    packages: [
      base('package-a', { patientId: 'patient-a' }),
      base('package-b', { patientId: 'patient-b' }),
    ],
    documents: [
      base('document-a', { patientId: 'patient-a' }),
      base('document-b', { patientId: 'patient-b' }),
    ],
    attachments: [
      base('attachment-linked', { sessionRecordId: 'record-linked' }),
      base('attachment-b', { patientId: 'patient-b' }),
    ],
  });

  const result = await deletePsychologyPatientSafely({ repository, patientId: 'patient-a', now });

  assert.deepEqual(result, { id: 'patient-a', deleted: true, preserved: true, active: false });
  assert.deepEqual(db.calls.collectionGets, []);
  assert.equal(db.calls.documentGets.length, 1);
  assert.equal(db.calls.queries.length, 12);
  assert.deepEqual([...new Set(db.calls.queries.map(call => call.aggregate))].sort(), [
    'attachments',
    'charges',
    'documents',
    'packages',
    'payments',
    'sessionRecords',
    'sessions',
  ]);
  assert.ok(db.calls.queries.every(call => call.operator === '==' || call.operator === 'in'));
  assert.deepEqual(db.calls.queries.find(call => call.aggregate === 'sessions'), {
    aggregate: 'sessions',
    field: 'patientId',
    operator: '==',
    value: 'patient-a',
  });
  assert.equal(db.collections.get('patients').has('patient-a'), false);
  assert.equal(db.collections.get('patients').has('patient-b'), true);
  assert.equal(db.collections.get('patients').has('patient-foreign'), true);
  assert.equal(db.collections.get('sessions').has('session-a'), false);
  assert.equal(db.collections.get('sessions').has('session-b'), true);
  assert.equal(db.collections.get('sessionRecords').has('record-linked'), false);
  assert.equal(db.collections.get('attachments').has('attachment-linked'), false);
  assert.equal(db.collections.get('attachments').has('attachment-b'), true);
  assert.equal(db.collections.get('payments').has('payment-a'), true);
  assert.equal(db.collections.get('payments').get('payment-a').patientId, null);
  assert.equal(db.collections.get('payments').get('payment-b').patientId, 'patient-b');
});

test('R2 leitura 02 — paciente sem vínculos usa sete consultas seletivas e uma leitura do paciente', async () => {
  const { db, repository } = createRepository({
    patients: [base('patient-empty', { name: 'Sem vínculos', active: true })],
  });

  const result = await deletePsychologyPatientSafely({ repository, patientId: 'patient-empty', now });

  assert.equal(result.deleted, true);
  assert.equal(db.calls.collectionGets.length, 0);
  assert.equal(db.calls.documentGets.length, 1);
  assert.equal(db.calls.queries.length, 7);
  assert.ok(db.calls.queries.every(call => call.operator === '=='));
  assert.deepEqual(db.calls.queries.map(call => call.aggregate).sort(), [
    'attachments',
    'charges',
    'documents',
    'packages',
    'payments',
    'sessionRecords',
    'sessions',
  ]);
  assert.deepEqual(db.calls.deletes, [{ aggregate: 'patients', id: 'patient-empty' }]);
});

test('R2 leitura 03 — isolamento seletivo mantém paciente de outro escopo inacessível', async () => {
  const foreignScope = { ...scope, workspaceId: 'workspace-other', professionalId: 'professional-other' };
  const { db, repository } = createRepository({
    patients: [
      base('patient-a', { active: true }),
      base('patient-b', { active: true }),
      base('patient-foreign', { patientId: 'patient-a', active: true }, foreignScope),
    ],
    sessions: [
      base('session-a', { patientId: 'patient-a' }),
      base('session-b', { patientId: 'patient-b' }),
      base('session-foreign', { patientId: 'patient-a' }, foreignScope),
    ],
  });

  await deletePsychologyPatientSafely({ repository, patientId: 'patient-a', now });

  assert.equal(db.collections.get('patients').has('patient-a'), false);
  assert.equal(db.collections.get('patients').has('patient-b'), true);
  assert.equal(db.collections.get('patients').has('patient-foreign'), true);
  assert.equal(db.collections.get('sessions').has('session-a'), false);
  assert.equal(db.collections.get('sessions').has('session-b'), true);
  assert.equal(db.collections.get('sessions').has('session-foreign'), true);
});

test('R2 leitura 04 — falha intermediária é propagada sem retry ou collection scan', async () => {
  const { db, repository } = createRepository({
    patients: [base('patient-a', { active: true })],
  });
  repository.patients.deleteKnown = async () => {
    throw new Error('falha sintética na mutação');
  };

  await assert.rejects(
    () => deletePsychologyPatientSafely({ repository, patientId: 'patient-a', now }),
    /falha sintética na mutação/,
  );
  assert.deepEqual(db.calls.collectionGets, []);
  assert.equal(db.calls.documentGets.length, 1);
});

test('R2 leitura 05 — relações com muitos IDs usam chunks seletivos, nunca consulta global', async () => {
  const sessionIds = Array.from({ length: 31 }, (_, index) => 'session-' + index);
  const { db, repository } = createRepository({
    sessionRecords: sessionIds.map((sessionId, index) => base('record-' + index, { sessionId })),
  });

  const records = await repository.sessionRecords.listByPatientOrSessionIds('patient-a', sessionIds);

  assert.equal(records.length, 31);
  assert.equal(db.calls.collectionGets.length, 0);
  assert.deepEqual(db.calls.queries.map(call => call.operator), ['==', 'in', '==']);
  assert.deepEqual(db.calls.queries.filter(call => call.operator === 'in').map(call => call.value.length), [30]);
});
