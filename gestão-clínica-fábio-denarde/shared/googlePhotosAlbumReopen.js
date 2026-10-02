import { buildPackageTimeline, isExplicitSessionAbsence } from './neuroFlowState.js';
import { buildGooglePhotosAlbumGroupKey, normalizeGooglePhotosAlbumUrl } from './googlePhotosAlbums.js';

export const EXPLICIT_ALBUM_REOPEN = 'explicit-session-reopen';

// This is an album-only exception. It never changes activity/media eligibility.
export function resolveAlbumReopenSessions({ card, sessions = [], now = new Date() } = {}) {
  const ids = card?.sessionIds;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !id || id.includes('/'))) return null;
  if (!card.patientId || !card.packageNumber || !card.activityDate) return null;
  const timeline = buildPackageTimeline(sessions, card.patientId, card.packageNumber, now);
  const selected = ids.map(id => {
    const matches = sessions.filter(session => session.id === id);
    if (matches.length !== 1 || matches[0].patientId !== card.patientId) return null;
    if (sessions.some(other => other.id !== id && other.patientId === card.patientId
      && other.date === matches[0].date && other.time === matches[0].time)) return null;
    return timeline.find(session => session.id === id && session.date === card.activityDate) || null;
  });
  if (selected.some(session => !session)) return null;
  // Absence cards represent a single canonical session, never a regrouped activity.
  if (selected.some(isExplicitSessionAbsence) && selected.length !== 1) return null;
  const group = buildGooglePhotosAlbumGroupKey({ patientId: card.patientId, activityDate: card.activityDate, sessionIds: ids });
  return group && card.sessionGroupKey === group ? selected : null;
}

export function canReopenSessionAlbum({ card = null, sessions = [], albums = [], ready = false,
  canCreate = false, hasNoMediaJustification = false, now = new Date() } = {}) {
  if (!ready || !canCreate || !card || card.status === 'removed' || String(card.url || '').trim()) return false;
  const selected = resolveAlbumReopenSessions({ card, sessions, now });
  if (!selected || (!selected.some(isExplicitSessionAbsence) && !hasNoMediaJustification)) return false;
  // Even an invalid/hidden persisted binding is evidence of ambiguity, not absence.
  return !albums.some(album => album.patientId === card.patientId
    && Number(album.packageNumber) === Number(card.packageNumber)
    && (album.sessionIds?.some(id => card.sessionIds.includes(id))
      || (!album.sessionIds?.length && album.activityDate === card.activityDate)));
}

export function findBoundSessionAlbum(cards = [], sessionIds = [], activityDate = '') {
  if (activityDate && cards.some(card => !card.sessionIds?.length && card.activityDate === activityDate)) return { kind: 'ambiguous' };
  const matches = cards.filter(card => card.sessionIds?.some(id => sessionIds.includes(id)));
  if (!matches.length) return { kind: 'missing' };
  if (matches.length !== 1 || !normalizeGooglePhotosAlbumUrl(matches[0].url)) return { kind: 'ambiguous' };
  return { kind: 'existing', card: matches[0] };
}
