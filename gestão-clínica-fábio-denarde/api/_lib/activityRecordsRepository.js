import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin.js';
import { assertActivityPatientAccess } from './accessContext.js';
import { applyActivityRecordGallerySummary } from './activityGalleryRepository.js';
import {
  ACTIVITY_UPLOAD_LEASE_MS,
  activityError,
  isActivityUploadLeaseExpired,
  isSameCompletedActivityUpload,
  isSameInProgressActivityUpload,
} from './activityRecordsValidation.js';

function createActivityUploadLease(now = Timestamp.now()) {
  return Timestamp.fromMillis(now.toMillis() + ACTIVITY_UPLOAD_LEASE_MS);
}

function patientRef(context, patientId) {
  assertActivityPatientAccess(context, patientId);
  return getAdminDb().doc(`users/${context.ownerUserId}/patients/${patientId}`);
}
function sessionRef(context, sessionId) {
  return getAdminDb().doc(`users/${context.ownerUserId}/sessions/${sessionId}`);
}
export function activityRecordRef(context, patientId, recordId) {
  return patientRef(context, patientId).collection('activityRecords').doc(recordId);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sanitizeFirestoreDocument(value) {
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => sanitizeFirestoreDocument(item));
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, sanitizeFirestoreDocument(item)]),
  );
}

function setTransactionDocument(transaction, ref, data, options) {
  const sanitized = sanitizeFirestoreDocument(data);
  if (options) transaction.set(ref, sanitized, options);
  else transaction.set(ref, sanitized);
}

export async function setActivityRecordDocument(ref, data, options) {
  const sanitized = sanitizeFirestoreDocument(data);
  return options ? ref.set(sanitized, options) : ref.set(sanitized);
}

export function hasVerifiedActivityContentHash(record, sha256) {
  return (
    record.originalContentHash === sha256
    || record.preparedContentHash === sha256
    || (
      record.sha256 === sha256
      && (
        record.mediaType === 'photo'
        || record.hashAlgorithm === 'SHA-256'
        || Boolean(record.hashVerifiedAt)
      )
    )
  );
}

export function needsLegacyActivityHashVerification(record) {
  return (
    !record.originalContentHash
    && !record.preparedContentHash
    && (
      !record.sha256
      || record.mediaType === 'video'
      || (!record.hashAlgorithm && !record.hashVerifiedAt)
    )
  );
}


export async function requirePatient(context, patientId) {
  const snapshot = await patientRef(context, patientId).get();
  if (!snapshot.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  return snapshot.data();
}

export async function requirePatientAndSessions(context, patientId, sessionIds) {
  const normalizedSessionIds = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds])
    .map(value => String(value || '').trim())
    .filter(Boolean))].slice(0, 8);
  if (normalizedSessionIds.length === 0) {
    throw activityError('activity-records/missing-session-id', 'Sessão não identificada.');
  }

  const patientReference = patientRef(context, patientId);
  const [patientSnap, ...sessionSnapshots] = await Promise.all([
    patientReference.get(),
    ...normalizedSessionIds.map(sessionId => sessionRef(context, sessionId).get()),
  ]);
  if (!patientSnap.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);

  const sessions = sessionSnapshots.map((snapshot, index) => {
    if (!snapshot.exists) throw activityError('activity-records/session-not-found', 'Uma das sessões selecionadas não foi encontrada.', 404);
    const session = snapshot.data();
    if (session.patientId !== patientId) throw activityError('activity-records/session-mismatch', 'Uma das sessões selecionadas não pertence a esta criança.', 409);
    if (session.isBlocked) throw activityError('activity-records/blocked-session', 'Não é possível registrar atividade em um bloqueio pessoal.', 409);
    if (['Falta', 'Falta.Prof', 'Cancelada'].includes(session.status)) throw activityError('activity-records/invalid-session-status', 'Uma das sessões selecionadas não permite registro de atividade.', 409);
    return { id: normalizedSessionIds[index], ...session };
  });

  return { patient: patientSnap.data(), sessions, session: sessions[0] };
}

export async function requirePatientAndSession(context, patientId, sessionId) {
  return requirePatientAndSessions(context, patientId, [sessionId]);
}

export async function findActivityRecordsBySha256(
  context,
  patientId,
  sha256,
  limit = 10,
  mediaType = '',
) {
  const collection = patientRef(context, patientId).collection('activityRecords');
  const snapshots = await Promise.all([
    'sha256',
    'originalContentHash',
    'preparedContentHash',
  ].map(field => collection.where(field, '==', sha256).limit(limit).get()));
  const records = new Map();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const record = { id: doc.id, ...serializeRecord(doc.data()) };
      if (
        record.status === 'active'
        && hasVerifiedActivityContentHash(record, sha256)
        && (!mediaType || record.mediaType === mediaType)
      ) records.set(record.id, record);
    }
  }
  return Array.from(records.values()).slice(0, limit);
}

export async function findLegacyActivityDuplicateCandidates(
  context,
  patientId,
  { fileSize, mediaType, mimeType, limit = 12 },
) {
  const snapshot = await patientRef(context, patientId)
    .collection('activityRecords')
    .where('fileSize', '==', fileSize)
    .limit(limit)
    .get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...serializeRecord(doc.data()) }))
    .filter(record => (
      record.status === 'active'
      && record.driveFileId
      && record.mediaType === mediaType
      && (!mimeType || !record.mimeType || record.mimeType === mimeType)
      && needsLegacyActivityHashVerification(record)
    ));
}

export async function claimActivityHashVerification(
  context,
  patientId,
  recordId,
  verificationId,
  leaseMs = 45_000,
) {
  const ref = activityRecordRef(context, patientId, recordId);
  return getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { claimed: false, missing: true };
    const data = snapshot.data() || {};
    if (data.sha256 || data.originalContentHash || data.preparedContentHash) {
      return { claimed: false, cached: true, record: { id: snapshot.id, ...serializeRecord(data) } };
    }
    const leaseUntil = data.hashVerificationLeaseUntil?.toMillis instanceof Function
      ? data.hashVerificationLeaseUntil.toMillis()
      : 0;
    if (
      data.hashVerificationStatus === 'verifying'
      && data.hashVerificationId !== verificationId
      && leaseUntil > Date.now()
    ) {
      return { claimed: false, inProgress: true };
    }
    setTransactionDocument(transaction, ref, {
      hashVerificationStatus: 'verifying',
      hashVerificationId: verificationId,
      hashVerificationLeaseUntil: Timestamp.fromMillis(Date.now() + leaseMs),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { claimed: true, record: { id: snapshot.id, ...serializeRecord(data) } };
  });
}

export async function completeActivityHashVerification(
  context,
  patientId,
  recordId,
  verificationId,
  fingerprint,
) {
  const ref = activityRecordRef(context, patientId, recordId);
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    if (
      data.hashVerificationStatus === 'verifying'
      && data.hashVerificationId !== verificationId
    ) return;
    const hashFields = data.mediaType === 'photo'
      ? { preparedContentHash: fingerprint.sha256 }
      : { originalContentHash: fingerprint.sha256 };
    setTransactionDocument(transaction, ref, {
      ...hashFields,
      sha256: fingerprint.sha256,
      hashAlgorithm: 'SHA-256',
      originalContentHashAlgorithm: data.mediaType === 'video' ? 'SHA-256' : FieldValue.delete(),
      preparedContentHashAlgorithm: data.mediaType === 'photo' ? 'SHA-256' : FieldValue.delete(),
      originalByteSize: Number(data.originalByteSize || fingerprint.byteSize || data.fileSize || 0),
      driveChecksum: fingerprint.driveChecksums?.sha256
        || fingerprint.driveChecksums?.md5
        || fingerprint.driveChecksums?.sha1
        || '',
      driveChecksumAlgorithm: fingerprint.driveChecksums?.sha256
        ? 'SHA-256'
        : fingerprint.driveChecksums?.md5
          ? 'MD5'
          : fingerprint.driveChecksums?.sha1
            ? 'SHA-1'
            : '',
      driveMd5Checksum: fingerprint.driveChecksums?.md5 || '',
      driveSha1Checksum: fingerprint.driveChecksums?.sha1 || '',
      driveSha256Checksum: fingerprint.driveChecksums?.sha256 || '',
      hashVerifiedAt: Timestamp.now(),
      hashSource: fingerprint.source,
      hashVerificationStatus: 'verified',
      hashVerificationId: FieldValue.delete(),
      hashVerificationLeaseUntil: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
  const snapshot = await ref.get();
  return snapshot.exists ? { id: snapshot.id, ...serializeRecord(snapshot.data()) } : null;
}

export async function failActivityHashVerification(
  context,
  patientId,
  recordId,
  verificationId,
  code,
) {
  const ref = activityRecordRef(context, patientId, recordId);
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    if (data.hashVerificationId !== verificationId) return;
    setTransactionDocument(transaction, ref, {
      hashVerificationStatus: 'inconclusive',
      hashVerificationFailureCode: String(code || 'unknown').slice(0, 120),
      hashVerificationId: FieldValue.delete(),
      hashVerificationLeaseUntil: FieldValue.delete(),
      hashVerificationLastAttemptAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
}

export async function reserveActivityRecord(context, patientId, recordId, data) {
  const ref = activityRecordRef(context, patientId, recordId);
  const existingRecord = await getAdminDb().runTransaction(async transaction => {
    const now = Timestamp.now();
    const uploadLeaseUntil = createActivityUploadLease(now);
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data() || {};
      if (isSameCompletedActivityUpload(existing, data)) {
        return { id: snapshot.id, ...serializeRecord(existing) };
      }
      if (isSameInProgressActivityUpload(existing, data)) {
        setTransactionDocument(transaction, ref, {
          uploadLeaseUntil,
          updatedAt: now,
        }, { merge: true });
        return {
          id: snapshot.id,
          ...serializeRecord({
            ...existing,
            uploadLeaseUntil,
            updatedAt: now,
          }),
        };
      }
      if (existing.status === 'uploading' && isActivityUploadLeaseExpired(existing, now.toMillis())) {
        const resumed = {
          ...data,
          status: 'uploading',
          uploadStatus: 'uploading',
          uploadAttemptId: data.uploadAttemptId,
          uploadLeaseUntil,
          failureMessage: FieldValue.delete(),
          updatedAt: now,
          activityAt: Timestamp.fromDate(new Date(data.activityAt)),
        };
        setTransactionDocument(transaction, ref, resumed, { merge: true });
        return {
          id: snapshot.id,
          ...serializeRecord({
            ...existing,
            ...data,
            status: 'uploading',
            uploadStatus: 'uploading',
            uploadAttemptId: data.uploadAttemptId,
            uploadLeaseUntil,
            updatedAt: now,
            activityAt: resumed.activityAt,
          }),
        };
      }
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
    setTransactionDocument(transaction, ref, {
      ...data,
      uploadLeaseUntil,
      createdAt: now,
      updatedAt: now,
      activityAt: Timestamp.fromDate(new Date(data.activityAt)),
    });
    return null;
  });
  return { ref, existingRecord };
}

export async function ensureActivityRecordGallerySummary(context, ref) {
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    if (current.status !== 'active') return;
    applyActivityRecordGallerySummary(transaction, context, ref, { id: snapshot.id, ...current }, Timestamp.now());
  });
  const snapshot = await ref.get();
  return snapshot.exists ? { id: snapshot.id, ...serializeRecord(snapshot.data()) } : null;
}

export async function finalizeActivityRecord(context, ref, values) {
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw activityError('activity-records/record-not-found', 'A reserva do registro não foi encontrada.', 409);
    const current = snapshot.data() || {};
    if (current.status === 'cancelled') throw activityError('activity-records/upload-cancelled', 'O envio da mídia foi cancelado.', 409);
    const now = Timestamp.now();
    const finalized = {
      id: snapshot.id,
      ...current,
      ...values,
      status: 'active',
      uploadStatus: 'active',
      updatedAt: now,
    };
    setTransactionDocument(transaction, ref, {
      ...values,
      status: 'active',
      uploadStatus: 'active',
      driveUploadSession: FieldValue.delete(),
      uploadedBytes: FieldValue.delete(),
      uploadLeaseUntil: FieldValue.delete(),
      updatedAt: now,
    }, { merge: true });
    applyActivityRecordGallerySummary(transaction, context, ref, finalized, now);
  });
  const snapshot = await ref.get();
  return { id: snapshot.id, ...serializeRecord(snapshot.data()) };
}

export async function markActivityFailure(ref, status, message) {
  await setActivityRecordDocument(ref, {
    status,
    uploadStatus: status,
    failureMessage: String(message || '').slice(0, 500),
    driveUploadSession: FieldValue.delete(),
    uploadedBytes: FieldValue.delete(),
    uploadLeaseUntil: FieldValue.delete(),
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
    const now = Timestamp.now();
    setTransactionDocument(transaction, ref, {
      uploadedBytes,
      uploadLeaseUntil: createActivityUploadLease(now),
      updatedAt: now,
    }, { merge: true });
  });
}

export async function failActivityUpload(context, patientId, recordId, uploadAttemptId, message) {
  const ref = activityRecordRef(context, patientId, recordId);
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    if (data.status !== 'uploading' || data.uploadAttemptId !== uploadAttemptId) return;
    setTransactionDocument(transaction, ref, {
      status: 'failed',
      uploadStatus: 'failed',
      failureMessage: String(message || '').slice(0, 500),
      driveFileId: FieldValue.delete(),
      driveUploadSession: FieldValue.delete(),
      uploadedBytes: FieldValue.delete(),
      uploadLeaseUntil: FieldValue.delete(),
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
    setTransactionDocument(transaction, item.ref, {
      status: 'cancelled',
      uploadStatus: 'cancelled',
      driveUploadSession: FieldValue.delete(),
      uploadedBytes: FieldValue.delete(),
      uploadLeaseUntil: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    result = { id: current.id, ...data, alreadyCompleted: false };
  });
  return result;
}

export async function updateActivityMetadata(context, patientId, recordId, values) {
  const { ref, data } = await getActivityRecord(context, patientId, recordId);
  if (data.status !== 'active' && data.status !== 'delete_failed') throw activityError('activity-records/record-unavailable', 'Este registro não está disponível para edição.', 409);
  await setActivityRecordDocument(ref, { ...values, updatedAt: Timestamp.now() }, { merge: true });
}


export async function listActivityRecords(context, patientId, sessionId = '') {
  const patient = await patientRef(context, patientId).get();
  if (!patient.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  const recordsRef = patient.ref.collection('activityRecords');
  const normalizedSessionId = String(sessionId || '').trim();
  let documents;

  if (normalizedSessionId) {
    const [multiSessionSnapshot, legacySessionSnapshot] = await Promise.all([
      recordsRef.where('sessionIds', 'array-contains', normalizedSessionId).limit(250).get(),
      recordsRef.where('sessionId', '==', normalizedSessionId).limit(250).get(),
    ]);
    const uniqueDocuments = new Map();
    for (const item of [...multiSessionSnapshot.docs, ...legacySessionSnapshot.docs]) {
      uniqueDocuments.set(item.id, item);
    }
    documents = [...uniqueDocuments.values()];
  } else {
    const snapshot = await recordsRef.limit(250).get();
    documents = snapshot.docs;
  }

  return documents
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
