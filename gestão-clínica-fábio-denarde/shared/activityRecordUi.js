export const LEGACY_ACTIVITY_RECORD_CATEGORY = 'Atividade pedagógica';
export const DEFAULT_ACTIVITY_RECORD_CATEGORY = 'Atividade Neuropsicopedagógica';
export const INTERVENTION_ACTIVITY_RECORD_CATEGORY = 'Atividade de Intervenção';

export function getActivityRecordCategoryLabel(value) {
  const category = String(value || '').trim();
  return category === LEGACY_ACTIVITY_RECORD_CATEGORY
    ? DEFAULT_ACTIVITY_RECORD_CATEGORY
    : category;
}

export function activityRecordCategoryMatches(recordCategory, selectedCategory) {
  return getActivityRecordCategoryLabel(recordCategory) === getActivityRecordCategoryLabel(selectedCategory);
}

export function isConfirmedActivityRecord(record) {
  if (!record) return false;
  const status = String(record.status || 'active');
  const uploadStatus = String(record.uploadStatus || status || 'active');
  return status === 'active' && uploadStatus === 'active';
}

export function getUniqueActivityMediaKey(record) {
  if (!record) return '';
  const driveFileId = String(record.driveFileId || '').trim();
  if (driveFileId) return `drive:${driveFileId}`;
  const uploadAttemptId = String(record.uploadAttemptId || '').trim();
  if (uploadAttemptId) return `attempt:${uploadAttemptId}`;
  const id = String(record.id || '').trim();
  if (id) return `record:${id}`;
  const sha256 = String(record.sha256 || '').trim();
  if (sha256) return `hash:${sha256}:${Number(record.fileSize || 0)}`;
  return [
    String(record.sessionDate || ''),
    String(record.sessionTime || ''),
    String(record.fileName || ''),
    String(record.mimeType || ''),
    Number(record.fileSize || 0),
  ].join('|');
}

export function countUniqueConfirmedActivityMedia(records, predicate = () => true) {
  const unique = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!isConfirmedActivityRecord(record) || !predicate(record)) continue;
    const key = getUniqueActivityMediaKey(record);
    if (key) unique.add(key);
  }
  return unique.size;
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function normalizeTime(value) {
  const time = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
}

function formatDatePtBr(date) {
  const [year, month, day] = String(date || '').split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(date || '');
}

function formatList(values) {
  const normalized = values.filter(Boolean);
  if (normalized.length <= 1) return normalized[0] || '';
  return `${normalized.slice(0, -1).join(', ')} e ${normalized.at(-1)}`;
}

function isCompletedSession(session) {
  const status = String(session?.status || '');
  return status === 'Realizada' || status === 'Reposição';
}

export function buildActivitySessionGroups(sessions, records = undefined) {
  const mediaKnowledgeAvailable = Array.isArray(records);
  const activityRecords = mediaKnowledgeAvailable ? records : [];
  const byDate = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const date = normalizeDate(session?.date);
    const id = String(session?.id || '').trim();
    if (!date || !id) continue;
    const group = byDate.get(date) || { key: date, date, sessions: [] };
    if (!group.sessions.some(item => String(item.id) === id)) group.sessions.push(session);
    byDate.set(date, group);
  }

  return [...byDate.values()]
    .map(group => {
      const sortedSessions = group.sessions
        .slice()
        .sort((left, right) => `${normalizeTime(left?.time)}|${String(left?.id || '')}`.localeCompare(`${normalizeTime(right?.time)}|${String(right?.id || '')}`));
      const sessionIds = sortedSessions.map(session => String(session.id));
      const times = [...new Set(sortedSessions.map(session => normalizeTime(session.time)))];
      const sessionNumbers = [...new Set(sortedSessions
        .map(session => Number(session.activitySessionNumber ?? session.packageNumber))
        .filter(value => Number.isFinite(value) && value > 0))];
      const mediaCount = countUniqueConfirmedActivityMedia(
        activityRecords,
        record => normalizeDate(record?.sessionDate) === group.date,
      );
      return {
        ...group,
        sessions: sortedSessions,
        primarySessionId: sessionIds[0] || '',
        sessionIds,
        times,
        sessionNumbers,
        mediaCount: mediaKnowledgeAvailable ? mediaCount : null,
        allCompleted: sortedSessions.every(isCompletedSession),
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function formatActivitySessionGroupLabel(group) {
  if (!group || !Array.isArray(group.sessions) || group.sessions.length === 0) return 'Sessão relacionada';
  const mediaLabel = group.mediaCount === null || group.mediaCount === undefined
    ? ''
    : group.mediaCount === 0
      ? 'Sem mídias'
      : `${group.mediaCount} ${group.mediaCount === 1 ? 'mídia já enviada' : 'mídias já enviadas'}`;
  if (group.sessions.length === 1) {
    const session = group.sessions[0];
    const sessionNumber = Number(session.activitySessionNumber ?? session.packageNumber);
    const numberLabel = Number.isFinite(sessionNumber) && sessionNumber > 0
      ? ` • Sessão ${sessionNumber} do pacote atual`
      : '';
    return `${formatDatePtBr(group.date)} às ${normalizeTime(session.time)} • ${String(session.status || 'Sessão')} ${numberLabel}${mediaLabel ? ` • ${mediaLabel}` : ''}`
      .replace(/\s+•/g, ' •')
      .replace(/\s{2,}/g, ' ');
  }

  const sessionsLabel = group.allCompleted
    ? `${group.sessions.length} sessões realizadas`
    : `${group.sessions.length} sessões relacionadas`;
  const numbersLabel = group.sessionNumbers.length > 0
    ? ` • Sessões ${formatList(group.sessionNumbers.map(String))}`
    : '';
  return `${formatDatePtBr(group.date)} • ${sessionsLabel} • ${formatList(group.times)}${numbersLabel}${mediaLabel ? ` • ${mediaLabel}` : ''}`;
}

export function toggleActivitySessionSelection(groupSessionIds, currentSessionIds, sessionId, checked) {
  const allowedIds = (Array.isArray(groupSessionIds) ? groupSessionIds : [])
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const allowed = new Set(allowedIds);
  const next = new Set(
    (Array.isArray(currentSessionIds) ? currentSessionIds : [])
      .map(value => String(value || '').trim())
      .filter(value => allowed.has(value)),
  );
  const normalizedSessionId = String(sessionId || '').trim();
  if (normalizedSessionId && allowed.has(normalizedSessionId)) {
    if (checked) next.add(normalizedSessionId);
    else next.delete(normalizedSessionId);
  }
  if (next.size === 0) {
    return { sessionIds: allowedIds.filter(id => currentSessionIds?.includes?.(id)), blocked: true };
  }
  return { sessionIds: allowedIds.filter(id => next.has(id)).slice(0, 8), blocked: false };
}

/**
 * @param {Array<Record<string, any>> | undefined} records
 * @param {{ sha256?: string, date?: string, sessionIds?: string[] }} [options]
 */
export function findConfirmedActivityMediaDuplicate(records, options = {}) {
  const { sha256, date, sessionIds = [] } = options;
  const normalizedHash = String(sha256 || '').trim();
  if (!normalizedHash) return null;
  const selectedIds = new Set((Array.isArray(sessionIds) ? sessionIds : []).map(value => String(value || '').trim()).filter(Boolean));
  const normalizedDate = normalizeDate(date);

  let otherDateMatch = null;
  for (const record of Array.isArray(records) ? records : []) {
    if (!isConfirmedActivityRecord(record)) continue;
    const recordHashes = [record.sha256, record.originalContentHash, record.preparedContentHash]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (!recordHashes.includes(normalizedHash)) continue;
    const recordIds = new Set([
      String(record.sessionId || '').trim(),
      ...(Array.isArray(record.sessionIds) ? record.sessionIds : []).map(value => String(value || '').trim()),
    ].filter(Boolean));
    const linkedToSelectedSession = [...recordIds].some(id => selectedIds.has(id));
    const sameDate = normalizedDate && normalizeDate(record.sessionDate) === normalizedDate;
    if (linkedToSelectedSession || sameDate) {
      return { record, scope: 'same-date' };
    }
    if (!otherDateMatch) otherDateMatch = { record, scope: 'other-date' };
  }
  return otherDateMatch;
}
