import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState } from '../src/types';
import {
  PersistenceBaselines, buildStatePersistencePlan, persistStateChange,
  type PersistenceDriver, type PersistenceOperation, type PersistencePlan,
} from '../src/lib/statePersistence';

type Data = Record<string, any>;
const clone = <T>(value: T): T => structuredClone(value);
const key = (operation: PersistenceOperation) => `${operation.collection}/${operation.id}`;
function apply(map: Map<string, Data>, operation: PersistenceOperation) {
  const id = key(operation);
  if (operation.kind === 'delete') map.delete(id);
  else if (operation.kind === 'create') map.set(id, clone(operation.data!));
  else {
    const data = clone(map.get(id)!);
    for (const change of operation.changes) {
      let parent = data;
      for (const segment of change.path.slice(0, -1)) parent = parent[segment] ||= {};
      const last = change.path.at(-1)!;
      if (change.after.present) parent[last] = clone(change.after.value);
      else delete parent[last];
    }
    map.set(id, data);
  }
}

/** All storage is fictitious and in memory. Versions simulate Firestore retries. */
class FakeDb implements PersistenceDriver {
  values = new Map<string, Data>();
  versions = new Map<string, number>();
  plans: PersistencePlan[] = [];
  committed: PersistenceOperation[][] = [];
  starts = 0;
  attempts = 0;
  failCommit = false;
  failRead = false;
  failValidate = false;
  beforeCommit?: () => void;
  validate(plan: PersistencePlan) {
    if (this.failValidate) throw new Error('fictitious SDK parser rejection');
    this.plans.push(plan);
  }
  put(id: string, data: Data) {
    this.values.set(id, clone(data));
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
  }
  async run(work: Parameters<PersistenceDriver['run']>[0]) {
    this.starts++;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.attempts++;
      const versions = new Map<string, number>();
      const writes: PersistenceOperation[] = [];
      await work({
        get: async operation => {
          assert.equal(writes.length, 0, 'all reads precede all writes');
          if (this.failRead) throw { code: 'unavailable', message: 'fictitious-private-value' };
          versions.set(key(operation), this.versions.get(key(operation)) || 0);
          return clone(this.values.get(key(operation)) || null);
        },
        write: operation => writes.push(operation),
      });
      const beforeCommit = this.beforeCommit;
      this.beforeCommit = undefined;
      beforeCommit?.();
      if ([...versions].some(([id, version]) => version !== (this.versions.get(id) || 0))) continue;
      if (this.failCommit) throw { code: 'permission-denied', message: 'fictitious-private-value' };
      const next = new Map(this.values);
      writes.forEach(operation => apply(next, operation));
      this.values = next;
      writes.forEach(operation => this.versions.set(key(operation), (this.versions.get(key(operation)) || 0) + 1));
      this.committed.push(writes);
      return;
    }
    throw { code: 'aborted' };
  }
}

function fixture(records: Data[] = [{ id: 'fixture-session', campoA: 'original-A', campoB: 'original-B' }]) {
  const baselines = new PersistenceBaselines();
  const db = new FakeDb();
  const state = {
    settings: {}, patients: [], sessions: records, payments: [], expenses: [],
    repositions: [], evolutions: [], personalAppointments: [], externalRegistrationForms: [],
  } as unknown as AppState;
  baselines.remember(state.settings, 'config', {});
  db.put('settings/config', {});
  for (const record of records) {
    baselines.remember(record, record.id, record);
    db.put(`sessions/${record.id}`, record);
  }
  const loaded = new Set(['settings', 'patients', 'sessions', 'payments', 'expenses', 'repositions', 'evolutions', 'agenda_pessoal', 'externalRegistrationForms']);
  const request = (intended: Data) => ({ baseline: state, intended: intended as Partial<AppState>, loaded, baselines });
  return { state, baselines, db, loaded, request, save: (intended: Data) => persistStateChange(request(intended), db) };
}

test('AUD001: later unloaded collection blocks 400 otherwise valid creates before any write', async () => {
  const f = fixture([]);
  f.loaded.delete('payments');
  const result = await f.save({ sessions: Array.from({ length: 400 }, (_, n) => ({ id: `fixture-${n}` })), payments: [] });
  assert.equal(result.status, 'VALIDATION_FAILED');
  assert.equal(result.code, 'collection-not-loaded');
  assert.equal(f.db.starts, 0);
  assert.equal(f.db.committed.length, 0);
  assert.equal(f.db.values.size, 1);
});

for (const [label, invalid] of [
  ['undefined', { bad: undefined }], ['function', { bad: () => 1 }],
  ['nested array', { bad: [[1]] }], ['invalid date', { bad: new Date(NaN) }],
  ['reserved field', { __fixture__: 1 }],
] as const) test(`AUD001: invalid final document (${label}) produces zero writes`, async () => {
  const f = fixture([]);
  const result = await f.save({ sessions: [{ id: 'fixture-valid' }, { id: 'fixture-invalid', ...invalid }] });
  assert.equal(result.status, 'VALIDATION_FAILED');
  assert.equal(f.db.starts, 0);
  assert.equal(f.db.committed.length, 0);
});

test('SDK validation rejection never starts transaction or persists a prefix', async () => {
  const f = fixture([]);
  f.db.failValidate = true;
  assert.equal((await f.save({ sessions: [{ id: 'fixture-valid' }] })).status, 'VALIDATION_FAILED');
  assert.equal(f.db.starts, 0);
});

test('valid multi-collection operation commits together exactly once', async () => {
  const f = fixture([]);
  const result = await f.save({ sessions: [{ id: 'fixture-session' }], payments: [{ id: 'fixture-payment', amount: 10 }] });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(f.db.committed.length, 1);
  assert.equal(f.db.committed[0].length, 2);
});

test('atomic commit failure persists zero documents and returns sanitized failure', async () => {
  const f = fixture([]);
  f.db.failCommit = true;
  const result = await f.save({ sessions: [{ id: 'fixture-session' }], payments: [{ id: 'fixture-payment' }] });
  assert.deepEqual(result, { status: 'PERSISTENCE_FAILED', code: 'permission-denied', operations: 2 });
  assert.equal(f.db.values.size, 1);
  assert.equal(f.db.committed.length, 0);
});

for (const count of [500, 501]) test(`atomic write limit: ${count} operations`, async () => {
  const f = fixture([]);
  const result = await f.save({ sessions: Array.from({ length: count }, (_, n) => ({ id: `fixture-${n}` })) });
  if (count === 500) {
    assert.equal(result.status, 'SUCCESS');
    assert.equal(f.db.committed.length, 1);
    assert.equal(f.db.committed[0].length, count);
  } else {
    assert.equal(result.status, 'VALIDATION_FAILED');
    assert.equal(result.code, 'atomic-write-limit-exceeded');
    assert.equal(f.db.starts, 0);
  }
});

test('oversized document and total payload fail closed before writes', async () => {
  const f = fixture([]);
  assert.equal((await f.save({ sessions: [{ id: 'fixture-big', text: 'x'.repeat(930 * 1024) }] })).code, 'document-size-limit-exceeded');
  assert.equal((await f.save({ sessions: Array.from({ length: 20 }, (_, n) => ({ id: `fixture-${n}`, text: 'x'.repeat(450 * 1024) })) })).code, 'atomic-payload-limit-exceeded');
  assert.equal(f.db.starts, 0);
});

test('update size includes existing fields; concurrent growth is validated before any transaction write', async () => {
  const f = fixture([{ id: 'fixture-session', existing: 'x'.repeat(800 * 1024) }]);
  const request = { sessions: [{ ...f.state.sessions[0], added: 'x'.repeat(150 * 1024) }] };
  assert.equal((await f.save(request)).code, 'document-size-limit-exceeded');
  assert.equal(f.db.starts, 0);
  const remote = fixture([{ id: 'fixture-session', value: 1 }]);
  remote.db.put('sessions/fixture-session', { id: 'fixture-session', value: 1, remote: 'x'.repeat(930 * 1024) });
  const result = await remote.save({ sessions: [{ id: 'fixture-session', value: 2 }] });
  assert.equal(result.status, 'VALIDATION_FAILED');
  assert.equal(remote.db.committed.length, 0);
  assert.equal(remote.db.values.get('sessions/fixture-session')!.value, 1);
});

test('duplicate IDs, missing baseline and invalid identity fail before writes', async () => {
  const f = fixture();
  assert.equal((await f.save({ sessions: [{ id: 'x' }, { id: 'x' }] })).code, 'duplicate-document-identity');
  assert.equal((await f.save({ sessions: [{ id: 'invalid/id' }] })).code, 'invalid-document-identity');
  f.baselines.clear();
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], campoA: 'new' }] })).code, 'baseline-unavailable');
  assert.equal(f.db.starts, 0);
});

test('AUD002: stale clients editing different fields preserve both changes', async () => {
  const f = fixture();
  const old = f.state.sessions[0];
  assert.equal((await f.save({ sessions: [{ ...old, campoA: 'A-alterado' }] })).status, 'SUCCESS');
  assert.equal((await f.save({ sessions: [{ ...old, campoB: 'B-alterado' }] })).status, 'SUCCESS');
  assert.deepEqual(f.db.values.get('sessions/fixture-session'), { id: 'fixture-session', campoA: 'A-alterado', campoB: 'B-alterado' });
  assert.deepEqual(f.db.plans.map(p => p.operations[0].changes.map(c => c.path)), [[['campoA']], [['campoB']]]);
  assert.ok(f.db.plans.every(p => p.operations[0].data === undefined));
});

test('AUD002: stale clients editing same field return CONFLICT without overwriting', async () => {
  const f = fixture();
  const old = f.state.sessions[0];
  await f.save({ sessions: [{ ...old, campoA: 'A-alterado' }] });
  assert.equal((await f.save({ sessions: [{ ...old, campoA: 'B-alterado' }] })).status, 'CONFLICT');
  assert.equal(f.db.values.get('sessions/fixture-session')!.campoA, 'A-alterado');
  assert.equal(f.db.committed.length, 1);
});

test('Firestore-style retry rechecks a concurrent same-field change, without partial writes', async () => {
  const f = fixture();
  f.db.beforeCommit = () => f.db.put('sessions/fixture-session', { ...f.state.sessions[0], campoA: 'remote' });
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], campoA: 'local' }] })).status, 'CONFLICT');
  assert.equal(f.db.attempts, 2);
  assert.equal(f.db.committed.length, 0);
});

test('Firestore-style retry preserves a concurrent different-field change', async () => {
  const f = fixture();
  f.db.beforeCommit = () => f.db.put('sessions/fixture-session', { ...f.state.sessions[0], campoB: 'remote' });
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], campoA: 'local' }] })).status, 'SUCCESS');
  assert.equal(f.db.attempts, 2);
  assert.equal(f.db.values.get('sessions/fixture-session')!.campoB, 'remote');
});

for (const nestedExists of [false, true]) test(`independent nested leaves preserve both changes (initial map ${nestedExists})`, async () => {
  const f = fixture([{ id: 'fixture-session', ...(nestedExists ? { options: { a: 0, b: 0 } } : {}) }]);
  const old = f.state.sessions[0] as unknown as Data;
  await f.save({ sessions: [{ ...old, options: { ...old.options, a: 1 } }] });
  assert.equal((await f.save({ sessions: [{ ...old, options: { ...old.options, b: 2 } }] })).status, 'SUCCESS');
  assert.deepEqual(f.db.values.get('sessions/fixture-session')!.options, { a: 1, b: 2 });
});

test('missing nested leaf does not allow recreating a concurrently removed parent', async () => {
  const f = fixture([{ id: 'fixture-session', options: { a: 1 } }]);
  f.db.put('sessions/fixture-session', { id: 'fixture-session' });
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], options: { a: 1, b: 2 } }] })).status, 'CONFLICT');
});

test('literal dotted field names remain one segment; removed optional fields are explicit deltas', () => {
  const f = fixture([{ id: 'fixture-session', 'literal.dot': 1, removable: 'old', keep: 'unchanged' }]);
  const plan = buildStatePersistencePlan(f.request({ sessions: [{ id: 'fixture-session', 'literal.dot': 2, keep: 'unchanged' }] }));
  assert.deepEqual(plan.operations[0].changes.map(c => c.path), [['literal.dot'], ['removable']]);
  assert.equal(plan.operations[0].changes[1].after.present, false);
});

test('arrays are atomic fields: concurrent edits to the same array conflict', async () => {
  const f = fixture([{ id: 'fixture-session', values: [1] }]);
  await f.save({ sessions: [{ id: 'fixture-session', values: [1, 2] }] });
  assert.equal((await f.save({ sessions: [{ id: 'fixture-session', values: [1, 3] }] })).status, 'CONFLICT');
});

test('remote deletion blocks update; concurrent create never overwrites existing document', async () => {
  const f = fixture();
  f.db.values.delete('sessions/fixture-session');
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], campoA: 'new' }] })).status, 'CONFLICT');
  assert.equal(f.db.values.has('sessions/fixture-session'), false);
  const create = fixture([]);
  create.db.put('sessions/fixture-new', { id: 'fixture-new', existing: true });
  assert.equal((await create.save({ sessions: [{ id: 'fixture-new' }] })).status, 'CONFLICT');
  assert.equal(create.db.values.get('sessions/fixture-new')!.existing, true);
});

test('delete compares full raw baseline including fields hidden by the UI mapping', async () => {
  const f = fixture();
  f.db.put('sessions/fixture-session', { ...f.state.sessions[0], hidden: 'remote' });
  assert.equal((await f.save({ sessions: [] })).status, 'CONFLICT');
  assert.equal(f.db.values.has('sessions/fixture-session'), true);
  const unchanged = fixture();
  assert.equal((await unchanged.save({ sessions: [] })).status, 'SUCCESS');
  assert.equal(unchanged.db.values.has('sessions/fixture-session'), false);
});

for (const collection of ['payments', 'expenses']) test(`${collection}: existing operationKey permits exact retry only, with no duplicate`, async () => {
  const f = fixture([]);
  const data = { id: 'fixture-operation', operationKey: 'fixture-idempotency', amount: 10 };
  assert.equal((await f.save({ [collection]: [data] })).status, 'SUCCESS');
  assert.equal((await f.save({ [collection]: [data] })).status, 'SUCCESS');
  assert.equal(f.db.committed[1].length, 0);
  assert.equal((await f.save({ [collection]: [{ ...data, amount: 11 }] })).status, 'CONFLICT');
  assert.equal(f.db.values.get(`${collection}/fixture-operation`)!.amount, 10);
});

test('all conflicts are checked before staging any write in a multi-document operation', async () => {
  const f = fixture([{ id: 'fixture-one', value: 1 }, { id: 'fixture-two', value: 1 }]);
  f.db.put('sessions/fixture-two', { id: 'fixture-two', value: 2 });
  assert.equal((await f.save({ sessions: f.state.sessions.map(s => ({ ...s, value: 3 })) })).status, 'CONFLICT');
  assert.equal(f.db.committed.length, 0);
  assert.equal(f.db.values.get('sessions/fixture-one')!.value, 1);
});

test('no-change skips commit; read failure remains distinct from validation and conflict', async () => {
  const f = fixture();
  assert.equal((await f.save({ sessions: f.state.sessions })).code, 'no-change');
  assert.equal(f.db.starts, 0);
  f.db.failRead = true;
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], campoA: 'new' }] })).code, 'unavailable');
  assert.equal(f.db.committed.length, 0);
});

test('baseline belongs to the exact stale record, not the latest record with the same ID', async () => {
  const f = fixture();
  const newer = { ...f.state.sessions[0], campoA: 'remote' };
  f.baselines.remember(newer, newer.id, newer);
  f.db.put('sessions/fixture-session', newer);
  assert.equal((await f.save({ sessions: [{ ...f.state.sessions[0], campoA: 'local' }] })).status, 'CONFLICT');
});

test('settings default values are not sent or compared as if persisted; no revisions added', async () => {
  const f = fixture([]);
  f.state.settings = f.baselines.remember({ name: 'UI default', visualTheme: 'light' } as any, 'config', {});
  f.db.put('settings/config', { remoteField: 'preserve' });
  assert.equal((await f.save({ settings: { ...f.state.settings, name: 'intentional change' } })).status, 'SUCCESS');
  assert.deepEqual(f.db.values.get('settings/config'), { remoteField: 'preserve', name: 'intentional change' });
});

test('personal agenda mapping preserves creation date and other unmapped fields', async () => {
  const f = fixture([]);
  const raw = { id: 'fixture-agenda', data: '2026-09-30', hora: '10:00', tipo_compromisso: 'Outro', observacao: 'old', criado_em: 'original', hidden: 'preserve' };
  const ui = { id: raw.id, date: raw.data, time: raw.hora, type: 'Outro', notes: 'old', recurrence: 'Não repetir', alarmEnabled: false, isDone: false, durationMinutes: 60 };
  f.state.personalAppointments = [f.baselines.remember(ui as any, raw.id, raw)];
  f.db.put('agenda_pessoal/fixture-agenda', raw);
  assert.equal((await f.save({ personalAppointments: [{ ...ui, notes: 'new' }] })).status, 'SUCCESS');
  assert.deepEqual(f.db.plans[0].operations[0].changes.map(c => c.path), [['observacao']]);
  assert.equal(f.db.values.get('agenda_pessoal/fixture-agenda')!.criado_em, 'original');
  assert.equal(f.db.values.get('agenda_pessoal/fixture-agenda')!.hidden, 'preserve');
});

test('patient identifiers, packageRecords and payment links are not resent by unrelated patches', async () => {
  const f = fixture([]);
  const patient = { id: 'fixture-patient', notes: 'old', packageRecords: [{ packageId: 'fixture-package', paymentId: 'fixture-payment' }] };
  f.state.patients = [f.baselines.remember(patient as any, patient.id, patient)];
  f.db.put('patients/fixture-patient', { ...patient, packageRecords: [{ packageId: 'fixture-remote-package', paymentId: 'fixture-remote-payment' }] });
  assert.equal((await f.save({ patients: [{ ...patient, notes: 'new' }] })).status, 'SUCCESS');
  assert.deepEqual(f.db.plans[0].operations[0].changes.map(c => c.path), [['notes']]);
  assert.equal(f.db.values.get('patients/fixture-patient')!.packageRecords[0].packageId, 'fixture-remote-package');
  assert.equal(patient.notes, 'old');
});
