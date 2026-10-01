import { sessionAllowsActivity, sessionConsumesPackage } from './sessionScheduling.js';
import { normalizeGooglePhotosAlbumUrl } from './googlePhotosAlbums.js';
import { isExplicitSessionAbsence } from './neuroFlowState.js';
import { NO_REPLACEMENT_REASON_OPTIONS, mapLegacyActivityReasonToCanonical } from './noReplacementReasons.js';
import { ACTIVITY_NO_MEDIA_REASON_OPTIONS, normalizeActivityJustificationReason } from './activityGalleryStatus.js';

const text = value => String(value || '').trim();
const orderKey = session => `${text(session.date)}T${text(session.time)}|${text(session.id)}`;
const ids = card => [...new Set((card?.sessionIds?.length ? card.sessionIds : [card?.sessionId]).map(text).filter(Boolean))];

export function formatActivitySummaryDate(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text(value);
}

function scopedSessions({ sessions = [], patientId = '', packageNumber = 0 }) {
  const seen = new Set();
  return sessions.filter(session => {
    const id = text(session.id);
    if (!id || seen.has(id) || text(session.patientId) !== text(patientId)) return false;
    if (packageNumber && session.activityPackageNumber && Number(session.activityPackageNumber) !== Number(packageNumber)) return false;
    seen.add(id);
    return true;
  }).slice().sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
}

function sessionNumber(session, source) {
  return Number(session.activitySessionNumber || session.logicalSessionNumber || session.sessionNumber || session.packageNumber)
    || source.findIndex(item => item.id === session.id) + 1;
}

/** @param {{card?: object, sessions?: object[]}} options */
export function getAccumulatedActivitySummaryLimitSessionId({ card, sessions = [] } = {}) {
  return sessions.filter(session => ids(card).includes(text(session.id)))
    .sort((a, b) => orderKey(a).localeCompare(orderKey(b))).at(-1)?.id || null;
}

function activitySummaryReasonOptions(kind) {
  return kind === 'absence' ? NO_REPLACEMENT_REASON_OPTIONS : ACTIVITY_NO_MEDIA_REASON_OPTIONS;
}

/** Shared display/summary resolver. Card visibility applies to card content only,
 * not to the independent canonical absence or active structured justification. */
export function resolveActivitySessionDisclosure({ session = {}, cards = [], statusRecord = null } = {}) {
  const canonicalAbsence = isExplicitSessionAbsence(session);
  const kind = canonicalAbsence ? 'absence' : 'media';
  const activeJustification = statusRecord?.justification?.active ? statusRecord.justification : null;
  const noMediaStructuredReason = activeJustification ? normalizeActivityJustificationReason(activeJustification.reason) : '';
  const canonicalOption = NO_REPLACEMENT_REASON_OPTIONS.find(option => option.code === text(session.noReplacementReasonCode))
    || NO_REPLACEMENT_REASON_OPTIONS.find(option => option.label === text(session.noReplacementReasonText));
  // Reuse the existing legacy mapping only after independent absence authority.
  const structuredReasonCode = canonicalAbsence ? canonicalOption?.code
    || (noMediaStructuredReason ? mapLegacyActivityReasonToCanonical(noMediaStructuredReason) : '') : noMediaStructuredReason;
  const structuredReasonText = (canonicalAbsence ? text(session.noReplacementReasonText) : '')
    || activitySummaryReasonOptions(kind).find(option => option.code === structuredReasonCode)?.label || '';
  const sharedCards = cards.filter(card => card.visibleToGuardian === true && card.status !== 'hidden' && card.status !== 'removed');
  const url = canonicalAbsence ? '' : sharedCards.map(card => normalizeGooglePhotosAlbumUrl(card.url)).find(Boolean) || '';
  const shareableObservation = (canonicalAbsence ? text(session.noReplacementObservation) : '')
    || text(activeJustification?.note) || text(sharedCards.find(card => text(card.observation))?.observation);
  const teamOnlyObservation = [...new Set(cards.filter(card => card.status !== 'removed'
    && (card.visibleToGuardian !== true || card.status === 'hidden')).map(card => text(card.observation)).filter(Boolean))].join('\n');
  const result = { kind, canonicalAbsence, url, hasValidMediaLink: Boolean(url), structuredReasonCode,
    structuredReasonText, shareableObservation, teamOnlyObservation, noMediaStructuredReason };
  const pendingReason = url || shareableObservation || (canonicalAbsence && structuredReasonText)
    ? '' : 'Informe o motivo / observação compartilhável.';
  return { ...result, pendingReason };
}

function draftValue(entry, draft, field) {
  return Object.hasOwn(draft, field) ? text(draft[field]) : text(entry[field]);
}

function formatSummaryAbsenceExplanation(value) {
  // Presentation only: the persisted note, status and classification remain untouched.
  return text(value).replace(/^Sem mídia\s*(?:[—:-]\s*)?/iu, '')
    .replace(/^Ausência registrada(?: nesta data)?\.?\s*(?:[—:-]\s*)?/iu, '')
    .replace(/^Falta\s*[—:-]\s*/iu, '')
    .replace(/\bFalta\b/giu, 'Ausência');
}

export function validateActivitySummaryDraft(entry, draft = {}) {
  if (entry.blocked) return entry.problem;
  if (!entry.url && !draftValue(entry, draft, 'note') && !(entry.kind === 'absence' && entry.structuredReasonText))
    return 'Informe o motivo / observação compartilhável.';
  return '';
}

/** The caller supplies the loaded, authoritative package timeline, never a filtered card list. */
export function buildActivitySummaryPlan({ patientId = '', patientName = '', sessions = [], albums = [], statusBySession = {}, throughSessionId = '', packageNumber = 0, writableAbsenceSessionIds = null } = {}) {
  const allSessions = scopedSessions({ patientId, sessions, packageNumber });
  const through = allSessions.find(session => text(session.id) === text(throughSessionId));
  const source = allSessions.filter(session => sessionConsumesPackage(session));
  if (!text(patientId) || !through) return { sourceComplete: false, entries: [], pending: [], summary: '' };
  const entries = source.filter(session => orderKey(session) <= orderKey(through)
    && (sessionAllowsActivity(session) || isExplicitSessionAbsence(session))).map(session => {
    const cards = albums.filter(card => text(card.patientId) === text(patientId)
      && (!packageNumber || Number(card.packageNumber) === Number(packageNumber))
      && card.status !== 'removed' && ids(card).includes(text(session.id)));
    const disclosure = resolveActivitySessionDisclosure({ session, cards, statusRecord: statusBySession[session.id] });
    const { kind, url, structuredReasonCode: reasonCode, shareableObservation: note } = disclosure;
    const missingAbsenceWriter = kind === 'absence' && writableAbsenceSessionIds !== null
      && !writableAbsenceSessionIds.includes(text(session.id)) && Boolean(disclosure.pendingReason);
    const blocked = missingAbsenceWriter || (!url && kind === 'media' && !['Realizada', 'Reposição'].includes(session.status));
    const problem = missingAbsenceWriter ? 'A ausência não está disponível na fonte canônica local para edição segura.'
        : blocked ? 'Esta sessão não possui um caminho de gravação de motivo compatível.' : '';
    const entry = { ...disclosure, sessionId: text(session.id), session, kind, number: sessionNumber(session, source),
      date: text(session.date), time: text(session.time), url, reasonCode, note, blocked, problem,
      summaryUrl: url ? cards.find(card => card.visibleToGuardian === true && card.status !== 'hidden'
        && normalizeGooglePhotosAlbumUrl(card.url) === url)?.url || url : '' };
    return { ...entry, problem: url ? '' : validateActivitySummaryDraft(entry) };
  });
  const pending = entries.filter(entry => entry.problem);
  const blocks = entries.map(entry => {
    const title = `*Sessão ${entry.number}*\n_${formatActivitySummaryDate(entry.date)}${entry.time ? ` às ${entry.time}` : ''}_`;
    if (entry.url) return `${title}\n${entry.summaryUrl}`;
    if (entry.kind === 'absence') {
      const explanation = formatSummaryAbsenceExplanation(entry.note) || formatSummaryAbsenceExplanation(entry.structuredReasonText);
      return `${title}\nAusência${explanation ? ` - ${explanation}` : ''}`;
    }
    return `${title}\n${entry.note}`;
  });
  const summary = !entries.length || pending.length ? ''
    : `*Segue abaixo o Registro das atividades - ${text(patientName)}*\n\n${blocks.join('\n\n')}`;
  return { sourceComplete: entries.length > 0, entries, pending, summary };
}

export function isAccumulatedActivitySummarySourceComplete(options = {}) {
  return buildActivitySummaryPlan(options).sourceComplete;
}

export function buildAccumulatedActivitySummary(options = {}) {
  return buildActivitySummaryPlan(options).summary;
}

/** Confirmation and full revalidation are required before the only clipboard call. */
export async function completeActivitySummary({ plan, drafts, saveEntry, isCurrent, onSaved, revalidate, copy }) {
  if (!isCurrent() || !plan.sourceComplete) return { ok: false, sessionId: '', error: 'O contexto mudou. Reabra o resumo.' };
  for (const entry of plan.pending) {
    const error = validateActivitySummaryDraft(entry, drafts[entry.sessionId]);
    if (error) return { ok: false, sessionId: entry.sessionId, error };
  }
  for (const entry of plan.pending) {
    if (!isCurrent()) return { ok: false, sessionId: entry.sessionId, error: 'O contexto mudou. Reabra o resumo.' };
    try {
      const draft = drafts[entry.sessionId] || {};
      // The existing writer needs its existing enum; this is not a summary input or requirement.
      const saved = await saveEntry(entry, { reasonCode: (entry.kind === 'absence' ? text(entry.session.noReplacementReasonCode) : '') || entry.reasonCode || 'other',
        note: draftValue(entry, draft, 'note') });
      if (saved !== true) throw new Error('Persistence not confirmed');
      onSaved(entry.sessionId);
    } catch {
      return { ok: false, sessionId: entry.sessionId, error: 'Não foi possível confirmar o salvamento desta sessão.' };
    }
  }
  const confirmed = revalidate();
  if (!isCurrent() || !confirmed.sourceComplete || confirmed.pending.length || !confirmed.summary)
    return { ok: false, sessionId: '', error: 'O resumo permanece incompleto. Nada foi copiado.' };
  await copy(confirmed.summary);
  return { ok: true, sessionId: '', error: '' };
}
