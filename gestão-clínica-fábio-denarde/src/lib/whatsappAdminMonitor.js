import { maskBrazilianPhone, maskPhoneShort, normalizeBrazilianWhatsappPhone } from './whatsappPhone.js';

export const ADMIN_REPORT_PHONE_ENV = 'WHATSAPP_ADMIN_REPORT_PHONE';
export const DEFAULT_ADMIN_MONITOR = Object.freeze({
  name: 'Fabio Luiz Silva Denarde',
});

export const ADMIN_RESULT_CATEGORIES = Object.freeze({
  SENT: '✅ Enviada',
  RULE_SKIPPED: '🟡 Não enviada por regra',
  SEND_FAILED: '🔴 Falha no envio',
  ROUTINE_NOT_RUN: '🔴 Rotina não executada',
  INCOMPLETE_REGISTRATION: '🟠 Cadastro incompleto',
  AGENDA_CHANGED: '🟠 Alteração na agenda',
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

function formatSessionDate(dateStr) {
  const value = String(dateStr || '').trim();
  if (!value) return 'não informada';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : formatDate(parsed);
}

function firstName(name) {
  return String(name || 'não informado').trim().split(/\s+/)[0] || 'não informado';
}

function getReminderResponsible(reminder) {
  return reminder?.responsibleName || reminder?.guardianName || 'não informado';
}

function getPhoneLast4(item) {
  const masked = item?.phoneMasked || maskPhoneShort(item?.whatsapp || item?.phone || '');
  const digits = String(masked || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : 'não informado';
}

function getReminderDate(audit, reminder) {
  if (reminder?.sessionDate) return reminder.sessionDate;
  for (const context of audit.planContexts || []) {
    if ((context.plan?.reminders || []).some(item => item.id === reminder?.id)) {
      return context.plan?.dateStr || '';
    }
  }
  return '';
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

function diagnosticBelongsToRoutine(diagnostic, tipo) {
  const rawHour = String(diagnostic?.time || '').split(':')[0];
  const hour = Number(rawHour);
  if (!Number.isFinite(hour)) return true;
  if (tipo === 'HOJE_MANHA' && hour >= 12) return false;
  if (tipo === 'HOJE_TARDE' && hour < 12) return false;
  return true;
}

function isAdministrativeRelevantDiagnostic(diagnostic, tipo) {
  if (!diagnosticBelongsToRoutine(diagnostic, tipo)) return false;
  const reason = String(diagnostic?.blockedReason || '').toLowerCase();
  const ignoredFragments = [
    'fora do turno',
    'conflito/deduplicação',
    'sessão cancelada',
    'status inválido',
    'paciente inativo',
    'sessão manual bloqueadora',
    'feriado/recesso',
  ];
  return !ignoredFragments.some(fragment => reason.includes(fragment));
}

function relevantDiagnostics(plan, tipo) {
  return (plan?.diagnostics || []).filter(item => isAdministrativeRelevantDiagnostic(item, tipo));
}

export function summarizePlans(planContexts, tipo) {
  return planContexts.reduce(
    (summary, context) => {
      const diagnostics = relevantDiagnostics(context.plan, tipo);
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
  const summary = summarizePlans(planContexts, tipo);
  if (summary.planned === 0) return '';

  const targetDate = planContexts.find(context => context.plan?.dateStr)?.plan?.dateStr;
  const lines = [
    `🔔 PRÉVIA — ${getRoutineLabel(tipo)}`,
    '',
    `Execução prevista: ${formatTime(scheduledAt).slice(0, 5).replace(':', 'h')}`,
    `Data das sessões: ${targetDate ? formatDate(new Date(`${targetDate}T12:00:00`)) : 'não informada'}`,
    `Mensagens programadas: ${summary.planned}`,
    '',
    'DESTINATÁRIOS',
    '',
  ];

  let index = 1;
  for (const context of planContexts) {
    for (const reminder of context.plan.reminders || []) {
      lines.push(
        `${index}. Atendente: ${firstName(reminder.patientName)}`,
        `   Responsável: ${firstName(getReminderResponsible(reminder))}`,
        `   WhatsApp: final ${getPhoneLast4(reminder)}`,
        `   Sessão: ${formatSessionDate(context.plan?.dateStr)} às ${formatSessionTime(reminder.time)}`,
        ''
      );
      index += 1;
    }
  }

  return lines.join('\n').trim();
}

function stableSnapshotHash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `snapshot-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function snapshotReasonCode(reason = '') {
  const normalized = String(reason || '').toLowerCase();
  if (normalized.includes('cancel')) return 'cancelled';
  if (normalized.includes('reagend')) return 'rescheduled';
  if (normalized.includes('whatsapp') || normalized.includes('telefone') || normalized.includes('responsável sem')) return 'invalid-phone';
  if (normalized.includes('desativ') || normalized.includes('suppression') || normalized.includes('suprim')) return 'reminder-disabled';
  if (normalized.includes('deduplic')) return 'deduplicated';
  if (normalized.includes('fora do turno') || normalized.includes('janela')) return 'outside-window';
  return 'blocked';
}

function snapshotEntry(context, item, state) {
  const sessionDate = item?.sessionDate || context?.plan?.dateStr || '';
  const rawKey = [
    context?.userId || 'account',
    item?.id || item?.patientId || item?.patientName || 'session',
  ].join('|');
  return {
    key: stableSnapshotHash(rawKey),
    state,
    reasonCode: state === 'eligible' ? 'eligible' : snapshotReasonCode(item?.blockedReason),
    reasonLabel: state === 'eligible' ? '' : String(item?.blockedReason || 'elegibilidade alterada'),
    patientFirstName: firstName(item?.patientName),
    responsibleFirstName: firstName(getReminderResponsible(item)),
    phoneLast4: getPhoneLast4(item),
    phoneFingerprint: stableSnapshotHash(item?.phone || item?.whatsapp || item?.phoneMasked || ''),
    sessionDate,
    sessionTime: String(item?.time || item?.sessionTime || ''),
  };
}

export function buildPlanSnapshot({
  tipo,
  planContexts,
  capturedAt = new Date(),
} = {}) {
  const entries = [];
  for (const context of planContexts || []) {
    for (const reminder of context?.plan?.reminders || []) {
      entries.push(snapshotEntry(context, reminder, 'eligible'));
    }
    for (const diagnostic of context?.plan?.diagnostics || []) {
      entries.push(snapshotEntry(context, diagnostic, 'blocked'));
    }
  }

  const unique = new Map();
  for (const entry of entries) {
    const current = unique.get(entry.key);
    if (!current || entry.state === 'eligible') unique.set(entry.key, entry);
  }

  return {
    schemaVersion: 1,
    routine: tipo || '',
    capturedAt: capturedAt.toISOString(),
    entries: [...unique.values()],
  };
}

function agendaChangeFrom(previous, current, code, label) {
  return {
    key: previous?.key || current?.key || '',
    patientFirstName: current?.patientFirstName || previous?.patientFirstName || 'não informado',
    responsibleFirstName: current?.responsibleFirstName || previous?.responsibleFirstName || 'não informado',
    phoneLast4: current?.phoneLast4 || previous?.phoneLast4 || 'não informado',
    previousSessionDate: previous?.sessionDate || '',
    previousSessionTime: previous?.sessionTime || '',
    sessionDate: current?.sessionDate || previous?.sessionDate || '',
    sessionTime: current?.sessionTime || previous?.sessionTime || '',
    changeCode: code,
    changeLabel: label,
  };
}

export function comparePlanSnapshots(previewSnapshot, executionSnapshot) {
  if (!previewSnapshot?.entries?.length) return [];
  const previousEntries = previewSnapshot.entries.filter(item => item?.state === 'eligible');
  const previousByKey = new Map(previousEntries.map(item => [item.key, item]));
  const currentByKey = new Map((executionSnapshot?.entries || []).map(item => [item.key, item]));
  const changes = [];

  for (const previous of previousEntries) {
    const current = currentByKey.get(previous.key);
    if (!current) {
      changes.push(agendaChangeFrom(
        previous,
        null,
        'removed',
        'Sessão removida ou não localizada depois da prévia.'
      ));
      continue;
    }

    if (current.state !== 'eligible') {
      const labels = {
        cancelled: 'Sessão cancelada depois da prévia.',
        rescheduled: 'Sessão reagendada depois da prévia.',
        'invalid-phone': 'Contato do responsável ficou inválido depois da prévia.',
        'reminder-disabled': 'Lembrete desativado depois da prévia.',
        deduplicated: 'Sessão passou a ser agrupada por deduplicação depois da prévia.',
        'outside-window': 'Sessão saiu da janela desta rotina depois da prévia.',
        blocked: 'Sessão deixou de ser elegível depois da prévia.',
      };
      changes.push(agendaChangeFrom(
        previous,
        current,
        current.reasonCode || 'blocked',
        labels[current.reasonCode] || current.reasonLabel || labels.blocked
      ));
      continue;
    }

    if (
      previous.sessionDate !== current.sessionDate
      || previous.sessionTime !== current.sessionTime
    ) {
      changes.push(agendaChangeFrom(
        previous,
        current,
        'rescheduled',
        `Sessão reagendada de ${formatSessionDate(previous.sessionDate)} às ${formatSessionTime(previous.sessionTime)} para ${formatSessionDate(current.sessionDate)} às ${formatSessionTime(current.sessionTime)}.`
      ));
    }

    if (previous.phoneFingerprint !== current.phoneFingerprint) {
      changes.push(agendaChangeFrom(
        previous,
        current,
        'contact-changed',
        'Contato do responsável alterado depois da prévia.'
      ));
    }
  }

  for (const current of executionSnapshot?.entries || []) {
    if (current.state !== 'eligible' || previousByKey.has(current.key)) continue;
    changes.push(agendaChangeFrom(
      null,
      current,
      'added',
      'Sessão adicionada ou tornada elegível depois da prévia.'
    ));
  }

  const unique = new Map();
  for (const change of changes) {
    unique.set(`${change.key}|${change.changeCode}`, change);
  }
  return [...unique.values()];
}

export function registerAgendaChanges(audit, changes = []) {
  audit.agendaChanges.push(...changes);
  return audit;
}

export function createExecutionAudit({ tipo, startedAt, planContexts }) {
  return {
    tipo,
    startedAt,
    finishedAt: null,
    planContexts,
    sent: [],
    ruleSkipped: [],
    incomplete: [],
    failures: [],
    agendaChanges: [],
    routineNotRun: false,
  };
}

export function registerPlanDiagnostics(audit, plan) {
  for (const diagnostic of relevantDiagnostics(plan, audit.tipo)) {
    const normalized = {
      ...diagnostic,
      sessionDate: diagnostic?.sessionDate || plan?.dateStr || '',
    };
    if (isIncompleteDiagnostic(normalized)) {
      audit.incomplete.push(normalized);
    } else {
      audit.ruleSkipped.push(normalized);
    }
  }
}

export function registerSuccessfulSend(audit, reminder, result = {}) {
  audit.sent.push({
    reminder: {
      ...reminder,
      sessionDate: getReminderDate(audit, reminder),
    },
    sentAt: result.confirmedAt || result.sentAt || new Date().toISOString(),
  });
}

export function registerRuntimeSkip(audit, reminder, reason = 'envio não realizado por regra operacional') {
  audit.ruleSkipped.push({
    ...reminder,
    sessionDate: getReminderDate(audit, reminder),
    blockedReason: reason,
  });
}

export function registerSendFailure(audit, reminder, error) {
  audit.failures.push({
    reminder: {
      ...reminder,
      sessionDate: getReminderDate(audit, reminder),
    },
    reason: error?.message || String(error || 'Erro desconhecido'),
  });
}

export function finishExecutionAudit(audit, finishedAt = new Date()) {
  audit.finishedAt = finishedAt;
  return audit;
}

export function getExecutionFinalStatus(audit) {
  if (audit.routineNotRun || audit.failures.length > 0) return '🔴 FALHA';
  if (audit.incomplete.length > 0 || audit.agendaChanges.length > 0) return '🟡 ATENÇÃO';
  return '🟢 NORMAL';
}

function reportRow(item, category, reason) {
  return {
    patientFirstName: firstName(item?.patientName),
    responsibleFirstName: firstName(getReminderResponsible(item)),
    phoneLast4: getPhoneLast4(item),
    sessionDate: item?.sessionDate || '',
    sessionTime: formatSessionTime(item?.time),
    category,
    reason: reason || item?.blockedReason || 'motivo não informado',
  };
}

export function buildExecutionReportData(audit) {
  const finishedAt = audit.finishedAt || new Date();
  const durationSeconds = Math.max(0, Math.round((finishedAt.getTime() - audit.startedAt.getTime()) / 1000));
  const plannedCount = audit.planContexts.reduce((total, context) => total + (context.plan.reminders || []).length, 0);
  const diagnosticsCount = audit.ruleSkipped.length + audit.incomplete.length;
  const noReport = plannedCount === 0
    && diagnosticsCount === 0
    && audit.failures.length === 0
    && audit.agendaChanges.length === 0;

  return {
    schemaVersion: 2,
    routine: audit.tipo,
    routineLabel: getRoutineLabel(audit.tipo),
    startedAt: audit.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds,
    finalStatus: getExecutionFinalStatus(audit),
    noReport,
    counts: {
      planned: plannedCount,
      confirmed: audit.sent.length,
      ruleSkipped: audit.ruleSkipped.length,
      incomplete: audit.incomplete.length,
      pending: 0,
      failures: audit.failures.length,
      blocked: diagnosticsCount,
      agendaChanges: audit.agendaChanges.length,
    },
    sent: audit.sent.map(item => ({
      patientFirstName: firstName(item.reminder?.patientName),
      responsibleFirstName: firstName(getReminderResponsible(item.reminder)),
      phoneLast4: getPhoneLast4(item.reminder),
      sessionDate: item.reminder?.sessionDate || '',
      sessionTime: formatSessionTime(item.reminder?.time),
      sentAt: item.sentAt,
    })),
    agendaChanges: audit.agendaChanges.map(item => ({
      patientFirstName: item.patientFirstName,
      responsibleFirstName: item.responsibleFirstName,
      phoneLast4: item.phoneLast4,
      previousSessionDate: item.previousSessionDate,
      previousSessionTime: item.previousSessionTime,
      sessionDate: item.sessionDate,
      sessionTime: item.sessionTime,
      changeCode: item.changeCode,
      changeLabel: item.changeLabel,
    })),
    notSent: [
      ...audit.ruleSkipped.map(item => reportRow(
        item,
        ADMIN_RESULT_CATEGORIES.RULE_SKIPPED,
        item?.blockedReason
      )),
      ...audit.incomplete.map(item => reportRow(
        item,
        ADMIN_RESULT_CATEGORIES.INCOMPLETE_REGISTRATION,
        item?.blockedReason
      )),
      ...audit.failures.map(item => reportRow(
        item.reminder,
        ADMIN_RESULT_CATEGORIES.SEND_FAILED,
        item.reason
      )),
    ],
  };
}

export function formatExecutionReportMessage(report) {
  if (report.noReport) return '';

  const icon = report.finalStatus.includes('FALHA')
    ? '🚨'
    : report.finalStatus.includes('ATENÇÃO')
      ? '⚠️'
      : '✅';

  const lines = [
    `${icon} RESULTADO — ${report.routineLabel}`,
    '',
    `Execução: ${formatDateTime(new Date(report.startedAt))}`,
    `Duração: ${report.durationSeconds} segundos`,
    '',
    'RESUMO',
    '',
    `Planejadas: ${report.counts.planned}`,
    `Enviadas: ${report.counts.confirmed}`,
    `Não enviadas por regra: ${report.counts.ruleSkipped}`,
    `Pendências de cadastro: ${report.counts.incomplete}`,
    `Alterações na agenda: ${report.counts.agendaChanges}`,
    `Falhas: ${report.counts.failures}`,
    '',
  ];

  if (report.sent.length > 0) {
    lines.push('ENVIADAS', '');
    report.sent.forEach((item, index) => {
      lines.push(
        `${index + 1}. Atendente: ${item.patientFirstName}`,
        `   Responsável: ${item.responsibleFirstName}`,
        `   WhatsApp: final ${item.phoneLast4}`,
        `   Sessão: ${formatSessionDate(item.sessionDate)} às ${item.sessionTime}`,
        `   Envio: ${formatTime(new Date(item.sentAt)).slice(0, 5)}`,
        `   Resultado: ${ADMIN_RESULT_CATEGORIES.SENT}`,
        ''
      );
    });
  }

  if (report.agendaChanges.length > 0) {
    lines.push('ALTERAÇÕES NA AGENDA', '');
    for (const row of report.agendaChanges) {
      lines.push(
        `* Atendente: ${row.patientFirstName}`,
        `  Responsável: ${row.responsibleFirstName}`,
        `  WhatsApp: ${row.phoneLast4 === 'não informado' ? 'não informado' : `final ${row.phoneLast4}`}`,
        `  Situação: ${ADMIN_RESULT_CATEGORIES.AGENDA_CHANGED}`,
        `  Alteração: ${row.changeLabel}`,
        ''
      );
    }
  }

  if (report.notSent.length > 0) {
    lines.push('NÃO ENVIADAS', '');
    for (const row of report.notSent) {
      lines.push(
        `* Atendente: ${row.patientFirstName}`,
        `  Responsável: ${row.responsibleFirstName}`,
        `  WhatsApp: ${row.phoneLast4 === 'não informado' ? 'não informado' : `final ${row.phoneLast4}`}`,
        `  Sessão: ${formatSessionDate(row.sessionDate)} às ${row.sessionTime}`,
        `  Situação: ${row.category}`,
        `  Motivo: ${row.reason}.`,
        ''
      );
    }
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
