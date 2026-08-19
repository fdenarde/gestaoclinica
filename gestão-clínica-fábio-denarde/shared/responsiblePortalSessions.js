function normalizeDate(value) {
  const date = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function normalizeTime(value) {
  const time = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
}

function sessionSortKey(session) {
  return `${normalizeDate(session?.date)}T${normalizeTime(session?.time)}|${String(session?.id || '')}`;
}

function referenceEventForGroup(events) {
  return events.reduce((latest, session) => {
    if (!latest) return session;
    return sessionSortKey(session).localeCompare(sessionSortKey(latest)) > 0 ? session : latest;
  }, null);
}

/**
 * Builds the progressive list shown to the responsible party.
 * It keeps all reached sessions plus only the next future session, while
 * retaining the complete schedule solely for the package-end forecast.
 */
export function buildResponsiblePortalSessionProgress(
  sessions = [],
  { today = getSaoPauloDateKey(), consumedCount = 0, targetCount = 10 } = {},
) {
  const normalizedToday = normalizeDate(today) || getSaoPauloDateKey();
  const safeTargetCount = Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 10;
  const sessionGroups = new Map();

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const number = Number(session?.sessionNumber);
    if (!Number.isInteger(number) || number < 1 || number > safeTargetCount) continue;
    const groupKey = session?.positionType === 'projected'
      ? `projected:${number}:${String(session?.id || sessionSortKey(session))}`
      : `position:${number}`;
    const group = sessionGroups.get(groupKey) || { groupKey, number, events: [] };
    group.events.push(session);
    sessionGroups.set(groupKey, group);
  }

  const groups = Array.from(sessionGroups.values())
    .map(({ groupKey, number, events }) => {
      const orderedEvents = [...events].sort((left, right) => sessionSortKey(left).localeCompare(sessionSortKey(right)));
      const referenceEvent = referenceEventForGroup(orderedEvents);
      const dates = orderedEvents.map(item => normalizeDate(item?.date)).filter(Boolean);
      const hasReachedDate = dates.some(date => date <= normalizedToday);
      const earliestFutureDate = dates.filter(date => date > normalizedToday).sort()[0] || '';
      return {
        groupKey,
        number,
        events: orderedEvents,
        referenceEvent,
        hasReachedDate,
        earliestFutureDate,
        sortKey: referenceEvent ? sessionSortKey(referenceEvent) : '',
      };
    })
    .sort((left, right) => left.number - right.number);

  const reachedNumbers = groups
    .filter(group => group.hasReachedDate)
    .map(group => group.number);
  const reachedByDate = reachedNumbers.length ? Math.max(...reachedNumbers) : 0;
  const reachedCount = Math.max(0, Math.min(safeTargetCount, Number(consumedCount) || 0), reachedByDate);

  const futureGroups = groups
    .filter(group => group.number > reachedCount && group.earliestFutureDate)
    .sort((left, right) => {
      if (left.earliestFutureDate !== right.earliestFutureDate) {
        return left.earliestFutureDate.localeCompare(right.earliestFutureDate);
      }
      return left.number - right.number;
    });
  const nextFutureGroup = futureGroups[0] || null;
  const nextAppointmentGroups = nextFutureGroup
    ? futureGroups.filter(group => group.earliestFutureDate === nextFutureGroup.earliestFutureDate)
    : [];

  let visibleMaxNumber = reachedCount;
  if (nextAppointmentGroups.length) {
    visibleMaxNumber = Math.max(visibleMaxNumber, ...nextAppointmentGroups.map(group => group.number));
  }
  if (visibleMaxNumber === 0 && groups.length) visibleMaxNumber = groups[0].number;

  const visibleGroups = groups
    .filter(group => group.number <= visibleMaxNumber)
    .sort((left, right) => {
      if (left.number !== right.number) return right.number - left.number;
      return right.sortKey.localeCompare(left.sortKey);
    });

  const forecastGroups = groups.filter(group => group.number <= safeTargetCount && group.referenceEvent?.date);
  const targetGroup = groups.find(group => group.number === safeTargetCount) || null;
  const forecastEndDate = normalizeDate(targetGroup?.referenceEvent?.date);
  const scheduledDates = [...new Set(
    forecastGroups
      .map(group => normalizeDate(group.referenceEvent?.date))
      .filter(Boolean),
  )].sort();

  return {
    visibleGroups,
    reachedCount,
    nextSessionNumber: nextFutureGroup?.number || null,
    forecastEndDate,
    forecastComplete: Boolean(forecastEndDate),
    scheduledSessionCount: forecastGroups.length,
    scheduledDateCount: scheduledDates.length,
    scheduledDates,
  };
}
import { getSaoPauloDateKey } from './clinicalDate.js';
