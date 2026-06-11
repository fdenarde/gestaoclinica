import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin.js';
import { activityError } from './activityRecordsValidation.js';

function patientRef(context, patientId) {
  return getAdminDb().doc(`users/${context.ownerUserId}/patients/${patientId}`);
}
function sessionRef(context, sessionId) {
  return getAdminDb().doc(`users/${context.ownerUserId}/sessions/${sessionId}`);
}
export function activityRecordRef(context, patientId, recordId) {
  return patientRef(context, patientId).collection('activityRecords').doc(recordId);
}


export async function requirePatient(context, patientId) {
  const snapshot = await patientRef(context, patientId).get();
  if (!snapshot.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  return snapshot.data();
}

export async function requirePatientAndSession(context, patientId, sessionId) {
  const [patientSnap, sessionSnap] = await Promise.all([patientRef(context, patientId).get(), sessionRef(context, sessionId).get()]);
  if (!patientSnap.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  if (!sessionSnap.exists) throw activityError('activity-records/session-not-found', 'A sessão selecionada não foi encontrada.', 404);
  const patient = patientSnap.data();
  const session = sessionSnap.data();
  if (session.patientId !== patientId) throw activityError('activity-records/session-mismatch', 'A sessão selecionada não pertence a esta criança.', 409);
  if (session.isBlocked) throw activityError('activity-records/blocked-session', 'Não é possível registrar atividade em um bloqueio pessoal.', 409);
  if (['Falta', 'Falta.Prof', 'Cancelada'].includes(session.status)) throw activityError('activity-records/invalid-session-status', 'Esta sessão não permite registro de atividade.', 409);
  return { patient, session };
}

export async function reserveActivityRecord(context, patientId, recordId, data) {
  const ref = activityRecordRef(context, patientId, recordId);
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data() || {};
      if (existing.driveFileId || ['active', 'uploading', 'deleting', 'delete_failed'].includes(existing.status)) {
        throw activityError(
          existing.status === 'uploading' ? 'activity-records/upload-in-progress' : 'activity-records/duplicate',
          existing.status === 'uploading'
            ? 'Esta mídia já está sendo enviada para a sessão selecionada.'
            : 'Esta mesma mídia já foi registrada para a sessão selecionada.',
          409,
        );
      }
    }
    transaction.set(ref, {
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      activityAt: Timestamp.fromDate(new Date(data.activityAt)),
    });
  });
  return ref;
}

export async function finalizeActivityRecord(ref, values) {
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw activityError('activity-records/record-not-found', 'A reserva do registro não foi encontrada.', 409);
    if (snapshot.data()?.status === 'cancelled') throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
    transaction.set(ref, {
      ...values,
      status: 'active',
      uploadStatus: 'active',
      driveUploadSession: FieldValue.delete(),
      uploadedBytes: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
  const snapshot = await ref.get();
  return { id: snapshot.id, ...serializeRecord(snapshot.data()) };
}

export async function markActivityFailure(ref, status, message) {
  await ref.set({
    status,
    uploadStatus: status,
    failureMessage: String(message || '').slice(0, 500),
    driveUploadSession: FieldValue.delete(),
    uploadedBytes: FieldValue.delete(),
    updatedAt: Timestamp.now(),
  }, { merge: true }).catch(() => undefined);
}

export async function updateActivityUploadProgress(ref, uploadAttemptId, uploadedBytes) {
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw activityError('activity-records/record-not-found', 'A reserva do registro não foi encontrada.', 409);
    const data = snapshot.data() || {};
    if (data.status === 'cancelled') throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
    if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) {
      throw activityError('activity-records/invalid-upload-attempt', 'A tentativa de envio do vídeo não está mais ativa.', 409);
    }
    transaction.set(ref, { uploadedBytes, updatedAt: Timestamp.now() }, { merge: true });
  });
}

export async function failActivityUpload(context, patientId, recordId, uploadAttemptId, message) {
  const ref = activityRecordRef(context, patientId, recordId);
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) return;
    transaction.set(ref, {
      status: 'failed',
      uploadStatus: 'failed',
      failureMessage: String(message || '').slice(0, 500),
      driveFileId: FieldValue.delete(),
      driveUploadSession: FieldValue.delete(),
      uploadedBytes: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
}

export async function getActivityRecord(context, patientId, recordId) {
  const snapshot = await activityRecordRef(context, patientId, recordId).get();
  if (!snapshot.exists) throw activityError('activity-records/record-not-found', 'O registro de atividade não foi encontrado.', 404);
  return { ref: snapshot.ref, id: snapshot.id, data: snapshot.data() };
}

export async function cancelUploadAttempt(context, patientId, uploadAttemptId) {
  const records = await patientRef(context, patientId).collection('activityRecords').where('uploadAttemptId', '==', uploadAttemptId).limit(1).get();
  if (records.empty) return null;
  const item = records.docs[0];
  let result = null;
  await getAdminDb().runTransaction(async transaction => {
    const current = await transaction.get(item.ref);
    if (!current.exists) return;
    const data = current.data() || {};
    if (data.status === 'active') {
      result = { id: current.id, ...data, alreadyCompleted: true };
      return;
    }
    if (!['uploading', 'failed', 'cancelled'].includes(data.status)) {
      result = { id: current.id, ...data, cancellationIgnored: true };
      return;
    }
    transaction.set(item.ref, {
      status: 'cancelled',
      uploadStatus: 'cancelled',
      driveUploadSession: FieldValue.delete(),
      uploadedBytes: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    result = { id: current.id, ...data, alreadyCompleted: false };
  });
  return result;
}

export async function updateActivityMetadata(context, patientId, recordId, values) {
  const { ref, data } = await getActivityRecord(context, patientId, recordId);
  if (data.status !== 'active' && data.status !== 'delete_failed') throw activityError('activity-records/record-unavailable', 'Este registro não está disponível para edição.', 409);
  await ref.set({ ...values, updatedAt: Timestamp.now() }, { merge: true });
}


export async function listActivityRecords(context, patientId) {
  const patient = await patientRef(context, patientId).get();
  if (!patient.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  const snapshot = await patient.ref.collection('activityRecords').limit(250).get();
  return snapshot.docs
    .map(item => ({ id: item.id, ...serializeRecord(item.data()) }))
    .filter(record => record.status === 'active' || record.status === 'delete_failed')
    .sort((a, b) => String(b.activityAt || '').localeCompare(String(a.activityAt || '')));
}

export async function hasActivityRecords(context, patientId) {
  const patient = await patientRef(context, patientId).get();
  if (!patient.exists) return false;
  const snapshot = await patient.ref.collection('activityRecords').limit(100).get();
  let hasRelevantRecord = false;
  const cleanup = [];
  for (const item of snapshot.docs) {
    const data = item.data();
    if (['failed', 'cancelled'].includes(data.status) && !data.driveFileId) {
      cleanup.push(item.ref.delete());
      continue;
    }
    hasRelevantRecord = true;
  }
  if (cleanup.length > 0) await Promise.allSettled(cleanup);
  return hasRelevantRecord;
}

export function serializeRecord(data) {
  const convert = value => value?.toDate instanceof Function ? value.toDate().toISOString() : value;
  return { ...data, createdAt: convert(data.createdAt), updatedAt: convert(data.updatedAt), activityAt: convert(data.activityAt) };
}
