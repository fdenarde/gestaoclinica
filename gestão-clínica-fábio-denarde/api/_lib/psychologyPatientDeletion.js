function completedPayment(payment) {
  return payment?.status === 'active' && !payment.reversedAt && !payment.voidedAt;
}

/**
 * Remote counterpart of the validated individual local deletion contract.
 * It is called only for an explicitly selected patient, never while loading
 * the list. Completed financial facts are detached and preserved; other
 * patient-linked records follow the existing deletion behavior.
 */
export async function deletePsychologyPatientSafely({ repository, patientId, now = new Date().toISOString() }) {
  const patient = await repository.patients.get(patientId);
  if (!patient) return { id: patientId, deleted: false, preserved: false, reason: 'Paciente não encontrado.' };

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
  const preservedChargeIds = new Set(charges
    .filter(item => chargeIds.has(item.id))
    .filter(charge => relatedPayments.some(payment => payment.chargeId === charge.id && completedPayment(payment)))
    .map(item => item.id));
  const preservedPaymentIds = new Set(relatedPayments.filter(completedPayment).map(item => item.id));

  await Promise.all(sessions.map(item => repository.sessions.deleteKnown(item)));
  await Promise.all(sessionRecords.map(item => repository.sessionRecords.deleteKnown(item)));
  await Promise.all(charges
    .filter(item => !preservedChargeIds.has(item.id))
    .map(item => repository.financial.updateChargeKnown(item, { status: 'cancelled', cancelledAt: now, cancellationReason: 'Paciente excluído' })));
  await Promise.all(packages.map(item => repository.packages.deleteKnown(item)));
  await Promise.all(documents.map(item => repository.documents.deleteKnown(item)));
  await Promise.all(attachments.map(item => repository.attachments.deleteKnown(item)));

  for (const payment of relatedPayments) {
    if (preservedPaymentIds.has(payment.id)) {
      await repository.financial.updatePaymentKnown(payment, { patientId: null, sessionId: undefined, chargeId: preservedChargeIds.has(payment.chargeId || '') ? payment.chargeId : null });
    } else {
      await repository.financial.updatePaymentKnown(payment, { status: 'voided', patientId: null, sessionId: undefined, voidedAt: now, voidReason: 'Paciente excluído' });
    }
  }
  for (const charge of charges.filter(item => preservedChargeIds.has(item.id))) {
    await repository.financial.updateChargeKnown(charge, { patientId: null, sessionId: undefined, packageId: undefined, description: 'Cobrança concluída — paciente excluído' });
  }
  const deletedPatient = await repository.patients.deleteKnown(patient);
  return {
    id: deletedPatient?.id || patientId,
    deleted: Boolean(deletedPatient),
    preserved: preservedPaymentIds.size > 0,
    active: false,
  };
}
