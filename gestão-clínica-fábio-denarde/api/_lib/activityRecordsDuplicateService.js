import crypto from 'crypto';
import { calculateActivityDriveFingerprint } from './activityRecordsDrive.js';
import {
  claimActivityHashVerification,
  completeActivityHashVerification,
  failActivityHashVerification,
  findActivityRecordsBySha256,
  findLegacyActivityDuplicateCandidates,
} from './activityRecordsRepository.js';

const ACTIVE_LEGACY_VERIFICATIONS = new Map();
export const MAX_LEGACY_DUPLICATE_CANDIDATES = 8;

function duplicateResult(matches, sessionId) {
  const sameSession = matches.find(record => record.sessionId === sessionId);
  const otherSession = matches.find(record => record.sessionId !== sessionId);
  const existing = sameSession || otherSession;
  return {
    duplicate: Boolean(existing),
    scope: sameSession ? 'same-session' : otherSession ? 'other-session' : 'none',
    verification: 'complete',
    existing: existing ? {
      recordId: existing.id,
      sessionId: existing.sessionId,
      sessionDate: existing.sessionDate || '',
      sessionTime: existing.sessionTime || '',
    } : null,
  };
}

function verificationKey(context, patientId, recordId) {
  return `${context.ownerUserId}:${patientId}:${recordId}`;
}

async function verifyLegacyCandidate({
  context,
  patientId,
  record,
  dependencies,
}) {
  const key = verificationKey(context, patientId, record.id);
  const active = ACTIVE_LEGACY_VERIFICATIONS.get(key);
  if (active) return active;

  const work = (async () => {
    const verificationId = crypto.randomUUID();
    const claim = await dependencies.claim(
      context,
      patientId,
      record.id,
      verificationId,
    );
    if (claim.cached) return claim.record;
    if (!claim.claimed) {
      return { inconclusive: true, reason: claim.inProgress ? 'verification-in-progress' : 'record-unavailable' };
    }

    try {
      const storedDriveSha256 = String(
        record.driveSha256Checksum
        || (record.driveChecksumAlgorithm === 'SHA-256' ? record.driveChecksum : ''),
      ).toLowerCase();
      const fingerprint = /^[a-f0-9]{64}$/.test(storedDriveSha256)
        ? {
            sha256: storedDriveSha256,
            byteSize: Number(record.fileSize || 0),
            source: 'stored-drive-sha256',
            streamed: false,
            driveChecksums: {
              md5: record.driveMd5Checksum || '',
              sha1: record.driveSha1Checksum || '',
              sha256: storedDriveSha256,
            },
          }
        : await dependencies.fingerprint({
            fileId: record.driveFileId,
            ownership: {
              ownerUserId: context.ownerUserId,
              patientId,
              recordId: record.id,
              mediaType: record.mediaType,
            },
          });
      return await dependencies.complete(
        context,
        patientId,
        record.id,
        verificationId,
        fingerprint,
      );
    } catch (error) {
      await dependencies.fail(
        context,
        patientId,
        record.id,
        verificationId,
        error?.code || 'activity-records/hash-verification-failed',
      );
      return {
        inconclusive: true,
        reason: error?.code || 'activity-records/hash-verification-failed',
      };
    }
  })();

  ACTIVE_LEGACY_VERIFICATIONS.set(key, work);
  try {
    return await work;
  } finally {
    if (ACTIVE_LEGACY_VERIFICATIONS.get(key) === work) {
      ACTIVE_LEGACY_VERIFICATIONS.delete(key);
    }
  }
}

const defaultDependencies = {
  findByHash: findActivityRecordsBySha256,
  findCandidates: findLegacyActivityDuplicateCandidates,
  claim: claimActivityHashVerification,
  complete: completeActivityHashVerification,
  fail: failActivityHashVerification,
  fingerprint: calculateActivityDriveFingerprint,
};

export async function checkPatientActivityMediaDuplicate({
  context,
  patientId,
  sessionId,
  sha256,
  fileSize,
  mediaType,
  mimeType,
  dependencies = defaultDependencies,
}) {
  const directMatches = await dependencies.findByHash(
    context,
    patientId,
    sha256,
    10,
    mediaType,
  );
  if (directMatches.length > 0) return duplicateResult(directMatches, sessionId);

  const candidates = await dependencies.findCandidates(context, patientId, {
    fileSize,
    mediaType,
    mimeType,
    limit: MAX_LEGACY_DUPLICATE_CANDIDATES + 1,
  });
  if (candidates.length > MAX_LEGACY_DUPLICATE_CANDIDATES) {
    return {
      duplicate: false,
      scope: 'none',
      verification: 'inconclusive',
      reason: 'candidate-limit-exceeded',
      existing: null,
    };
  }

  let inconclusive = false;
  for (const candidate of candidates) {
    const verified = await verifyLegacyCandidate({
      context,
      patientId,
      record: candidate,
      dependencies,
    });
    if (verified?.inconclusive) {
      inconclusive = true;
      continue;
    }
    const hashes = [
      verified?.sha256,
      verified?.originalContentHash,
      verified?.preparedContentHash,
    ].filter(Boolean);
    if (hashes.includes(sha256)) {
      return duplicateResult([verified], sessionId);
    }
  }

  return {
    duplicate: false,
    scope: 'none',
    verification: inconclusive ? 'inconclusive' : 'complete',
    reason: inconclusive ? 'legacy-verification-failed' : '',
    existing: null,
  };
}

export function getActiveLegacyVerificationCount() {
  return ACTIVE_LEGACY_VERIFICATIONS.size;
}
