function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSessionNumber(value) {
  const number = Math.floor(Number(value) || 0);
  return number >= 1 && number <= 10 ? number : 0;
}

function normalizeDisplayEntry(entry = {}) {
  return {
    ...entry,
    sessionId: normalizeText(entry.sessionId),
    sessionNumber: normalizeSessionNumber(entry.sessionNumber),
    date: normalizeText(entry.date),
    time: normalizeText(entry.time),
    state: normalizeText(entry.state),
    justificationReason: normalizeText(entry.justificationReason),
  };
}

function stateSignature(entry) {
  return `${entry.state}|${entry.state === 'excused' ? entry.justificationReason : ''}`;
}

function sessionNumberSort(left, right) {
  return right.sessionNumber - left.sessionNumber
    || `${right.date}T${right.time}|${right.sessionId}`.localeCompare(`${left.date}T${left.time}|${left.sessionId}`);
}

function chronologicalTimeSort(left, right) {
  return `${left.time}|${left.sessionNumber}`.localeCompare(`${right.time}|${right.sessionNumber}`);
}

function joinDisplayValues(values) {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} e ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} e ${values.at(-1)}`;
}

function formatSessionLabel(entries) {
  const numbers = [...new Set(entries.map(entry => entry.sessionNumber).filter(Boolean))]
    .sort((left, right) => right - left);
  if (numbers.length === 0) return entries.length > 1 ? 'Sessões vinculadas' : 'Sessão vinculada';
  if (numbers.length === 1) return `Sessão ${numbers[0]}`;
  return `Sessões ${joinDisplayValues(numbers.map(String))}`;
}

/**
 * Builds presentation-only grouping for the media status of one activity card.
 * The caller provides entries from one card, so no proximity or cross-card
 * grouping can occur here.
 */
export function buildActivityGalleryMediaPresentation(entries = []) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map(normalizeDisplayEntry)
    .filter(entry => entry.sessionId)
    .sort(sessionNumberSort);
  const hasMultipleSessions = normalizedEntries.length >= 2;
  const firstDate = normalizedEntries[0]?.date || '';
  const sameDate = Boolean(firstDate) && normalizedEntries.every(entry => entry.date === firstDate);
  const firstStateSignature = stateSignature(normalizedEntries[0] || {});
  const sameState = normalizedEntries.length > 0
    && normalizedEntries.every(entry => stateSignature(entry) === firstStateSignature);
  const times = [...new Set(normalizedEntries
    .slice()
    .sort(chronologicalTimeSort)
    .map(entry => entry.time)
    .filter(Boolean))];

  return {
    entries: normalizedEntries,
    hasMultipleSessions,
    sameDate,
    sameState,
    canShareStatus: hasMultipleSessions && sameState,
    canCompactSchedule: hasMultipleSessions && sameDate && sameState,
    sessionLabel: formatSessionLabel(normalizedEntries),
    commonDate: sameDate ? firstDate : '',
    chronologicalTimes: joinDisplayValues(times),
  };
}
