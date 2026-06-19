function normalizeTime(value) {
  const parts = String(value || '').trim().split(':');
  if (parts.length < 2) return String(value || '').trim();
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

export function findWhatsappReminderSuppression({
  suppressions = [],
  patient,
  session,
  runDateStr,
  scheduledTime,
  dateStr,
  tipo
}) {
  if (!patient?.id || !runDateStr || !scheduledTime || !dateStr || !tipo) return null;

  return suppressions.find(suppression => {
    if (!suppression || suppression.active === false) return false;
    if (suppression.patientId !== patient.id) return false;
    if (suppression.runDate !== runDateStr) return false;
    if (normalizeTime(suppression.scheduledTime) !== normalizeTime(scheduledTime)) return false;
    if (suppression.reminderType !== tipo) return false;
    if (suppression.sessionDate !== dateStr) return false;
    if (suppression.sessionId && suppression.sessionId === session?.id) return true;

    return Boolean(
      suppression.sessionTime &&
      normalizeTime(suppression.sessionTime) === normalizeTime(session?.time)
    );
  }) || null;
}
