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

  const [sessions, sessionRecords, charges, payments, packages, documents, attachments] = await Promise.all([
    repository.sessions.list(),
    repository.sessionRecords.list(),
    repository.financial.listCharges(),
    repository.financial.listPayments(),
    repository.packages.list(),
    repository.documents.list(),
    repository.attachments.list(),
  ]);
  const sessionIds = new Set(sessions.filter(item => item.patientId === patientId).map(item => item.id));
  const recordIds = new Set(sessionRecords
    .filter(item => item.patientId === patientId || (item.sessionId && sessionIds.has(item.sessionId)))
    .map(item => item.id));
  const chargeIds = new Set(charges
    .filter(item => item.patientId === patientId || (item.sessionId && sessionIds.has(item.sessionId)))
    .map(item => item.id));
  const relatedPayments = payments.filter(item => item.patientId === patientId
    || (item.sessionId && sessionIds.has(item.sessionId))
    || (item.chargeId && chargeIds.has(item.chargeId)));
  const preservedChargeIds = new Set(charges
    .filter(item => chargeIds.has(item.id))
    .filter(charge => relatedPayments.some(payment => payment.chargeId === charge.id && completedPayment(payment)))
    .map(item => item.id));
  const preservedPaymentIds = new Set(relatedPayments.filter(completedPayment).map(item => item.id));

  await Promise.all(sessions.filter(item => sessionIds.has(item.id)).map(item => repository.sessions.delete(item.id)));
  await Promise.all(sessionRecords.filter(item => recordIds.has(item.id)).map(item => repository.sessionRecords.delete(item.id)));
  await Promise.all(charges
    .filter(item => chargeIds.has(item.id) && !preservedChargeIds.has(item.id))
    .map(item => repository.financial.updateCharge(item.id, { status: 'cancelled', cancelledAt: now, cancellationReason: 'Paciente excluído' })));
  await Promise.all(packages.filter(item => item.patientId === patientId).map(item => repository.packages.delete(item.id)));
  await Promise.all(documents.filter(item => item.patientId === patientId).map(item => repository.documents.delete(item.id)));
  await Promise.all(attachments
    .filter(item => item.patientId === patientId || (item.sessionRecordId && recordIds.has(item.sessionRecordId)))
    .map(item => repository.attachments.delete(item.id)));

  for (const payment of relatedPayments) {
    if (preservedPaymentIds.has(payment.id)) {
      await repository.financial.updatePayment(payment.id, { patientId: null, sessionId: undefined, chargeId: preservedChargeIds.has(payment.chargeId || '') ? payment.chargeId : null });
    } else {
      await repository.financial.updatePayment(payment.id, { status: 'voided', patientId: null, sessionId: undefined, voidedAt: now, voidReason: 'Paciente excluído' });
    }
  }
  for (const charge of charges.filter(item => preservedChargeIds.has(item.id))) {
    await repository.financial.updateCharge(charge.id, { patientId: null, sessionId: undefined, packageId: undefined, description: 'Cobrança concluída — paciente excluído' });
  }
  const deletedPatient = await repository.patients.delete(patientId);
  return {
    id: deletedPatient?.id || patientId,
    deleted: Boolean(deletedPatient),
    preserved: preservedPaymentIds.size > 0,
    active: false,
  };
}
