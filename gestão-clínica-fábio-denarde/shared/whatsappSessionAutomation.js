import { isWhatsappReminderEnabled } from './whatsappReminderPreferences.js';

export const WHATSAPP_REMINDER_TYPES = Object.freeze(['AMANHA', 'HOJE_MANHA', 'HOJE_TARDE', 'RETRY']);
export const WHATSAPP_AUTOMATION_CONTROL_VERSION = 1;
export const WHATSAPP_TIME_ZONE = 'America/Sao_Paulo';

const SAO_PAULO_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: WHATSAPP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function normalizeText(value, maxLength = 180) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseInstant(value) {
  const parsed = new Date(String(value || '').trim());
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function getDateTimeParts(value = new Date()) {
  const parts = Object.fromEntries(SAO_PAULO_PARTS_FORMATTER.formatToParts(value).map(item => [item.type, item.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function addCalendarDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function saoPauloLocalDateTimeToIso(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return '';
  const targetAsUtc = Date.UTC(
    Number(match[1].slice(0, 4)),
    Number(match[1].slice(5, 7)) - 1,
    Number(match[1].slice(8, 10)),
    hour,
    minute,
  );
  const representedParts = getDateTimeParts(new Date(targetAsUtc));
  const representedAsUtc = Date.UTC(
    Number(representedParts.date.slice(0, 4)),
    Number(representedParts.date.slice(5, 7)) - 1,
    Number(representedParts.date.slice(8, 10)),
    Number(representedParts.time.slice(0, 2)),
    Number(representedParts.time.slice(3, 5)),
    0,
  );
  return new Date(targetAsUtc - (representedAsUtc - targetAsUtc)).toISOString();
}

export function buildWhatsappSilenceUntil({ duration = 'manual', quantity = 1, now = new Date(), customUntil = '' } = {}) {
  if (duration === 'session' || duration === 'manual') return '';
  if (duration === 'custom') return saoPauloLocalDateTimeToIso(customUntil);

  const current = getDateTimeParts(now);
  if (duration === 'endOfDay') {
    return saoPauloLocalDateTimeToIso(`${addCalendarDays(current.date, 1)}T00:00`);
  }

  const amount = Math.max(1, Number(quantity) || 1);
  if (duration === '1h' || duration === 'hours') {
    return new Date(now.getTime() + amount * 60 * 60 * 1000).toISOString();
  }

  const days = duration === '1d' ? 1 : duration === '1w' ? 7 : duration === 'days' ? amount : amount * 7;
  const targetDate = addCalendarDays(current.date, days);
  return saoPauloLocalDateTimeToIso(`${targetDate}T${current.time}`);
}

export function getWhatsappSilenceLocalValue(value) {
  const date = parseInstant(value);
  if (!date) return '';
  const parts = getDateTimeParts(date);
  return `${parts.date}T${parts.time}`;
}

export function normalizeWhatsappBlockedReminderTypes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => WHATSAPP_REMINDER_TYPES.includes(item)))]
    .sort();
}

export function normalizeWhatsappAutomationControl(value) {
  if (!value || typeof value !== 'object') return null;
  const blockAll = value.blockAll === true;
  const blockedReminderTypes = normalizeWhatsappBlockedReminderTypes(value.blockedReminderTypes);
  if (!blockAll && blockedReminderTypes.length === 0) return null;
  return {
    version: WHATSAPP_AUTOMATION_CONTROL_VERSION,
    blockAll,
    blockedReminderTypes,
    scope: value.scope === 'patient' || value.scope === 'patient_date' ? value.scope : 'session',
    startsAt: normalizeText(value.startsAt, 64),
    silenceUntil: normalizeText(value.silenceUntil, 64),
    reasonCode: normalizeText(value.reasonCode, 40),
    reasonText: normalizeText(value.reasonText, 180),
    updatedAt: normalizeText(value.updatedAt, 64),
    updatedBy: normalizeText(value.updatedBy, 180),
    updatedByRole: normalizeText(value.updatedByRole, 40),
  };
}

export function isWhatsappSilenceActive(value, now = new Date()) {
  const control = normalizeWhatsappAutomationControl(value);
  if (!control) return false;
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return false;

  const startsAt = parseInstant(control.startsAt);
  if (startsAt && nowMs < startsAt.getTime()) return false;

  const silenceUntil = parseInstant(control.silenceUntil);
  if (silenceUntil && nowMs >= silenceUntil.getTime()) return false;

  // Legacy controls have no start/end fields and remain active until removed.
  return control.blockAll || control.blockedReminderTypes.length > 0;
}

function controlBlocksReminder(control, reminderType, phase, now) {
  if (!isWhatsappSilenceActive(control, now)) return false;
  const normalized = normalizeWhatsappAutomationControl(control);
  if (!normalized) return false;
  if (normalized.blockAll) return true;
  const normalizedType = String(reminderType || '').trim().toUpperCase();
  if (normalized.blockedReminderTypes.includes(normalizedType)) return true;
  return phase === 'retry' && normalized.blockedReminderTypes.includes('RETRY');
}

export function getWhatsappSilenceState(session = null, patient = null, now = new Date()) {
  const sessionControl = normalizeWhatsappAutomationControl(session?.whatsappAutomationControl);
  if (isWhatsappSilenceActive(sessionControl, now)) {
    return {
      active: true,
      source: 'session',
      until: sessionControl?.silenceUntil || '',
      control: sessionControl,
    };
  }

  const patientControl = normalizeWhatsappAutomationControl(patient?.whatsappAutomationControl);
  if (isWhatsappSilenceActive(patientControl, now)) {
    return {
      active: true,
      source: 'patient',
      until: patientControl?.silenceUntil || '',
      control: patientControl,
    };
  }

  return { active: false, source: '', until: '', control: null };
}

export function isWhatsappAutomationBlocked(session, {
  patient = null,
  reminderType = '',
  phase = 'plan',
  now = new Date(),
} = {}) {
  if (session?.removedFromAgenda === true || session?.isBlocked === true) return true;
  if (session?.status && session.status !== 'Agendada') return true;
  if (!isWhatsappReminderEnabled(session, patient, reminderType)) return true;
  if (controlBlocksReminder(session?.whatsappAutomationControl, reminderType, phase, now)) return true;
  return controlBlocksReminder(patient?.whatsappAutomationControl, reminderType, phase, now);
}

export function getWhatsappAutomationBlockLabel(session, patient = null, now = new Date()) {
  const rawControl = session?.whatsappAutomationControl;
  const isLegacyControl = rawControl && rawControl.version !== WHATSAPP_AUTOMATION_CONTROL_VERSION;
  if (isLegacyControl) {
    const legacy = normalizeWhatsappAutomationControl(rawControl);
    if (legacy && isWhatsappSilenceActive(legacy, now)) {
      return legacy.blockAll ? 'WhatsApp desativado' : 'WhatsApp parcialmente bloqueado';
    }
  }
  if (
    rawControl?.blockAll === true &&
    !rawControl.scope &&
    !rawControl.startsAt &&
    !rawControl.silenceUntil
  ) {
    return 'WhatsApp desativado';
  }
  const silence = getWhatsappSilenceState(session, patient, now);
  if (silence.active) return 'WhatsApp silenciado';
  const control = normalizeWhatsappAutomationControl(session?.whatsappAutomationControl);
  if (!control || !isWhatsappSilenceActive(control, now)) return '';
  return control.blockAll ? 'WhatsApp desativado' : 'WhatsApp parcialmente bloqueado';
}

export function getWhatsappAutomationBlockedLabels(session, patient = null, now = new Date()) {
  const rawControl = session?.whatsappAutomationControl;
  const isLegacyControl = rawControl && rawControl.version !== WHATSAPP_AUTOMATION_CONTROL_VERSION;
  if (isLegacyControl) {
    const legacy = normalizeWhatsappAutomationControl(rawControl);
    if (!legacy || !isWhatsappSilenceActive(legacy, now)) return [];
    if (legacy.blockAll) return ['Todos os próximos envios'];
    const legacyLabels = {
      AMANHA: 'Lembrete da véspera',
      HOJE_MANHA: 'Lembrete do mesmo dia — manhã',
      HOJE_TARDE: 'Lembrete do mesmo dia — tarde',
      RETRY: 'Novas tentativas e reenvios',
    };
    return legacy.blockedReminderTypes.map(type => legacyLabels[type] || type);
  }
  const silence = getWhatsappSilenceState(session, patient, now);
  if (silence.active) {
    return [silence.until ? `Silenciado até ${formatWhatsappSilenceUntil(silence.until)}` : 'Até desbloqueio manual'];
  }

  const control = normalizeWhatsappAutomationControl(session?.whatsappAutomationControl);
  if (!control || !isWhatsappSilenceActive(control, now)) return [];
  if (control.blockAll) return ['Todos os próximos envios'];
  const labels = {
    AMANHA: 'Lembrete da véspera',
    HOJE_MANHA: 'Lembrete do mesmo dia — manhã',
    HOJE_TARDE: 'Lembrete do mesmo dia — tarde',
    RETRY: 'Novas tentativas e reenvios',
  };
  return control.blockedReminderTypes.map(type => labels[type] || type);
}

export function formatWhatsappSilenceUntil(value) {
  const date = parseInstant(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: WHATSAPP_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
