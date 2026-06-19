import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  getSessionsForDate,
  getWhatsappReminderPlan,
} from '../src/lib/whatsappReminderPlan.js';
import { loadWhatsappReminderSuppressions } from '../src/lib/whatsappReminderSuppressionStore.js';

const suppressions = loadWhatsappReminderSuppressions(
  path.resolve('config', 'whatsapp-reminder-suppressions.example.json')
);
const settings = { holidays: [] };
const testPatient = {
  id: 'patient-test-01',
  name: 'Paciente Teste',
  guardianName: 'Responsável Teste',
  whatsapp: '27 99999-0000',
  status: 'Ativo',
  fixedDay: 'sexta',
  fixedTime: '14:00',
  fixedScheduleEffectiveFrom: '2026-01-01',
  doubleSession: true,
};
const testSession = {
  id: 'session-test-01',
  patientId: testPatient.id,
  date: '2026-06-12',
  time: '14:00',
  status: 'Agendada',
  type: 'Sessão simples (50 min)',
};

function assertSingleDoubleSessionReminder(
  plan: ReturnType<typeof getWhatsappReminderPlan>,
  expectedMainSessionId: string
) {
  assert.equal(plan.reminders.length, 1);
  assert.equal(plan.reminders[0]?.id, expectedMainSessionId);
  assert.equal(plan.reminders[0]?.time, '14:00');

  const secondHour = plan.diagnostics.find(item => item.time === '15:00');
  assert.ok(secondHour);
  assert.equal(secondHour.blockedReason, 'conflito/deduplicação (Dupla)');
  assert.equal('isSuppressed' in secondHour, false);
  assert.equal('suppressionId' in secondHour, false);
}

test('cenário A: bloqueia somente a véspera fictícia já enviada manualmente', () => {
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-11',
    tipo: 'AMANHA',
    patients: [testPatient],
    sessions: [testSession],
    settings,
    suppressions,
  });
  assert.equal(plan.reminders.length, 0);
  assert.ok(plan.diagnostics.some(item =>
    item.id === testSession.id &&
    item.suppressionId === 'patient-test-2026-06-12-manual-message' &&
    item.isSuppressed &&
    item.blockedReason === 'Mensagem fictícia registrada como enviada manualmente. Não reenviar.'
  ));
});

test('cenário 1: 12/06 às 12:30 gera uma mensagem às 14h e deduplica 15h', () => {
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-12',
    tipo: 'HOJE_TARDE',
    patients: [testPatient],
    sessions: [testSession],
    settings,
    suppressions,
  });
  assertSingleDoubleSessionReminder(plan, testSession.id);
  assert.ok(!plan.diagnostics.some(item => item.isSuppressed));
});

test('véspera fictícia mantém 15h bloqueada somente por deduplicação', () => {
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-11',
    tipo: 'AMANHA',
    patients: [testPatient],
    sessions: [testSession],
    settings,
    suppressions,
  });
  const secondHour = plan.diagnostics.find(item => item.time === '15:00');
  assert.ok(secondHour);
  assert.equal(secondHour?.blockedReason, 'conflito/deduplicação (Dupla)');
  assert.equal('isSuppressed' in secondHour, false);
  assert.equal('suppressionId' in secondHour, false);
});

test('cenário 2: véspera de 19/06 gera uma mensagem às 14h e deduplica 15h', () => {
  const futureSession = { ...testSession, id: 'session-test-19', date: '2026-06-19' };
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-18',
    tipo: 'AMANHA',
    patients: [testPatient],
    sessions: [futureSession],
    settings,
    suppressions,
  });
  assertSingleDoubleSessionReminder(plan, futureSession.id);
  assert.ok(!plan.diagnostics.some(item => item.isSuppressed));
});

test('cenário 3: 19/06 às 12:30 gera uma mensagem às 14h e deduplica 15h', () => {
  const futureSession = { ...testSession, id: 'session-test-19', date: '2026-06-19' };
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-19',
    tipo: 'HOJE_TARDE',
    patients: [testPatient],
    sessions: [futureSession],
    settings,
    suppressions,
  });
  assertSingleDoubleSessionReminder(plan, futureSession.id);
  assert.ok(!plan.diagnostics.some(item => item.isSuppressed));
});

test('Falta, Realizada e Cancelada nunca geram lembrete', () => {
  for (const status of ['Falta', 'Realizada', 'Cancelada']) {
    const plan = getWhatsappReminderPlan({
      runDateStr: '2026-06-11',
      tipo: 'AMANHA',
      patients: [{ ...testPatient, id: `patient-${status}`, doubleSession: false }],
      sessions: [{
        ...testSession,
        id: `session-${status}`,
        patientId: `patient-${status}`,
        status,
      }],
      settings,
    });
    assert.equal(plan.reminders.length, 0);
  }
});

test('paciente inativo e telefone ausente são bloqueados', () => {
  const inactive = { ...testPatient, id: 'inactive', status: 'Inativo', doubleSession: false };
  const noPhone = { ...testPatient, id: 'no-phone', whatsapp: '', doubleSession: false };
  const sessions = [
    { ...testSession, id: 'inactive-session', patientId: inactive.id },
    { ...testSession, id: 'no-phone-session', patientId: noPhone.id },
  ];
  const daySessions = getSessionsForDate({
    dateStr: '2026-06-12',
    patients: [inactive, noPhone],
    sessions,
    settings,
  });
  assert.equal(daySessions.find(item => item.id === 'inactive-session')?.blockedReason, 'paciente inativo');
  assert.equal(daySessions.find(item => item.id === 'no-phone-session')?.blockedReason, 'paciente sem WhatsApp');
});

test('sessão de sábado e cálculo de amanhã permanecem na data local correta', () => {
  const saturdayPatient = {
    ...testPatient,
    id: 'patient-test-saturday',
    name: 'Paciente Sábado',
    fixedDay: 'sábado',
    fixedTime: '08:00',
    doubleSession: false,
  };
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-19',
    tipo: 'AMANHA',
    patients: [saturdayPatient],
    sessions: [],
    settings,
  });
  assert.equal(plan.dateStr, '2026-06-20');
  assert.equal(plan.reminders[0]?.time, '08:00');
});

test('arquivo de supressões ausente falha fechado', () => {
  assert.throws(
    () => loadWhatsappReminderSuppressions(path.resolve('config', 'arquivo-inexistente.json')),
    /Arquivo obrigatório/
  );
});
