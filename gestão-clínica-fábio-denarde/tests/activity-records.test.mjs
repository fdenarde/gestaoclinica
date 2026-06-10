import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityDedupeKey,
  canRecordActivity,
  decodeActivityPhoto,
  sanitizeText,
  validateUploadInput,
} from '../api/_lib/activityRecordsValidation.js';

test('dedupe key is deterministic and scoped by workspace, patient and session', () => {
  const base = { workspaceId: 'w1', patientId: 'p1', sessionId: 's1', sha256: 'a'.repeat(64) };
  assert.equal(buildActivityDedupeKey(base), buildActivityDedupeKey(base));
  assert.notEqual(buildActivityDedupeKey(base), buildActivityDedupeKey({ ...base, sessionId: 's2' }));
});

test('internal recording requires explicit authorization', () => {
  assert.equal(canRecordActivity({ activityMediaAuthorization: { internalRecordingStatus: 'authorized' } }), true);
  assert.equal(canRecordActivity({ activityMediaAuthorization: { internalRecordingStatus: 'pending' } }), false);
  assert.equal(canRecordActivity({}), false);
});

test('upload validation accepts expected metadata', () => {
  const result = validateUploadInput({
    patientId: 'patient-1',
    sessionId: 'session-1',
    uploadAttemptId: 'attempt-1',
    category: 'Memória',
    visibility: 'internal_only',
    sha256: 'b'.repeat(64),
    width: 1280,
    height: 720,
    description: ' atividade ',
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
  });
  assert.equal(result.description, 'atividade');
  assert.equal(result.category, 'Memória');
});

test('invalid category is rejected', () => {
  assert.throws(() => validateUploadInput({
    patientId: 'p', sessionId: 's', uploadAttemptId: 'a', category: 'Inexistente', visibility: 'internal_only',
    sha256: 'c'.repeat(64), width: 100, height: 100,
  }), /categoria válida/i);
});

test('photo decoder rejects oversized payload', () => {
  const oversized = Buffer.alloc(1_800_001).toString('base64');
  assert.throws(() => decodeActivityPhoto(oversized, 'image/jpeg'), /1,8 MB/i);
});

test('sanitizer limits text length', () => {
  assert.equal(sanitizeText('  abcdef  ', 3), 'abc');
});

test('photo decoder validates the real file signature', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  assert.deepEqual(decodeActivityPhoto(jpeg.toString('base64'), 'image/jpeg'), jpeg);
  assert.throws(
    () => decodeActivityPhoto(Buffer.from('not-an-image').toString('base64'), 'image/jpeg'),
    /não corresponde a uma imagem válida/i,
  );
});
