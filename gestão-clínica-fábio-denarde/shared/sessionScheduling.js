const REALIZED_STATUSES = new Set([
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

// Mantém a mesma definição do card "Sessões Restantes (Pacote atual)":
// apenas sessões efetivamente realizadas ou de reposição avançam a sequência
// exibida na Agenda. Faltas, cancelamentos e faltas sem reposição continuam
// podendo ter efeitos financeiros próprios, mas não criam uma divergência
// visual entre o card do pacote e o texto "Sessão será".
export function isCompletedClinicalSession(session = {}) {
  if (isSessionRemovedOrBlocked(session)) return false;
  return REALIZED_STATUSES.has(String(session.status || ''));
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

function normalizeStoredCycleNumber(session = {}) {
  const candidates = [
    session.logicalSessionNumber,
    session.packageNumber,
  ];

  for (const candidate of candidates) {
    const number = Math.floor(Number(candidate) || 0);
    if (number >= 1 && number <= 10) return number;
  }

  return 0;
}

function getPatientRealizedSessions(sessions = [], patientId = '') {
  const normalizedPatientId = String(patientId || '');
  return (Array.isArray(sessions) ? sessions : [])
    .filter(session => (
      String(session?.patientId || '') === normalizedPatientId
      && isCompletedClinicalSession(session)
    ))
    .slice()
    .sort((left, right) => getSessionSequenceSortKey(left).localeCompare(getSessionSequenceSortKey(right)));
}

function buildPatientSequencePositionMap(sessions = [], patientId = '') {
  const normalizedPatientId = String(patientId || '');
  const source = Array.isArray(sessions) ? sessions : [];
  const positions = new Map();
  const usedPositions = new Set();

  const realized = getPatientRealizedSessions(source, normalizedPatientId);
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

export function getSessionLogicalPosition(sessions = [], session = {}) {
  if (isSessionRemovedOrBlocked(session)) return 0;

  if (isCompletedClinicalSession(session) || isPlannedClinicalSession(session)) {
    const positions = buildPatientSequencePositionMap(sessions, session.patientId);
    const mappedPosition = positions.get(String(session?.id || '')) || 0;
    if (mappedPosition > 0) return mappedPosition;
  }

  if (isWouldBeClinicalSession(session)) {
    const stablePosition = normalizeStableLogicalPosition(session);
    if (stablePosition > 0) return stablePosition;

    const targetKey = getSessionSequenceSortKey(session);
    const realizedBefore = getPatientRealizedSessions(sessions, session.patientId)
      .filter(item => getSessionSequenceSortKey(item) < targetKey)
      .length;
    return realizedBefore + 1;
  }

  return 0;
}

export function getCompletedSessions(sessions = [], patientId = '') {
  return getPatientRealizedSessions(sessions, patientId);
}

export function getCompletedSessionCycleNumber(sessions = [], session = {}) {
  return getSessionCycleNumberFromPosition(getSessionLogicalPosition(sessions, session));
}

export function getPlannedSessionCycleNumber(sessions = [], session = {}) {
  return getSessionCycleNumberFromPosition(getSessionLogicalPosition(sessions, session));
}

export function getSessionCycleNumber(sessions = [], session = {}) {
  if (isSessionRemovedOrBlocked(session)) return 0;

  if (isCompletedClinicalSession(session) || isPlannedClinicalSession(session)) {
    return getSessionCycleNumberFromPosition(getSessionLogicalPosition(sessions, session));
  }

  if (isWouldBeClinicalSession(session)) {
    const stablePosition = normalizeStableLogicalPosition(session);
    if (stablePosition > 0) return getSessionCycleNumberFromPosition(stablePosition);

    const storedCycleNumber = normalizeStoredCycleNumber(session);
    if (storedCycleNumber > 0) return storedCycleNumber;

    return getSessionCycleNumberFromPosition(getSessionLogicalPosition(sessions, session));
  }

  return 0;
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
