import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PersistenceBaselines, persistStateChange } from '../src/lib/statePersistence.ts';

// Execute the actual App callback, with only SDK IO replaced by an in-memory fake.
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let subscribe;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'updateState') callback = node.initializer.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('const listenerCollections')) subscribe = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);
const compiled = ts.transpileModule(`globalThis.updateState = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const compiledSubscribe = ts.transpileModule(`globalThis.subscribe = ${subscribe}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deleted = Symbol('deleted-field');
class FieldPath { constructor(...segments) { this.segments = segments; } }

function fixture() {
  const baselines = new PersistenceBaselines();
  const initial = { id: 'fixture-session', campoA: 'original-A', campoB: 'original-B' };
  const state = { settings: {}, patients: [], sessions: [initial], payments: [], expenses: [], repositions: [], evolutions: [], personalAppointments: [], externalRegistrationForms: [] };
  baselines.remember(initial, initial.id, initial);
  baselines.remember(state.settings, 'config', {});
  const values = new Map([
    ['users/fixture-owner/sessions/fixture-session', structuredClone(initial)],
    ['users/fixture-owner/settings/config', {}],
  ]);
  const trace = [], warnings = [], events = [], stateReplays = [];
  let transactionStarts = 0, commits = 0, fail = false;
  const context = {
    db: {}, user: { uid: 'fixture-owner' }, state,
    psychologyAuthenticatedRoute: false, canAccessInternalSystem: true,
    loadedCollectionsRef: { current: new Set(['settings', 'patients', 'sessions', 'payments', 'expenses', 'repositions', 'evolutions', 'agenda_pessoal', 'externalRegistrationForms']) },
    persistenceBaselinesRef: { current: baselines }, persistStateChange, FieldPath,
    deleteField: () => deleted,
    doc: (base, ...segments) => ({ path: [base.path, ...segments].filter(Boolean).join('/') }),
    collection: (base, ...segments) => ({ path: [base.path, ...segments].filter(Boolean).join('/') }),
    console: { warn: (...args) => warnings.push(args) },
    setState: fn => stateReplays.push(fn),
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, details) { this.type = type; this.details = details; } },
    ACTIVITY_GALLERY_CHANGED_EVENT: 'fixture-gallery-changed',
  };
  function writer(phase, pending) {
    return {
      set: (ref, data) => { trace.push({ phase, kind: 'create', path: ref.path }); pending.push({ kind: 'create', ref, data }); },
      delete: ref => { trace.push({ phase, kind: 'delete', path: ref.path }); pending.push({ kind: 'delete', ref }); },
      update: (ref, ...fields) => {
        assert.equal(fields.length % 2, 0);
        assert.ok(fields.filter((_, i) => i % 2 === 0).every(p => p instanceof FieldPath));
        trace.push({ phase, kind: 'update', path: ref.path, fields });
        pending.push({ kind: 'update', ref, fields });
      },
      commit: () => { throw new Error('dry validation batch must NEVER commit'); },
    };
  }
  context.writeBatch = () => writer('preflight', []);
  context.runTransaction = async (_db, work) => {
    transactionStarts++;
    const pending = [];
    await work({
      ...writer('transaction', pending),
      get: async ref => {
        assert.equal(pending.length, 0);
        trace.push({ phase: 'transaction', kind: 'read', path: ref.path });
        return { exists: () => values.has(ref.path), data: () => structuredClone(values.get(ref.path)) };
      },
    });
    if (fail) throw { code: 'permission-denied', message: 'fixture-private-message' };
    const next = new Map(values);
    for (const operation of pending) {
      const path = operation.ref.path;
      if (operation.kind === 'delete') next.delete(path);
      else if (operation.kind === 'create') next.set(path, structuredClone(operation.data));
      else {
        const data = structuredClone(next.get(path));
        for (let n = 0; n < operation.fields.length; n += 2) {
          const segments = operation.fields[n].segments;
          let parent = data;
          for (const segment of segments.slice(0, -1)) parent = parent[segment] ||= {};
          const value = operation.fields[n + 1];
          if (value === deleted) delete parent[segments.at(-1)];
          else parent[segments.at(-1)] = structuredClone(value);
        }
        next.set(path, data);
      }
    }
    values.clear();
    for (const [path, data] of next) values.set(path, data);
    commits++;
  };
  vm.runInNewContext(compiled, context);
  return { context, state, initial, baselines, values, trace, warnings, events, stateReplays,
    counts: () => ({ transactionStarts, commits }), setFail: () => { fail = true; } };
}

test('App AUD001 reproduction: later unloaded collection produces zero SDK writes/commits', async () => {
  const f = fixture();
  f.context.loadedCollectionsRef.current.delete('payments');
  const result = await f.context.updateState({ sessions: Array.from({ length: 400 }, (_, n) => ({ id: `fixture-${n}` })), payments: [] });
  assert.equal(result, false);
  assert.deepEqual(f.counts(), { transactionStarts: 0, commits: 0 });
  assert.equal(f.trace.length, 0);
  assert.equal(f.values.size, 2);
});

test('App AUD002 reproduction: real callback sends only changed fields and keeps both stale-client edits', async () => {
  const f = fixture();
  assert.equal(await f.context.updateState({ sessions: [{ ...f.initial, campoA: 'A-alterado' }] }), true);
  assert.equal(await f.context.updateState({ sessions: [{ ...f.initial, campoB: 'B-alterado' }] }), true);
  assert.deepEqual(f.values.get('users/fixture-owner/sessions/fixture-session'), { id: 'fixture-session', campoA: 'A-alterado', campoB: 'B-alterado' });
  const writes = f.trace.filter(e => e.phase === 'transaction' && e.kind === 'update');
  assert.deepEqual(writes.map(e => e.fields.filter((_, i) => i % 2 === 0).map(p => p.segments)), [[['campoA']], [['campoB']]]);
  assert.equal(f.trace.some(e => e.kind === 'create'), false);
  assert.equal(f.stateReplays.length, 0, 'never replay stale full arrays over authoritative listeners');
});

test('App same-field conflict returns false and logs no document, owner, or content', async () => {
  const f = fixture();
  await f.context.updateState({ sessions: [{ ...f.initial, campoA: 'A-alterado' }] });
  assert.equal(await f.context.updateState({ sessions: [{ ...f.initial, campoA: 'B-alterado' }] }), false);
  assert.equal(f.values.get('users/fixture-owner/sessions/fixture-session').campoA, 'A-alterado');
  assert.deepEqual(f.warnings[0], ['[STATE PERSISTENCE]', { status: 'CONFLICT', code: 'concurrent-change', operations: 1 }]);
  assert.doesNotMatch(JSON.stringify(f.warnings), /fixture-owner|fixture-session|alterado|original/);
});

test('App checks all reads before writes, preserves collection paths, and uses deleteField for removed fields', async () => {
  const f = fixture();
  assert.equal(await f.context.updateState({
    sessions: [{ id: f.initial.id, campoA: 'original-A' }],
    externalRegistrationForms: [{ id: 'fixture-form', ownerUserId: 'fixture-owner' }],
    payments: [{ id: 'fixture-payment', amount: 10 }],
  }), true);
  const transaction = f.trace.filter(e => e.phase === 'transaction');
  assert.deepEqual(transaction.slice(0, 3).map(e => e.kind), ['read', 'read', 'read']);
  assert.equal(transaction.length, 6);
  const update = transaction.find(e => e.kind === 'update');
  assert.equal(update.fields[1], deleted);
  assert.equal(f.values.has('externalRegistrationForms/fixture-form'), true);
  assert.equal(f.values.has('users/fixture-owner/payments/fixture-payment'), true);
  assert.deepEqual(f.counts(), { transactionStarts: 1, commits: 1 });
});

test('App publishes gallery invalidation only after confirmed success; failure keeps old state', async () => {
  const f = fixture();
  f.setFail();
  assert.equal(await f.context.updateState({ settings: { activityMediaMonitoringStart: '2026-09-30' } }), false);
  assert.equal(f.events.length, 0);
  assert.equal(f.stateReplays.length, 0);
  assert.deepEqual(f.values.get('users/fixture-owner/settings/config'), {});
  assert.doesNotMatch(JSON.stringify(f.warnings), /private-message|fixture-owner/);
  const success = fixture();
  assert.equal(await success.context.updateState({ settings: { activityMediaMonitoringStart: '2026-09-30' } }), true);
  assert.equal(success.events.length, 1);
  assert.equal(success.events[0].details.detail.reason, 'clinic-data-updated');
});

for (const guard of ['user', 'psychologyAuthenticatedRoute', 'canAccessInternalSystem']) test(`App preserves existing authentication/domain guard (${guard})`, async () => {
  const f = fixture();
  f.context[guard] = guard === 'user' ? null : guard === 'psychologyAuthenticatedRoute';
  assert.equal(await f.context.updateState({ sessions: [{ ...f.initial, campoA: 'new' }] }), false);
  assert.deepEqual(f.counts(), { transactionStarts: 0, commits: 0 });
  assert.equal(f.trace.length, 0);
});

test('actual snapshot callbacks attach raw baselines to every collection without changing DTO contents', async () => {
  const f = fixture();
  const listeners = new Map();
  Object.assign(f.context, {
    DEFAULT_SETTINGS: { name: 'fixture-default' }, setDataLoading() {}, emitFirestoreMetric() {},
    resolveTheme: value => value || 'light', applyTheme() {}, storeTheme() {},
    setTimeout: () => 0, clearTimeout() {},
    query: ref => ref, where: () => ({}),
    onSnapshot: (ref, ...args) => { listeners.set(ref.path.split('/').at(-1), args.at(-2)); return () => {}; },
    setState: fn => { f.context.state = fn(f.context.state); },
  });
  vm.runInNewContext(compiledSubscribe, f.context);
  const cleanup = f.context.subscribe();
  assert.equal(listeners.size, 9);
  const rawRecords = new Map();
  for (const [collection, listener] of listeners) {
    const id = collection === 'settings' ? 'config' : `fixture-${collection}`;
    const raw = { id, hidden: 'fictitious-hidden-field', ...(collection === 'agenda_pessoal' ? { observacao: 'fictitious-note', criado_em: 'original-date' } : {}) };
    rawRecords.set(collection, raw);
    const doc = { id, data: () => structuredClone(raw), metadata: {} };
    listener({ size: 1, docs: [doc], metadata: { fromCache: false }, docChanges: () => [], forEach: fn => fn(doc) });
  }
  for (const [property, collection] of [
    ['settings', 'settings'], ['patients', 'patients'], ['sessions', 'sessions'], ['payments', 'payments'],
    ['repositions', 'repositions'], ['expenses', 'expenses'], ['evolutions', 'evolutions'],
    ['personalAppointments', 'agenda_pessoal'], ['externalRegistrationForms', 'externalRegistrationForms'],
  ]) {
    const record = property === 'settings' ? f.context.state.settings : f.context.state[property][0];
    const saved = f.baselines.get(record);
    assert.ok(saved);
    assert.deepEqual(saved.data, rawRecords.get(collection));
    assert.equal(saved.id, rawRecords.get(collection).id);
  }
  assert.equal(f.context.state.personalAppointments[0].notes, 'fictitious-note');
  assert.equal(f.context.state.settings.name, 'fixture-default');
  // Baselines clone snapshots and retain old records even after a later snapshot.
  const old = f.context.state.sessions[0];
  const oldBaseline = f.baselines.get(old);
  listeners.get('sessions')({ size: 0, docs: [], metadata: { fromCache: false }, docChanges: () => [], forEach() {} });
  assert.equal(f.baselines.get(old), oldBaseline);
  cleanup();
});
