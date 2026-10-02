import { getSaoPauloDateKey } from '../../shared/clinicalDate.js';
import { isWhatsappTimingSlotEnabled, resolveWhatsappReminderTiming } from '../../shared/whatsappReminderPreferences.js';
import { ROUTINE_DEFINITIONS } from './whatsappReminderOperations.js';

const minuteFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function getSaoPauloReminderClock(now = new Date()) {
  return { date: getSaoPauloDateKey(now), time: minuteFormatter.format(now) };
}

export function addReminderCalendarDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

// One slot per clock minute and modality across the entire scheduler. The sender
// reads current records again and never trusts this cache to authorize delivery.
export function collectDueCustomReminderSlots({ patients = [], sessions = [], now = new Date() } = {}) {
  const clock = getSaoPauloReminderClock(now);
  const tomorrow = addReminderCalendarDays(clock.date, 1);
  const patientMap = new Map(patients.map(patient => [patient.id, patient]));
  const slots = new Map();
  const add = (session, patient, relativeDay) => {
    const timing = resolveWhatsappReminderTiming(session, patient);
    if (timing.timingMode !== 'custom' || !timing.valid) return;
    if (!isWhatsappTimingSlotEnabled(session, patient, { relativeDay, time: clock.time })) return;
    const routine = relativeDay === 'dayBefore' ? 'AMANHA'
      : clock.time < '12:00' ? 'HOJE_MANHA' : 'HOJE_TARDE';
    // The fixed cron already covers a custom slot that coincides with its clock.
    if (ROUTINE_DEFINITIONS[routine].scheduledTime === clock.time) return;
    slots.set(`${routine}:${clock.time}`, { routine, scheduledTime: clock.time });
  };
  for (const session of sessions) {
    const patient = patientMap.get(session.patientId);
    if (!patient) continue;
    if (session.date === clock.date) add(session, patient, 'sameDay');
    if (session.date === tomorrow) add(session, patient, 'dayBefore');
  }
  return [...slots.values()];
}
