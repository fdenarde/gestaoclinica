import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ecosystem from '../ecosystem.config.cjs';
import {
  ADMIN_REPORT_PHONE_ENV,
  buildExecutionReportMessage,
  buildPlanSnapshot,
  buildPreventiveAlertMessage,
  comparePlanSnapshots,
  createExecutionAudit,
  finishExecutionAudit,
  getAdminReportConfig,
  getExecutionFinalStatus,
  registerAgendaChanges,
  registerPlanDiagnostics,
  registerSendFailure,
  registerSuccessfulSend,
  summarizePlans,
} from '../src/lib/whatsappAdminMonitor.js';
import { normalizeBrazilianWhatsappPhone } from '../src/lib/whatsappPhone.js';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import { ROUTINE_DEFINITIONS } from '../src/lib/whatsappReminderOperations.js';

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

const invalidPhoneDiagnostic = {
  id: 'alicia-1600',
  patientName: 'Alicia',
  guardianName: 'Alexandre',
  responsibleName: 'Alexandre',
  phoneMasked: '(sem telefone)',
  time: '16:00',
  blockedReason: 'responsável sem WhatsApp válido',
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

test('prévia existe somente quando há mensagem programada e expõe apenas dados permitidos', () => {
  const message = buildPreventiveAlertMessage({
    tipo: 'HOJE_MANHA',
    scheduledAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts(),
  });

  assert.match(message, /PRÉVIA/);
  assert.match(message, /Atendente: Nicolas/);
  assert.match(message, /Responsável: Leila/);
  assert.match(message, /WhatsApp: final 5476/);
  assert.match(message, /20\/06\/2026 às 07h00/);
  assert.doesNotMatch(message, /Vínculo|Tipo: lembrete|Celso|27999072659|27996395476|5527996395476/);
});

test('prévia vazia produz silêncio operacional', () => {
  const message = buildPreventiveAlertMessage({
    tipo: 'AMANHA',
    scheduledAt: new Date('2026-06-20T09:00:00-03:00'),
    planContexts: makeContexts([], []),
  });
  assert.equal(message, '');
});

test('envio técnico concluído aparece somente como Enviada', () => {
  const audit = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts(),
  });

  registerPlanDiagnostics(audit, makeContexts()[0].plan);
  registerSuccessfulSend(audit, baseReminder, { confirmedAt: '2026-06-20T09:30:01.000Z' });
  finishExecutionAudit(audit, new Date('2026-06-20T06:30:12-03:00'));

  const report = buildExecutionReportMessage(audit);
  assert.equal(getExecutionFinalStatus(audit), '🟢 NORMAL');
  assert.match(report, /Enviadas: 1/);
  assert.match(report, /Resultado: ✅ Enviada/);
  assert.doesNotMatch(report, /confirmad|pendente|respondeu|entregue|lida/i);
});

test('deduplicação normal e sessão fora do turno não geram atenção nem relatório isolado', () => {
  const ruleOnly = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts([], [
      blockedDiagnostic,
      { ...blockedDiagnostic, id: 'afternoon', blockedReason: 'fora do turno (Sessão da tarde)' },
    ]),
  });

  registerPlanDiagnostics(ruleOnly, ruleOnly.planContexts[0].plan);
  finishExecutionAudit(ruleOnly);

  assert.equal(getExecutionFinalStatus(ruleOnly), '🟢 NORMAL');
  assert.equal(buildExecutionReportMessage(ruleOnly), '');
  assert.deepEqual(summarizePlans(ruleOnly.planContexts, 'HOJE_MANHA'), {
    planned: 0,
    ruleSkipped: 0,
    incomplete: 0,
  });
});

test('telefone ausente ou inválido gera uma única pendência de cadastro', () => {
  const audit = createExecutionAudit({
    tipo: 'HOJE_TARDE',
    startedAt: new Date('2026-06-20T12:30:00-03:00'),
    planContexts: makeContexts([], [invalidPhoneDiagnostic]),
  });

  registerPlanDiagnostics(audit, audit.planContexts[0].plan);
  finishExecutionAudit(audit);

  const report = buildExecutionReportMessage(audit);
  assert.equal(getExecutionFinalStatus(audit), '🟡 ATENÇÃO');
  assert.match(report, /Pendências de cadastro: 1/);
  assert.match(report, /Alicia/);
  assert.match(report, /Alexandre/);
  assert.match(report, /telefone|WhatsApp válido/i);
  assert.doesNotMatch(report, /Confirmação pendente|Confirmações pendentes/);
});

test('falha técnica real gera status de falha', () => {
  const audit = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts([baseReminder], []),
  });

  registerSendFailure(audit, baseReminder, new Error('WhatsApp desconectado'));
  finishExecutionAudit(audit);

  assert.equal(getExecutionFinalStatus(audit), '🔴 FALHA');
  assert.match(buildExecutionReportMessage(audit), /Falha no envio|WhatsApp desconectado/);
});

test('rotina totalmente vazia não cria relatório de conclusão', () => {
  const audit = createExecutionAudit({
    tipo: 'AMANHA',
    startedAt: new Date('2026-06-20T09:00:00-03:00'),
    planContexts: makeContexts([], []),
  });

  finishExecutionAudit(audit);
  const report = buildExecutionReportMessage(audit);

  assert.equal(report, '');
  assert.doesNotMatch(report, /ROTINA CONCLUÍDA|Nenhuma mensagem precisava ser enviada|Funcionamento normal/);
});

test('prévias ficam exatamente quinze minutos antes das execuções', () => {
  assert.equal(ROUTINE_DEFINITIONS.HOJE_MANHA.scheduledTime, '06:30');
  assert.equal(ROUTINE_DEFINITIONS.HOJE_MANHA.preventiveTime, '06:15');
  assert.equal(ROUTINE_DEFINITIONS.AMANHA.scheduledTime, '09:00');
  assert.equal(ROUTINE_DEFINITIONS.AMANHA.preventiveTime, '08:45');
  assert.equal(ROUTINE_DEFINITIONS.HOJE_TARDE.scheduledTime, '12:30');
  assert.equal(ROUTINE_DEFINITIONS.HOJE_TARDE.preventiveTime, '12:15');
});

test('sessão dupla gera um destinatário e preserva a deduplicação da segunda hora', () => {
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

test('ativador preserva o destinatário administrativo correto', () => {
  const activator = fs.readFileSync(path.join(root, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  const adminMonitor = fs.readFileSync(path.join(root, 'src', 'lib', 'whatsappAdminMonitor.js'), 'utf8');

  assert.match(activator, /Assert-AdminReportConfig/);
  assert.match(activator, /WHATSAPP_ADMIN_REPORT_PHONE/);
  assert.doesNotMatch(adminMonitor, /98114|0948|WHATSAPP_ADMIN_MONITOR_PHONE/);
});

test('snapshot sanitizado detecta cancelamento, reagendamento, contato alterado e nova elegibilidade', () => {
  const preview = buildPlanSnapshot({
    tipo: 'HOJE_MANHA',
    capturedAt: new Date('2026-06-20T09:15:00.000Z'),
    planContexts: makeContexts([
      baseReminder,
      { ...baseReminder, id: 'bia-0800', patientId: 'bia', patientName: 'Bia', time: '08:00', phoneMasked: '***1111' },
      { ...baseReminder, id: 'caio-0900', patientId: 'caio', patientName: 'Caio', time: '09:00', phone: '5527991112222@c.us', phoneMasked: '***2222' },
    ], []),
  });

  const execution = buildPlanSnapshot({
    tipo: 'HOJE_MANHA',
    capturedAt: new Date('2026-06-20T09:30:00.000Z'),
    planContexts: makeContexts([
      { ...baseReminder, id: 'bia-0800', patientId: 'bia', patientName: 'Bia', time: '08:30', phoneMasked: '***1111' },
      { ...baseReminder, id: 'caio-0900', patientId: 'caio', patientName: 'Caio', time: '09:00', phone: '5527988882222@c.us', phoneMasked: '***2222' },
      { ...baseReminder, id: 'duda-1000', patientId: 'duda', patientName: 'Duda', time: '10:00', phoneMasked: '***3333' },
    ], [
      { ...baseReminder, blockedReason: 'sessão cancelada depois da prévia' },
    ]),
  });

  const changes = comparePlanSnapshots(preview, execution);
  assert.ok(changes.some(item => item.patientFirstName === 'Nicolas' && item.changeCode === 'cancelled'));
  assert.ok(changes.some(item => item.patientFirstName === 'Bia' && item.changeCode === 'rescheduled'));
  assert.ok(changes.some(item => item.patientFirstName === 'Caio' && item.changeCode === 'contact-changed'));
  assert.ok(changes.some(item => item.patientFirstName === 'Duda' && item.changeCode === 'added'));

  const encoded = JSON.stringify(preview);
  assert.doesNotMatch(encoded, /5527996395476|27996395476|account-a|nicolas-0700/);
});

test('alterações posteriores à prévia aparecem em seção própria sem duplicar envio e não envio', () => {
  const audit = createExecutionAudit({
    tipo: 'HOJE_MANHA',
    startedAt: new Date('2026-06-20T06:30:00-03:00'),
    planContexts: makeContexts([baseReminder], []),
  });

  registerSuccessfulSend(audit, baseReminder, { sentAt: '2026-06-20T09:30:01.000Z' });
  registerAgendaChanges(audit, [{
    key: 'snapshot-fixture',
    patientFirstName: 'Nicolas',
    responsibleFirstName: 'Leila',
    phoneLast4: '5476',
    previousSessionDate: '2026-06-20',
    previousSessionTime: '07:00',
    sessionDate: '2026-06-20',
    sessionTime: '07:30',
    changeCode: 'rescheduled',
    changeLabel: 'Sessão reagendada depois da prévia.',
  }]);
  finishExecutionAudit(audit);

  const report = buildExecutionReportMessage(audit);
  assert.match(report, /ALTERAÇÕES NA AGENDA/);
  assert.match(report, /Alterações na agenda: 1/);
  assert.match(report, /Sessão reagendada depois da prévia/);
  assert.match(report, /Resultado: ✅ Enviada/);
  assert.doesNotMatch(report, /snapshot-fixture/);
});
