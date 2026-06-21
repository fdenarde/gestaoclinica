import { maskBrazilianPhone, maskPhoneShort, normalizeBrazilianWhatsappPhone } from './whatsappPhone.js';

export const ADMIN_REPORT_PHONE_ENV = 'WHATSAPP_ADMIN_REPORT_PHONE';
export const DEFAULT_ADMIN_MONITOR = Object.freeze({
  name: 'Fabio Luiz Silva Denarde',
});

export const ADMIN_RESULT_CATEGORIES = Object.freeze({
  CONFIRMED: '✅ Enviada e confirmada',
  RULE_SKIPPED: '🟡 Não enviada por regra',
  NOT_NEEDED: '⚪ Sem mensagem necessária',
  SEND_FAILED: '🔴 Falha no envio',
  ROUTINE_NOT_RUN: '🔴 Rotina não executada',
  PENDING_CONFIRMATION: '🟠 Confirmação pendente',
  INCOMPLETE_REGISTRATION: '🟠 Cadastro incompleto',
});

export function isAdminMonitoringEnabled(env = process.env) {
  return env.WHATSAPP_ADMIN_MONITORING !== 'NAO';
}

export function isDetailedReportEnabled(env = process.env) {
  return env.WHATSAPP_ADMIN_DETAILED_REPORT === 'SIM';
}

export function getAdminReportConfig(env = process.env) {
  const rawPhone = String(env[ADMIN_REPORT_PHONE_ENV] || '').trim();
  if (!rawPhone) {
    throw new Error(`${ADMIN_REPORT_PHONE_ENV} ausente. Relatórios administrativos bloqueados.`);
  }
  const normalized = normalizeBrazilianWhatsappPhone(rawPhone);
  return {
    name: env.WHATSAPP_ADMIN_MONITOR_NAME || DEFAULT_ADMIN_MONITOR.name,
    phone: normalized.chatId,
    phoneDigits: normalized.digits,
    phoneMasked: normalized.maskedShort,
    phoneMaskedDisplay: normalized.maskedDisplay,
    detailedReportEnabled: isDetailedReportEnabled(env),
  };
}

export function getAdminMonitorConfig(env = process.env) {
  return getAdminReportConfig(env);
}

export function getRoutineLabel(tipo) {
  if (tipo === 'AMANHA') return 'VÉSPERA';
  if (tipo === 'HOJE_MANHA') return 'ATENDIMENTOS DA MANHÃ';
  if (tipo === 'HOJE_TARDE') return 'ATENDIMENTOS DA TARDE';
  return String(tipo || 'ROTINA');
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function formatSessionTime(time) {
  const value = String(time || '').trim();
  if (!value) return 'não informado';
  return value.endsWith(':00') ? `${value.slice(0, 2)}h00` : value;
}

function firstName(name) {
  return String(name || 'não informado').trim().split(/\s+/)[0] || 'não informado';
}

function getReminderResponsible(reminder) {
  return reminder?.responsibleName || reminder?.guardianName || 'não informado';
}

function getReminderRelationship(item) {
  return item?.responsibleRelationship || item?.guardianRelationship || 'não informado';
}

function getMaskedPhone(item) {
  return item?.phoneMasked || maskPhoneShort(item?.whatsapp || item?.phone || '');
}

function diagnosticCategory(diagnostic) {
  const reason = String(diagnostic?.blockedReason || '').toLowerCase();
  if (reason.includes('whatsapp') || reason.includes('telefone') || reason.includes('responsável sem')) {
    return ADMIN_RESULT_CATEGORIES.INCOMPLETE_REGISTRATION;
  }
  return ADMIN_RESULT_CATEGORIES.RULE_SKIPPED;
}

function isIncompleteDiagnostic(diagnostic) {
  return diagnosticCategory(diagnostic) === ADMIN_RESULT_CATEGORIES.INCOMPLETE_REGISTRATION;
}

export function summarizePlans(planContexts) {
  return planContexts.reduce(
    (summary, context) => {
      const diagnostics = context.plan.diagnostics || [];
      summary.planned += context.plan.reminders.length;
      summary.ruleSkipped += diagnostics.filter(item => !isIncompleteDiagnostic(item)).length;
      summary.incomplete += diagnostics.filter(isIncompleteDiagnostic).length;
      return summary;
    },
    {
      planned: 0,
      ruleSkipped: 0,
      incomplete: 0,
    }
  );
}

export function buildPreventiveAlertMessage({ tipo, scheduledAt, planContexts }) {
  const summary = summarizePlans(planContexts);
  const targetDate = planContexts.find(context => context.plan?.dateStr)?.plan?.dateStr;
  const lines = [
    `🔔 PRÉVIA DE ENVIO — ${getRoutineLabel(tipo)}`,
    '',
    `Execução prevista: ${formatTime(scheduledAt).slice(0, 5).replace(':', 'h')}`,
    `Data dos atendimentos: ${targetDate ? formatDate(new Date(`${targetDate}T12:00:00`)) : 'não informada'}`,
    `Mensagens programadas: ${summary.planned}`,
    '',
  ];

  if (summary.planned > 0) {
    lines.push('DESTINATÁRIOS', '');
    let index = 1;
    for (const context of planContexts) {
      for (const reminder of context.plan.reminders || []) {
        lines.push(
          `${index}. Atendente: ${firstName(reminder.patientName)}`,
          `   Responsável: ${getReminderResponsible(reminder)}`,
          `   Vínculo: ${getReminderRelationship(reminder)}`,
          `   WhatsApp: final ${getMaskedPhone(reminder).slice(-4)}`,
          `   Sessão: ${formatSessionTime(reminder.time)}`,
          '   Tipo: lembrete clínico automático',
          '   Situação: 🟢 Programado para envio',
          ''
        );
        index += 1;
      }
    }
  }

  const blocked = planContexts.flatMap(context => context.plan.diagnostics || []);
  if (blocked.length > 0) {
    lines.push('NÃO SERÃO ENVIADAS', '');
    for (const diagnostic of blocked) {
      lines.push(`* ${firstName(diagnostic.patientName)} — ${diagnostic.blockedReason || 'motivo não informado'}.`);
    }
    lines.push('');
  }

  const status = summary.incomplete > 0 ? '🟡 Requer conferência cadastral.' : '🟢 Pronto para a execução.';
  lines.push(`Status do robô: ${status}`);
  return lines.join('\n').trim();
}

export function createExecutionAudit({ tipo, startedAt, planContexts }) {
  return {
    tipo,
    startedAt,
    finishedAt: null,
    planContexts,
    confirmed: [],
    ruleSkipped: [],
    incomplete: [],
    failures: [],
    pending: [],
    routineNotRun: false,
  };
}

export function registerPlanDiagnostics(audit, plan) {
  for (const diagnostic of plan.diagnostics || []) {
    if (isIncompleteDiagnostic(diagnostic)) {
      audit.incomplete.push(diagnostic);
    } else {
      audit.ruleSkipped.push(diagnostic);
    }
  }
}

export function registerSuccessfulSend(audit, reminder, result = {}) {
  audit.confirmed.push({
    reminder,
    confirmedAt: result.confirmedAt || new Date().toISOString(),
  });
}

export function registerPendingConfirmation(audit, reminder) {
  audit.pending.push(reminder);
}

export function registerSendFailure(audit, reminder, error) {
  audit.failures.push({
    reminder,
    reason: error?.message || String(error || 'Erro desconhecido'),
  });
}

export function finishExecutionAudit(audit, finishedAt = new Date()) {
  audit.finishedAt = finishedAt;
  const confirmedIds = new Set(audit.confirmed.map(item => item.reminder?.id).filter(Boolean));
  const failedIds = new Set(audit.failures.map(item => item.reminder?.id).filter(Boolean));
  const pendingIds = new Set(audit.pending.map(item => item?.id).filter(Boolean));
  for (const context of audit.planContexts) {
    for (const reminder of context.plan.reminders || []) {
      if (!confirmedIds.has(reminder.id) && !failedIds.has(reminder.id) && !pendingIds.has(reminder.id)) {
        audit.pending.push(reminder);
      }
    }
  }
  return audit;
}

export function getExecutionFinalStatus(audit) {
  if (audit.routineNotRun || audit.failures.length > 0) return '🔴 FALHA';
  if (audit.pending.length > 0 || audit.incomplete.length > 0) return '🟡 ATENÇÃO';
  return '🟢 SUCESSO';
}

export function buildExecutionReportData(audit) {
  const finishedAt = audit.finishedAt || new Date();
  const durationSeconds = Math.max(0, Math.round((finishedAt.getTime() - audit.startedAt.getTime()) / 1000));
  const plannedCount = audit.planContexts.reduce((total, context) => total + (context.plan.reminders || []).length, 0);
  const diagnosticsCount = audit.ruleSkipped.length + audit.incomplete.length;
  const noReport = plannedCount === 0
    && diagnosticsCount === 0
    && audit.failures.length === 0
    && audit.pending.length === 0;

  return {
    schemaVersion: 1,
    routine: audit.tipo,
    routineLabel: getRoutineLabel(audit.tipo),
    startedAt: audit.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds,
    finalStatus: getExecutionFinalStatus(audit),
    noReport,
    counts: {
      planned: plannedCount,
      confirmed: audit.confirmed.length,
      ruleSkipped: audit.ruleSkipped.length,
      incomplete: audit.incomplete.length,
      pending: audit.pending.length,
      failures: audit.failures.length,
      blocked: diagnosticsCount,
    },
    confirmed: audit.confirmed.map(item => ({
      patientFirstName: firstName(item.reminder?.patientName),
      responsibleName: getReminderResponsible(item.reminder),
      relationship: getReminderRelationship(item.reminder),
      phoneLast4: getMaskedPhone(item.reminder).slice(-4),
      sessionTime: formatSessionTime(item.reminder?.time),
      confirmedAt: item.confirmedAt,
    })),
    notSent: [
      ...audit.ruleSkipped.map(item => ({
        patientFirstName: firstName(item?.patientName),
        category: ADMIN_RESULT_CATEGORIES.RULE_SKIPPED,
        reason: item?.blockedReason || 'motivo não informado',
      })),
      ...audit.incomplete.map(item => ({
        patientFirstName: firstName(item?.patientName),
        category: ADMIN_RESULT_CATEGORIES.INCOMPLETE_REGISTRATION,
        reason: item?.blockedReason || 'motivo não informado',
      })),
      ...audit.pending.map(item => ({
        patientFirstName: firstName(item?.patientName),
        category: ADMIN_RESULT_CATEGORIES.PENDING_CONFIRMATION,
        reason: item?.blockedReason || 'motivo não informado',
      })),
      ...audit.failures.map(item => ({
        patientFirstName: firstName(item.reminder?.patientName),
        category: ADMIN_RESULT_CATEGORIES.SEND_FAILED,
        reason: item.reason || 'motivo não informado',
      })),
    ],
  };
}

export function formatExecutionReportMessage(report) {
  if (report.noReport) {
    return [
      `ℹ️ ROTINA CONCLUÍDA — ${report.routineLabel}`,
      '',
      `Execução: ${formatDateTime(new Date(report.startedAt))}`,
      '',
      'Nenhuma mensagem precisava ser enviada.',
      '',
      'Motivo: nenhum atendimento elegível para a rotina.',
      '',
      'Status: 🟢 Funcionamento normal.',
    ].join('\n');
  }

  const lines = [
    `✅ RESULTADO DOS ENVIOS — ${report.routineLabel}`,
    '',
    `Execução: ${formatDateTime(new Date(report.startedAt))}`,
    `Duração: ${report.durationSeconds} segundos`,
    '',
    'RESUMO',
    '',
    `Planejadas: ${report.counts.planned}`,
    `Confirmadas: ${report.counts.confirmed}`,
    `Não enviadas por regra: ${report.counts.ruleSkipped}`,
    `Cadastros incompletos: ${report.counts.incomplete}`,
    `Confirmações pendentes: ${report.counts.pending}`,
    `Falhas: ${report.counts.failures}`,
    '',
  ];

  if (report.confirmed.length > 0) {
    lines.push('ENVIOS CONFIRMADOS', '');
    report.confirmed.forEach((item, index) => {
      lines.push(
        `${index + 1}. Atendente: ${item.patientFirstName}`,
        `   Responsável: ${item.responsibleName}`,
        `   Vínculo: ${item.relationship}`,
        `   WhatsApp: final ${item.phoneLast4}`,
        `   Sessão: ${item.sessionTime}`,
        `   Confirmação: ${formatTime(new Date(item.confirmedAt))}`,
        `   Resultado: ${ADMIN_RESULT_CATEGORIES.CONFIRMED}`,
        ''
      );
    });
  }

  if (report.notSent.length > 0) {
    lines.push('NÃO ENVIADOS', '');
    for (const row of report.notSent) {
      lines.push(`* ${row.patientFirstName} — ${row.category}. Motivo: ${row.reason}.`);
    }
    lines.push('');
  }

  lines.push(`Status final: ${report.finalStatus}.`);
  return lines.join('\n').trim();
}

export function buildExecutionReportMessage(audit) {
  return formatExecutionReportMessage(buildExecutionReportData(audit));
}

export function buildDetailedReportMessage(audit) {
  return buildExecutionReportMessage(audit);
}

export function buildAdminTestMessage(now = new Date()) {
  return [
    'TESTE DE MONITORAMENTO DO ROBÔ',
    '',
    'Mensagem administrativa offline/de configuração do canal operacional.',
    'Nenhum paciente ou responsável foi incluído neste teste.',
    `Data/Hora: ${formatDateTime(now)}`,
    '',
    'Status: canal de auditoria operacional.',
  ].join('\n');
}

export function maskAdminReportPhone(value) {
  return maskBrazilianPhone(value);
}
