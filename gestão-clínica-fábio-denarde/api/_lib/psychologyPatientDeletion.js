/**
 * Remote counterpart of the validated individual local deletion contract.
 * It is called only for an explicitly selected patient, never while loading
 * the list. Every proven patient relation is deleted before the patient.
 */
export async function deletePsychologyPatientSafely({ repository, patientId, now = new Date().toISOString() }) {
  const patient = await repository.patients.get(patientId);
  if (!patient) return { id: patientId, deleted: false, reason: 'Paciente não encontrado.' };

  const sessions = await repository.sessions.listByPatientId(patientId);
  const sessionIds = new Set(sessions.map(item => item.id));
  const [sessionRecords, charges, packages, documents] = await Promise.all([
    repository.sessionRecords.listByPatientOrSessionIds(patientId, [...sessionIds]),
    repository.financial.listChargesByPatientOrSessionIds(patientId, [...sessionIds]),
    repository.packages.listByPatientId(patientId),
    repository.documents.listByPatientId(patientId),
  ]);

  const recordIds = new Set(sessionRecords.map(item => item.id));
  const chargeIds = new Set(charges.map(item => item.id));
  const [relatedPayments, attachments] = await Promise.all([
    repository.financial.listPaymentsByPatientOrSessionOrChargeIds(patientId, [...sessionIds], [...chargeIds]),
    repository.attachments.listByPatientOrSessionRecordIds(patientId, [...recordIds]),
  ]);
  await Promise.all(sessions.map(item => repository.sessions.deleteKnown(item)));
  await Promise.all(sessionRecords.map(item => repository.sessionRecords.deleteKnown(item)));
  await Promise.all(charges.map(item => repository.financial.deleteChargeKnown(item)));
  await Promise.all(packages.map(item => repository.packages.deleteKnown(item)));
  await Promise.all(documents.map(item => repository.documents.deleteKnown(item)));
  await Promise.all(attachments.map(item => repository.attachments.deleteKnown(item)));
  await Promise.all(relatedPayments.map(item => repository.financial.deletePaymentKnown(item)));
  const deletedPatient = await repository.patients.deleteKnown(patient);
  return {
    id: deletedPatient?.id || patientId,
    deleted: Boolean(deletedPatient),
  };
}
