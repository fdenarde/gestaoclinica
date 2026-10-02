import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  DEFAULT_WHATSAPP_REMINDER_TIMES,
  isWhatsappTimingSlotEnabled,
  normalizeWhatsappCustomTimes,
  prepareWhatsappReminderPreferencesUpdate,
  resolveWhatsappReminderTiming,
} from '../shared/whatsappReminderPreferences.js';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import { collectDueCustomReminderSlots, getSaoPauloReminderClock } from '../src/lib/whatsappCustomSchedule.js';
import { buildReminderPlanContexts } from '../src/lib/whatsappReminderRuntime.js';
import { createMemoryReminderLedger, createReminderDeliveryService, createRoutineWindow, WHATSAPP_OPERATION_MODES } from '../src/lib/whatsappReminderOperations.js';
import { isWhatsappAutomationBlocked } from '../shared/whatsappSessionAutomation.js';
import { persistStateChange } from '../src/lib/statePersistence.ts';

const date = '2026-09-08';
const patient = (id, preferences) => ({ id, name: `Fictício ${id}`, guardianName: 'Responsável fictício',
  whatsapp: '27 90000-0000', status: 'Ativo', startDate: '2026-01-01', fixedDay: '', fixedTime: '',
  ...(preferences ? { whatsappReminderPreferences: preferences } : {}) });
const session = (id, patientId, day = date, preferences) => ({ id, patientId, date: day, time: '16:40',
  type: 'Sessão simples (50 min)', status: 'Agendada', packageNumber: 1,
  ...(preferences ? { whatsappReminderPreferences: preferences } : {}) });
const custom = (slots, flags = {}) => ({ dayBefore: true, sameDay: true, ...flags,
  timingMode: 'custom', customTimes: slots });
const slots = [
  { relativeDay: 'dayBefore', time: '10:30' },
  { relativeDay: 'sameDay', time: '08:00' },
  { relativeDay: 'sameDay', time: '13:15' },
];
const plan = ({ tipo, runDateStr = date, scheduledTime = '', customOnly = false, patients, sessions, now = new Date('2026-09-08T16:00:00Z') }) =>
  getWhatsappReminderPlan({ tipo, runDateStr, scheduledTime, customOnly, patients, sessions,
    settings: { holidays: [] }, referenceDateStr: date, now });

test('paciente legado e modo padrão explícito mantêm 09:00, 06:30 e 12:30', () => {
  for (const owner of [patient('legacy'), patient('explicit', { dayBefore: true, sameDay: true, timingMode: 'default' })]) {
    assert.deepEqual(resolveWhatsappReminderTiming(null, owner).customTimes, DEFAULT_WHATSAPP_REMINDER_TIMES);
    const care = session('s-' + owner.id, owner.id);
    for (const [tipo, runDateStr, scheduledTime] of [
      ['AMANHA', '2026-09-07', '09:00'], ['HOJE_TARDE', date, '12:30'],
    ]) assert.equal(plan({ tipo, runDateStr, patients: [owner], sessions: [care] }).reminders[0]?.scheduledTime, scheduledTime);
    assert.equal(isWhatsappTimingSlotEnabled(care, owner, { relativeDay: 'sameDay', time: '06:30' }), true);
  }
});

test('horários personalizados funcionam na véspera e em dois horários do mesmo dia', () => {
  const owner = patient('a', custom(slots));
  const care = session('s-a', 'a');
  assert.equal(plan({ tipo: 'AMANHA', runDateStr: '2026-09-07', scheduledTime: '10:30', customOnly: true, patients: [owner], sessions: [care] }).reminders[0]?.scheduledTime, '10:30');
  for (const [tipo, scheduledTime] of [['HOJE_MANHA', '08:00'], ['HOJE_TARDE', '13:15']]) {
    const reminders = plan({ tipo, scheduledTime, customOnly: true, patients: [owner], sessions: [care] }).reminders;
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].timingMode, 'custom');
  }
  assert.equal(plan({ tipo: 'HOJE_TARDE', patients: [owner], sessions: [care] }).reminders.length, 0);
});

test('pacientes mantêm horários independentes e nenhum slot estranho gera envio', () => {
  const a = patient('a', custom([{ relativeDay: 'sameDay', time: '08:00' }]));
  const b = patient('b', custom([{ relativeDay: 'sameDay', time: '13:15' }]));
  const care = [session('s-a', 'a'), session('s-b', 'b')];
  assert.deepEqual(plan({ tipo: 'HOJE_MANHA', scheduledTime: '08:00', customOnly: true, patients: [a, b], sessions: care }).reminders.map(item => item.patientId), ['a']);
  assert.deepEqual(plan({ tipo: 'HOJE_TARDE', scheduledTime: '13:15', customOnly: true, patients: [a, b], sessions: care }).reminders.map(item => item.patientId), ['b']);
  assert.equal(plan({ tipo: 'HOJE_TARDE', scheduledTime: '14:00', customOnly: true, patients: [a, b], sessions: care }).reminders.length, 0);
  const past = { ...session('s-past', 'b'), time: '10:00' };
  assert.equal(plan({ tipo: 'HOJE_TARDE', scheduledTime: '13:15', customOnly: true, patients: [b], sessions: [past] }).reminders.length, 0);
});

test('valida 00:00 e 23:59, rejeita vazio, 24:00, formato incorreto, dia e duplicidade', () => {
  assert.deepEqual(normalizeWhatsappCustomTimes([{ relativeDay: 'sameDay', time: '23:59' }, { relativeDay: 'dayBefore', time: '00:00' }], { strict: true }),
    [{ relativeDay: 'dayBefore', time: '00:00' }, { relativeDay: 'sameDay', time: '23:59' }]);
  for (const invalid of [[], [{ relativeDay: 'sameDay', time: '' }], [{ relativeDay: 'sameDay', time: '24:00' }],
    [{ relativeDay: 'sameDay', time: '8:00' }], [{ relativeDay: 'other', time: '08:00' }],
    [{ relativeDay: 'sameDay', time: '08:00' }, { relativeDay: 'sameDay', time: '08:00' }]]) {
    assert.throws(() => normalizeWhatsappCustomTimes(invalid, { strict: true }));
  }
});

test('configuração carregada inválida falha fechada; sessão pode sobrescrever horário do paciente', () => {
  const owner = patient('a', custom([{ relativeDay: 'sameDay', time: '24:00' }]));
  assert.equal(resolveWhatsappReminderTiming(null, owner).valid, false);
  assert.equal(isWhatsappTimingSlotEnabled(null, owner, { relativeDay: 'sameDay', time: '12:30' }), false);
  const override = session('s-a', 'a', date, custom([{ relativeDay: 'sameDay', time: '08:00' }]));
  assert.equal(isWhatsappTimingSlotEnabled(override, owner, { relativeDay: 'sameDay', time: '08:00' }), true);
  assert.equal(isWhatsappTimingSlotEnabled(override, owner, { relativeDay: 'sameDay', time: '12:30' }), false);
});

test('modalidades false e silêncio prevalecem sobre todos os horários customizados', () => {
  const owner = patient('a', custom(slots, { dayBefore: false, sameDay: false }));
  const care = session('s-a', 'a');
  assert.equal(plan({ tipo: 'AMANHA', runDateStr: '2026-09-07', scheduledTime: '10:30', customOnly: true, patients: [owner], sessions: [care] }).reminders.length, 0);
  assert.equal(plan({ tipo: 'HOJE_TARDE', scheduledTime: '13:15', customOnly: true, patients: [owner], sessions: [care] }).reminders.length, 0);
  const silenced = patient('silent', custom(slots));
  silenced.whatsappAutomationControl = { version: 1, blockAll: true, scope: 'patient', blockedReminderTypes: [], reasonCode: 'outro' };
  assert.equal(plan({ tipo: 'HOJE_TARDE', scheduledTime: '13:15', customOnly: true, patients: [silenced], sessions: [session('s-silent', 'silent')] }).reminders.length, 0);
});

test('remoção, restauração e persistência permanecem no objeto existente', () => {
  const owner = patient('a');
  const care = session('s-a', 'a');
  const saved = prepareWhatsappReminderPreferencesUpdate({ session: care, patient: owner, sessions: [care], patients: [owner], scope: 'patient', preferences: custom(slots) });
  assert.equal(saved.patients[0].whatsappReminderPreferences.customTimes.length, 3);
  const remaining = saved.patients[0].whatsappReminderPreferences.customTimes.filter(item => item.time !== '08:00');
  const removed = prepareWhatsappReminderPreferencesUpdate({ session: care, patient: saved.patients[0], sessions: [care], patients: saved.patients, scope: 'patient', preferences: custom(remaining) });
  assert.equal(removed.patients[0].whatsappReminderPreferences.customTimes.length, 2);
  const restored = prepareWhatsappReminderPreferencesUpdate({ session: care, patient: removed.patients[0], sessions: [care], patients: removed.patients, scope: 'patient', preferences: { dayBefore: true, sameDay: true, timingMode: 'default' } });
  assert.equal(resolveWhatsappReminderTiming(null, restored.patients[0]).timingMode, 'default');
  assert.throws(() => prepareWhatsappReminderPreferencesUpdate({ session: care, patient: owner, sessions: [care], patients: [owner], scope: 'patient', preferences: custom([]) }));
});

test('configuração customizada salva e recarrega pelo fluxo de persistência existente', async () => {
  const owner = patient('a');
  const care = session('s-a', 'a');
  const intended = prepareWhatsappReminderPreferencesUpdate({ session: care, patient: owner,
    sessions: [care], patients: [owner], scope: 'patient', preferences: custom(slots) });
  const clone = value => JSON.parse(JSON.stringify(value));
  const stored = new Map([['patients/a', clone(owner)], ['sessions/s-a', clone(care)]]);
  const baselines = new Map([[owner, { id: owner.id, data: clone(owner) }], [care, { id: care.id, data: clone(care) }]]);
  const result = await persistStateChange({ baseline: { patients: [owner], sessions: [care] }, intended,
    loaded: new Set(['patients', 'sessions']), baselines }, {
    validate: () => {},
    run: async work => work({ get: async operation => clone(stored.get(`${operation.collection}/${operation.id}`)),
      write: operation => {
        const key = `${operation.collection}/${operation.id}`;
        const next = clone(stored.get(key));
        for (const change of operation.changes) {
          let parent = next;
          for (const part of change.path.slice(0, -1)) parent = parent[part] ||= {};
          if (change.after.present) parent[change.path.at(-1)] = clone(change.after.value);
          else delete parent[change.path.at(-1)];
        }
        stored.set(key, next);
      } }),
  });
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(stored.get('patients/a').whatsappReminderPreferences.customTimes, slots);
  assert.deepEqual(stored.get('sessions/s-a'), care);
});

test('scheduler usa minuto de São Paulo, incluindo virada de dia, sem consultar Firebase por minuto no helper', () => {
  const owner = patient('a', custom([{ relativeDay: 'sameDay', time: '00:00' }, { relativeDay: 'dayBefore', time: '23:59' }]));
  assert.deepEqual(getSaoPauloReminderClock(new Date('2026-09-09T02:59:00Z')), { date: '2026-09-08', time: '23:59' });
  const care = session('s-a', 'a');
  assert.deepEqual(collectDueCustomReminderSlots({ patients: [owner], sessions: [{ ...care, date: '2026-09-09' }], now: new Date('2026-09-09T02:59:00Z') }), [{ routine: 'AMANHA', scheduledTime: '23:59' }]);
  assert.deepEqual(collectDueCustomReminderSlots({ patients: [owner], sessions: [{ ...care, date: '2026-09-09' }], now: new Date('2026-09-09T03:00:00Z') }), [{ routine: 'HOJE_MANHA', scheduledTime: '00:00' }]);
  assert.deepEqual(collectDueCustomReminderSlots({ patients: [owner], sessions: [{ ...care, date: '2026-09-09' }], now: new Date('2026-09-09T03:01:00Z') }), []);
  assert.deepEqual(collectDueCustomReminderSlots({ patients: [owner], sessions: [], now: new Date('2026-09-09T03:00:00Z') }), []);
  const beforeMidnight = createRoutineWindow({ dateStr: '2026-09-08', routine: 'AMANHA', scheduledTime: '23:59' });
  assert.equal(beforeMidnight.end, '2026-09-09T03:00:00.000Z');
});

test('rotina custom consulta em lote somente a conta elegível e a data alvo', async () => {
  const reads = [];
  const owner = patient('a', custom([{ relativeDay: 'sameDay', time: '13:15' }]));
  const care = session('s-a', 'a');
  const db = {
    collectionGroup() { throw new Error('scan global proibido na rotina custom'); },
    doc(path) { reads.push(path); return { get: async () => ({ exists: true, id: 'config', ref: { parent: { parent: { id: 'fixture-account' } } }, data: () => ({ holidays: [] }) }) }; },
    collection(path) { reads.push(path); return {
      get: async () => ({ docs: [{ id: owner.id, data: () => owner }] }),
      where(field, operator, value) { assert.deepEqual([field, operator, value], ['date', '==', date]);
        return { get: async () => ({ docs: [{ id: care.id, data: () => care }] }) }; },
    }; },
  };
  const contexts = await buildReminderPlanContexts({ db, tipo: 'HOJE_TARDE', scheduledTime: '13:15', customOnly: true,
    accountIds: ['fixture-account'], routineDateStr: date, now: new Date('2026-09-08T16:15:00Z'), suppressions: [] });
  assert.equal(contexts[0].plan.reminders.length, 1);
  assert.deepEqual(reads, ['users/fixture-account/settings/config', 'users/fixture-account/patients', 'users/fixture-account/sessions']);
});

test('ledger confirma slots customizados distintos uma vez cada, sem envio real', async () => {
  const ledger = createMemoryReminderLedger();
  let calls = 0;
  let currentNow = new Date('2026-09-08T16:15:00Z');
  const service = createReminderDeliveryService({ mode: WHATSAPP_OPERATION_MODES.LIVE, ledger,
    sender: { async sendMessage() { calls += 1; } }, now: () => currentNow, maxAttempts: 1,
    logger: { log() {}, error() {} }, shouldBlockReminder: async () => ({ blocked: false }) });
  const reminder = { id: 's-a', patientId: 'a', guardianName: 'Responsável fictício', phone: 'offline-sentinel',
    whatsapp: 'offline-sentinel', time: '16:40', message: 'Somente fixture', reminderType: 'HOJE_TARDE', timingMode: 'custom', relativeDay: 'sameDay' };
  for (const time of ['13:15', '13:16']) {
    currentNow = new Date(`2026-09-08T${time === '13:15' ? '16:15' : '16:16'}:00Z`);
    const window = createRoutineWindow({ dateStr: date, routine: 'HOJE_TARDE', scheduledTime: time });
    for (let repeat = 0; repeat < 2; repeat++) await service.processReminder({ accountId: 'fixture', reminder: { ...reminder, scheduledTime: time },
      routine: 'HOJE_TARDE', routineDate: date, window });
  }
  assert.equal(calls, 2);
});

test('sender fictício não envia antes ou depois da janela personalizada', async () => {
  let calls = 0;
  const reminder = { id: 's-a', patientId: 'a', guardianName: 'Responsável fictício', phone: 'offline-sentinel',
    whatsapp: 'offline-sentinel', time: '16:40', message: 'Somente fixture', reminderType: 'HOJE_TARDE',
    timingMode: 'custom', relativeDay: 'sameDay', scheduledTime: '13:15' };
  const window = createRoutineWindow({ dateStr: date, routine: 'HOJE_TARDE', scheduledTime: '13:15' });
  for (const at of ['2026-09-08T16:14:59Z', '2026-09-08T16:20:00Z']) {
    const service = createReminderDeliveryService({ mode: WHATSAPP_OPERATION_MODES.LIVE,
      ledger: createMemoryReminderLedger(), now: () => new Date(at), maxAttempts: 1,
      sender: { async sendMessage() { calls += 1; } }, logger: { log() {}, error() {} },
      shouldBlockReminder: async () => ({ blocked: false }) });
    const result = await service.processReminder({ accountId: 'fixture', reminder, routine: 'HOJE_TARDE',
      routineDate: date, window });
    assert.equal(result.status, 'skipped');
  }
  assert.equal(calls, 0);
});

test('guard final rejeita plano de horário customizado obsoleto antes de qualquer envio', async () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function resolveSessionAutomationBlock(');
  const end = source.indexOf('async function processClaimedRoutine(', start);
  assert.ok(start >= 0 && end > start);
  const care = session('s-a', 'a');
  const owner = patient('a', custom([{ relativeDay: 'sameDay', time: '13:15' }]));
  const snapshot = value => ({ exists: true, id: value.id, data: () => value });
  const db = { doc: path => ({ get: async () => snapshot(path.includes('/patients/') ? owner : care) }) };
  const guard = vm.runInNewContext(`(${source.slice(start, end)})`, {
    Date, db, isWhatsappAutomationBlocked, isWhatsappTimingSlotEnabled, resolveWhatsappReminderTiming,
    SENDER_NAME: 'Fixture', console: { error() {} },
  });
  const reminder = { id: care.id, patientId: owner.id, time: care.time, relativeDay: 'sameDay',
    scheduledTime: '08:00', timingMode: 'custom' };
  const result = await guard({ accountId: 'fixture', reminder, routine: 'HOJE_MANHA', routineDate: date, phase: 'send' });
  assert.equal(result.blocked, true);
  assert.equal((await guard({ accountId: 'fixture', reminder: { ...reminder, scheduledTime: '13:15' },
    routine: 'HOJE_TARDE', routineDate: date, phase: 'send' })).blocked, false);
});
