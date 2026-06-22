const DEFAULT_PACKAGE_SESSION_TOTAL = 10;
const REALIZED_SESSION_STATUSES = new Set(['Realizada', 'Reposição']);
const ACTIVE_PATIENT_STATUS = 'Ativo';
const SAFE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizePlannedSessions(value) {
  const planned = Math.floor(Number(value) || 0);
  return planned > 0 ? planned : DEFAULT_PACKAGE_SESSION_TOTAL;
}

function sessionSortKey(session = {}) {
  return `${String(session.date || '')}T${String(session.time || '')}|${String(session.id || '')}`;
}

export function isCurrentPackageRealizedSession(session = {}) {
  return REALIZED_SESSION_STATUSES.has(String(session.status || ''));
}

export function isActivePackagePatient(patient = {}) {
  return String(patient.status || '') === ACTIVE_PATIENT_STATUS;
}

export function buildCurrentPackageSessionSummary(patient = {}, sessions = [], plannedSessions = DEFAULT_PACKAGE_SESSION_TOTAL) {
  const planned = normalizePlannedSessions(plannedSessions);
  const patientId = String(patient.id || '');
  const realizedSessions = (Array.isArray(sessions) ? sessions : [])
    .filter(session => (
      String(session?.patientId || '') === patientId
      && isCurrentPackageRealizedSession(session)
      && session?.isBlocked !== true
    ))
    .slice()
    .sort((left, right) => sessionSortKey(left).localeCompare(sessionSortKey(right)));

  const totalRealized = realizedSessions.length;
  const currentPackageIndex = totalRealized > 0
    ? Math.floor((totalRealized - 1) / planned) * planned
    : 0;
  const packageStartDate = String(
    realizedSessions[currentPackageIndex]?.date
    || patient.startDate
    || '',
  );

  // Mantém exatamente o critério já utilizado em Relatórios: o pacote atual
  // começa na data da primeira sessão do ciclo e inclui as sessões realizadas
  // a partir dessa data.
  const currentPackageSessions = packageStartDate
    ? realizedSessions.filter(session => String(session.date || '') >= packageStartDate)
    : realizedSessions;
  const count = currentPackageSessions.length;

  return {
    patient,
    sessions: currentPackageSessions,
    plannedSessions: planned,
    count,
    remaining: Math.max(0, planned - count),
    totalRealized,
    currentPackageIndex,
    packageStartDate,
  };
}

export function buildCurrentPackageSessionSummaries(patients = [], sessions = [], options = {}) {
  const plannedSessions = normalizePlannedSessions(options.plannedSessions);
  const onlyActive = options.onlyActive !== false;
  const includePatient = typeof options.includePatient === 'function'
    ? options.includePatient
    : () => true;

  return (Array.isArray(patients) ? patients : [])
    .filter(patient => (!onlyActive || isActivePackagePatient(patient)) && includePatient(patient))
    .slice()
    .sort((left, right) => String(left.name || left.fullName || '').localeCompare(
      String(right.name || right.fullName || ''),
      'pt-BR',
      { sensitivity: 'base' },
    ))
    .map(patient => buildCurrentPackageSessionSummary(patient, sessions, plannedSessions));
}

export function formatSessionPackageDate(value = '') {
  const raw = String(value || '');
  const match = raw.match(SAFE_DATE_PATTERN);
  return match ? `${match[3]}/${match[2]}` : raw;
}

function getPatientDisplayName(patient = {}) {
  return String(patient.fullName || patient.name || 'Atendente');
}

export function formatCurrentPackageSessionSummary(summary = {}, options = {}) {
  const patient = summary.patient || {};
  const includeReportHeader = options.includeReportHeader === true;
  const reportDate = String(options.reportDate || '');
  const lines = [];

  if (includeReportHeader) {
    lines.push(`📋 Relatório de Sessões${reportDate ? ` — ${reportDate}` : ''}`, '');
  }

  lines.push(
    `👦 Atendente: ${getPatientDisplayName(patient)}`,
    `👤 Responsável: ${patient.guardianName || 'Não informado'}`,
    `✅ Sessões realizadas (${summary.count || 0}/${summary.plannedSessions || DEFAULT_PACKAGE_SESSION_TOTAL}):`,
  );

  (Array.isArray(summary.sessions) ? summary.sessions : [])
    .slice(-(summary.plannedSessions || DEFAULT_PACKAGE_SESSION_TOTAL))
    .forEach((session, index) => {
      const typeLabel = String(session.status || '') === 'Reposição' ? 'reposição' : 'OK';
      lines.push(`${index + 1}. ${formatSessionPackageDate(session.date)} - ${typeLabel}`);
    });

  lines.push(`⏳ Restantes: ${summary.remaining || 0} sessões`);
  return lines.join('\n');
}

export function formatCurrentPackageSessionSummaries(summaries = [], options = {}) {
  const reportDate = String(options.reportDate || '');
  const body = (Array.isArray(summaries) ? summaries : [])
    .map(summary => formatCurrentPackageSessionSummary(summary))
    .join('\n━━━━━━━━━━━━━━━━\n');

  return `📋 Relatório de Sessões${reportDate ? ` — ${reportDate}` : ''}${body ? `\n\n${body}` : ''}`;
}
