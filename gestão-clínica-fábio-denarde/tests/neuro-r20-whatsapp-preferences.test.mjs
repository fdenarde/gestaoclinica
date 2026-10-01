import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { prepareWhatsappReminderPreferencesUpdate, resolveWhatsappReminderPreferences,
  isWhatsappReminderEnabled } from '../shared/whatsappReminderPreferences.js';
import { isWhatsappAutomationBlocked } from '../shared/whatsappSessionAutomation.js';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import { persistStateChange } from '../src/lib/statePersistence.ts';
import { createMemoryReminderLedger, createReminderDeliveryService,
  WHATSAPP_OPERATION_MODES } from '../src/lib/whatsappReminderOperations.js';

// All identities and transport are synthetic. The sender is an in-memory spy.
const date = '2026-09-30';
const basePatient = { id: 'fixture-patient-r20', name: 'Paciente fictício', guardianName: 'Responsável fictício',
  whatsapp: '27 90000-0000', status: 'Ativo', startDate: '2026-01-01', fixedDay: '', fixedTime: '' };
const baseSession = { id: 'fixture-session-r20', patientId: basePatient.id, date, time: '15:40',
  type: 'Sessão simples (50 min)', status: 'Agendada', packageNumber: 1 };
const clone = value => JSON.parse(JSON.stringify(value));
const routines = [
  { type: 'AMANHA', runDateStr: '2026-09-29', now: new Date('2026-09-29T12:30:00Z'), field: 'dayBefore' },
  { type: 'HOJE_TARDE', runDateStr: date, now: new Date('2026-09-30T15:30:00Z'), field: 'sameDay' },
];
function plan(routine, patient, session) {
  return getWhatsappReminderPlan({ runDateStr: routine.runDateStr, tipo: routine.type,
    patients: [patient], sessions: [session], settings: { holidays: [] },
    referenceDateStr: '2026-09-29', now: routine.now });
}
function writeOperation(stored, operation) {
  const key = `${operation.collection}/${operation.id}`;
  if (operation.kind === 'create') return stored.set(key, clone(operation.data));
  if (operation.kind === 'delete') return stored.delete(key);
  const next = clone(stored.get(key));
  for (const change of operation.changes) {
    let parent = next;
    for (const part of change.path.slice(0, -1)) parent = parent[part] ||= {};
    const leaf = change.path.at(-1);
    if (change.after.present) parent[leaf] = clone(change.after.value);
    else delete parent[leaf];
  }
  stored.set(key, next);
}
async function saveReload(scope, preferences, patient = basePatient) {
  const session = clone(baseSession);
  patient = clone(patient);
  const intended = prepareWhatsappReminderPreferencesUpdate({ session, patient,
    sessions: [session], patients: [patient], scope, preferences });
  const stored = new Map([['sessions/' + session.id, clone(session)], ['patients/' + patient.id, clone(patient)]]);
  const baselines = new Map([[session, { id: session.id, data: clone(session) }],
    [patient, { id: patient.id, data: clone(patient) }]]);
  const result = await persistStateChange({ baseline: { sessions: [session], patients: [patient] },
    intended, loaded: new Set(['sessions', 'patients']), baselines }, {
    validate: () => {}, // No Firebase SDK or network is used.
    run: async work => work({ get: async operation => clone(stored.get(`${operation.collection}/${operation.id}`)),
      write: operation => writeOperation(stored, operation) }),
  });
  assert.equal(result.status, 'SUCCESS');
  return { session: clone(stored.get('sessions/' + session.id)), patient: clone(stored.get('patients/' + patient.id)) };
}
async function offlineDispatch(routine, patient, session, reminder) {
  let sendCalls = 0;
  const service = createReminderDeliveryService({ mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger: createMemoryReminderLedger(), now: () => routine.now, maxAttempts: 1,
    sender: { sendMessage: async phone => { assert.equal(phone, 'offline-sentinel'); sendCalls++; } },
    logger: { log() {}, error() {} },
    shouldBlockReminder: async ({ routine: type, phase }) => ({ blocked: isWhatsappAutomationBlocked(session,
      { patient, reminderType: type, phase, now: routine.now }) }),
  });
  const result = await service.processReminder({ accountId: 'fixture-account',
    reminder: { ...reminder, phone: 'offline-sentinel', whatsapp: 'offline-sentinel', message: 'fixture only' },
    routine: routine.type, routineDate: date,
    window: { start: new Date(routine.now.getTime() - 60_000).toISOString(),
      end: new Date(routine.now.getTime() + 60_000).toISOString() } });
  return { status: result.status, sendCalls };
}

for (const scope of ['patient', 'session']) {
  for (const [dayBefore, sameDay] of [[true, true], [true, false], [false, true], [false, false]]) {
    test(`${scope}: save → reload → plan → dispatch fictício ${dayBefore}/${sameDay}`, async () => {
      const preferences = { dayBefore, sameDay };
      const saved = await saveReload(scope, preferences, scope === 'session'
        ? { ...basePatient, whatsappReminderPreferences: { dayBefore: true, sameDay: true } } : basePatient);
      assert.deepEqual(resolveWhatsappReminderPreferences(saved.session, saved.patient), preferences);
      assert.deepEqual(scope === 'session' ? saved.session.whatsappReminderPreferences
        : saved.patient.whatsappReminderPreferences, preferences);
      for (const routine of routines) {
        const expected = preferences[routine.field];
        assert.equal(plan(routine, saved.patient, saved.session).reminders.length, Number(expected));
        const staleReminder = plan(routine, { ...basePatient,
          whatsappReminderPreferences: { dayBefore: true, sameDay: true } }, baseSession).reminders[0];
        assert.ok(staleReminder);
        const dispatch = await offlineDispatch(routine, saved.patient, saved.session, staleReminder);
        assert.equal(dispatch.sendCalls, Number(expected));
        assert.equal(dispatch.status, expected ? 'confirmed' : 'skipped');
      }
    });
  }
}

test('false explícito da sessão prevalece sobre true do paciente; campo parcial herda somente propriedade ausente', async () => {
  const saved = await saveReload('session', { dayBefore: true, sameDay: false },
    { ...basePatient, whatsappReminderPreferences: { dayBefore: true, sameDay: true } });
  assert.equal(saved.session.whatsappReminderPreferences.sameDay, false);
  assert.equal(resolveWhatsappReminderPreferences(saved.session, saved.patient).sameDay, false);
  const partial = { ...saved.session, whatsappReminderPreferences: { dayBefore: true } };
  const patientFalse = { ...saved.patient, whatsappReminderPreferences: { dayBefore: true, sameDay: false } };
  assert.equal(resolveWhatsappReminderPreferences(partial, patientFalse).sameDay, false);
  assert.equal(resolveWhatsappReminderPreferences(partial, basePatient).sameDay, false);
  assert.equal(resolveWhatsappReminderPreferences({ ...partial, whatsappReminderPreferences: null }, saved.patient).sameDay, false);
  assert.equal(isWhatsappReminderEnabled(saved.session, saved.patient, 'UNKNOWN'), false);
  assert.deepEqual(resolveWhatsappReminderPreferences(baseSession, basePatient), { dayBefore: true, sameDay: true },
    'contrato legado sem objeto de preferência permanece explícito');
});

test('plano previamente calculado não autoriza envio após Save desmarcar sameDay', async () => {
  const stale = plan(routines[1], { ...basePatient,
    whatsappReminderPreferences: { dayBefore: true, sameDay: true } }, baseSession).reminders[0];
  const current = await saveReload('session', { dayBefore: true, sameDay: false },
    { ...basePatient, whatsappReminderPreferences: { dayBefore: true, sameDay: true } });
  assert.equal(plan(routines[1], current.patient, current.session).reminders.length, 0);
  assert.deepEqual(await offlineDispatch(routines[1], current.patient, current.session, stale),
    { status: 'skipped', sendCalls: 0 });
});

test('silêncio ativo bloqueia véspera e mesmo dia acima das preferências', async () => {
  const saved = await saveReload('session', { dayBefore: true, sameDay: true });
  const silenced = { ...saved.session, whatsappAutomationControl: { blockAll: true } };
  for (const routine of routines) {
    const reminder = plan(routine, saved.patient, saved.session).reminders[0];
    assert.equal(isWhatsappAutomationBlocked(silenced, { patient: saved.patient,
      reminderType: routine.type, now: routine.now }), true);
    assert.deepEqual(await offlineDispatch(routine, saved.patient, silenced, reminder),
      { status: 'skipped', sendCalls: 0 });
  }
});

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const guardStart = serverSource.indexOf('async function resolveSessionAutomationBlock(');
const guardEnd = serverSource.indexOf('async function processClaimedRoutine(', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart);
function finalGuard({ session = null, patient = basePatient, daySessions = [], readError = false } = {}) {
  const snapshot = value => value ? { exists: true, id: value.id, data: () => clone(value) }
    : { exists: false, id: '', data: () => null };
  const db = {
    doc: path => ({ get: async () => snapshot(path.includes('/patients/') ? patient : session) }),
    collection: () => ({ where: (field, operator, value) => {
      assert.equal(field, 'date'); assert.equal(operator, '=='); assert.equal(value, date);
      return { get: async () => {
        if (readError) throw new Error('fixture read failure');
        return { docs: daySessions.map(item => snapshot(item)) };
      } };
    } }),
  };
  return vm.runInNewContext(`(${serverSource.slice(guardStart, guardEnd)})`, {
    Date, db, isWhatsappAutomationBlocked, SENDER_NAME: 'Fixture', console: { error() {} },
  });
}

test('rechecagem final lê override materializado após plano virtual e bloqueia sameDay', async () => {
  const patient = { ...basePatient, whatsappReminderPreferences: { dayBefore: true, sameDay: true } };
  const materialized = { ...baseSession, id: 'fixture-materialized-r20',
    whatsappReminderPreferences: { dayBefore: true, sameDay: false } };
  const reminder = { id: 'virtual-fixture-r20', patientId: patient.id, time: baseSession.time, isVirtual: true };
  const check = finalGuard({ patient, daySessions: [materialized] });
  assert.equal((await check({ accountId: 'fixture-account', reminder, routine: 'HOJE_TARDE', routineDate: date, phase: 'send' })).blocked, true);
  assert.equal((await check({ accountId: 'fixture-account', reminder, routine: 'AMANHA', routineDate: date, phase: 'send' })).blocked, false);
  assert.equal((await finalGuard({ patient })({ accountId: 'fixture-account', reminder,
    routine: 'HOJE_TARDE', routineDate: date, phase: 'send' })).blocked, false);
});

test('rechecagem final falha fechada em plano stale, contexto incompleto e leitura indisponível', async () => {
  const patient = { ...basePatient, whatsappReminderPreferences: { dayBefore: true, sameDay: true } };
  const reminder = { id: 'virtual-fixture-r20', patientId: patient.id, time: baseSession.time, isVirtual: true };
  for (const input of [
    { check: finalGuard({ patient, daySessions: [{ ...baseSession, time: '16:40' }] }), reminder },
    { check: finalGuard({ patient, readError: true }), reminder },
    { check: finalGuard({ patient, session: { ...baseSession, time: '16:40' } }),
      reminder: { ...reminder, id: baseSession.id, isVirtual: false } },
  ]) assert.equal((await input.check({ accountId: 'fixture-account', reminder: input.reminder,
    routine: 'HOJE_TARDE', routineDate: date, phase: 'send' })).blocked, true);
  assert.equal((await finalGuard({ patient })({ accountId: 'fixture-account', reminder,
    routine: 'HOJE_TARDE', phase: 'send' })).blocked, true);
});
