// A wholly absent configuration retains the established legacy default. Once a
// preference object exists, missing or invalid fields must not authorize sends.
function preferenceFlag(owner, key) {
  if (!owner || !Object.hasOwn(owner, 'whatsappReminderPreferences')) return undefined;
  const preferences = owner.whatsappReminderPreferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return false;
  if (!Object.hasOwn(preferences, key)) return undefined;
  return preferences[key] === true;
}

export const DEFAULT_WHATSAPP_REMINDER_TIMES = Object.freeze([
  Object.freeze({ relativeDay: 'dayBefore', time: '09:00' }),
  Object.freeze({ relativeDay: 'sameDay', time: '06:30' }),
  Object.freeze({ relativeDay: 'sameDay', time: '12:30' }),
]);

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_DAYS = new Set(['dayBefore', 'sameDay']);

export function normalizeWhatsappCustomTimes(value, { strict = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    if (strict) throw new Error('Adicione pelo menos um horário personalizado.');
    return null;
  }
  const seen = new Set();
  const times = [];
  for (const item of value) {
    const relativeDay = item?.relativeDay;
    const time = item?.time;
    if (!VALID_DAYS.has(relativeDay) || typeof time !== 'string' || !VALID_TIME.test(time)) {
      if (strict) throw new Error('Informe Dia anterior ou Dia do atendimento e um horário HH:mm válido.');
      return null;
    }
    const key = `${relativeDay}:${time}`;
    if (seen.has(key)) {
      if (strict) throw new Error('Este horário já foi adicionado para o mesmo dia.');
      return null;
    }
    seen.add(key);
    times.push({ relativeDay, time });
  }
  return times.sort((a, b) => (a.relativeDay === b.relativeDay
    ? a.time.localeCompare(b.time)
    : a.relativeDay === 'dayBefore' ? -1 : 1));
}

// Timing is independently inherited from the session, patient and legacy default.
// An explicitly malformed timing object fails closed instead of enabling default sends.
export function resolveWhatsappReminderTiming(session = null, patient = null) {
  const owners = [session, patient];
  for (const owner of owners) {
    if (!owner || !Object.hasOwn(owner, 'whatsappReminderPreferences')) continue;
    const preferences = owner.whatsappReminderPreferences;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      return { timingMode: 'invalid', customTimes: [], valid: false };
    }
    if (!Object.hasOwn(preferences, 'timingMode') && !Object.hasOwn(preferences, 'customTimes')) continue;
    if (preferences.timingMode === 'default' && !Object.hasOwn(preferences, 'customTimes')) {
      return { timingMode: 'default', customTimes: DEFAULT_WHATSAPP_REMINDER_TIMES, valid: true };
    }
    if (preferences.timingMode === 'custom') {
      const customTimes = normalizeWhatsappCustomTimes(preferences.customTimes);
      return customTimes
        ? { timingMode: 'custom', customTimes, valid: true }
        : { timingMode: 'invalid', customTimes: [], valid: false };
    }
    return { timingMode: 'invalid', customTimes: [], valid: false };
  }
  return { timingMode: 'default', customTimes: DEFAULT_WHATSAPP_REMINDER_TIMES, valid: true };
}

export function isWhatsappTimingSlotEnabled(session, patient, { relativeDay, time } = {}) {
  const timing = resolveWhatsappReminderTiming(session, patient);
  if (!timing.valid || !VALID_DAYS.has(relativeDay) || !VALID_TIME.test(time || '')) return false;
  const flags = resolveWhatsappReminderPreferences(session, patient);
  if (!flags[relativeDay]) return false;
  return timing.customTimes.some(slot => slot.relativeDay === relativeDay && slot.time === time);
}

export function resolveWhatsappReminderPreferences(session = null, patient = null) {
  const legacyDefault = !Object.hasOwn(session || {}, 'whatsappReminderPreferences')
    && !Object.hasOwn(patient || {}, 'whatsappReminderPreferences');
  const resolveFlag = key => preferenceFlag(session, key) ?? preferenceFlag(patient, key) ?? legacyDefault;
  return { dayBefore: resolveFlag('dayBefore'), sameDay: resolveFlag('sameDay') };
}

export function isWhatsappReminderEnabled(session, patient, reminderType = '') {
  const preferences = resolveWhatsappReminderPreferences(session, patient);
  if (reminderType === 'AMANHA') return preferences.dayBefore;
  if (reminderType === 'HOJE_MANHA' || reminderType === 'HOJE_TARDE') return preferences.sameDay;
  // Unknown or unbound reminder types are never authorized for dispatch.
  return false;
}

export function getWhatsappReminderPreferencesLabel(session = null, patient = null) {
  const { dayBefore, sameDay } = resolveWhatsappReminderPreferences(session, patient);
  if (dayBefore && sameDay) return 'Véspera ✓ | No dia ✓';
  if (dayBefore) return 'Somente véspera';
  return sameDay ? 'Somente no dia' : 'Lembretes desativados';
}

/** Pure preparation only. Persistence remains in the existing confirmed UI flow.
 * @param {{session: any, patient: any, sessions: any[], patients: any[], scope: string, preferences?: any, generatedId?: string}} options */
export function prepareWhatsappReminderPreferencesUpdate({ session, patient, sessions, patients, scope, preferences, generatedId = '' }) {
  if (!patient || session?.patientId !== patient.id) throw new Error('Atendimento inválido.');
  if (!['patient', 'session', 'default'].includes(scope)) throw new Error('Configuração inválida.');
  if (scope !== 'default' && (typeof preferences?.dayBefore !== 'boolean' || typeof preferences?.sameDay !== 'boolean')) {
    throw new Error('Selecione as modalidades de lembrete.');
  }
  let nextPreferences = preferences;
  if (scope !== 'default') {
    if (!Object.hasOwn(preferences, 'timingMode') && !Object.hasOwn(preferences, 'customTimes')) {
      nextPreferences = { dayBefore: preferences.dayBefore, sameDay: preferences.sameDay };
    } else {
      const timingMode = preferences.timingMode;
      if (!['default', 'custom'].includes(timingMode)) throw new Error('Modo de horários inválido.');
      nextPreferences = timingMode === 'custom'
        ? { dayBefore: preferences.dayBefore, sameDay: preferences.sameDay, timingMode, customTimes: normalizeWhatsappCustomTimes(preferences.customTimes, { strict: true }) }
        : { dayBefore: preferences.dayBefore, sameDay: preferences.sameDay, timingMode };
    }
  }
  const update = item => {
    const next = { ...item };
    if (scope === 'default') delete next.whatsappReminderPreferences;
    else next.whatsappReminderPreferences = { ...nextPreferences };
    return next;
  };
  if (scope === 'patient') return { patients: patients.map(item => item.id === patient.id ? update(item) : item) };
  const existing = sessions.find(item => item.id === session.id);
  if (existing) return { sessions: sessions.map(item => item.id === session.id ? update(item) : item) };
  if (scope === 'default') return {};
  if (!session.isVirtual || !generatedId) throw new Error('Sessão não encontrada.');
  const materialized = update({ ...session, id: generatedId, isFixedSchedule: true, source: 'fixed' });
  delete materialized.isVirtual;
  delete materialized.isValid;
  delete materialized.blockedReason;
  return { sessions: [...sessions, materialized] };
}
