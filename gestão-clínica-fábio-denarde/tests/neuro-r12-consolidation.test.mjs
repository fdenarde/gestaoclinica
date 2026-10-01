import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveWhatsappReminderPreferences, prepareWhatsappReminderPreferencesUpdate } from '../shared/whatsappReminderPreferences.js';
import { isWhatsappAutomationBlocked } from '../shared/whatsappSessionAutomation.js';
import { getWhatsappReminderPlan, getSessionsForDate } from '../src/lib/whatsappReminderPlan.js';
import { rescheduleSessionInAgenda, sessionConsumesPackage } from '../shared/sessionScheduling.js';
import { calculatePackageFinancialSummary, getPackageRenewalNotice, SESSIONS_PER_PACKAGE } from '../src/lib/financePackages.ts';
import { preparePaymentCreation } from '../shared/paymentOperations.js';
import { buildUnregisteredActivityGroups } from '../shared/unregisteredActivities.js';
import { createMemoryReminderLedger, createReminderDeliveryService, WHATSAPP_OPERATION_MODES, createRoutineCheckpointId } from '../src/lib/whatsappReminderOperations.js';

const NOW = new Date('2026-09-30T12:30:00-03:00');
const patient = { id: 'fixture-patient', name: 'Paciente fictício', guardianName: 'Responsável fictício', whatsapp: '27 90000-0000', status: 'Ativo', startDate: '2026-01-01', fixedDay: '', fixedTime: '', paymentModal: 'PADRÃO: Pix integral' };
const occurrence = (extra = {}) => ({ id: 'fixture-session', patientId: patient.id, date: '2026-09-30', time: '15:40', type: 'Sessão simples (50 min)', status: 'Agendada', packageNumber: 1, ...extra });
const plan = (tipo, p = patient, sessions = [occurrence()]) => getWhatsappReminderPlan({ runDateStr: tipo === 'AMANHA' ? '2026-09-29' : '2026-09-30', tipo, patients: [p], sessions, settings: { holidays: [] }, referenceDateStr: '2026-09-29', now: NOW });

for (const [dayBefore, sameDay] of [[true, false], [false, true], [true, true], [false, false]]) {
  test(`modalidades véspera=${dayBefore} dia=${sameDay}: planeja somente a seleção`, () => {
    const p = { ...patient, whatsappReminderPreferences: { dayBefore, sameDay } };
    assert.equal(plan('AMANHA', p).reminders.length, Number(dayBefore));
    assert.equal(plan('HOJE_TARDE', p).reminders.length, Number(sameDay));
  });
}

test('legado, herança, override e retorno ao padrão não alteram controles de silêncio', () => {
  assert.deepEqual(resolveWhatsappReminderPreferences(null, patient), { dayBefore: true, sameDay: true });
  const p = { ...patient, whatsappReminderPreferences: { dayBefore: true, sameDay: false } };
  const s = occurrence({ whatsappReminderPreferences: { dayBefore: false, sameDay: true }, whatsappAutomationControl: { blockAll: true } });
  assert.deepEqual(resolveWhatsappReminderPreferences(s, p), { dayBefore: false, sameDay: true });
  const result = prepareWhatsappReminderPreferencesUpdate({ session: s, patient: p, sessions: [s], patients: [p], scope: 'default' });
  assert.deepEqual(resolveWhatsappReminderPreferences(result.sessions[0], p), p.whatsappReminderPreferences);
  assert.deepEqual(result.sessions[0].whatsappAutomationControl, s.whatsappAutomationControl);
  assert.ok(s.whatsappReminderPreferences, 'objeto de entrada intacto');
});

test('padrão futuro modifica só o paciente e preserva overrides individuais', () => {
  const s = occurrence({ whatsappReminderPreferences: { dayBefore: false, sameDay: true } });
  const result = prepareWhatsappReminderPreferencesUpdate({ session: s, patient, sessions: [s], patients: [patient], scope: 'patient', preferences: { dayBefore: true, sameDay: false } });
  assert.deepEqual(Object.keys(result), ['patients']);
  assert.deepEqual(resolveWhatsappReminderPreferences(s, result.patients[0]), s.whatsappReminderPreferences);
  assert.deepEqual(resolveWhatsappReminderPreferences(occurrence(), result.patients[0]), { dayBefore: true, sameDay: false });
});

test('override de ocorrência virtual materializa só uma sessão sem alterar quantidade ou dados', () => {
  const source = occurrence({ isVirtual: true, notes: 'Fictício', mediaId: 'fixture-media' });
  const result = prepareWhatsappReminderPreferencesUpdate({ session: source, patient, sessions: [], patients: [patient], scope: 'session', preferences: { dayBefore: false, sameDay: false }, generatedId: 'fixture-materialized' });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, 'fixture-materialized');
  assert.equal(result.sessions[0].mediaId, source.mediaId);
  assert.equal(result.sessions[0].packageNumber, source.packageNumber);
  assert.equal(result.sessions[0].isVirtual, undefined);
});

test('uma mensagem no dia mesmo com sessões em turnos diferentes ou duração dupla', () => {
  const sessions = [occurrence({ id: 'fixture-afternoon', time: '15:40' }), occurrence({ id: 'fixture-morning', time: '10:05', type: 'Sessão dupla (2 × 50 min)' })];
  assert.equal(plan('HOJE_MANHA', patient, sessions).reminders.length, 1);
  assert.equal(plan('HOJE_TARDE', patient, sessions).reminders.length, 0);
  assert.equal(plan('AMANHA', patient, sessions).reminders.length, 1);
});

test('override desativado na primeira sessão não bloqueia outra ocorrência elegível', () => {
  const sessions = [occurrence({ id: 'fixture-morning', time: '10:05', whatsappReminderPreferences: { dayBefore: true, sameDay: false } }), occurrence({ id: 'fixture-afternoon', time: '15:40' })];
  assert.equal(plan('HOJE_MANHA', patient, sessions).reminders.length, 0);
  assert.equal(plan('HOJE_TARDE', patient, sessions).reminders.length, 1);
});

test('silêncio de sessão/paciente prevalece e expiração respeita a modalidade', () => {
  const control = { version: 1, blockAll: true, blockedReminderTypes: [], scope: 'session', startsAt: '2026-09-30T10:00:00Z', silenceUntil: '2026-09-30T16:00:00Z' };
  const s = occurrence({ whatsappAutomationControl: control });
  assert.equal(isWhatsappAutomationBlocked(s, { patient, reminderType: 'HOJE_TARDE', now: NOW }), true);
  assert.equal(isWhatsappAutomationBlocked(occurrence(), { patient: { ...patient, whatsappAutomationControl: { ...control, scope: 'patient' } }, reminderType: 'AMANHA', now: NOW }), true);
  assert.equal(isWhatsappAutomationBlocked(s, { patient, reminderType: 'HOJE_TARDE', now: new Date('2026-09-30T16:01:00Z') }), false);
  assert.equal(isWhatsappAutomationBlocked(s, { patient: { ...patient, whatsappReminderPreferences: { dayBefore: true, sameDay: false } }, reminderType: 'HOJE_TARDE', phase: 'retry', now: new Date('2026-09-30T16:01:00Z') }), true);
});

test('cancelada, removida, inválida e nenhuma modalidade nunca planejam', () => {
  for (const changes of [{ status: 'Cancelada' }, { removedFromAgenda: true }, { patientId: 'fixture-missing' }, { whatsappReminderPreferences: { dayBefore: false, sameDay: false } }]) {
    assert.equal(plan('AMANHA', patient, [occurrence(changes)]).reminders.length, 0);
    assert.equal(plan('HOJE_TARDE', patient, [occurrence(changes)]).reminders.length, 0);
  }
});

test('reagendamento preserva ID/vínculos/histórico e planejamento usa minuto exato novo', () => {
  const source = occurrence({ paymentId: 'fixture-payment', albumId: 'fixture-album', notes: 'Fictício', clinicalRecordId: 'fixture-record' });
  const past = occurrence({ id: 'fixture-past', date: '2026-09-01', status: 'Realizada' });
  const result = rescheduleSessionInAgenda([past, source], source, { newDate: source.date, newTime: '17:05', rescheduledAt: NOW.toISOString(), rescheduledBy: 'Equipe fictícia' });
  assert.equal(result.sessions.length, 2);
  assert.deepEqual(result.sessions[0], past);
  for (const field of ['id', 'patientId', 'packageNumber', 'paymentId', 'albumId', 'notes', 'clinicalRecordId']) assert.equal(result.session[field], source[field]);
  assert.equal(result.session.rescheduleHistory.length, 1);
  assert.equal(plan('AMANHA', patient, result.sessions).reminders[0].time, '17:05');
});

test('sessão fixa reagendada não reaparece virtualmente no horário anterior do WhatsApp', () => {
  const p = { ...patient, fixedDay: 'quarta', fixedTime: '15:40' };
  const virtual = occurrence({ id: 'virtual-fixture', isVirtual: true });
  const result = rescheduleSessionInAgenda([], virtual, { newDate: '2026-10-01', newTime: '17:05', generatedId: 'fixture-materialized', rescheduledAt: NOW.toISOString(), rescheduledBy: 'Equipe fictícia' });
  const originalDay = getSessionsForDate({ dateStr: '2026-09-30', patients: [p], sessions: result.sessions, settings: { holidays: [] }, referenceDateStr: '2026-09-29' });
  assert.equal(originalDay.length, 0);
  const nextWeek = getSessionsForDate({ dateStr: '2026-10-07', patients: [p], sessions: result.sessions, settings: { holidays: [] }, referenceDateStr: '2026-09-29' });
  assert.equal(nextWeek.length, 1, 'somente a ocorrência foi alterada');
  assert.equal(nextWeek[0].time, '15:40');
});

test('ledger bloqueia duplicidade entre turnos mesmo se a seleção mudar após a manhã', async () => {
  const ledger = createMemoryReminderLedger(); let sends = 0;
  const service = createReminderDeliveryService({ mode: WHATSAPP_OPERATION_MODES.LIVE, ledger, sender: { sendMessage: async () => { sends++; } }, now: () => NOW, logger: { log() {}, error() {} } });
  const input = { accountId: 'fixture-account', routineDate: '2026-09-30', window: { start: '2026-09-30T09:30:00Z', end: '2026-09-30T16:30:00Z' } };
  const morning = plan('HOJE_MANHA', patient, [occurrence({ id: 'fixture-morning', time: '10:05' })]).reminders[0];
  const first = await service.processReminder({ ...input, reminder: morning, routine: 'HOJE_MANHA' });
  assert.equal(first.status, 'confirmed');
  const afternoon = plan('HOJE_TARDE').reminders[0];
  const second = await service.processPlan({ ...input, plan: { reminders: [afternoon] }, routine: 'HOJE_TARDE' });
  assert.equal(sends, 1);
  assert.equal(second[0].status, 'skipped');
  // The day-before modality remains independent and its existing retry ID stays terminal.
  const tomorrow = { ...afternoon, reminderType: 'AMANHA' };
  assert.equal((await service.processReminder({ ...input, reminder: tomorrow, routine: 'AMANHA' })).status, 'confirmed');
  await service.processReminder({ ...input, reminder: tomorrow, routine: 'AMANHA' });
  assert.equal(sends, 2);
});

test('retry reconsulta preferência; alteração ou erro de segurança bloqueiam envio', async () => {
  let p = patient; let sends = 0;
  const reminder = plan('HOJE_TARDE').reminders[0];
  const service = createReminderDeliveryService({ mode: WHATSAPP_OPERATION_MODES.LIVE, ledger: createMemoryReminderLedger(), sender: { sendMessage: async () => { sends++; p = { ...patient, whatsappReminderPreferences: { dayBefore: true, sameDay: false } }; throw new Error('Page.navigate timed out (fixture)'); } }, now: () => NOW, maxAttempts: 2, retryDelayMs: 0, logger: { log() {}, error() {} }, shouldBlockReminder: async ({ routine, phase }) => ({ blocked: isWhatsappAutomationBlocked(occurrence(), { patient: p, reminderType: routine, phase, now: NOW }) }) });
  const input = { accountId: 'fixture-account', reminder, routine: 'HOJE_TARDE', routineDate: '2026-09-30', window: { start: '2026-09-30T15:30:00Z', end: '2026-09-30T16:30:00Z' } };
  assert.equal((await service.processReminder(input)).status, 'skipped');
  assert.equal(sends, 1);
  const failedCheck = createReminderDeliveryService({ mode: WHATSAPP_OPERATION_MODES.LIVE, ledger: createMemoryReminderLedger(), sender: { sendMessage: async () => assert.fail('não envia') }, now: () => NOW, shouldBlockReminder: async () => { throw new Error('Rechecagem sintética indisponível'); } });
  await assert.rejects(() => failedCheck.processReminder(input), /Rechecagem sintética/);
});

test('janela vencida após expiração de silêncio não gera catch-up', () => {
  const ledger = createMemoryReminderLedger();
  const id = createRoutineCheckpointId({ dateStr: '2026-09-30', routine: 'HOJE_TARDE' });
  ledger.queueRoutine(id, { date: '2026-09-30', routine: 'HOJE_TARDE', expectedWindowStart: '2026-09-30T15:30:00Z', expectedWindowEnd: '2026-09-30T16:00:00Z' });
  assert.equal(ledger.expireOverdueQueuedRoutines(new Date('2026-09-30T18:00:00Z')).length, 1);
  assert.equal(ledger.getCheckpoint(id).status, 'expired');
  assert.equal(ledger.claimNextQueuedRoutine({ now: new Date('2026-09-30T18:00:00Z') }), null);
});

const completed = (count, type = 'Sessão simples (50 min)') => Array.from({ length: count }, (_, i) => occurrence({ id: `fixture-done-${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, status: 'Realizada', type }));
const payment = { id: 'fixture-payment-first', patientId: patient.id, packageNumber: 1, amount: 1000, date: '2026-09-01', status: 'active' };
test('pacote ativo, último consumo e renovação confirmada produzem alertas coerentes', () => {
  assert.equal(getPackageRenewalNotice(calculatePackageFinancialSummary(patient, completed(3), [payment], NOW)), '');
  const ended = calculatePackageFinancialSummary(patient, completed(SESSIONS_PER_PACKAGE), [payment], NOW);
  assert.match(getPackageRenewalNotice(ended), /Pacote encerrado/);
  const renewed = calculatePackageFinancialSummary(patient, completed(SESSIONS_PER_PACKAGE), [payment, { ...payment, id: 'fixture-renewed', packageNumber: 2 }], NOW);
  assert.equal(renewed.packageNumber, 2);
  assert.equal(getPackageRenewalNotice(renewed), '');
});

for (const type of ['Sessão simples (50 min)', 'Sessão dupla (2 × 50 min)']) {
  test(`quantidade canônica, renovação e retry sem gerar vinte sessões: ${type}`, () => {
    const sessions = completed(SESSIONS_PER_PACKAGE, type);
    const before = structuredClone(sessions);
    const summary = calculatePackageFinancialSummary(patient, sessions, [payment], NOW);
    assert.equal(summary.completedSessionsInCurrentPackage, SESSIONS_PER_PACKAGE);
    assert.equal(summary.remainingSessionsInCurrentPackage, 0);
    const options = { patient, sessions, payments: [payment], expenses: [], operationKey: 'fixture-renewal', actor: 'Equipe fictícia', now: NOW.toISOString(), input: { patientId: patient.id, packageNumber: 2, amount: 1000, date: '2026-09-30', installment: 'Pagamento integral', method: 'Pix' } };
    const prepared = preparePaymentCreation(options);
    const retry = preparePaymentCreation({ ...options, payments: prepared.payments, expenses: prepared.expenses });
    assert.equal(retry.idempotent, true);
    assert.equal(retry.payments.length, 2);
    assert.equal(retry.expenses.length, 1);
    assert.equal(calculatePackageFinancialSummary(patient, sessions, retry.payments, NOW).packageNumber, 2);
    assert.deepEqual(sessions, before);
    assert.equal(sessions.length, SESSIONS_PER_PACKAGE);
  });
}

test('ausência contabilizada conta uma vez, não contabilizada não consome', () => {
  assert.equal(sessionConsumesPackage(occurrence({ status: 'Falta', consumesPackage: true })), true);
  assert.equal(sessionConsumesPackage(occurrence({ status: 'Falta', consumesPackage: false })), false);
});

const missing = (changes = {}) => buildUnregisteredActivityGroups({ patients: [patient], sessions: [occurrence({ status: 'Realizada', date: '2026-09-10' })], monitoringStart: '2026-09-01', now: NOW, mediaReadComplete: true, isAlbumReadComplete: () => true, ...changes });
test('pendência derivada some com observação compartilhável da Galeria, sem escrita', () => {
  assert.equal(missing().length, 1);
  const album = { patientId: patient.id, packageNumber: 1, sessionIds: ['fixture-session'], url: '', status: 'active', visibleToGuardian: true, observation: 'Explicação fictícia compartilhável.' };
  assert.equal(missing({ googlePhotosAlbums: [album] }).length, 0);
  assert.equal(missing({ googlePhotosAlbums: [{ ...album, visibleToGuardian: false }] }).length, 1);
  assert.equal(missing({ googlePhotosAlbums: [{ ...album, status: 'hidden' }] }).length, 1);
  assert.equal(missing({ googlePhotosAlbums: [{ ...album, status: 'removed' }] }).length, 1);
});

test('não contabilizadas, canceladas e ausências completas não viram atividade pendente', () => {
  for (const changes of [{ status: 'Falta', consumesPackage: false }, { status: 'Cancelada' }, { removedFromAgenda: true }, { status: 'Agendada' }, { noReplacementReasonCode: 'other', noReplacementObservation: 'Fictício' }]) {
    assert.equal(missing({ sessions: [occurrence({ status: 'Realizada', date: '2026-09-10', ...changes })] }).length, 0);
  }
});

test('fonte ainda não carregada fica desconhecida, sem falsa pendência', () => {
  assert.equal(missing({ mediaReadComplete: false }).length, 0);
  assert.equal(missing({ isAlbumReadComplete: () => false }).length, 0);
});

test('rechecagem real do remetente falha fechada com registro removido, cancelamento ou leitura indisponível', async () => {
  // Evaluate only the read-only safety function, never the sender entrypoint.
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function resolveSessionAutomationBlock(');
  const end = source.indexOf('\nasync function processClaimedRoutine(', start);
  assert.ok(start >= 0 && end > start);
  for (const scenario of ['missing-session', 'cancelled', 'removed', 'missing-patient', 'inactive-patient', 'read-error', 'preferences-disabled', 'valid', 'virtual']) {
    let reads = 0;
    const check = vm.runInNewContext(`(${source.slice(start, end)})`, {
      Date, isWhatsappAutomationBlocked, SENDER_NAME: 'Fixture', console: { error() {} },
      db: { doc: docPath => ({ get: async () => {
        reads++;
        if (scenario === 'read-error') throw new Error('Leitura fictícia indisponível');
        const isPatient = docPath.includes('/patients/');
        const value = isPatient ? { ...patient, ...(scenario === 'inactive-patient' ? { status: 'Inativo' } : {}), ...(scenario === 'preferences-disabled' ? { whatsappReminderPreferences: { dayBefore: false, sameDay: false } } : {}) }
          : occurrence({ ...(scenario === 'cancelled' ? { status: 'Cancelada' } : {}), ...(scenario === 'removed' ? { removedFromAgenda: true } : {}) });
        return { exists: isPatient ? scenario !== 'missing-patient' : !['missing-session', 'virtual'].includes(scenario), id: value.id, data: () => value };
      } }), collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) },
    });
    const result = await check({ accountId: 'fixture-account', reminder: { id: 'fixture-session', patientId: patient.id, time: '15:40', isVirtual: scenario === 'virtual' }, routine: 'HOJE_TARDE', routineDate: '2026-09-30', phase: 'send' });
    assert.equal(result.blocked, !['valid', 'virtual'].includes(scenario), scenario);
    assert.ok(reads <= 2, 'a consulta extra só ocorre para sessão virtual');
    assert.equal((await check({ accountId: '', reminder: {}, routine: 'AMANHA' })).blocked, true);
  }
});
