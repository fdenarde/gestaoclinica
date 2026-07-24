import { hasPersistedScheduleOccurrence, isSessionRemovedFromAgenda } from './sessionRemoval.js';
import { buildCurrentPackageSessionSummary } from './sessionPackageSummary.js';
import { sessionConsumesPackage } from './sessionScheduling.js';

const CLOSED_PATIENT_STATUS = new Set(['Concluído', 'Concluido', 'Encerrado']);
const DEFAULT_PACKAGE_SESSION_TOTAL = 10;
const SAFE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function normalizeMonitoringText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isMonitoringRealizedSession(session) {
  return sessionConsumesPackage(session);
}

export function calculateMonitoringProgress({
  realizedSessions = 0,
  plannedSessions = DEFAULT_PACKAGE_SESSION_TOTAL,
} = {}) {
  const realized = Math.max(0, Math.floor(Number(realizedSessions) || 0));
  const planned = Math.max(0, Math.floor(Number(plannedSessions) || 0));
  if (planned <= 0) {
    return {
      realizedSessions: realized,
      plannedSessions: 0,
      percentage: null,
      label: 'Pacote não definido',
    };
  }
  const percentage = Math.min(100, Math.max(0, Math.round((realized / planned) * 100)));
  return {
    realizedSessions: realized,
    plannedSessions: planned,
    percentage,
    label: `${percentage}%`,
  };
}

export function getCurrentPackageSessionCount(sessions = [], plannedSessions = DEFAULT_PACKAGE_SESSION_TOTAL) {
  const planned = Math.max(0, Math.floor(Number(plannedSessions) || 0));
  if (planned <= 0) return 0;
  const realized = sessions.filter(isMonitoringRealizedSession).length;
  return realized === 0 ? 0 : (realized % planned || planned);
}

export function buildMonitoringPatientSummary(patient, sessions = [], activityCount = 0, plannedSessions = DEFAULT_PACKAGE_SESSION_TOTAL) {
  const patientSessions = sessions
    .filter(session => String(session?.patientId || '') === String(patient?.id || '') && !session?.isBlocked)
    .sort((left, right) => `${left.date || ''}T${left.time || ''}`.localeCompare(`${right.date || ''}T${right.time || ''}`));
  const realizedSessions = patientSessions.filter(isMonitoringRealizedSession);
  const futureSessions = patientSessions.filter(session => String(session?.status || '') === 'Agendada');
  const currentPackageRealized = buildCurrentPackageSessionSummary(
    patient,
    patientSessions,
    plannedSessions,
  ).count;
  const progress = calculateMonitoringProgress({
    realizedSessions: currentPackageRealized,
    plannedSessions,
  });
  return {
    patient,
    sessions: patientSessions,
    sessionsRealized: realizedSessions.length,
    sessionsPlanned: progress.plannedSessions,
    currentPackageRealized,
    progressPercentage: progress.percentage,
    progressLabel: progress.label,
    lastSession: realizedSessions.at(-1) || null,
    nextSession: futureSessions.find(session => session.date >= new Date().toISOString().slice(0, 10)) || futureSessions[0] || null,
    status: patient?.status || 'Não informado',
    activityCount: Math.max(0, Math.floor(Number(activityCount) || 0)),
  };
}

function parseOptionalMonitoringNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterMonitoringSummaries(summaries = [], filters = {}) {
  const name = normalizeMonitoringText(filters.name);
  const status = normalizeMonitoringText(filters.status);
  const activeState = String(filters.activeState || 'all');
  const minProgress = parseOptionalMonitoringNumber(filters.minProgress);
  const maxProgress = parseOptionalMonitoringNumber(filters.maxProgress);

  return summaries.filter(summary => {
    const patient = summary.patient || {};
    if (name && !normalizeMonitoringText(patient.fullName || patient.name).includes(name)) return false;
    if (status && !normalizeMonitoringText(summary.status).includes(status)) return false;
    if (activeState === 'active' && CLOSED_PATIENT_STATUS.has(String(patient.status || ''))) return false;
    if (activeState === 'closed' && !CLOSED_PATIENT_STATUS.has(String(patient.status || ''))) return false;
    if (minProgress !== null && (summary.progressPercentage ?? -1) < minProgress) return false;
    if (maxProgress !== null && (summary.progressPercentage ?? 101) > maxProgress) return false;
    return true;
  });
}

export function getSaoPauloWeekRange(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = new Date(`${formatter.format(now)}T12:00:00`);
  const day = today.getDay();
  const start = new Date(today);
  start.setDate(today.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const toIso = date => formatter.format(date);
  return { start: toIso(start), end: toIso(end) };
}

export function isDateWithinMonitoringWeek(date, weekRange) {
  const value = String(date || '');
  return SAFE_DATE_PATTERN.test(value)
    && value >= weekRange.start
    && value <= weekRange.end;
}

export function getSaoPauloDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isMonitoringUpcomingSession(session, today) {
  if (!session || session.isBlocked === true) return false;
  const date = String(session.date || '');
  if (!SAFE_DATE_PATTERN.test(date) || date < today) return false;
  const status = normalizeMonitoringText(session.status);
  return !new Set(['realizada', 'reposicao', 'cancelada', 'cancelado', 'falta', 'faltou']).has(status);
}

export function getMonitoringUpcomingSessionGroups(sessions = [], now = new Date()) {
  const today = getSaoPauloDateKey(now);
  const upcoming = sessions
    .filter(session => isMonitoringUpcomingSession(session, today))
    .slice()
    .sort((left, right) => (
      `${left.date || ''}T${left.time || ''}|${left.id || ''}`
        .localeCompare(`${right.date || ''}T${right.time || ''}|${right.id || ''}`)
    ));
  const todaySessions = upcoming.filter(session => session.date === today);
  const nextDate = upcoming.find(session => session.date > today)?.date || null;
  const nextSessions = nextDate
    ? upcoming.filter(session => session.date === nextDate)
    : [];
  return { today, todaySessions, nextDate, nextSessions };
}

export function groupMonitoringSessionsByDate(sessions = []) {
  const groups = new Map();
  for (const session of sessions) {
    const date = String(session?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || session?.isBlocked === true) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(session);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateSessions]) => ({
      date,
      sessions: dateSessions.slice().sort((left, right) => (
        `${left.time || ''}|${left.id || ''}`.localeCompare(`${right.time || ''}|${right.id || ''}`)
      )),
    }));
}

export function normalizeMonitoringTime(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(SAFE_TIME_PATTERN);
  if (!match) return raw;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function addOneMonitoringHour(value = '') {
  const time = normalizeMonitoringTime(value);
  const match = time.match(SAFE_TIME_PATTERN);
  if (!match) return '';
  const hour = (Number(match[1]) + 1) % 24;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

export function getMonitoringFixedScheduleForDate(patient = {}, dateStr = '', now = new Date()) {
  if (!SAFE_DATE_PATTERN.test(String(dateStr || ''))) return null;

  const history = Array.isArray(patient.fixedScheduleHistory) ? patient.fixedScheduleHistory : [];
  const historicalSchedule = history.find(item => (
    item
    && item.effectiveFrom
    && item.effectiveTo
    && item.effectiveFrom <= dateStr
    && dateStr <= item.effectiveTo
  ));

  if (historicalSchedule) {
    return {
      fixedDay: String(historicalSchedule.fixedDay || ''),
      fixedTime: normalizeMonitoringTime(historicalSchedule.fixedTime || ''),
      doubleSession: historicalSchedule.doubleSession === true,
    };
  }

  const todayStr = getSaoPauloDateKey(now);
  if (!patient.fixedScheduleEffectiveFrom && history.length === 0 && dateStr < todayStr) {
    return null;
  }

  const effectiveFrom = String(patient.fixedScheduleEffectiveFrom || patient.startDate || '');
  if (effectiveFrom && dateStr < effectiveFrom) {
    return null;
  }

  return {
    fixedDay: String(patient.fixedDay || ''),
    fixedTime: normalizeMonitoringTime(patient.fixedTime || ''),
    doubleSession: patient.doubleSession === true,
  };
}

export function isMonitoringPatientVisible(patient = {}) {
  if (patient.monitoringVisible === false || patient.hideFromMonitoring === true || patient.excludeFromMonitoring === true) {
    return false;
  }
  const comparableName = normalizeMonitoringText(patient.fullName || patient.name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return comparableName !== 'jacinto melaco teste';
}

export function isMonitoringGalleryPatientVisible(patient = {}) {
  return isMonitoringPatientVisible(patient);
}

export function filterMonitoringPatients(patients = []) {
  return (Array.isArray(patients) ? patients : []).filter(isMonitoringPatientVisible);
}

function listDateRange(start, end) {
  if (!SAFE_DATE_PATTERN.test(String(start || '')) || !SAFE_DATE_PATTERN.test(String(end || '')) || start > end) {
    return [];
  }
  const dates = [];
  const current = new Date(`${start}T12:00:00-03:00`);
  const final = new Date(`${end}T12:00:00-03:00`);
  while (current.getTime() <= final.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function getMonitoringDayName(dateStr) {
  const date = new Date(`${dateStr}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return '';
  return DAY_NAMES[date.getUTCDay()] || '';
}

function fixedDayMatchesDate(fixedDay, dateStr) {
  const configured = normalizeMonitoringText(fixedDay).replace('-feira', '');
  const target = normalizeMonitoringText(getMonitoringDayName(dateStr)).replace('-feira', '');
  return configured && configured === target;
}

function createMonitoringVirtualSession(patient, date, time, doubleSession = false, professionalName = 'Fábio Denarde') {
  return {
    id: `virtual-${patient.id}-${date}-${time}`,
    patientId: String(patient.id || ''),
    patientName: patient.fullName || patient.name || 'Atendente',
    date,
    time,
    durationMinutes: doubleSession ? 100 : 50,
    professionalName,
    type: doubleSession ? 'Sessão dupla (2 × 50 min)' : 'Sessão simples (50 min)',
    status: 'Agendada',
    packageNumber: null,
    isBlocked: false,
    consumesPackage: false,
    source: 'fixed',
    isVirtual: true,
  };
}

export function buildMonitoringWeekVirtualSessions({
  patients = [],
  sessions = [],
  weekRange = getSaoPauloWeekRange(),
  holidays = [],
  professionalName = 'Fábio Denarde',
  now = new Date(),
} = {}) {
  const holidayDates = new Set((Array.isArray(holidays) ? holidays : []).map(item => String(item?.date || '')).filter(Boolean));
  const sourceSessions = Array.isArray(sessions) ? sessions : [];
  const result = [];

  for (const date of listDateRange(weekRange.start, weekRange.end)) {
    if (holidayDates.has(date)) continue;
    const dbSessionsForDate = sourceSessions.filter(session => String(session?.date || '') === date);

    for (const patient of patients) {
      if (!patient?.id || String(patient.status || '') !== 'Ativo') continue;
      const fixedSchedule = getMonitoringFixedScheduleForDate(patient, date, now);
      if (!fixedSchedule?.fixedDay || !fixedSchedule.fixedTime) continue;
      if (!fixedDayMatchesDate(fixedSchedule.fixedDay, date)) continue;

      const firstTime = fixedSchedule.fixedTime;
      const hasFirst = hasPersistedScheduleOccurrence(dbSessionsForDate, {
        patientId: patient.id,
        date,
        time: firstTime,
      });
      if (!hasFirst) {
        result.push(createMonitoringVirtualSession(patient, date, firstTime, fixedSchedule.doubleSession, professionalName));
      }

      if (fixedSchedule.doubleSession) {
        const secondTime = addOneMonitoringHour(firstTime);
        const hasSecond = hasPersistedScheduleOccurrence(dbSessionsForDate, {
          patientId: patient.id,
          date,
          time: secondTime,
        });
        if (secondTime && !hasSecond) {
          result.push(createMonitoringVirtualSession(patient, date, secondTime, true, professionalName));
        }
      }
    }
  }

  return result.sort((left, right) => (
    `${left.date || ''}T${left.time || ''}|${left.id || ''}`
      .localeCompare(`${right.date || ''}T${right.time || ''}|${right.id || ''}`)
  ));
}

export function buildMonitoringSessionDataset({
  patients = [],
  sessions = [],
  weekRange = getSaoPauloWeekRange(),
  holidays = [],
  professionalName = 'Fábio Denarde',
  now = new Date(),
} = {}) {
  const visiblePatients = filterMonitoringPatients(patients);
  const allowedPatientIds = new Set(visiblePatients.map(patient => String(patient.id || '')));
  const persistedSessions = (Array.isArray(sessions) ? sessions : []).filter(session => (
    allowedPatientIds.has(String(session?.patientId || ''))
    && session?.isBlocked !== true
    && !isSessionRemovedFromAgenda(session)
  ));
  const virtualSessions = buildMonitoringWeekVirtualSessions({
    patients: visiblePatients,
    sessions,
    weekRange,
    holidays,
    professionalName,
    now,
  });
  const allSessions = [...persistedSessions, ...virtualSessions]
    .sort((left, right) => (
      `${left.date || ''}T${left.time || ''}|${left.id || ''}`
        .localeCompare(`${right.date || ''}T${right.time || ''}|${right.id || ''}`)
    ));

  return {
    patients: visiblePatients,
    sessions: allSessions,
    weekSessions: allSessions.filter(session => isDateWithinMonitoringWeek(session.date, weekRange)),
    virtualSessions,
  };
}
