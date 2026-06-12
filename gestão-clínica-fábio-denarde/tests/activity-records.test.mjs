import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES,
  MAX_ACTIVITY_VIDEO_CHUNK_BYTES,
  MAX_ACTIVITY_VIDEO_BYTES,
  buildActivityDedupeKey,
  buildActivityVideoDedupeKey,
  canRecordActivity,
  canShareActivityWithGuardian,
  decodeActivityMedia,
  decodeActivityPhoto,
  decodeActivityVideoChunk,
  sanitizeText,
  validateUploadInput,
} from '../api/_lib/activityRecordsValidation.js';
import {
  MAX_ACTIVITY_MEDIA_RANGE_BYTES,
  parseActivityResumableRange,
  protectActivityUploadSession,
  resolveActivityMediaRange,
  revealActivityUploadSession,
  uploadActivityResumableChunk,
} from '../api/_lib/activityRecordsDrive.js';

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

test('upload validation accepts expected photo metadata', () => {
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
  assert.equal(result.mediaType, 'photo');
});

test('upload validation accepts expected video metadata', () => {
  const result = validateUploadInput({
    patientId: 'patient-1',
    sessionId: 'session-1',
    uploadAttemptId: 'attempt-1',
    category: 'Atenção',
    visibility: 'internal_only',
    sha256: 'd'.repeat(64),
    width: 1920,
    height: 1080,
    durationSeconds: 12,
    fileName: 'video.mp4',
    mimeType: 'video/mp4',
  });
  assert.equal(result.category, 'Atenção');
  assert.equal(result.mediaType, 'video');
  assert.equal(result.durationSeconds, 12);
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

test('video upload limit is configured for larger clinical recordings', () => {
  assert.equal(MAX_ACTIVITY_VIDEO_BYTES, 600 * 1024 * 1024);
  assert.equal(MAX_ACTIVITY_VIDEO_CHUNK_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_ACTIVITY_VIDEO_CHUNK_BYTES % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES, 0);
  assert.ok(Math.ceil(MAX_ACTIVITY_VIDEO_CHUNK_BYTES / 3) * 4 < 4 * 1024 * 1024);
});

test('guardian media requires current authorization, share visibility and authorized snapshot', () => {
  const patient = {
    activityMediaAuthorization: {
      guardianSharingStatus: 'authorized',
    },
  };
  const record = {
    status: 'active',
    visibility: 'share_allowed',
    authorizationSnapshot: {
      guardianSharingStatus: 'authorized',
    },
  };
  assert.equal(canShareActivityWithGuardian(patient, record), true);
  assert.equal(canShareActivityWithGuardian(patient, { ...record, visibility: 'internal_only' }), false);
  assert.equal(canShareActivityWithGuardian(patient, { ...record, status: 'uploading' }), false);
  assert.equal(
    canShareActivityWithGuardian(
      { activityMediaAuthorization: { guardianSharingStatus: 'not_authorized' } },
      record,
    ),
    false,
  );
});

test('video dedupe key uses lightweight stable metadata', () => {
  const base = {
    workspaceId: 'w1',
    patientId: 'p1',
    sessionId: 's1',
    fileName: 'video.mp4',
    fileSize: 87_000_000,
    durationSeconds: 36,
    lastModified: 1_700_000_000_000,
  };
  assert.equal(buildActivityVideoDedupeKey(base), buildActivityVideoDedupeKey(base));
  assert.notEqual(buildActivityVideoDedupeKey(base), buildActivityVideoDedupeKey({ ...base, fileSize: base.fileSize + 1 }));
});

test('sanitizer limits text length', () => {
  assert.equal(sanitizeText('  abcdef  ', 3), 'abc');
});

test('photo decoder validates the real file signature', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  assert.deepEqual(decodeActivityPhoto(jpeg.toString('base64'), 'image/jpeg'), jpeg);
  assert.throws(
    () => decodeActivityPhoto(Buffer.from('not-an-image').toString('base64'), 'image/jpeg'),
    /não corresponde a uma mídia válida/i,
  );
});

test('video decoder validates the real file signature', () => {
  const mp4 = Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
  ]);
  assert.deepEqual(decodeActivityMedia(mp4.toString('base64'), 'video/mp4'), mp4);
  assert.throws(
    () => decodeActivityMedia(Buffer.from('not-a-video').toString('base64'), 'video/mp4'),
    /não corresponde a uma mídia válida/i,
  );
});

test('video chunk decoder validates only the first chunk signature and enforces its limit', () => {
  const mp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert.deepEqual(decodeActivityVideoChunk(mp4Header.toString('base64'), 'video/mp4', { isFirstChunk: true }), mp4Header);
  const middleChunk = Buffer.from('video-content');
  assert.deepEqual(decodeActivityVideoChunk(middleChunk.toString('base64'), 'video/mp4'), middleChunk);
  assert.throws(
    () => decodeActivityVideoChunk(Buffer.alloc(MAX_ACTIVITY_VIDEO_CHUNK_BYTES + 1).toString('base64'), 'video/mp4'),
    /no máximo 2 MB/i,
  );
});

test('google drive resumable range returns the next byte offset', () => {
  assert.equal(parseActivityResumableRange('bytes=0-2097151'), 2_097_152);
  assert.equal(parseActivityResumableRange(''), 0);
  assert.equal(parseActivityResumableRange('invalid'), 0);
});

test('google drive resumable session is encrypted before persistence', () => {
  const previousSecret = process.env.DRIVE_FILE_SIGNING_SECRET;
  process.env.DRIVE_FILE_SIGNING_SECRET = 'test-only-signing-secret';
  try {
    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=secret';
    const protectedValue = protectActivityUploadSession(uploadUrl);
    assert.notEqual(protectedValue, uploadUrl);
    assert.equal(protectedValue.includes('upload_id=secret'), false);
    assert.equal(revealActivityUploadSession(protectedValue), uploadUrl);
  } finally {
    if (previousSecret === undefined) delete process.env.DRIVE_FILE_SIGNING_SECRET;
    else process.env.DRIVE_FILE_SIGNING_SECRET = previousSecret;
  }
});

test('resumable chunk forwards the expected content range and accepts drive 308 progress', async () => {
  const originalFetch = globalThis.fetch;
  let capturedOptions;
  globalThis.fetch = async (_url, options) => {
    capturedOptions = options;
    return new Response(null, { status: 308, headers: { Range: 'bytes=0-3' } });
  };
  try {
    const result = await uploadActivityResumableChunk({
      uploadUrl: 'https://upload.example/session',
      chunkBuffer: Buffer.from([1, 2, 3, 4]),
      start: 0,
      totalSize: 8,
      mimeType: 'video/mp4',
    });
    assert.equal(capturedOptions.method, 'PUT');
    assert.equal(capturedOptions.headers['Content-Length'], '4');
    assert.equal(capturedOptions.headers['Content-Range'], 'bytes 0-3/8');
    assert.deepEqual(result, { completed: false, nextOffset: 4, file: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resumable final chunk returns one completed drive file', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'drive-file-1',
    name: 'video.mp4',
    size: '8',
    parents: ['folder-1'],
    appProperties: { category: 'activity-record-media', mediaType: 'video' },
  }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  try {
    const result = await uploadActivityResumableChunk({
      uploadUrl: 'https://upload.example/session',
      chunkBuffer: Buffer.from([5, 6, 7, 8]),
      start: 4,
      totalSize: 8,
      mimeType: 'video/mp4',
    });
    assert.equal(result.completed, true);
    assert.equal(result.nextOffset, 8);
    assert.equal(result.file.id, 'drive-file-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('video playback ranges are capped below the function response limit', () => {
  const totalSize = 10 * 1024 * 1024;
  assert.deepEqual(
    resolveActivityMediaRange('', totalSize),
    { start: 0, end: MAX_ACTIVITY_MEDIA_RANGE_BYTES - 1 },
  );
  assert.deepEqual(
    resolveActivityMediaRange('bytes=2097152-', totalSize),
    { start: 2_097_152, end: 4_194_303 },
  );
  assert.deepEqual(
    resolveActivityMediaRange('bytes=-1024', totalSize),
    { start: totalSize - 1024, end: totalSize - 1 },
  );
  assert.throws(() => resolveActivityMediaRange('bytes=99999999-', totalSize), error => {
    assert.equal(error.statusCode, 416);
    assert.equal(error.details.totalSize, totalSize);
    return true;
  });
});
