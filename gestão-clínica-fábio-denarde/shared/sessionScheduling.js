const PACKAGE_CONSUMING_STATUSES = new Set([
  'Realizada',
  'Reposição',
]);

const ABSENCE_STATUSES = new Set([
  'Falta',
  'late_cancellation_no_replacement',
]);

const ACTIVITY_ALLOWED_STATUSES = new Set([
  'Realizada',
  'Reposição',
]);

const PLANNED_STATUSES = new Set(['Agendada']);
const WOULD_BE_STATUSES = new Set([
  'Falta',
  'Falta.Prof',
  'Cancelada',
  'late_cancellation_no_replacement',
]);
const MAX_RESCHEDULE_HISTORY = 20;

export function normalizeAgendaTime(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function getSessionSequenceSortKey(session = {}) {
  return `${String(session.date || '')}T${normalizeAgendaTime(session.time)}|${String(session.id || '')}`;
}

function getSessionOccurrenceKey(session = {}) {
  const patientId = String(session?.patientId || '').trim();
  const date = String(session?.date || '').trim();
  const time = normalizeAgendaTime(session?.time);
  if (!patientId || !date || !time) return '';
  return `${patientId}|${date}|${time}`;
}

// A Agenda combina registros persistidos com ocorrências fixas virtuais. A
// sequência clínica precisa enxergar as duas fontes ao mesmo tempo, mas sem
// duplicar o mesmo horário quando ele já foi materializado no Firestore.
export function mergeSessionSequenceSource(sessions = [], supplementalSessions = []) {
  const merged = Array.isArray(sessions) ? sessions.slice() : [];
  const knownIds = new Set(
    merged
      .map(session => String(session?.id || '').trim())
      .filter(Boolean),
  );
  const knownOccurrences = new Set(
    merged
      .map(getSessionOccurrenceKey)
      .filter(Boolean),
  );

  for (const session of Array.isArray(supplementalSessions) ? supplementalSessions : []) {
    if (!session || isSessionRemovedOrBlocked(session)) continue;

    const id = String(session?.id || '').trim();
    const occurrenceKey = getSessionOccurrenceKey(session);
    if ((id && knownIds.has(id)) || (occurrenceKey && knownOccurrences.has(occurrenceKey))) {
      continue;
    }

    merged.push(session);
    if (id) knownIds.add(id);
    if (occurrenceKey) knownOccurrences.add(occurrenceKey);
  }

  return merged;
}

export function getSessionCycleNumberFromPosition(position) {
  const normalized = Math.floor(Number(position) || 0);
  if (normalized <= 0) return 0;
  return ((normalized - 1) % 10) + 1;
}

export function isSessionRemovedOrBlocked(session = {}) {
  return session.removedFromAgenda === true || session.isBlocked === true;
}

function normalizeThroughDate(value) {
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

export function normalizePackageConsumptionDecision(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

export function getPackageConsumptionDecision(session = {}) {
  if (!ABSENCE_STATUSES.has(String(session.status || ''))) return null;
  return normalizePackageConsumptionDecision(session.consumesPackage);
}

export function hasExplicitPackageConsumptionDecision(session = {}) {
  return getPackageConsumptionDecision(session) !== null;
}

export function dedupeSessionsByStableIdentity(sessions = []) {
  const unique = [];
  const knownIds = new Set();

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session) continue;
    const id = String(session.id || '').trim();
    if (id && knownIds.has(id)) continue;
    if (id) knownIds.add(id);
    unique.push(session);
  }

  return unique;
}

export function sessionConsumesPackage(session = {}, { throughDate = '' } = {}) {
  if (isSessionRemovedOrBlocked(session)) return false;

  const normalizedThroughDate = normalizeThroughDate(throughDate);
  const sessionDate = normalizeThroughDate(session.date);
  if (normalizedThroughDate && sessionDate && sessionDate > normalizedThroughDate) return false;

  const status = String(session.status || '');
  if (PACKAGE_CONSUMING_STATUSES.has(status)) return true;
  if (!ABSENCE_STATUSES.has(status)) return false;
  return getPackageConsumptionDecision(session) === true;
}

export function isCountedAbsenceSession(session = {}, options = {}) {
  if (!sessionConsumesPackage(session, options)) return false;
  const status = String(session.status || '');
  return status === 'Falta' || status === 'late_cancellation_no_replacement';
}

export function sessionAllowsActivity(session = {}, { throughDate = '' } = {}) {
  if (isSessionRemovedOrBlocked(session)) return false;
  const normalizedThroughDate = normalizeThroughDate(throughDate);
  const sessionDate = normalizeThroughDate(session.date);
  if (normalizedThroughDate && sessionDate && sessionDate > normalizedThroughDate) return false;
  return ACTIVITY_ALLOWED_STATUSES.has(String(session.status || ''));
}

export function getSessionPresentationStatus(session = {}) {
  const status = String(session.status || '');
  if (ABSENCE_STATUSES.has(status)) {
    const decision = getPackageConsumptionDecision(session);
    if (decision === true) return 'Falta contabilizada';
    if (decision === false) return 'Falta não contabilizada';
    return 'Falta — situação legada sem decisão explícita';
  }
  if (status === 'Falta.Prof') return 'Falta do profissional';
  return status || 'Agendada';
}

// Uma posição clínica avança sempre que o evento efetivamente consome o
// pacote. A atividade é uma dimensão separada: faltas contabilizadas ocupam a
// sequência sem admitir mídia ou registro clínico fictício.
export function isCompletedClinicalSession(session = {}) {
  return sessionConsumesPackage(session);
}

export function isPlannedClinicalSession(session = {}) {
  return !isSessionRemovedOrBlocked(session)
    && PLANNED_STATUSES.has(String(session.status || ''));
}

function isWouldBeClinicalSession(session = {}) {
  return !isSessionRemovedOrBlocked(session)
    && WOULD_BE_STATUSES.has(String(session.status || ''));
}

function normalizeStableLogicalPosition(session = {}) {
  const position = Math.floor(Number(session.logicalSessionPosition) || 0);
  return position > 0 ? position : 0;
}

function getPatientRealizedSessions(sessions = [], patientId = '', options = {}) {
  const normalizedPatientId = String(patientId || '');
  return dedupeSessionsByStableIdentity(sessions)
    .filter(session => (
      String(session?.patientId || '') === normalizedPatientId
      && sessionConsumesPackage(session, options)
    ))
    .slice()
    .sort((left, right) => getSessionSequenceSortKey(left).localeCompare(getSessionSequenceSortKey(right)));
}

function buildPatientSequencePositionMap(sessions = [], patientId = '', options = {}) {
  const normalizedPatientId = String(patientId || '');
  const source = Array.isArray(sessions) ? sessions : [];
  const positions = new Map();
  const usedPositions = new Set();

  const realized = getPatientRealizedSessions(source, normalizedPatientId, options);
  const reservedRealizedPositions = new Set(
    realized
      .map(normalizeStableLogicalPosition)
      .filter(position => position > 0),
  );
  let nextRealizedPosition = 1;

  for (const item of realized) {
    const id = String(item?.id || '');
    const stablePosition = normalizeStableLogicalPosition(item);
    let position = 0;

    if (stablePosition > 0 && !usedPositions.has(stablePosition)) {
      position = stablePosition;
    } else {
      while (
        reservedRealizedPositions.has(nextRealizedPosition)
        || usedPositions.has(nextRealizedPosition)
      ) {
        nextRealizedPosition += 1;
      }
      position = nextRealizedPosition;
      nextRealizedPosition += 1;
    }

    usedPositions.add(position);
    if (id) positions.set(id, position);
  }

  const realizedCount = realized.length;
  const lastRealizedKey = realizedCount > 0
    ? getSessionSequenceSortKey(realized[realizedCount - 1])
    : '';

  // Registros antigos que permaneceram como "Agendada" antes da última sessão
  // realizada não podem reservar posição no pacote atual. Sessões reagendadas
  // com posição lógica estável continuam incluídas, mesmo quando mudam de ordem.
  const planned = source
    .filter(item => {
      if (String(item?.patientId || '') !== normalizedPatientId) return false;
      if (!isPlannedClinicalSession(item)) return false;

      const stablePosition = normalizeStableLogicalPosition(item);
      if (stablePosition > 0) return true;
      if (!lastRealizedKey) return true;
      return getSessionSequenceSortKey(item) > lastRealizedKey;
    })
    .slice()
    .sort((left, right) => getSessionSequenceSortKey(left).localeCompare(getSessionSequenceSortKey(right)));

  const reservedPlannedPositions = new Set(
    planned
      .map(normalizeStableLogicalPosition)
      .filter(position => position > 0),
  );

  let nextPlannedPosition = realizedCount + 1;

  for (const item of planned) {
    const id = String(item?.id || '');
    const stablePosition = normalizeStableLogicalPosition(item);
    let position = 0;

    if (stablePosition > 0 && !usedPositions.has(stablePosition)) {
      position = stablePosition;
    } else {
      while (
        reservedPlannedPositions.has(nextPlannedPosition)
        || usedPositions.has(nextPlannedPosition)
      ) {
        nextPlannedPosition += 1;
      }
      position = nextPlannedPosition;
      nextPlannedPosition += 1;
    }

    usedPositions.add(position);
    if (id) positions.set(id, position);
  }

  return positions;
}

export function getSessionPackagePosition(sessions = [], session = {}, options = {}) {
  const empty = {
    logicalPosition: 0,
    packageNumber: 0,
    sessionNumber: 0,
    positionType: 'none',
    consumesPackage: false,
  };
  if (isSessionRemovedOrBlocked(session)) return empty;

  const consumesPackage = sessionConsumesPackage(session, options);
  const planned = isPlannedClinicalSession(session);
  const projected = isWouldBeClinicalSession(session) && !consumesPackage;
  let logicalPosition = 0;
  let positionType = 'none';

  if (consumesPackage || planned) {
    const positions = buildPatientSequencePositionMap(sessions, session.patientId, options);
    logicalPosition = positions.get(String(session?.id || '')) || 0;
    positionType = consumesPackage ? 'consumed' : 'planned';
  } else if (projected) {
    const targetKey = getSessionSequenceSortKey(session);
    const consumedBefore = getPatientRealizedSessions(sessions, session.patientId, options)
      .filter(item => getSessionSequenceSortKey(item) < targetKey)
      .length;
    logicalPosition = consumedBefore + 1;
    positionType = 'projected';
  }

  if (logicalPosition <= 0) return empty;
  return {
    logicalPosition,
    packageNumber: Math.floor((logicalPosition - 1) / 10) + 1,
    sessionNumber: getSessionCycleNumberFromPosition(logicalPosition),
    positionType,
    consumesPackage,
  };
}

export function getSessionLogicalPosition(sessions = [], session = {}, options = {}) {
  return getSessionPackagePosition(sessions, session, options).logicalPosition;
}

export function getCompletedSessions(sessions = [], patientId = '', options = {}) {
  return getPatientRealizedSessions(sessions, patientId, options);
}

export function getCompletedSessionCycleNumber(sessions = [], session = {}) {
  return getSessionCycleNumberFromPosition(getSessionLogicalPosition(sessions, session));
}

export function getPlannedSessionCycleNumber(sessions = [], session = {}) {
  return getSessionCycleNumberFromPosition(getSessionLogicalPosition(sessions, session));
}

export function getSessionCycleNumber(sessions = [], session = {}) {
  return getSessionPackagePosition(sessions, session).sessionNumber;
}

export function getSessionCycleLabel(sessions = [], session = {}) {
  const number = getSessionCycleNumber(sessions, session);
  if (number <= 0) return '';

  if (isCompletedClinicalSession(session)) return `Sessão foi ${number}`;
  if (isPlannedClinicalSession(session)) return `Sessão será ${number}`;
  if (isWouldBeClinicalSession(session)) return `Sessão seria ${number}`;
  return `Sessão ${number}`;
}

export function getCurrentPackageProgress(sessions = [], patientId = '') {
  const completedCount = getCompletedSessions(sessions, patientId).length;
  return completedCount === 0 ? 0 : getSessionCycleNumberFromPosition(completedCount);
}

function linkedActivitySessionIds(activity = {}) {
  const ids = Array.isArray(activity.sessionIds) && activity.sessionIds.length > 0
    ? activity.sessionIds
    : [activity.sessionId];
  return [...new Set(ids.map(value => String(value || '').trim()).filter(Boolean))];
}

export function buildEffectiveSessionHistory(sessions = [], {
  patientId = '',
  activities = [],
  throughDate = '',
  includeRemoved = false,
} = {}) {
  const normalizedPatientId = String(patientId || '').trim();
  const normalizedThroughDate = normalizeThroughDate(throughDate);
  const source = dedupeSessionsByStableIdentity(sessions)
    .filter(session => !normalizedPatientId || String(session.patientId || '') === normalizedPatientId)
    .filter(session => includeRemoved || !isSessionRemovedOrBlocked(session))
    .filter(session => {
      const date = normalizeThroughDate(session.date);
      return date && (!normalizedThroughDate || date <= normalizedThroughDate);
    })
    .slice()
    .sort((left, right) => getSessionSequenceSortKey(left).localeCompare(getSessionSequenceSortKey(right)));

  const activityIdsBySession = new Map();
  for (const [index, activity] of (Array.isArray(activities) ? activities : []).entries()) {
    const activityId = String(activity?.id || `activity-${index}`);
    for (const sessionId of linkedActivitySessionIds(activity)) {
      const activityIds = activityIdsBySession.get(sessionId) || new Set();
      activityIds.add(activityId);
      activityIdsBySession.set(sessionId, activityIds);
    }
  }

  return source.map(session => {
    const logicalPosition = getSessionLogicalPosition(source, session);
    const sessionNumber = getSessionCycleNumber(source, session);
    const activityCount = activityIdsBySession.get(String(session.id || ''))?.size || 0;
    const history = Array.isArray(session.noReplacementHistory) ? session.noReplacementHistory : [];
    const wasCountedAbsence = history.some(entry => (
      String(entry?.newStatus || '') === 'late_cancellation_no_replacement'
    ));
    const reopened = String(session.status || '') === 'Agendada' && wasCountedAbsence;
    const removed = isSessionRemovedOrBlocked(session);

    return {
      id: String(session.id || ''),
      sessionId: String(session.id || ''),
      patientId: String(session.patientId || ''),
      packageNumber: logicalPosition > 0 ? Math.floor((logicalPosition - 1) / 10) + 1 : null,
      date: String(session.date || ''),
      time: normalizeAgendaTime(session.time),
      sessionNumber,
      logicalSessionPosition: logicalPosition,
      originalStatus: String(session.status || ''),
      presentationStatus: getSessionPresentationStatus(session),
      consumesPackage: sessionConsumesPackage(session, { throughDate: normalizedThroughDate }),
      packageConsumptionDecision: getPackageConsumptionDecision(session),
      packageConsumptionDecisionRecorded: hasExplicitPackageConsumptionDecision(session),
      hasActivity: activityCount > 0,
      activityCount,
      sessionKind: String(session.status || '') === 'Reposição' || String(session.source || '') === 'reposition'
        ? 'replacement'
        : 'normal',
      absenceReason: String(session.noReplacementReasonText || session.noReplacementObservation || ''),
      reopened,
      reverted: reopened || removed || (String(session.status || '') === 'Cancelada' && wasCountedAbsence),
      removed,
    };
  });
}

function sanitizeVirtualSessionForPersistence(session = {}, generatedId) {
  const {
    isVirtual: _isVirtual,
    isValid: _isValid,
    blockedReason: _blockedReason,
    ...persisted
  } = session;
  void _isVirtual;
  void _isValid;
  void _blockedReason;

  return {
    ...persisted,
    id: generatedId,
    isFixedSchedule: true,
    source: 'fixed',
  };
}

export function rescheduleSessionInAgenda(sessions = [], session = {}, options = {}) {
  const source = Array.isArray(sessions) ? sessions : [];
  const newDate = String(options.newDate || '').trim();
  const newTime = normalizeAgendaTime(options.newTime);
  const previousDate = String(session.date || '').trim();
  const previousTime = normalizeAgendaTime(session.time);

  if (!newDate || !newTime) {
    return { sessions: source, changed: false, mode: 'invalid_target', session: null };
  }

  if (newDate === previousDate && newTime === previousTime) {
    return { sessions: source, changed: false, mode: 'no_change', session: null };
  }

  const existingIndex = source.findIndex(item => String(item?.id || '') === String(session?.id || ''));
  const isVirtual = session?.isVirtual === true || existingIndex < 0;
  const generatedId = String(options.generatedId || '').trim();
  if (isVirtual && !generatedId) {
    return { sessions: source, changed: false, mode: 'missing_generated_id', session: null };
  }

  const persistedBase = isVirtual
    ? sanitizeVirtualSessionForPersistence(session, generatedId)
    : source[existingIndex];
  const rescheduledAt = String(options.rescheduledAt || new Date().toISOString());
  const rescheduledBy = String(options.rescheduledBy || 'Profissional');
  const logicalSessionPosition = Math.floor(Number(options.logicalSessionPosition) || 0);
  const logicalSessionNumber = Math.floor(Number(options.logicalSessionNumber) || 0);
  const previousHistory = Array.isArray(persistedBase.rescheduleHistory)
    ? persistedBase.rescheduleHistory
    : [];
  const historyEntry = {
    previousDate,
    previousTime,
    newDate,
    newTime,
    changedAt: rescheduledAt,
    changedBy: rescheduledBy,
  };

  const fixedOriginDate = persistedBase.isFixedSchedule === true || String(persistedBase.source || '') === 'fixed'
    ? String(persistedBase.fixedScheduleOriginalDate || previousDate)
    : persistedBase.fixedScheduleOriginalDate;
  const fixedOriginTime = persistedBase.isFixedSchedule === true || String(persistedBase.source || '') === 'fixed'
    ? normalizeAgendaTime(persistedBase.fixedScheduleOriginalTime || previousTime)
    : persistedBase.fixedScheduleOriginalTime;

  const updatedSession = {
    ...persistedBase,
    date: newDate,
    time: newTime,
    rescheduledAt,
    rescheduledBy,
    rescheduleHistory: [...previousHistory, historyEntry].slice(-MAX_RESCHEDULE_HISTORY),
  };

  let preservedLogicalPosition = logicalSessionPosition > 0
    ? logicalSessionPosition
    : Math.floor(Number(persistedBase.logicalSessionPosition) || 0);
  if (preservedLogicalPosition <= 0 && logicalSessionNumber >= 1 && logicalSessionNumber <= 10) {
    const completedCount = getCompletedSessions(source, session.patientId).length;
    preservedLogicalPosition = Math.floor(completedCount / 10) * 10 + logicalSessionNumber;
    while (preservedLogicalPosition <= completedCount) preservedLogicalPosition += 10;
  }

  if (preservedLogicalPosition > 0) {
    const preservedLogicalNumber = getSessionCycleNumberFromPosition(preservedLogicalPosition);
    updatedSession.logicalSessionPosition = preservedLogicalPosition;
    updatedSession.logicalSessionNumber = preservedLogicalNumber;
    updatedSession.packageNumber = preservedLogicalNumber;
  } else {
    delete updatedSession.logicalSessionPosition;
    delete updatedSession.logicalSessionNumber;
  }

  if (fixedOriginDate && fixedOriginTime) {
    updatedSession.fixedScheduleOriginalDate = fixedOriginDate;
    updatedSession.fixedScheduleOriginalTime = fixedOriginTime;
  } else {
    delete updatedSession.fixedScheduleOriginalDate;
    delete updatedSession.fixedScheduleOriginalTime;
  }

  const nextSessions = existingIndex >= 0
    ? source.map((item, index) => index === existingIndex ? updatedSession : item)
    : [...source, updatedSession];

  return {
    sessions: nextSessions,
    changed: true,
    mode: existingIndex >= 0 ? 'updated' : 'materialized',
    session: updatedSession,
  };
}
