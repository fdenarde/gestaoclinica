import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsappSilenceUntil,
  getWhatsappSilenceLocalValue,
  getWhatsappSilenceState,
  isWhatsappAutomationBlocked,
  isWhatsappSilenceActive,
  saoPauloLocalDateTimeToIso,
} from '../shared/whatsappSessionAutomation.js';
import {
  findSessionConflict,
  getSessionInterval,
  normalizeAgendaTime,
  rescheduleSessionInAgenda,
} from '../shared/sessionScheduling.js';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import {
  createMemoryReminderLedger,
  createRoutineWindow,
} from '../src/lib/whatsappReminderOperations.js';

const SYNTHETIC_PHONE = '27 90000-0000';

function session(id, time, overrides = {}) {
  return {
    id,
    patientId: overrides.patientId || 'patient-a',
    date: overrides.date || '2026-09-08',
    time,
    type: overrides.type || 'Sessão simples (50 min)',
    status: overrides.status || 'Agendada',
    packageNumber: overrides.packageNumber ?? null,
    ...overrides,
  };
}

function patient(id, overrides = {}) {
  return {
    id,
    name: `Atendente Sintético ${id}`,
    guardianName: 'Responsável Sintético',
    whatsapp: SYNTHETIC_PHONE,
    status: 'Ativo',
    fixedDay: '',
    fixedTime: '',
    startDate: '2026-01-01',
    ...overrides,
  };
}

function silence(scope = 'session', until = '') {
  return {
    version: 1,
    blockAll: true,
    blockedReminderTypes: [],
    scope,
    startsAt: '2026-09-08T12:00:00.000Z',
    ...(until ? { silenceUntil: until } : {}),
    reasonCode: 'ajuste_administrativo',
    updatedAt: '2026-09-08T12:00:00.000Z',
    updatedBy: 'Administrador Sintético',
    updatedByRole: 'admin',
  };
}

test('silêncio legado ausente mantém WhatsApp ativo', () => {
  assert.equal(isWhatsappAutomationBlocked(session('legacy', '16:40'), { patient: patient('a'), reminderType: 'HOJE_TARDE', now: new Date('2026-09-08T15:00:00Z') }), false);
});

test('silêncio de sessão bloqueia apenas a sessão selecionada', () => {
  const selected = session('selected', '16:40', { whatsappAutomationControl: silence() });
  const other = session('other', '17:17');
  const now = new Date('2026-09-08T15:00:00Z');
  assert.equal(isWhatsappAutomationBlocked(selected, { patient: patient('a'), reminderType: 'AMANHA', now }), true);
  assert.equal(isWhatsappAutomationBlocked(other, { patient: patient('a'), reminderType: 'AMANHA', now }), false);
  assert.equal(selected.status, 'Agendada');
});

test('silêncio global do atendente bloqueia suas sessões e preserva outro atendente', () => {
  const blockedPatient = patient('a', { whatsappAutomationControl: silence('patient') });
  const otherPatient = patient('b');
  const now = new Date('2026-09-08T15:00:00Z');
  assert.equal(isWhatsappAutomationBlocked(session('a-1', '16:40'), { patient: blockedPatient, reminderType: 'HOJE_TARDE', now }), true);
  assert.equal(isWhatsappAutomationBlocked(session('b-1', '16:40', { patientId: 'b' }), { patient: otherPatient, reminderType: 'HOJE_TARDE', now }), false);
});

test('expiração derivada desbloqueia automaticamente e não depende de cron', () => {
  const control = silence('patient', '2026-09-08T16:00:00.000Z');
  assert.equal(isWhatsappSilenceActive(control, new Date('2026-09-08T15:59:59Z')), true);
  assert.equal(isWhatsappSilenceActive(control, new Date('2026-09-08T16:00:00Z')), false);
  assert.equal(getWhatsappSilenceState(null, { whatsappAutomationControl: control }, new Date('2026-09-08T16:00:00Z')).active, false);
});

test('desbloqueio manual reativa sessão e atendente sem tocar dados clínicos', () => {
  const now = new Date('2026-09-08T15:00:00.000Z');
  const blockedSession = session('manual-session', '16:40', {
    status: 'Agendada',
    packageNumber: 7,
    notes: 'Nota clínica sintética',
    presence: 'pendente',
    whatsappAutomationControl: silence('session'),
  });
  assert.equal(isWhatsappAutomationBlocked(blockedSession, { reminderType: 'HOJE_TARDE', now }), true);
  assert.equal(isWhatsappAutomationBlocked({ ...blockedSession, whatsappAutomationControl: undefined }, { reminderType: 'HOJE_TARDE', now }), false);
  assert.equal(blockedSession.status, 'Agendada');
  assert.equal(blockedSession.packageNumber, 7);
  assert.equal(blockedSession.notes, 'Nota clínica sintética');
  assert.equal(blockedSession.presence, 'pendente');

  const blockedPatient = patient('a', { whatsappAutomationControl: silence('patient') });
  assert.equal(isWhatsappAutomationBlocked(session('global-session', '17:05', { patientId: 'a' }), { patient: blockedPatient, reminderType: 'HOJE_TARDE', now }), true);
  assert.equal(isWhatsappAutomationBlocked(session('global-session', '17:05', { patientId: 'a' }), { patient: { ...blockedPatient, whatsappAutomationControl: undefined }, reminderType: 'HOJE_TARDE', now }), false);
});

test('motivo é metadado administrativo e não muda elegibilidade', () => {
  const now = new Date('2026-09-08T15:00:00.000Z');
  const base = session('reason-session', '17:05');
  const withReason = { ...base, whatsappAutomationControl: { ...silence(), reasonCode: 'feriado', reasonText: 'Recesso sintético' } };
  const withoutReason = { ...base, whatsappAutomationControl: { ...silence(), reasonCode: '', reasonText: '' } };
  assert.equal(isWhatsappAutomationBlocked(withReason, { reminderType: 'AMANHA', now }), true);
  assert.equal(isWhatsappAutomationBlocked(withoutReason, { reminderType: 'AMANHA', now }), true);
});

test('duração e data/hora usam America/Sao_Paulo sem deslocar o horário visual', () => {
  const iso = saoPauloLocalDateTimeToIso('2026-09-08T16:40');
  assert.equal(iso, '2026-09-08T19:40:00.000Z');
  assert.equal(getWhatsappSilenceLocalValue(iso), '2026-09-08T16:40');
  assert.equal(getWhatsappSilenceLocalValue(buildWhatsappSilenceUntil({ duration: 'custom', customUntil: '2026-09-08T17:17' })), '2026-09-08T17:17');
});

test('lembretes da véspera e do próprio dia são suprimidos sem envio retroativo', () => {
  const blocked = patient('a', { whatsappAutomationControl: silence('patient') });
  const active = patient('b');
  const sessions = [
    session('a-tomorrow', '16:40', { patientId: 'a', date: '2026-09-09' }),
    session('b-today', '17:17', { patientId: 'b', date: '2026-09-08' }),
  ];
  const tomorrow = getWhatsappReminderPlan({
    runDateStr: '2026-09-08',
    tipo: 'AMANHA',
    patients: [blocked, active],
    sessions,
    settings: { holidays: [] },
    now: new Date('2026-09-08T15:00:00.000Z'),
  });
  assert.equal(tomorrow.reminders.some(item => item.patientId === 'a'), false);
  assert.match(tomorrow.diagnostics.find(item => item.id === 'a-tomorrow')?.blockedReason || '', /WhatsApp|silenci|bloquead/i);

  const today = getWhatsappReminderPlan({
    runDateStr: '2026-09-08',
    tipo: 'HOJE_TARDE',
    patients: [blocked, active],
    sessions,
    settings: { holidays: [] },
    now: new Date('2026-09-08T15:00:00.000Z'),
  });
  assert.equal(today.reminders.find(item => item.patientId === 'b')?.time, '17:17');

  const ledger = createMemoryReminderLedger();
  const window = createRoutineWindow({ dateStr: '2026-09-08', routine: 'HOJE_TARDE' });
  ledger.queueRoutine('2026-09-08:HOJE_TARDE:all', {
    date: '2026-09-08',
    routine: 'HOJE_TARDE',
    scheduledTime: window.scheduledTime,
    expectedWindowStart: window.start,
    expectedWindowEnd: window.end,
  });
  const expired = ledger.expireOverdueQueuedRoutines(new Date('2026-09-08T18:00:00.000Z'));
  assert.equal(expired[0]?.blockedReason, 'janela segura encerrada; envio retroativo bloqueado');
  assert.equal(ledger.claimNextQueuedRoutine({ now: new Date('2026-09-09T12:00:00.000Z') }), null);
});

test('mensagem preserva minuto livre exatamente', () => {
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-09-08',
    tipo: 'HOJE_TARDE',
    patients: [patient('a')],
    sessions: [session('minute-1640', '16:40', { patientId: 'a' })],
    settings: { holidays: [] },
    now: new Date('2026-09-08T15:00:00.000Z'),
  });
  assert.equal(plan.reminders[0].time, '16:40');
  assert.match(plan.reminders[0].message, /16:40/);
  assert.doesNotMatch(plan.reminders[0].message, /16:00/);
});

test('conflito considera intervalo [início, término) e duração da modalidade', () => {
  const adjacent = session('adjacent', '17:00');
  assert.deepEqual(getSessionInterval(session('first', '16:10')), { start: 970, end: 1020 });
  assert.equal(findSessionConflict([session('first', '16:10')], adjacent), null);
  assert.equal(findSessionConflict([session('first', '16:10')], session('overlap', '16:40'))?.id, 'first');
  assert.equal(findSessionConflict([session('double', '16:10', { type: 'Sessão dupla (2 × 50 min)' })], adjacent)?.id, 'double');
});

test('minuto não múltiplo de cinco, edição e reagendamento preservam HH:mm', () => {
  assert.equal(normalizeAgendaTime('7:05'), '07:05');
  for (const time of ['16:30', '16:40', '16:50', '17:05', '17:17']) {
    assert.equal(normalizeAgendaTime(time), time);
  }
  const original = session('reschedule', '16:40', { notes: 'Nota sintética', packageNumber: 4 });
  const result = rescheduleSessionInAgenda([original], original, {
    newDate: '2026-09-09',
    newTime: '17:17',
    rescheduledAt: '2026-09-08T12:00:00.000Z',
    rescheduledBy: 'Administrador Sintético',
  });
  assert.equal(result.session.time, '17:17');
  assert.equal(result.session.rescheduleHistory[0].previousTime, '16:40');
  assert.equal(result.session.rescheduleHistory[0].newTime, '17:17');
  assert.equal(result.session.notes, 'Nota sintética');
});

test('conflito ignora a própria sessão durante o reagendamento', () => {
  const current = session('same', '16:40');
  assert.equal(findSessionConflict([current], { ...current, time: '17:17' }, { ignoreSessionId: current.id }), null);
  assert.equal(findSessionConflict([session('other', '17:00')], { ...current, time: '17:17' })?.id, 'other');
});
