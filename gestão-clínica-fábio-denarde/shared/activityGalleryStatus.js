import { sessionAllowsActivity } from './sessionScheduling.js';

export const ACTIVITY_MONITORING_TIME_ZONE = 'America/Sao_Paulo';
export const ACTIVITY_UPLOAD_GRACE_HOURS = 24;
export const ACTIVITY_UPLOAD_ESCALATION_HOURS = [48, 72];
export const ACTIVITY_NO_MEDIA_REASON_OPTIONS = Object.freeze([
  { code: 'responsible_accompanied', label: 'Responsável acompanhou a sessão' },
  { code: 'activity_without_media', label: 'Atividade sem necessidade de mídia' },
  { code: 'recording_not_authorized', label: 'Registro não autorizado' },
  { code: 'professional_opted_out', label: 'Profissional optou por não registrar mídia' },
  { code: 'no_recording_opportunity', label: 'Não houve oportunidade de registro' },
  { code: 'technical_issue', label: 'Problema técnico que impossibilitou o registro' },
  { code: 'other', label: 'Outro motivo' },
]);

const LEGACY_NO_MEDIA_REASON_MAP = Object.freeze({
  'atividade sem registro visual': 'activity_without_media',
  'responsável não autorizou': 'recording_not_authorized',
  'sessão administrativa': 'activity_without_media',
  'atendimento virtual': 'activity_without_media',
  'mídia não produzida': 'activity_without_media',
  'problema técnico': 'technical_issue',
  'outro': 'other',
});

export function normalizeActivityJustificationReason(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
  if (ACTIVITY_NO_MEDIA_REASON_OPTIONS.some(option => option.code === normalized)) return normalized;
  return LEGACY_NO_MEDIA_REASON_MAP[normalized] || '';
}

export function getActivityJustificationReasonLabel(value) {
  const normalized = normalizeActivityJustificationReason(value);
  return ACTIVITY_NO_MEDIA_REASON_OPTIONS.find(option => option.code === normalized)?.label || 'Sem mídia';
}

function parseDateTimeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getActivitySessionDurationMinutes(sessionType) {
  const normalized = String(sessionType || '').toLocaleLowerCase('pt-BR');
  if (normalized.includes('dupla') || normalized.includes('2 × 50') || normalized.includes('2 x 50')) return 100;
  return 50;
}

export function getActivitySessionStartAt(session) {
  const date = String(session?.date || '').trim();
  const time = String(session?.time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getActivitySessionEndAt(session) {
  const startAt = getActivitySessionStartAt(session);
  if (!startAt) return null;
  return new Date(startAt.getTime() + getActivitySessionDurationMinutes(session?.type) * 60_000);
}

export function getActivityUploadDeadline(session) {
  const endAt = getActivitySessionEndAt(session);
  if (!endAt) return null;
  return new Date(endAt.getTime() + ACTIVITY_UPLOAD_GRACE_HOURS * 60 * 60_000);
}

export function normalizeActivitySessionIds(recordOrInput) {
  const raw = Array.isArray(recordOrInput?.sessionIds)
    ? recordOrInput.sessionIds
    : [recordOrInput?.sessionId];
  return [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 8);
}

export function resolveActivityUploadState({ session, monitoringStart, statusRecord, now = new Date() }) {
  const endAt = getActivitySessionEndAt(session);
  const deadlineAt = getActivityUploadDeadline(session);
  const monitoringStartAt = parseDateTimeValue(monitoringStart);
  const nowAt = parseDateTimeValue(now) || new Date();
  const justification = statusRecord?.justification;
  const hasActiveJustification = Boolean(justification?.active);
  const hasMedia = Boolean(statusRecord?.hasMedia) || Number(statusRecord?.mediaCount || 0) > 0;

  if (
    !endAt
    || !deadlineAt
    || !monitoringStartAt
    || !sessionAllowsActivity(session)
    || Boolean(session?.isBlocked)
    || endAt.getTime() < monitoringStartAt.getTime()
    || nowAt.getTime() < endAt.getTime()
  ) {
    return {
      state: 'not_applicable',
      endAt: endAt?.toISOString() || null,
      deadlineAt: deadlineAt?.toISOString() || null,
      elapsedHours: 0,
      overdueHours: 0,
      escalation: 0,
    };
  }

  if (hasMedia) {
    return {
      state: 'sent',
      endAt: endAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      elapsedHours: Math.max(0, (nowAt.getTime() - endAt.getTime()) / 3_600_000),
      overdueHours: 0,
      escalation: 0,
    };
  }

  if (hasActiveJustification) {
    return {
      state: 'excused',
      endAt: endAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      elapsedHours: Math.max(0, (nowAt.getTime() - endAt.getTime()) / 3_600_000),
      overdueHours: Math.max(0, (nowAt.getTime() - deadlineAt.getTime()) / 3_600_000),
      escalation: 0,
    };
  }

  const overdueHours = Math.max(0, (nowAt.getTime() - deadlineAt.getTime()) / 3_600_000);
  if (nowAt.getTime() <= deadlineAt.getTime()) {
    return {
      state: 'waiting',
      endAt: endAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      elapsedHours: Math.max(0, (nowAt.getTime() - endAt.getTime()) / 3_600_000),
      overdueHours: 0,
      escalation: 0,
    };
  }

  return {
    state: 'overdue',
    endAt: endAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    elapsedHours: Math.max(0, (nowAt.getTime() - endAt.getTime()) / 3_600_000),
    overdueHours,
    escalation: overdueHours >= 48 ? 72 : overdueHours >= 24 ? 48 : 24,
  };
}

export function formatActivityElapsedHours(hours) {
  const safeHours = Math.max(0, Math.floor(Number(hours) || 0));
  const days = Math.floor(safeHours / 24);
  const remainder = safeHours % 24;
  if (days <= 0) return `${remainder} ${remainder === 1 ? 'hora' : 'horas'}`;
  if (remainder <= 0) return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  return `${days} ${days === 1 ? 'dia' : 'dias'} e ${remainder} ${remainder === 1 ? 'hora' : 'horas'}`;
}
