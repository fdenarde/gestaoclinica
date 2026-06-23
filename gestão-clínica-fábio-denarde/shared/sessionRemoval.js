export const SESSION_REMOVAL_REASON = 'removed_after_cancellation';

function normalizeTime(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function isSessionRemovedFromAgenda(session) {
  return session?.removedFromAgenda === true;
}

export function isFixedScheduleOccurrence(session) {
  return Boolean(
    session
    && !session.isBlocked
    && (session.isFixedSchedule === true || String(session.source || '') === 'fixed'),
  );
}

export function hasPersistedScheduleOccurrence(sessions, {
  patientId,
  date,
  time,
} = {}) {
  const normalizedPatientId = String(patientId || '').trim();
  const normalizedDate = String(date || '').trim();
  const normalizedTime = normalizeTime(time);
  if (!normalizedPatientId || !normalizedDate || !normalizedTime) return false;

  return (Array.isArray(sessions) ? sessions : []).some(session => {
    if (String(session?.patientId || '').trim() !== normalizedPatientId) return false;

    const matchesCurrentSlot = String(session?.date || '').trim() === normalizedDate
      && normalizeTime(session?.time) === normalizedTime;
    if (matchesCurrentSlot) return true;

    const matchesFixedOrigin = String(session?.fixedScheduleOriginalDate || '').trim() === normalizedDate
      && normalizeTime(session?.fixedScheduleOriginalTime) === normalizedTime;
    if (matchesFixedOrigin) return true;

    const canSuppressFixedOrigin = session?.isFixedSchedule === true
      || String(session?.source || '') === 'fixed'
      || Boolean(session?.fixedScheduleOriginalDate || session?.fixedScheduleOriginalTime);
    if (!canSuppressFixedOrigin) return false;

    return (Array.isArray(session?.rescheduleHistory) ? session.rescheduleHistory : []).some(entry => (
      String(entry?.previousDate || '').trim() === normalizedDate
      && normalizeTime(entry?.previousTime) === normalizedTime
    ));
  });
}

export function removeSessionFromAgenda(sessions, sessionId, {
  removedAt = new Date().toISOString(),
  removedBy = 'Profissional',
} = {}) {
  const source = Array.isArray(sessions) ? sessions : [];
  const normalizedId = String(sessionId || '').trim();
  const target = source.find(session => String(session?.id || '') === normalizedId);

  if (!target) {
    return { sessions: source, changed: false, mode: 'not_found' };
  }

  if (isSessionRemovedFromAgenda(target)) {
    return { sessions: source, changed: false, mode: 'already_removed' };
  }

  if (!isFixedScheduleOccurrence(target)) {
    return {
      sessions: source.filter(session => String(session?.id || '') !== normalizedId),
      changed: true,
      mode: 'deleted',
    };
  }

  const tombstone = {
    ...target,
    status: 'Cancelada',
    consumesPackage: false,
    isBlocked: true,
    removedFromAgenda: true,
    removedFromAgendaAt: String(removedAt || ''),
    removedFromAgendaBy: String(removedBy || 'Profissional'),
    removalReason: SESSION_REMOVAL_REASON,
  };

  return {
    sessions: source.map(session => String(session?.id || '') === normalizedId ? tombstone : session),
    changed: true,
    mode: 'suppressed',
  };
}
