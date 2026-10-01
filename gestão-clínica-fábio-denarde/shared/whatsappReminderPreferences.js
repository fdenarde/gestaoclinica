// A wholly absent configuration retains the established legacy default. Once a
// preference object exists, missing or invalid fields must not authorize sends.
function preferenceFlag(owner, key) {
  if (!owner || !Object.hasOwn(owner, 'whatsappReminderPreferences')) return undefined;
  const preferences = owner.whatsappReminderPreferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return false;
  if (!Object.hasOwn(preferences, key)) return undefined;
  return preferences[key] === true;
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
  const update = item => {
    const next = { ...item };
    if (scope === 'default') delete next.whatsappReminderPreferences;
    else next.whatsappReminderPreferences = { ...preferences };
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
