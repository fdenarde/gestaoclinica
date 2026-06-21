import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ecosystem from '../ecosystem.config.cjs';
import {
  ADMIN_REPORT_PHONE_ENV,
  buildExecutionReportMessage,
  buildPreventiveAlertMessage,
  createExecutionAudit,
  finishExecutionAudit,
  getAdminReportConfig,
  getExecutionFinalStatus,
  registerPlanDiagnostics,
  registerSendFailure,
  registerSuccessfulSend,
  summarizePlans,
} from '../src/lib/whatsappAdminMonitor.js';
import { normalizeBrazilianWhatsappPhone } from '../src/lib/whatsappPhone.js';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';

const root = path.resolve('.');

const baseReminder = {
  id: 'nicolas-0700',
  patientId: 'nicolas',
  patientName: 'Nicolas',
  guardianName: 'Leila',
  responsibleName: 'Leila',
  responsibleRelationship: 'Mãe',
  whatsapp: '27 99639-5476',
  phone: '5527996395476@c.us',
  phoneMasked: '***5476',
  time: '07:00',
  type: 'Sessão simples (50 min)',
};

const blockedDiagnostic = {
  id: 'celso-1500',
  patientName: 'Celso',
  guardianName: 'Debriane',
  responsibleName: 'Debriane',
  responsibleRelationship: 'não informado',
  phoneMasked: '***3352',
  time: '15:00',
  blockedReason: 'conflito/deduplicação (Dupla)',
};

function makeContexts(reminders = [baseReminder], diagnostics = [blockedDiagnostic]) {
  return [{
    userId: 'account-a',
    plan: {
      dateStr: '2026-06-20',
      reminders,
      diagnostics,
    },
  }];
}

test('configuração administrativa central normaliza o número autorizado sem duplicar 55', () => {
  const config = getAdminReportConfig({ [ADMIN_REPORT_PHONE_ENV]: '27999072659' });
  assert.equal(config.phone, '5527999072659@c.us');
  assert.equal(config.phoneMasked, '***2659');
  assert.equal(config.phoneMaskedDisplay, '(27) *****-2659');
  assert.equal(normalizeBrazilianWhatsappPhone('55 27 99907-2659').digits, '5527999072659');
});

test('configuração administrativa ausente bloqueia somente relatório administrativo', () => {
  assert.throws(() => getAdminReportConfig({}), /WHATSAPP_ADMIN_REPORT_PHONE/);
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-20',
    tipo: 'HOJE_MANHA',
    patients: [{
      id: 'nicolas',
      name: 'Nicolas',
      guardianName: 'Leila',
      motherName: 'Leila',
      whatsapp: '27 99639-5476',
      status: 'Ativo',
      fixedDay: 'sábado',
      fixedTime: '07:00',
      fixedScheduleEffectiveFrom: '2026-01-01',
    }],
    sessions: [],
    settings: { holidays: [] },
  });
  assert.equal(plan.reminders[0]?.phone, '5527996395476@c.us');
});

test('telefone administrativo fica somente no sender e não substitui responsáveis', () => {
  const sender = ecosystem.apps.find(app => app.name === 'RoboClinica');
  const scheduler = ecosystem.apps.find(app => app.name === 'RoboClinicaScheduler');
  const watchdog = ecosystem.apps.find(app => app.name === 'RoboClinicaWatchdog');
  assert.equal(sender.env.WHATSAPP_ADMIN_REPORT_PHONE, '27999072659');
  assert.equal('WHATSAPP_ADMIN_REPORT_PHONE' in scheduler.env, false);
  assert.equal('WHATSAPP_ADMIN_REPORT_PHONE' in watchdog.env, false);

  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-20',
    tipo: 'HOJE_MANHA',
    patients: [{
      id: 'luiza',
      name: 'Luiza',
      guardianName: 'Josi',
      motherName: 'Josi',
      fatherName: 'Pai Fixture',
      fatherPhone: '27 99999-1111',
      whatsapp: '27 98900-0374',
      status: 'Ativo',
      fixedDay: 'sábado',
      fixedTime: '08:00',
      fixedScheduleEffectiveFrom: '2026-01-01',
    }],
    sessions: [],
    settings: { holidays: [] },
  });
  assert.equal(plan.reminders[0]?.phone, '5527989000374@c.us');
  assert.equal(plan.reminders[0]?.phoneMasked, '***0374');
  assert.equal(plan.reminders[0]?.responsibleRelationship, 'Mãe');
});

test('prévia lista destinatários e bloqueios sem telefone completo', () => {
  const message = buildPreventiveAlertMessage({
    tipo: 'HOJE_MANHA',
    scheduledAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts(),
  });
  assert.match(message, /PRÉVIA DE ENVIO/);
  assert.match(message, /Atendente: Nicolas/);
  assert.match(message, /Responsável: Leila/);
  assert.match(message, /Vínculo: Mãe/);
  assert.match(message, /WhatsApp: final 5476/);
  assert.match(message, /Sessão: 07h00/);
  assert.match(message, /Celso — conflito\/deduplicação/);
  assert.doesNotMatch(message, /27999072659|27996395476|5527996395476/);
});

test('relatório final confirma somente itens registrados após sendMessage e ledger', () => {
  const audit = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts(),
  });
  registerPlanDiagnostics(audit, makeContexts()[0].plan);
  finishExecutionAudit(audit, new Date('2026-06-20T06:30:12-03:00'));
  assert.equal(getExecutionFinalStatus(audit), '🟡 ATENÇÃO');
  assert.match(buildExecutionReportMessage(audit), /Confirmações pendentes: 1/);

  const confirmed = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts(),
  });
  registerPlanDiagnostics(confirmed, makeContexts()[0].plan);
  registerSuccessfulSend(confirmed, baseReminder, { confirmedAt: '2026-06-20T09:30:01.000Z' });
  finishExecutionAudit(confirmed, new Date('2026-06-20T06:30:12-03:00'));
  const report = buildExecutionReportMessage(confirmed);
  assert.equal(getExecutionFinalStatus(confirmed), '🟢 SUCESSO');
  assert.match(report, /Enviada e confirmada/);
  assert.match(report, /Não enviadas por regra: 1/);
  assert.doesNotMatch(report, /Ignoradas|Bloqueadas|27996395476/);
});

test('bloqueios previstos não geram atenção, pendência gera atenção e falha real gera falha', () => {
  const ruleOnly = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts([], [blockedDiagnostic]),
  });
  registerPlanDiagnostics(ruleOnly, makeContexts([], [blockedDiagnostic])[0].plan);
  finishExecutionAudit(ruleOnly);
  assert.equal(getExecutionFinalStatus(ruleOnly), '🟢 SUCESSO');

  const pending = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts([baseReminder], []),
  });
  finishExecutionAudit(pending);
  assert.equal(getExecutionFinalStatus(pending), '🟡 ATENÇÃO');

  const failed = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts([baseReminder], []),
  });
  registerSendFailure(failed, baseReminder, new Error('WhatsApp desconectado'));
  finishExecutionAudit(failed);
  assert.equal(getExecutionFinalStatus(failed), '🔴 FALHA');
});

test('rotina sem destinatários gera relatório curto e sem contagem duplicada', () => {
  const audit = createExecutionAudit({
    tipo: 'AMANHA',
    startedAt: new Date('2026-06-20T09:00:00-03:00'),
    planContexts: makeContexts([], []),
  });
  finishExecutionAudit(audit);
  const report = buildExecutionReportMessage(audit);
  assert.match(report, /ROTINA CONCLUÍDA/);
  assert.match(report, /Nenhuma mensagem precisava ser enviada/);
  assert.doesNotMatch(report, /RESUMO|Ignoradas|Bloqueadas/);

  assert.deepEqual(summarizePlans(makeContexts([], [blockedDiagnostic])), {
    planned: 0,
    ruleSkipped: 1,
    incomplete: 0,
  });
});

test('sessão dupla gera um destinatário e preserva regra específica do Celso', () => {
  const celso = {
    id: 'patient-test-01',
    name: 'Celso',
    guardianName: 'Debriane',
    whatsapp: '27 99868-3352',
    status: 'Ativo',
    fixedDay: 'sexta',
    fixedTime: '14:00',
    fixedScheduleEffectiveFrom: '2026-01-01',
    doubleSession: true,
  };
  const session = {
    id: 'session-test-19',
    patientId: celso.id,
    date: '2026-06-19',
    time: '14:00',
    status: 'Agendada',
    type: 'Sessão simples (50 min)',
  };
  const plan = getWhatsappReminderPlan({
    runDateStr: '2026-06-19',
    tipo: 'HOJE_TARDE',
    patients: [celso],
    sessions: [session],
    settings: { holidays: [] },
    suppressions: [],
  });
  assert.equal(plan.reminders.length, 1);
  assert.equal(plan.reminders[0].time, '14:00');
  assert.equal(plan.diagnostics.filter(item => item.time === '15:00').length, 1);
  assert.equal(plan.diagnostics.find(item => item.time === '15:00')?.blockedReason, 'conflito/deduplicação (Dupla)');
});

test('scheduler e watchdog continuam sem WhatsApp real ou envio', () => {
  const scheduler = fs.readFileSync(path.join(root, 'scripts', 'whatsapp-reminder-scheduler.js'), 'utf8');
  const watchdog = fs.readFileSync(path.join(root, 'scripts', 'whatsapp-reminder-watchdog.js'), 'utf8');
  const sender = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.doesNotMatch(scheduler, /whatsapp-web\.js|sendMessage|Client\(|LocalAuth/);
  assert.doesNotMatch(watchdog, /whatsapp-web\.js|sendMessage|Client\(|LocalAuth/);
  assert.match(sender, /sendMessage/);
});

test('ativador valida configuração nova e bloqueia referência administrativa antiga ativa', () => {
  const activator = fs.readFileSync(path.join(root, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  const adminMonitor = fs.readFileSync(path.join(root, 'src', 'lib', 'whatsappAdminMonitor.js'), 'utf8');
  assert.match(activator, /Assert-AdminReportConfig/);
  assert.match(activator, /WHATSAPP_ADMIN_REPORT_PHONE/);
  assert.doesNotMatch(adminMonitor, /98114|0948|WHATSAPP_ADMIN_MONITOR_PHONE/);
});
