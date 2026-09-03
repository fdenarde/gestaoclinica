import { sessionAllowsActivity } from './sessionScheduling.js';
import { normalizeGooglePhotosAlbumUrl } from './googlePhotosAlbums.js';

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizePackageNumber(value) {
  const number = Math.floor(Number(value) || 0);
  return number >= 1 && number <= 10 ? number : 0;
}

function albumBelongsToPackage(album, packageNumber) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  if (!normalizedPackageNumber) return true;
  const albumPackageNumber = normalizePackageNumber(album?.packageNumber);
  return !albumPackageNumber || albumPackageNumber === normalizedPackageNumber;
}

function patientSessions(sessions, patientId) {
  const normalizedPatientId = normalizeId(patientId);
  const seen = new Set();
  return (Array.isArray(sessions) ? sessions : []).filter(session => {
    const id = normalizeId(session?.id);
    if (!id || seen.has(id) || normalizeId(session?.patientId) !== normalizedPatientId) return false;
    seen.add(id);
    return true;
  });
}

function albumSessionIds(album) {
  const ids = Array.isArray(album?.sessionIds) && album.sessionIds.length > 0
    ? album.sessionIds
    : [album?.sessionId];
  return [...new Set(ids.map(normalizeId).filter(Boolean))];
}

function formatSummaryDate(value) {
  const match = normalizeId(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : normalizeId(value);
}

function sessionOrderKey(session) {
  return `${normalizeId(session?.date)}T${normalizeId(session?.time)}|${normalizeId(session?.id)}`;
}

function packageSessionNumber(sessions, session) {
  const localCandidates = [
    session?.activitySessionNumber,
    session?.logicalSessionNumber,
    session?.sessionNumber,
    session?.packageNumber,
  ];
  for (const candidate of localCandidates) {
    const normalized = Math.floor(Number(candidate) || 0);
    if (normalized >= 1 && normalized <= 10) return normalized;
  }

  const ordered = patientSessions(sessions, session?.patientId)
    .slice()
    .sort((left, right) => sessionOrderKey(left).localeCompare(sessionOrderKey(right)));
  const index = ordered.findIndex(item => normalizeId(item?.id) === normalizeId(session?.id));
  return index >= 0 && index < 10 ? index + 1 : 0;
}

function joinPortuguese(values) {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} e ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} e ${values.at(-1)}`;
}

function formatSummarySessionLabel(numbers) {
  const normalizedNumbers = [...new Set(numbers
    .map(value => normalizePackageNumber(value))
    .filter(Boolean))].sort((left, right) => right - left);
  if (normalizedNumbers.length === 0) return 'Sessão';
  if (normalizedNumbers.length === 1) return `Sessão ${normalizedNumbers[0]}`;
  return `Sessões ${joinPortuguese(normalizedNumbers)}`;
}

function sessionDateTime(session) {
  return {
    date: normalizeId(session?.date),
    time: normalizeId(session?.time),
  };
}

export function isAccumulatedActivitySummarySourceComplete({
  patientId = '',
  sessions = [],
  albums = [],
  throughSessionId = '',
  packageNumber = 0,
} = {}) {
  const normalizedPatientId = normalizeId(patientId);
  const source = patientSessions(sessions, normalizedPatientId);
  const sessionById = new Map(source.map(session => [normalizeId(session.id), session]));
  const throughSession = sessionById.get(normalizeId(throughSessionId));
  const throughPosition = throughSession ? packageSessionNumber(source, throughSession) : 0;
  if (!normalizedPatientId || !throughSession || throughPosition <= 0) return false;

  const coveredSessionIds = new Set();
  for (const album of Array.isArray(albums) ? albums : []) {
    if (
      !album
      || normalizeId(album.patientId) !== normalizedPatientId
      || !albumBelongsToPackage(album, packageNumber)
    ) continue;
    albumSessionIds(album).forEach(sessionId => coveredSessionIds.add(sessionId));
  }

  return source.every(session => {
    const position = packageSessionNumber(source, session);
    if (
      position <= 0
      || position > throughPosition
      || !sessionAllowsActivity(session)
    ) return true;
    return coveredSessionIds.has(normalizeId(session.id));
  });
}

/**
 * @param {{card?: object, sessions?: object[]}} options
 */
export function getAccumulatedActivitySummaryLimitSessionId({ card, sessions = [] } = {}) {
  const source = Array.isArray(sessions) ? sessions : [];
  const sessionById = new Map(source.map(session => [normalizeId(session?.id), session]));
  const candidates = albumSessionIds(card)
    .map(id => sessionById.get(id))
    .filter(Boolean)
    .sort((left, right) => packageSessionNumber(source, left) - packageSessionNumber(source, right));
  return normalizeId(candidates.at(-1)?.id || card?.sessionId || card?.sessionIds?.[0]) || null;
}

export function buildAccumulatedActivitySummary({
  patientId = '',
  patientName = '',
  sessions = [],
  albums = [],
  throughSessionId = '',
  packageNumber = 0,
} = {}) {
  const normalizedPatientId = normalizeId(patientId);
  const source = patientSessions(sessions, normalizedPatientId);
  const sessionById = new Map(source.map(session => [normalizeId(session.id), session]));
  const throughSession = sessionById.get(normalizeId(throughSessionId));
  const throughPosition = throughSession ? packageSessionNumber(source, throughSession) : 0;
  if (!normalizedPatientId || !throughSession || throughPosition <= 0) return '';

  const entries = [];
  const seenActivityIds = new Set();
  for (const album of Array.isArray(albums) ? albums : []) {
    if (
      !album
      || normalizeId(album.patientId) !== normalizedPatientId
      || normalizeId(album.status) === 'removed'
      || !albumBelongsToPackage(album, packageNumber)
    ) continue;

    const url = normalizeGooglePhotosAlbumUrl(album.url);
    if (!url) continue;

    const activityId = normalizeId(album.id || album.sessionGroupKey);
    if (!activityId || seenActivityIds.has(activityId)) continue;

    const linkedSessions = albumSessionIds(album)
      .map(sessionId => sessionById.get(sessionId))
      .filter(session => session && sessionAllowsActivity(session))
      .map(session => ({
        session,
        position: packageSessionNumber(source, session),
        ...sessionDateTime(session),
      }))
      .filter(entry => entry.position > 0 && entry.position <= throughPosition)
      .sort((left, right) => (
        right.position - left.position
        || sessionOrderKey(right.session).localeCompare(sessionOrderKey(left.session))
      ));

    if (linkedSessions.length === 0) continue;

    const fallbackDate = normalizeId(album.activityDate);
    const fallbackTime = normalizeId(album.sessionTime);
    linkedSessions.forEach(entry => {
      entry.date = entry.date || fallbackDate;
      entry.time = entry.time || fallbackTime;
    });

    entries.push({
      position: linkedSessions[0].position,
      sessionNumbers: linkedSessions.map(entry => entry.position),
      sessions: linkedSessions,
      url,
      id: activityId,
    });
    seenActivityIds.add(activityId);
  }

  entries.sort((left, right) => (
    right.position - left.position
      || `${right.sessions[0]?.date || ''}T${right.sessions[0]?.time || ''}|${right.id}`
        .localeCompare(`${left.sessions[0]?.date || ''}T${left.sessions[0]?.time || ''}|${left.id}`)
  ));

  if (entries.length === 0) return '';
  const headerName = normalizeId(patientName);
  const blocks = entries.map(entry => {
    const dates = [...new Set(entry.sessions.map(item => item.date).filter(Boolean))];
    const title = formatSummarySessionLabel(entry.sessionNumbers);
    let temporalLines;

    if (dates.length <= 1) {
      const date = dates[0] || '';
      const times = joinPortuguese([...new Set(entry.sessions
        .map(item => item.time)
        .filter(Boolean))].sort());
      temporalLines = `${formatSummaryDate(date)}${times ? ` às ${times}` : ''}`.trim();
    } else {
      temporalLines = entry.sessions
        .map(item => `Sessão ${item.position} — ${formatSummaryDate(item.date)}${item.time ? ` às ${item.time}` : ''}`)
        .join('\n');
    }

    return [`*${title}*`, temporalLines, entry.url].join('\n');
  });
  return `*Registro das atividades - ${headerName}*\n\n${blocks.join('\n\n')}`;
}
