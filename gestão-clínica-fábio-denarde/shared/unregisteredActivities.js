import { getActivitySessionEndAt } from './activityGalleryStatus.js';
import { buildActivityMediaPackageModel } from './activityMediaPackages.js';
import {
  groupGooglePhotosActivitySessions,
  isValidGooglePhotosAlbumUrl,
  normalizeGooglePhotosSessionIds,
} from './googlePhotosAlbums.js';
import { sessionAllowsActivity } from './sessionScheduling.js';

const SAFE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
  const normalized = String(value || '').trim().slice(0, 10);
  return SAFE_DATE_PATTERN.test(normalized) ? normalized : '';
}

function normalizeNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeTime(value) {
  const normalized = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : '';
}

function uniqueNumbers(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))]
    .sort((a, b) => a - b);
}

function recordIsActive(record) {
  const status = String(record?.status || record?.uploadStatus || '').trim().toLowerCase();
  return !['failed', 'cancelled', 'deleting', 'delete_failed', 'deleted'].includes(status)
    && !record?.deletedAt;
}

function recordMatchesGroup(record, group) {
  if (!recordIsActive(record)) return false;
  if (String(record?.patientId || '') !== group.patientId) return false;
  const recordSessionIds = normalizeGooglePhotosSessionIds(record?.sessionIds?.length ? record.sessionIds : [record?.sessionId]);
  if (recordSessionIds.some(sessionId => group.sessionIds.includes(sessionId))) return true;
  return normalizeDate(record?.sessionDate || record?.activityAt) === group.date;
}

function albumMatchesGroup(album, group) {
  if (!album || String(album?.patientId || '') !== group.patientId) return false;
  if (Number(album?.packageNumber || 0) !== group.packageNumber) return false;
  if (String(album?.status || 'active') === 'removed') return false;
  if (!isValidGooglePhotosAlbumUrl(album?.url)) return false;
  const albumSessionIds = normalizeGooglePhotosSessionIds(album?.sessionIds?.length ? album.sessionIds : [album?.sessionId]);
  if (albumSessionIds.some(sessionId => group.sessionIds.includes(sessionId))) return true;
  return normalizeDate(album?.activityDate) === group.date;
}

function getGroupEndAt(sessions) {
  const grouped = Array.isArray(sessions) && sessions.length > 1;
  return sessions
    .map(session => getActivitySessionEndAt(grouped
      ? { ...session, type: 'Sessão simples (50 min)' }
      : session))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

export function buildUnregisteredActivityGroups({
  patients = [],
  sessions = [],
  payments = [],
  activityRecords = [],
  googlePhotosAlbums = [],
  monitoringStart = '',
  now = new Date(),
} = {}) {
  const nowAt = normalizeNow(now);
  const monitoringStartDate = normalizeDate(monitoringStart);
  if (!monitoringStartDate) return [];

  const patientMap = new Map((Array.isArray(patients) ? patients : []).map(patient => [String(patient?.id || ''), patient]));
  const records = Array.isArray(activityRecords) ? activityRecords : [];
  const albums = Array.isArray(googlePhotosAlbums) ? googlePhotosAlbums : [];
  const result = [];

  for (const patient of patientMap.values()) {
    const patientId = String(patient?.id || '');
    if (!patientId) continue;
    const patientSessions = (Array.isArray(sessions) ? sessions : []).filter(session => String(session?.patientId || '') === patientId);
    const model = buildActivityMediaPackageModel(patientSessions, {
      patientId,
      now: nowAt,
      payments,
      packageTolerances: patient?.packageTolerances || [],
    });

    for (const pkg of model.packages) {
      const realized = (pkg.sessions || []).filter(session => (
        sessionAllowsActivity(session)
        && normalizeDate(session?.date) >= monitoringStartDate
      ));
      const groups = groupGooglePhotosActivitySessions(realized, {
        patientDoubleSession: patient?.doubleSession === true,
      });

      for (const rawGroup of groups) {
        const groupSessions = rawGroup.slice().sort((left, right) => (
          `${left?.date || ''}T${normalizeTime(left?.time)}|${left?.id || ''}`
            .localeCompare(`${right?.date || ''}T${normalizeTime(right?.time)}|${right?.id || ''}`)
        ));
        const first = groupSessions[0];
        const date = normalizeDate(first?.date);
        const endAt = getGroupEndAt(groupSessions);
        if (!date || !endAt || endAt.getTime() > nowAt.getTime()) continue;

        const sessionIds = normalizeGooglePhotosSessionIds(groupSessions.map(session => session?.id));
        const group = {
          id: `activity-missing:${patientId}:${pkg.number}:${date}:${sessionIds.join(',')}`,
          patientId,
          patientName: String(patient?.name || patient?.fullName || 'Atendente').trim() || 'Atendente',
          patientPhotoUrl: String(patient?.photoUrl || ''),
          patientPhotoDriveFileId: String(patient?.photoDriveFileId || ''),
          packageNumber: Number(pkg.number || 0),
          date,
          times: groupSessions.map(session => normalizeTime(session?.time)).filter(Boolean),
          sessionIds,
          sessionNumbers: uniqueNumbers(groupSessions.map(session => (
            session?.activitySessionNumber ?? session?.logicalSessionNumber ?? session?.packageNumber
          ))),
          endAt: endAt.toISOString(),
          doubleOrReplacement: groupSessions.length > 1,
        };

        const hasActivityRecord = records.some(record => recordMatchesGroup(record, group));
        const hasGooglePhotosLink = albums.some(album => albumMatchesGroup(album, group));
        if (!hasActivityRecord && !hasGooglePhotosLink) result.push(group);
      }
    }
  }

  return result.sort((left, right) => (
    `${left.date}T${left.times[0] || '00:00'}|${left.patientName}`
      .localeCompare(`${right.date}T${right.times[0] || '00:00'}|${right.patientName}`)
  ));
}
