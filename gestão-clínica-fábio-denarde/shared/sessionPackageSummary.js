import {
  dedupeSessionsByStableIdentity,
  isCountedAbsenceSession,
  sessionConsumesPackage,
} from './sessionScheduling.js';
import { getSaoPauloDateKey } from './clinicalDate.js';

const DEFAULT_PACKAGE_SESSION_TOTAL = 10;
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
  return sessionConsumesPackage(session);
}

export function isActivePackagePatient(patient = {}) {
  return String(patient.status || '') === ACTIVE_PATIENT_STATUS;
}

export function buildCurrentPackageSessionSummary(patient = {}, sessions = [], plannedSessions = DEFAULT_PACKAGE_SESSION_TOTAL, options = {}) {
  const planned = normalizePlannedSessions(plannedSessions);
  const patientId = String(patient.id || '');
  const throughDate = String(options.throughDate || getSaoPauloDateKey());
  const realizedSessions = dedupeSessionsByStableIdentity(sessions)
    .filter(session => (
      String(session?.patientId || '') === patientId
      && sessionConsumesPackage(session, { throughDate })
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

  // A fronteira do pacote é posicional. Usar apenas a data mistura ciclos
  // quando a 10ª e a 1ª sessões de pacotes consecutivos ocorrem no mesmo dia.
  const currentPackageSessions = realizedSessions.slice(currentPackageIndex);
  const count = currentPackageSessions.length;

  return {
    patient,
    sessions: currentPackageSessions,
    plannedSessions: planned,
    count,
    remaining: Math.max(0, planned - count),
    totalRealized,
    totalConsumed: totalRealized,
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
    .map(patient => buildCurrentPackageSessionSummary(patient, sessions, plannedSessions, options));
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
    `✅ Sessões contabilizadas (${summary.count || 0}/${summary.plannedSessions || DEFAULT_PACKAGE_SESSION_TOTAL}):`,
  );

  (Array.isArray(summary.sessions) ? summary.sessions : [])
    .slice(-(summary.plannedSessions || DEFAULT_PACKAGE_SESSION_TOTAL))
    .forEach((session, index) => {
      const typeLabel = isCountedAbsenceSession(session)
        ? 'falta contabilizada'
        : String(session.status || '') === 'Reposição' ? 'reposição' : 'OK';
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
