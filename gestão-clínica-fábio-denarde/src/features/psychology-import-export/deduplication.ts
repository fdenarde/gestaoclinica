import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import type { DeduplicationResult, DeduplicationSignal, ImportConflict, ImportWarning, PsychologyImportBundle } from './types';
import { normalizePhoneForComparison } from '../../../shared/phoneNormalization.js';

function comparable(value: string | undefined): string {
  if (!value) return '';
  try {
    return normalizePhoneForComparison(value, { defaultCountryCode: '55' });
  } catch {
    return '';
  }
}

function textComparable(value: string | undefined): string {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

export function deduplicatePsychologyBundle(bundle: PsychologyImportBundle, store: PsychologyStore): DeduplicationResult {
  const signals: DeduplicationSignal[] = [];
  const conflicts: ImportConflict[] = [...bundle.conflicts];
  const warnings: ImportWarning[] = [...bundle.warnings];
  const existingById = new Map(store.patients.map(patient => [patient.id, patient]));
  const existingSessions = new Set(store.sessions.map(session => `${session.patientId}|${session.date}|${session.time}`));
  const sourceIds = new Set<string>();

  for (const patient of bundle.patients) {
    if (patient.externalId && sourceIds.has(`patient:${patient.externalId}`)) continue;
    if (patient.externalId) sourceIds.add(`patient:${patient.externalId}`);
    const exact = patient.externalId ? existingById.get(patient.externalId) : undefined;
    if (exact) {
      signals.push({ sourceRecordId: patient.sourceRecordId, existingPatientId: exact.id, matchedFields: ['externalId'], requiresReview: false });
      continue;
    }
    const possible = store.patients.find(existing => {
      const sameName = textComparable(existing.name) === textComparable(patient.name);
      const sameBirthDate = Boolean(patient.birthDate && existing.birthDate && patient.birthDate === existing.birthDate);
      const samePhone = Boolean(patient.phone && comparable(existing.phone) && comparable(existing.phone) === comparable(patient.phone));
      const sameEmail = Boolean(patient.email && existing.email && textComparable(existing.email) === textComparable(patient.email));
      return sameName && (sameBirthDate || samePhone || sameEmail);
    });
    if (possible) {
      const matchedFields = ['name'];
      if (patient.birthDate === possible.birthDate) matchedFields.push('birthDate');
      if (comparable(patient.phone) && comparable(patient.phone) === comparable(possible.phone)) matchedFields.push('phone');
      if (patient.email && textComparable(patient.email) === textComparable(possible.email)) matchedFields.push('email');
      signals.push({ sourceRecordId: patient.sourceRecordId, existingPatientId: possible.id, matchedFields, requiresReview: true });
      conflicts.push({ type: 'possible_duplicate_patient', severity: 'conflict', entity: 'patients', sourceRecordId: patient.sourceRecordId, message: `Possível duplicidade com ${possible.name}. Nenhum vínculo automático foi feito.` });
    }
  }

  for (const appointment of bundle.appointments) {
    const patientExternalId = appointment.patientExternalId || appointment.patientRef;
    if (patientExternalId && existingSessions.has(`${patientExternalId}|${appointment.date}|${appointment.startTime}`)) conflicts.push({ type: 'appointment_conflict', severity: 'conflict', entity: 'appointments', sourceRecordId: appointment.sourceRecordId, message: 'Consulta com mesmo paciente, data e horário já existente.' });
  }
  if (bundle.attachments.some(attachment => attachment.ownerType === 'unknown' || !attachment.ownerExternalId)) warnings.push({ code: 'unlinked_attachment', message: 'Há anexo sem vínculo e ele ficará separado para revisão.', entity: 'attachments' });
  return { bundle: { ...bundle, warnings, conflicts }, signals, conflicts, warnings };
}
