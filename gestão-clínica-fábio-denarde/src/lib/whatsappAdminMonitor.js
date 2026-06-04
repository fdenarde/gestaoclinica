export const DEFAULT_ADMIN_MONITOR = {
  name: 'Fabio Luiz Silva Denarde',
  phone: '+55 27 98114-0948'
};

export function isAdminMonitoringEnabled(env = process.env) {
  return env.WHATSAPP_ADMIN_MONITORING !== 'NAO';
}

export function isDetailedReportEnabled(env = process.env) {
  return env.WHATSAPP_ADMIN_DETAILED_REPORT === 'SIM';
}

export function getAdminMonitorConfig(env = process.env) {
  return {
    name: env.WHATSAPP_ADMIN_MONITOR_NAME || DEFAULT_ADMIN_MONITOR.name,
    phone: env.WHATSAPP_ADMIN_MONITOR_PHONE || DEFAULT_ADMIN_MONITOR.phone,
    detailedReportEnabled: isDetailedReportEnabled(env)
  };
}

export function getRoutineLabel(tipo) {
  if (tipo === 'AMANHA') return 'Vespera';
  if (tipo === 'HOJE_MANHA') return 'Dia do Atendimento - Manha';
  if (tipo === 'HOJE_TARDE') return 'Dia do Atendimento - Tarde';
  return tipo;
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Sao_Paulo'
  }).format(date);
}

export function summarizePlans(planContexts) {
  return planContexts.reduce(
    (summary, context) => {
      const diagnostics = context.plan.diagnostics || [];
      summary.expectedMessages += context.plan.reminders.length;
      summary.expectedBlocks += diagnostics.length;
      summary.expectedCanceled += diagnostics.filter(diagnostic =>
        String(diagnostic.blockedReason || '').toLowerCase().includes('cancelada')
      ).length;
      return summary;
    },
    {
      expectedMessages: 0,
      expectedBlocks: 0,
      expectedCanceled: 0
    }
  );
}

export function buildPreventiveAlertMessage({ tipo, scheduledAt, planContexts }) {
  const summary = summarizePlans(planContexts);

  return [
    'ALERTA DO ROBO',
    '',
    'Em 30 minutos sera iniciado um processamento automatico de mensagens.',
    '',
    `Tipo: ${getRoutineLabel(tipo)}`,
    `Data/Hora prevista: ${formatDateTime(scheduledAt)}`,
    `Quantidade prevista de envios: ${summary.expectedMessages}`,
    `Quantidade prevista de bloqueios: ${summary.expectedBlocks}`,
    '',
    'Status: Sistema operacional.',
    '',
    'Objetivo: Permitir acompanhamento preventivo antes dos disparos reais.'
  ].join('\n');
}

export function createExecutionAudit({ tipo, startedAt, planContexts }) {
  return {
    tipo,
    startedAt,
    finishedAt: null,
    planContexts,
    sent: 0,
    ignored: 0,
    blocked: 0,
    canceled: 0,
    successfulReminderIds: new Set(),
    failedReminderIds: new Set(),
    failures: []
  };
}

export function registerPlanDiagnostics(audit, plan) {
  const diagnostics = plan.diagnostics || [];
  audit.ignored += diagnostics.length;
  audit.blocked += diagnostics.length;
  audit.canceled += diagnostics.filter(diagnostic =>
    String(diagnostic.blockedReason || '').toLowerCase().includes('cancelada')
  ).length;
}

export function registerSuccessfulSend(audit, reminder) {
  audit.sent += 1;
  if (reminder?.id) audit.successfulReminderIds.add(reminder.id);
}

export function registerSendFailure(audit, reminder, error) {
  if (reminder?.id) audit.failedReminderIds.add(reminder.id);
  audit.failures.push({
    patientName: reminder?.patientName || '',
    guardianName: reminder?.guardianName || '',
    phone: reminder?.phone || '',
    reason: error?.message || String(error || 'Erro desconhecido')
  });
}

export function finishExecutionAudit(audit, finishedAt = new Date()) {
  audit.finishedAt = finishedAt;
  return audit;
}

export function buildExecutionReportMessage(audit) {
  const finishedAt = audit.finishedAt || new Date();
  const durationSeconds = Math.max(0, Math.round((finishedAt.getTime() - audit.startedAt.getTime()) / 1000));
  let status = 'Sucesso';
  if (audit.failures.length > 0) status = audit.sent > 0 ? 'Atencao' : 'Erro';
  if (audit.blocked > 0 && audit.failures.length === 0) status = 'Atencao';

  return [
    'RELATORIO DE EXECUCAO',
    '',
    `Data: ${formatDate(audit.startedAt)}`,
    `Horario de inicio: ${formatTime(audit.startedAt)}`,
    `Horario de termino: ${formatTime(finishedAt)}`,
    `Tipo: ${getRoutineLabel(audit.tipo)}`,
    '',
    'Resumo:',
    '',
    `Mensagens enviadas: ${audit.sent}`,
    `Mensagens ignoradas: ${audit.ignored}`,
    `Mensagens bloqueadas: ${audit.blocked}`,
    `Agendamentos cancelados: ${audit.canceled}`,
    `Falhas encontradas: ${audit.failures.length}`,
    `Tempo total de processamento: ${durationSeconds} segundos`,
    '',
    `Status final: ${status}`
  ].join('\n');
}

export function buildDetailedReportMessage(audit, maxItems = 20) {
  const rows = [];

  for (const context of audit.planContexts) {
    for (const reminder of context.plan.reminders || []) {
      const failed = audit.failedReminderIds?.has(reminder.id);
      const sent = audit.successfulReminderIds?.has(reminder.id);
      rows.push({
        guardianName: reminder.guardianName,
        patientName: reminder.patientName,
        whatsapp: reminder.whatsapp,
        tipo: getRoutineLabel(audit.tipo),
        time: reminder.time,
        result: failed ? 'Falha' : (sent ? 'Enviado' : 'Ignorado'),
        reason: failed ? 'Falha registrada durante o envio' : (sent ? 'Mensagem enviada pelo robo' : 'Mensagem prevista, mas sem confirmacao de envio')
      });
    }

    for (const diagnostic of context.plan.diagnostics || []) {
      rows.push({
        guardianName: '-',
        patientName: diagnostic.patientName,
        whatsapp: '-',
        tipo: getRoutineLabel(audit.tipo),
        time: diagnostic.time,
        result: 'Bloqueado',
        reason: diagnostic.blockedReason || 'Nao informado'
      });
    }
  }

  if (rows.length === 0) {
    return [
      'RELATORIO DETALHADO',
      '',
      'Nenhum item encontrado nesta execucao.'
    ].join('\n');
  }

  const limited = rows.slice(0, maxItems);
  const lines = ['RELATORIO DETALHADO', ''];
  limited.forEach((row, index) => {
    lines.push(
      `${index + 1}. Responsavel: ${row.guardianName}`,
      `Paciente: ${row.patientName}`,
      `Telefone: ${row.whatsapp}`,
      `Tipo: ${row.tipo}`,
      `Horario da Sessao: ${row.time}`,
      `Resultado: ${row.result}`,
      `Motivo: ${row.reason}`,
      ''
    );
  });

  if (rows.length > limited.length) {
    lines.push(`Itens omitidos por seguranca/tamanho da mensagem: ${rows.length - limited.length}`);
  }

  return lines.join('\n').trim();
}

export function buildAdminTestMessage(now = new Date()) {
  return [
    'TESTE DE MONITORAMENTO DO ROBO',
    '',
    'Esta e uma mensagem fake enviada apenas para o administrador.',
    'Nenhum paciente ou responsavel foi incluido neste teste.',
    `Data/Hora: ${formatDateTime(now)}`,
    '',
    'Status: canal de auditoria operacional.'
  ].join('\n');
}
