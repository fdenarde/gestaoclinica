// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyServerRepository, psychologyCollectionPath } from '../api/_lib/psychologyRepository.js';
import { createApiPsychologyRepositories } from '../src/features/psychology-persistence/repositories/api';
import { createPsychologyRemotePatientClient } from '../src/features/psychology-persistence/remotePatientClient';
import { buildPsychologyChange, capturePsychologyBaseline, pinPsychologyEdit,
  copyPsychologyBaseline, psychologyBaseline, PSYCHOLOGY_CONFLICT_MESSAGE } from '../shared/psychologyConcurrency.js';

const scope = { workspaceId: 'fixture-r17-workspace', professionalId: 'fixture-r17-professional', context: 'PSICOLOGIA' };
const runtimeScope = { ...scope, authUid: 'fixture-r17-actor', role: 'professional', permissions: {} };
const NOW = '2026-09-30T12:00:00.000Z';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const path = (aggregate, id) => `${psychologyCollectionPath(scope, aggregate)}/${id}`;
const patient = { id: 'fixture-patient', ...scope, name: 'Pessoa Fictícia', birthDate: '1990-01-01',
  phone: '(27) 99999-0000', preferredModality: 'online', administrativeNote: 'Original', active: true };
const session = { id: 'fixture-session', ...scope, patientId: patient.id, date: '2026-10-01',
  time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada', administrativeNote: 'Original' };

/** Offline-only database: atomically queues writes and simulates native retries. */
class FakeDb {
  records = new Map(); versions = new Map(); commits = []; attempts = 0;
  failCommit = false; failRead = false; beforeCommit = undefined; waitCommit = undefined;
  put(key, data) { this.records.set(key, clone(data)); this.versions.set(key, (this.versions.get(key) || 0) + 1); }
  snapshot(key) { if (this.failRead) throw new Error('fixture read failure'); return { id: key.split('/').at(-1), exists: this.records.has(key), data: () => clone(this.records.get(key)) }; }
  collection(name) {
    const query = filters => ({
      doc: id => ({ key: `${name}/${id}`, get: async () => this.snapshot(`${name}/${id}`) }),
      where: (field, op, value) => query([...filters, [field, op, value]]),
      get: async () => ({ docs: [...this.records].filter(([key, data]) => key.startsWith(`${name}/`)
        && filters.every(([field, op, value]) => op === 'in' ? value.includes(data[field]) : data[field] === value))
        .map(([key]) => this.snapshot(key)) }),
    });
    return query([]);
  }
  async runTransaction(work) {
    for (let attempt = 0; attempt < 5; attempt++) {
      this.attempts++;
      const readVersions = new Map(), writes = [];
      const result = await work({
        get: async ref => { assert.equal(writes.length, 0, 'reads precede all writes'); readVersions.set(ref.key, this.versions.get(ref.key) || 0); return this.snapshot(ref.key); },
        create: (ref, value) => writes.push({ kind: 'create', key: ref.key, value: clone(value) }),
        delete: ref => writes.push({ kind: 'delete', key: ref.key }),
        update: (ref, ...fields) => writes.push({ kind: 'update', key: ref.key, fields }),
      });
      const hook = this.beforeCommit; this.beforeCommit = undefined; hook?.();
      await this.waitCommit?.();
      if ([...readVersions].some(([key, version]) => version !== (this.versions.get(key) || 0))) continue;
      if (this.failCommit) throw new Error('fixture persistence failure');
      const next = new Map(this.records);
      for (const write of writes) {
        if (write.kind === 'delete') next.delete(write.key);
        else if (write.kind === 'create') { assert.equal(next.has(write.key), false); next.set(write.key, write.value); }
        else {
          const data = clone(next.get(write.key));
          for (let index = 0; index < write.fields.length; index += 2) {
            const field = write.fields[index], value = write.fields[index + 1];
            const segments = field.toString().split('.').map(segment => segment.replace(/^`|`$/g, ''));
            let parent = data;
            for (const segment of segments.slice(0, -1)) parent = parent[segment] ||= {};
            if (value?.constructor.name === 'DeleteTransform') delete parent[segments.at(-1)];
            else parent[segments.at(-1)] = clone(value);
          }
          next.set(write.key, data);
        }
      }
      this.records = next;
      writes.forEach(write => this.versions.set(write.key, (this.versions.get(write.key) || 0) + 1));
      this.commits.push(writes);
      return result;
    }
    throw new Error('fixture transaction exhausted');
  }
}
function fixture() {
  const db = new FakeDb(); db.put(path('patients', patient.id), patient); db.put(path('sessions', session.id), session);
  const calls = [], permissions = [];
  const handler = createPsychologyApiHandler({ getDb: () => db, now: () => NOW, auditLogger() {},
    resolveAccess: async (_req, options) => { permissions.push(options.requiredPermissions || options.requiredAnyPermissions); return runtimeScope; } });
  const fetchImpl = async (input, init = {}) => {
    const method = init.method || 'GET', url = String(input), body = init.body ? JSON.parse(init.body) : {};
    calls.push({ method, url, body });
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const res = { statusCode: 200, headers: {}, payload: null,
      setHeader(key, value) { this.headers[key] = String(value); }, status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; return this; }, end() { return this; } };
    await handler({ method, url, headers, body }, res);
    return new Response(JSON.stringify(res.payload), { status: res.statusCode, headers: { ...res.headers, 'Content-Type': 'application/json' } });
  };
  const client = () => createApiPsychologyRepositories({ scope: { ...scope }, fetchImpl, getToken: async () => 'fixture-token' });
  const remote = () => createPsychologyRemotePatientClient({ scope: { ...scope }, api: { fetchImpl, getToken: async () => 'fixture-token' }, now: () => NOW });
  return { db, calls, permissions, fetchImpl, client, remote };
}
const conflict = error => error.status === 409 && error.persistenceStatus === 'CONFLICT' && error.message === PSYCHOLOGY_CONFLICT_MESSAGE;

test('R17 client → API → repository: independent edits preserve both changes and omit unchanged fields', async () => {
  const f = fixture(), a = f.client(), b = f.client();
  const [left, right] = await Promise.all([a.patients.get(scope, patient.id), b.patients.get(scope, patient.id)]);
  await a.patients.upsert(scope, { ...left, phone: '27999991111' });
  const saved = await b.patients.upsert(scope, { ...right, administrativeNote: 'Alteração B' });
  assert.equal(saved.phone, '27999991111'); assert.equal(saved.administrativeNote, 'Alteração B');
  const body = f.calls.at(-1).body;
  assert.deepEqual(body.persistence.changes.map(item => item.path), [['administrativeNote']]);
  assert.equal('data' in body.persistence, false); assert.equal(JSON.stringify(body).includes(patient.phone), false);
  assert.equal(f.db.records.get(path('patients', patient.id)).__psychologyVersion, undefined);
  assert.ok(f.permissions.some(value => value?.includes('patients.edit')));
});

test('R17 same field conflicts and retry preserves original baseline without overwriting', async () => {
  const f = fixture(), a = f.client(), b = f.client();
  const [left, right] = await Promise.all([a.patients.get(scope, patient.id), b.patients.get(scope, patient.id)]);
  await a.patients.upsert(scope, { ...left, administrativeNote: 'A' });
  const draft = { ...right, administrativeNote: 'B' };
  await assert.rejects(b.patients.upsert(scope, draft), conflict);
  await assert.rejects(b.patients.upsert(scope, draft), conflict);
  assert.equal(draft.administrativeNote, 'B'); assert.equal(f.db.records.get(path('patients', patient.id)).administrativeNote, 'A');
  assert.equal(f.db.commits.filter(writes => writes.length).length, 1);
});

test('R17 normalized form is pinned to its opening snapshot even after a later read', async () => {
  const f = fixture(), client = f.remote(); const first = await client.load();
  const before = first.patients[0];
  const draft = pinPsychologyEdit({ name: before.name, administrativeNote: 'Draft B' }, before);
  f.db.put(path('patients', patient.id), { ...patient, administrativeNote: 'Concurrent A' });
  const latest = await client.load();
  const entity = copyPsychologyBaseline({ ...latest.patients[0], ...draft }, draft);
  await assert.rejects(client.updatePatient(entity), conflict);
  assert.equal(draft.administrativeNote, 'Draft B');
  assert.equal(psychologyBaseline(entity).ui.administrativeNote, 'Original');
});

test('R17 normalized defaults and UI aliases are not sent as edits', async () => {
  const f = fixture(), client = f.remote(); const store = await client.load();
  const saved = await client.updatePatient({ ...store.patients[0], administrativeNote: 'Edited' });
  assert.deepEqual(f.calls.at(-1).body.persistence.changes.map(item => item.path), [['administrativeNote']]);
  assert.equal(saved.name, patient.name);
});

test('R17 legacy document without revision, updatedAt or embedded ID remains editable', async () => {
  const f = fixture(); const legacy = { ...patient }; delete legacy.id;
  f.db.put(path('patients', patient.id), legacy);
  const client = f.client(), record = await client.patients.get(scope, patient.id);
  const saved = await client.patients.update(scope, patient.id, { administrativeNote: 'Legacy edit' });
  assert.equal(saved.id, patient.id); assert.equal(saved.administrativeNote, 'Legacy edit');
  assert.equal(f.db.records.get(path('patients', patient.id)).revision, undefined);
  assert.equal(record.updatedAt, undefined);
});

test('R17 simultaneous create uses native transaction and never replaces an existing ID', async () => {
  const f = fixture(), a = f.client(), b = f.client();
  await Promise.all([a.patients.list(scope), b.patients.list(scope)]);
  const created = { ...patient, id: 'new-fixture', updatedAt: 'create-A' };
  const outcomes = await Promise.allSettled([a.patients.upsert(scope, created), b.patients.upsert(scope, { ...created, name: 'Different fictitious draft', updatedAt: 'create-B' })]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const rejection = outcomes.find(outcome => outcome.status === 'rejected'); assert.ok(conflict(rejection.reason));
  assert.equal(f.db.commits.flat().filter(write => write.key === path('patients', created.id)).length, 1);
});

test('R17 matching create idempotency key preserves existing record', async () => {
  const f = fixture(); const repository = createPsychologyServerRepository({ db: f.db, runtimeScope, now: () => NOW, idempotencyKey: 'fixture-operation' });
  const entity = { ...patient, id: 'idempotent-fixture' };
  const first = await repository.patients.upsert(entity);
  const second = await repository.patients.upsert(entity);
  assert.deepEqual(second, first); assert.equal(f.db.commits.flat().filter(write => write.kind === 'create').length, 1);
  await assert.rejects(repository.patients.upsert({ ...entity, name: 'Different draft' }), error => error.statusCode === 409);
});

test('R17 SUCCESS is delivered only after confirmed commit', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  let release; const gate = new Promise(resolve => { release = resolve; });
  let commitEntered; const entered = new Promise(resolve => { commitEntered = resolve; });
  f.db.waitCommit = () => { commitEntered(); return gate; };
  let resolved = false;
  const saving = client.patients.upsert(scope, { ...record, administrativeNote: 'Confirmed' }).then(value => { resolved = true; return value; });
  await entered; assert.equal(resolved, false); assert.equal(f.db.records.get(path('patients', patient.id)).administrativeNote, 'Original');
  release(); await saving; assert.equal(resolved, true);
});

test('R17 persistence failure is typed and neither reports success nor advances the baseline', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  f.db.failCommit = true;
  await assert.rejects(client.patients.upsert(scope, { ...record, administrativeNote: 'Pending' }), error => error.persistenceStatus === 'PERSISTENCE_FAILED' && error.status === 500);
  assert.equal(f.db.commits.length, 0); assert.equal(psychologyBaseline(record).ui.administrativeNote, 'Original');
  f.db.failCommit = false;
  assert.equal((await client.patients.upsert(scope, { ...record, administrativeNote: 'Pending' })).administrativeNote, 'Pending');
});

test('R17 native retry rechecks changed field and preserves independent concurrent field', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  f.db.beforeCommit = () => f.db.put(path('patients', patient.id), { ...patient, phone: '(27) 99999-2222' });
  const saved = await client.patients.upsert(scope, { ...record, administrativeNote: 'Independent' });
  assert.equal(saved.phone, '(27) 99999-2222'); assert.equal(saved.administrativeNote, 'Independent'); assert.equal(f.db.attempts, 2);
});

test('R17 native retry changing the same field aborts without committing', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  f.db.beforeCommit = () => f.db.put(path('patients', patient.id), { ...patient, administrativeNote: 'Winner' });
  await assert.rejects(client.patients.upsert(scope, { ...record, administrativeNote: 'Loser' }), conflict);
  assert.equal(f.db.commits.length, 0); assert.equal(f.db.records.get(path('patients', patient.id)).administrativeNote, 'Winner');
});

test('R17 delete checks raw fingerprint including fields hidden by the administrative DTO', async () => {
  const f = fixture(), client = f.client(); await client.patients.get(scope, patient.id);
  f.db.put(path('patients', patient.id), { ...patient, clinicalContent: 'Fictitious hidden change' });
  await assert.rejects(client.patients.delete(scope, patient.id), conflict);
  assert.equal(f.db.commits.length, 0); assert.equal(f.db.records.has(path('patients', patient.id)), true);
});

test('R17 generic deletion succeeds on unchanged fingerprint and conflicts on transactional race', async () => {
  const f = fixture(); const record = { id: 'fixture-service', ...scope, name: 'Service fixture' }; f.db.put(path('services', record.id), record);
  const client = f.client(); await client.services.get(scope, record.id);
  f.db.beforeCommit = () => f.db.put(path('services', record.id), { ...record, name: 'Concurrent service' });
  await assert.rejects(client.services.delete(scope, record.id), conflict);
  await client.services.get(scope, record.id); assert.equal((await client.services.delete(scope, record.id)).id, record.id);
});

test('R17 malformed/managed-field changes return VALIDATION_FAILED with no write', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  const change = buildPsychologyChange('patients', record.id, { ...record, name: 'Edited' });
  change.changes[0].path = ['permissions'];
  const response = await f.fetchImpl(`/api/psychology/patients/${record.id}`, { method: 'PATCH', headers: { Authorization: 'Bearer fixture-token' }, body: JSON.stringify({ persistence: change }) });
  assert.equal(response.status, 422); assert.equal((await response.json()).persistenceStatus, 'VALIDATION_FAILED'); assert.equal(f.db.commits.length, 0);
});

test('R17 old API permits reads but rejects writes before sending an unsafe request', async () => {
  const calls = [];
  const client = createApiPsychologyRepositories({ scope, getToken: async () => 'fixture-token', fetchImpl: async (url, init) => {
    calls.push(init.method); return new Response(JSON.stringify({ items: [patient] }), { status: 200 });
  } });
  const record = (await client.patients.list(scope))[0];
  await assert.rejects(client.patients.upsert(scope, { ...record, name: 'Preserved draft' }), error => error.code === 'psychology/persistence-protocol-required');
  assert.deepEqual(calls, ['GET']);
});

test('R17 missing commit acknowledgement never becomes SUCCESS', async () => {
  const client = createApiPsychologyRepositories({ scope, getToken: async () => 'fixture-token', fetchImpl: async (_url, init) =>
    new Response(JSON.stringify(init.method === 'GET' ? { items: [patient] } : { patient }), { status: 200, headers: { 'X-Psychology-Persistence-Version': '1' } }) });
  const record = (await client.patients.list(scope))[0];
  await assert.rejects(client.patients.upsert(scope, { ...record, name: 'Draft' }), error => error.code === 'psychology/persistence-unconfirmed');
});

const genericFixtures = {
  personalAppointments: { id: 'fixture-personal', title: 'Personal fictitious', date: '2026-10-01', time: '09:00', durationMinutes: 50, administrativeNote: 'Original' },
  services: { id: 'fixture-service', name: 'Service fictitious', active: true, publicBooking: { enabled: true, minimumAdvanceHours: 24 } },
  locations: { id: 'fixture-location', displayName: 'Place fictitious', active: true, address: 'Fictitious address' },
  charges: { id: 'fixture-charge', patientId: patient.id, amount: 100, description: 'Charge fictitious', status: 'pending' },
  payments: { id: 'fixture-payment', patientId: patient.id, chargeId: 'fixture-charge', amount: 10, date: '2026-10-01', method: 'PIX', status: 'active', description: 'Original' },
  expenses: { id: 'fixture-expense', amount: 10, date: '2026-10-01', category: 'Outros', status: 'REALIZED', description: 'Original' },
  packages: { id: 'fixture-package', patientId: patient.id, name: 'Package fictitious', totalSessions: 4, usedSessions: 0, startDate: '2026-10-01', active: true },
};
for (const [aggregate, data] of Object.entries(genericFixtures)) {
  test(`R17 ${aggregate}: representative generic/validated format preserves concurrent independent fields`, async () => {
    const f = fixture(); f.db.put(path('charges', 'fixture-charge'), { ...genericFixtures.charges, ...scope }); f.db.put(path(aggregate, data.id), { ...data, ...scope, fixtureField: 'Original' });
    const a = f.client(), b = f.client();
    const repo = client => aggregate === 'charges' ? { list: client.financial.listCharges, upsert: client.financial.upsertCharge }
      : aggregate === 'payments' ? { list: client.financial.listPayments, upsert: client.financial.createPayment }
        : aggregate === 'expenses' ? { list: client.financial.listExpenses, upsert: client.financial.upsertExpense } : client[aggregate];
    const left = (await repo(a).list(scope))[0], right = (await repo(b).list(scope))[0];
    const firstKey = aggregate === 'locations' ? 'address' : aggregate === 'packages' ? 'name' : aggregate === 'services' ? 'name' : aggregate === 'personalAppointments' ? 'title' : 'description';
    await repo(a).upsert(scope, { ...left, [firstKey]: 'Concurrent A' });
    const saved = await repo(b).upsert(scope, { ...right, fixtureField: 'Independent B' });
    assert.equal(saved[firstKey], 'Concurrent A'); assert.equal(saved.fixtureField, 'Independent B');
  });
}

test('R17 session DTO format retains concurrent date while updating administrative note', async () => {
  const f = fixture(), a = f.client(), b = f.client();
  const left = (await a.sessions.list(scope))[0], right = (await b.sessions.list(scope))[0];
  await a.sessions.upsert(scope, { ...left, date: '2026-10-02' });
  const saved = await b.sessions.upsert(scope, { ...right, administrativeNote: 'Independent B' });
  assert.equal(saved.date, '2026-10-02'); assert.equal(saved.administrativeNote, 'Independent B');
});

test('R17 settings nested map format merges independent leaves and conflicts on same leaf', async () => {
  const f = fixture(); f.db.put(path('settings', 'settings'), { ...scope, id: 'settings', settings: { agenda: { intervalMinutes: 5, defaultDurationMinutes: 50 } } });
  const a = f.client(), b = f.client(); await Promise.all([a.settings.get(scope, 'settings'), b.settings.get(scope, 'settings')]);
  await a.settings.update(scope, 'settings', { agenda: { intervalMinutes: 10 } });
  const saved = await b.settings.update(scope, 'settings', { agenda: { defaultDurationMinutes: 60 } });
  assert.equal(saved.settings.agenda.intervalMinutes, 10); assert.equal(saved.settings.agenda.defaultDurationMinutes, 60);
  await assert.rejects(a.settings.update(scope, 'settings', { agenda: { defaultDurationMinutes: 90 } }), conflict);
});

test('R17 settings first save creates safely without legacy migration', async () => {
  const f = fixture(), a = f.client(), b = f.client(); await Promise.all([a.settings.get(scope, 'settings'), b.settings.get(scope, 'settings')]);
  const saved = await a.settings.update(scope, 'settings', { reminders: { enabled: true, advanceMinutes: 30 } });
  assert.equal(saved.settings.reminders.enabled, true);
  await assert.rejects(b.settings.update(scope, 'settings', { reminders: { enabled: false, advanceMinutes: 0 } }), conflict);
  assert.equal(f.db.records.get(path('settings', 'settings')).revision, undefined);
});

test('R17 normalized settings UI baseline does not send defaults and keeps wire-field expectations', async () => {
  const f = fixture(); f.db.put(path('settings', 'settings'), { ...scope, id: 'settings', settings: { professionalProfile: { displayName: 'Fictitious' } } });
  const client = f.remote(), store = await client.load();
  const patch = copyPsychologyBaseline({ professionalProfile: { ...store.settings.professionalProfile, displayName: 'Changed' } }, store.settings);
  const saved = await client.updateSettings(patch);
  assert.equal(saved.professionalProfile.displayName, 'Changed');
  assert.deepEqual(f.calls.at(-1).body.persistence.changes.map(item => item.path), [['settings', 'professionalProfile', 'displayName']]);
});

test('R17 read-only clinical/document routes remain read-only', async () => {
  const f = fixture();
  for (const resource of ['documents', 'attachments', 'session-records']) {
    const record = { id: 'fixture-readonly', ...scope, title: 'Fictitious' };
    const change = { version: 1, operation: 'create', id: record.id, data: record };
    const response = await f.fetchImpl(`/api/psychology/${resource}`, { method: 'POST', headers: { Authorization: 'Bearer fixture-token' }, body: JSON.stringify({ persistence: change }) });
    assert.equal(response.status, 404);
  }
  assert.equal(f.db.commits.length, 0);
});

test('R17 actual session form retains edited draft and opening baseline after conflict and refresh', async () => {
  // React renderer and DOM stubs only; no browser or external storage.
  const React = await import('react');
  const { default: TestRenderer, act } = await import('react-test-renderer');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { innerWidth: 1280, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    localStorage: storage, sessionStorage: storage, atob: globalThis.atob, btoa: globalThis.btoa, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };
  globalThis.HTMLElement = class {};
  const { SessionDialog } = await import('../src/features/psychology-pilot/PsychologyPilot');
  const f = fixture();
  f.db.put(path('sessions', session.id), { ...session, serviceId: 'psychotherapy-individual' });
  const client = f.remote(), store = await client.load(), original = store.sessions[0];
  store.settings.agenda.weeklyAvailability = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, enabled: true, periods: [{ startTime: '00:00', endTime: '23:59' }] }));
  let notice = '', closed = false, renderer;
  const props = { value: original, store, settings: store.settings, defaultDate: original.date,
    onClose: () => { closed = true; }, onSave: async input => {
      const entity = copyPsychologyBaseline({ ...original, ...input }, input);
      try { await client.repositories.sessions.upsert(scope, entity); return true; }
      catch (error) { notice = error.message; return false; }
    } };
  await act(async () => { renderer = TestRenderer.create(React.createElement(SessionDialog, props)); });
  await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: 'Preserved fictitious draft' } }); });
  f.db.put(path('sessions', session.id), { ...session, serviceId: 'psychotherapy-individual', administrativeNote: 'Concurrent winner' });
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(notice, PSYCHOLOGY_CONFLICT_MESSAGE); assert.equal(closed, false);
  assert.equal(renderer.root.findByType('textarea').props.value, 'Preserved fictitious draft');
  const refreshed = (await client.load()).sessions[0];
  await act(async () => { renderer.update(React.createElement(SessionDialog, { ...props, value: refreshed })); });
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(f.db.records.get(path('sessions', session.id)).administrativeNote, 'Concurrent winner');
  assert.equal(renderer.root.findByType('textarea').props.value, 'Preserved fictitious draft');
  assert.equal(f.db.commits.filter(writes => writes.length).length, 0);
  await act(async () => { renderer.unmount(); });
});

test('R17 actual financial form keeps its original baseline and draft through domain reconstruction', async () => {
  const React = await import('react');
  const { default: TestRenderer, act } = await import('react-test-renderer');
  const { default: FinanceView } = await import('../src/features/psychology-pilot/PsychologyFinanceView');
  const f = fixture(), client = f.remote();
  const data = { ...genericFixtures.expenses, ...scope, date: '2026-09-30' };
  f.db.put(path('expenses', data.id), data);
  const store = await client.load();
  let notice = '', renderer;
  const props = { store, onStoreChange: () => false, onNotice: value => { notice = value; },
    onRemoteMutation: async mutation => {
      await client.repositories.financial.updateExpense(scope, mutation.expense.id, mutation.expense);
      return true;
    } };
  const text = node => typeof node === 'string' ? node : node.children.map(text).join('');
  const button = label => renderer.root.findAllByType('button').find(item => text(item).trim() === label);
  await act(async () => { renderer = TestRenderer.create(React.createElement(FinanceView, props)); });
  await act(async () => { button('Despesas').props.onClick(); });
  await act(async () => { renderer.root.findByProps({ 'aria-label': 'Editar' }).props.onClick(); });
  const dialog = () => renderer.root.findAllByType('input').find(item => item.props.value === 'Original' || item.props.value === 'Preserved expense draft');
  await act(async () => { dialog().props.onChange({ target: { value: 'Preserved expense draft' } }); });
  f.db.put(path('expenses', data.id), { ...data, description: 'Concurrent expense' });
  // A refreshed parent must not silently rebase the already-open form.
  const refreshed = await client.load();
  await act(async () => { renderer.update(React.createElement(FinanceView, { ...props, store: refreshed })); });
  await act(async () => { button('Salvar despesa').props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(notice, PSYCHOLOGY_CONFLICT_MESSAGE);
  assert.equal(dialog().props.value, 'Preserved expense draft');
  assert.equal(f.db.records.get(path('expenses', data.id)).description, 'Concurrent expense');
  await act(async () => { renderer.unmount(); });
});

test('R17 raw API errors distinguish persistence failure and validation failure', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  const change = buildPsychologyChange('patients', record.id, { ...record, administrativeNote: 'Draft' });
  f.db.failCommit = true;
  const failed = await f.fetchImpl(`/api/psychology/patients/${record.id}`, { method: 'PATCH', headers: { Authorization: 'Bearer fixture-token' }, body: JSON.stringify({ persistence: change }) });
  assert.equal(failed.status, 500); assert.equal((await failed.json()).persistenceStatus, 'PERSISTENCE_FAILED');
  f.db.failCommit = false;
  await assert.rejects(client.patients.upsert(scope, { ...record, preferredModality: 'invalid' }), error => error.status === 422 && error.persistenceStatus === 'VALIDATION_FAILED');
  assert.equal(f.db.commits.length, 0);
});

test('R17 malformed paths, prototype values and oversize changes fail before any write', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  const valid = buildPsychologyChange('patients', record.id, { ...record, administrativeNote: 'Edited' });
  const malformed = [
    { ...valid, changes: [{ ...valid.changes[0], path: ['__proto__'] }] },
    { ...valid, changes: [valid.changes[0], valid.changes[0]] },
    { ...valid, changes: [{ ...valid.changes[0], after: { present: true } }] },
    { ...valid, changes: [{ ...valid.changes[0], after: { present: true, value: JSON.parse('{"__proto__":{"bad":true}}') } }] },
    { ...valid, changes: [{ ...valid.changes[0], after: { present: true, value: 'x'.repeat(901 * 1024) } }] },
  ];
  for (const persistence of malformed) {
    const response = await f.fetchImpl(`/api/psychology/patients/${record.id}`, { method: 'PATCH', headers: { Authorization: 'Bearer fixture-token' }, body: JSON.stringify({ persistence }) });
    assert.equal(response.status, 422);
  }
  assert.equal(f.db.commits.length, 0); assert.equal({}.bad, undefined);
});

test('R17 arrays conflict as a single field; unrelated nested map leaves can merge', async () => {
  const f = fixture(); const data = { ...genericFixtures.services, ...scope, slots: ['A'], publicBooking: { enabled: true, minimumAdvanceHours: 24 } };
  f.db.put(path('services', data.id), data);
  const a = f.client(), b = f.client(); const left = await a.services.get(scope, data.id), right = await b.services.get(scope, data.id);
  await a.services.upsert(scope, { ...left, publicBooking: { ...left.publicBooking, enabled: false }, slots: ['A', 'B'] });
  const saved = await b.services.upsert(scope, { ...right, publicBooking: { ...right.publicBooking, minimumAdvanceHours: 48 } });
  assert.equal(saved.publicBooking.enabled, false); assert.equal(saved.publicBooking.minimumAdvanceHours, 48);
  await assert.rejects(b.services.upsert(scope, { ...right, slots: ['C'] }), conflict);
});

test('R17 missing update is not recreated and missing baseline never sends a mutation', async () => {
  const f = fixture(), client = f.client(); const record = await client.patients.get(scope, patient.id);
  f.db.records.delete(path('patients', record.id));
  await assert.rejects(client.patients.upsert(scope, { ...record, administrativeNote: 'Edited' }), conflict);
  const untouched = f.calls.length;
  await assert.rejects(client.patients.update(scope, 'missing-fixture', { active: false }), error => error.code === 'psychology/baseline-required');
  assert.equal(f.calls.length, untouched); assert.equal(f.db.records.has(path('patients', record.id)), false);
});

test('R17 settings profile aliases are presentation only and immutable/unknown settings remain protected', async () => {
  const f = fixture(); f.db.put(path('settings', 'settings'), { ...scope, id: 'settings', settings: { professionalProfile: { displayName: 'Fictitious', professionalTitle: 'Psicologia' } } });
  const client = f.remote(), store = await client.load();
  const patch = pinPsychologyEdit({ professionalProfile: { ...store.settings.professionalProfile, displayName: 'Changed', name: 'Changed', specialty: 'Psicologia', crp: '' } }, store.settings);
  await client.updateSettings(patch);
  assert.deepEqual(f.calls.at(-1).body.persistence.changes.map(item => item.path), [['settings', 'professionalProfile', 'displayName']]);
  await assert.rejects(client.repositories.settings.update(scope, 'settings', { professionalProfile: { unknownPrivateKey: 'Forbidden' } }), error => error.status === 422);
});

test('R17 granular field removal retains canonical required defaults and clears optional fields', async () => {
  const f = fixture(), client = f.client(); await client.sessions.list(scope);
  const saved = await client.sessions.update(scope, session.id, { status: undefined });
  assert.equal(saved.status, 'agendada');
  const data = { ...genericFixtures.services, ...scope, optional: 'Old optional', independent: 'Keep' };
  f.db.put(path('services', data.id), data);
  const repository = createPsychologyServerRepository({ db: f.db, runtimeScope, now: () => NOW });
  const result = await repository.services.updateKnown(await repository.services.get(data.id), { optional: undefined });
  assert.equal('optional' in result, false); assert.equal(result.independent, 'Keep');
  assert.equal(f.db.records.get(path('services', data.id)).optional, undefined);
});

test('R17 charge form sends only the edited description while preserving concurrent status', async () => {
  const React = await import('react');
  const { default: TestRenderer, act } = await import('react-test-renderer');
  const { default: FinanceView } = await import('../src/features/psychology-pilot/PsychologyFinanceView');
  const f = fixture(), client = f.remote();
  const data = { ...genericFixtures.charges, ...scope, dueDate: '2026-09-30' };
  f.db.put(path('charges', data.id), data);
  const store = await client.load(); let saved, renderer;
  const props = { store, onStoreChange: () => false, onNotice() {}, onRemoteMutation: async mutation => {
    saved = await client.repositories.financial.updateCharge(scope, mutation.charge.id, mutation.charge);
    return true;
  } };
  const text = node => typeof node === 'string' ? node : node.children.map(text).join('');
  const button = label => renderer.root.findAllByType('button').find(item => text(item).trim() === label);
  await act(async () => { renderer = TestRenderer.create(React.createElement(FinanceView, props)); });
  await act(async () => { button('Cobranças').props.onClick(); });
  await act(async () => { renderer.root.findByProps({ 'aria-label': 'Editar' }).props.onClick(); });
  await act(async () => { renderer.root.findAllByType('input').find(item => item.props.value === data.description).props.onChange({ target: { value: 'Only description changed' } }); });
  f.db.put(path('charges', data.id), { ...data, status: 'canceled' });
  const refreshed = await client.load();
  await act(async () => { renderer.update(React.createElement(FinanceView, { ...props, store: refreshed })); });
  await act(async () => { button('Salvar cobrança').props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(saved.status, 'canceled'); assert.equal(saved.description, 'Only description changed');
  assert.deepEqual(f.calls.at(-1).body.persistence.changes.map(item => item.path), [['description']]);
  await act(async () => { renderer.unmount(); });
});
