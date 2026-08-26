const NON_BLOCKING_ACTIVITY_STATUSES = new Set(['failed', 'cancelled']);

export function isActivityRecordDeletionBlocker(data) {
  return !(
    NON_BLOCKING_ACTIVITY_STATUSES.has(String(data?.status || ''))
    && !data?.driveFileId
  );
}
export async function evaluateActivityRecordDeletionGuard({
  findStatusBlocker,
  findDriveFileBlocker,
  cleanupNonBlockingRecords,
}) {
  if (await findStatusBlocker()) return true;
  if (await findDriveFileBlocker()) return true;
  await cleanupNonBlockingRecords();
  return false;
}

export async function evaluatePatientActivityRecordDeletionGuard({ getPatient, evaluate }) {
  const patient = await getPatient();
  if (!patient?.exists) return false;
  return evaluate(patient);
}
