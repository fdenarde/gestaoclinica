import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES,
  ACTIVITY_UPLOAD_LEASE_MS,
  MAX_ACTIVITY_VIDEO_CHUNK_BYTES,
  MAX_ACTIVITY_VIDEO_BYTES,
  MAX_ACTIVITY_VIDEO_DURATION_SECONDS,
  buildActivityDedupeKey,
  buildActivityVideoDedupeKey,
  canRecordActivity,
  canShareActivityWithGuardian,
  decodeActivityMedia,
  decodeActivityPhoto,
  decodeActivityVideoChunk,
  isSameCompletedActivityUpload,
  isSameInProgressActivityUpload,
  getActivityUploadLeaseExpiryMillis,
  isActivityUploadLeaseExpired,
  sanitizeText,
  validateUploadInput,
} from '../api/_lib/activityRecordsValidation.js';
import {
  MAX_ACTIVITY_MEDIA_RANGE_BYTES,
  calculateActivityDriveFingerprint,
  parseActivityResumableRange,
  protectActivityUploadSession,
  resolveActivityMediaRange,
  revealActivityUploadSession,
  uploadActivityResumableChunk,
} from '../api/_lib/activityRecordsDrive.js';
import {
  checkPatientActivityMediaDuplicate,
  getActiveLegacyVerificationCount,
} from '../api/_lib/activityRecordsDuplicateService.js';
import {
  hasVerifiedActivityContentHash,
  needsLegacyActivityHashVerification,
  sanitizeFirestoreDocument,
} from '../api/_lib/activityRecordsRepository.js';
import {
  createActivityPhotoThumbnail,
  createActivityVideoThumbnail,
  generateActivityThumbnailsSequentially,
  getActivityThumbnailDimensions,
} from '../src/lib/activityMediaThumbnails.js';
import {
  selectActivityUploadItems,
} from '../src/lib/activityUploadRetry.js';
import {
  calculateActivityUploadProgress,
  calculateActivityUploadTelemetry,
  formatActivityUploadEta,
  runActivityUploadPools,
} from '../src/lib/activityUploadScheduler.js';
import {
  ACTIVITY_DIRECT_UPLOAD_CHUNK_BYTES,
  ACTIVITY_PHOTO_UPLOAD_CONCURRENCY,
  ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES,
  ACTIVITY_VIDEO_UPLOAD_CONCURRENCY,
} from '../shared/activityMediaLimits.js';
import {
  MAX_ACTIVITY_FILES_PER_SELECTION,
  MAX_ACTIVITY_TOTAL_MEDIA,
  MAX_ACTIVITY_VISUAL_PREVIEWS,
  canAddNextActivityBatch,
  classifyActivityMediaError,
  createActivityMediaRetention,
  createPreparedPhotoRetry,
  formatActivityUploadSummary,
  getAcceptedActivityBatchFiles,
  getActivityBatchOverview,
  getActivityCloseImpact,
  getActivityFailurePresentation,
  getActivityQueueCounts,
  getActivityQueueStatusMessage,
  getActivityRemainingSlots,
  getActivitySelectionErrorMessage,
  getActivityUploadSummaryTitle,
  getActivityUploadSummaryTone,
  isActivityMediaFileReadError,
  isSameSessionDuplicateError,
  matchActivityMediaReplacements,
  preserveActivityBatchMetadata,
  processAfterNonBlockingProbe,
  recordConfirmedActivityMedia,
  releaseActivityMediaRetention,
  replaceActivityMediaRetention,
  sanitizeActivityMediaErrorMessage,
  shouldShowActivitySaveButton,
  validateActivityBatchSelection,
} from '../src/lib/activityMediaQueue.js';
import {
  IncrementalSha256,
  assertDurableActivityStorageCapacity,
  buildActivityMediaManifest,
  cleanupActivityMediaAcquisition,
  estimateActivityAcquisitionBytes,
  hashBlobIncrementally,
  inspectDurableActivityStorage,
  isExactActivityMediaDuplicate,
  persistActivityBlob,
  persistActivitySelectionBlobs,
  pinActivityMediaSelection,
  releasePinnedActivityMediaSelection,
  deletePersistedActivityFile,
  readPersistedActivityFile,
} from '../src/lib/activityMediaAcquisition.js';

test('retry selects only failed media and never resends queued or uploading items', () => {
  const items = [
    { id: 'saved-is-not-in-queue', status: 'active' },
    { id: 'failed-photo', status: 'failed' },
    { id: 'failed-video', status: 'failed' },
    { id: 'needs-reselection', status: 'failed', needsReselection: true },
    { id: 'pending', status: 'queued' },
    { id: 'uploading', status: 'uploading' },
  ];
  assert.deepEqual(
    selectActivityUploadItems(items, 'failed').map(item => item.id),
    ['failed-photo', 'failed-video'],
  );
  assert.deepEqual(
    selectActivityUploadItems(items, 'pending').map(item => item.id),
    ['pending'],
  );
  assert.equal(selectActivityUploadItems(items, 'all').some(item => item.id === 'saved-is-not-in-queue'), false);
});

test('fast direct upload uses large aligned chunks and bounded parallelism', () => {
  assert.equal(ACTIVITY_DIRECT_UPLOAD_CHUNK_BYTES, 16 * 1024 * 1024);
  assert.equal(ACTIVITY_DIRECT_UPLOAD_CHUNK_BYTES % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES, 0);
  assert.equal(ACTIVITY_PHOTO_UPLOAD_CONCURRENCY, 4);
  assert.equal(ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES, 4 * 1024 * 1024);
  assert.equal(ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES, 0);
  assert.equal(ACTIVITY_VIDEO_UPLOAD_CONCURRENCY, 2);
  assert.ok(ACTIVITY_DIRECT_UPLOAD_CHUNK_BYTES > MAX_ACTIVITY_VIDEO_CHUNK_BYTES);
});

test('photo and video upload pools respect independent concurrency limits', async () => {
  const items = [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `photo-${index}`, mediaType: 'photo' })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `video-${index}`, mediaType: 'video' })),
  ];
  let activePhotos = 0;
  let activeVideos = 0;
  let maxPhotos = 0;
  let maxVideos = 0;
  await runActivityUploadPools(items, async item => {
    if (item.mediaType === 'video') {
      activeVideos += 1;
      maxVideos = Math.max(maxVideos, activeVideos);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeVideos -= 1;
    } else {
      activePhotos += 1;
      maxPhotos = Math.max(maxPhotos, activePhotos);
      await new Promise(resolve => setTimeout(resolve, 5));
      activePhotos -= 1;
    }
    return item.id;
  });
  assert.equal(maxPhotos, 4);
  assert.equal(maxVideos, 2);
});

test('photo uploads finish before large videos start competing for bandwidth', async () => {
  const events = [];
  const items = [
    { id: 'video-1', mediaType: 'video' },
    { id: 'photo-1', mediaType: 'photo' },
    { id: 'photo-2', mediaType: 'photo' },
  ];
  await runActivityUploadPools(items, async item => {
    events.push(`start:${item.id}`);
    await new Promise(resolve => setTimeout(resolve, 2));
    events.push(`end:${item.id}`);
  });
  const lastPhotoEnd = Math.max(events.indexOf('end:photo-1'), events.indexOf('end:photo-2'));
  assert.ok(events.indexOf('start:video-1') > lastPhotoEnd);
});

test('overall upload progress is weighted by bytes instead of file count', () => {
  const items = [
    { id: 'small-photo', fileSize: 1_000_000 },
    { id: 'large-video', fileSize: 9_000_000 },
  ];
  const progress = new Map([
    ['small-photo', 100],
    ['large-video', 0],
  ]);
  assert.deepEqual(calculateActivityUploadProgress(items, progress), {
    percent: 10,
    bytesSent: 1_000_000,
    totalBytes: 10_000_000,
  });
});

test('upload telemetry reports speed and a readable remaining time', () => {
  const telemetry = calculateActivityUploadTelemetry({
    bytesSent: 60 * 1024 * 1024,
    totalBytes: 180 * 1024 * 1024,
    startedAt: 0,
    now: 60_000,
  });
  assert.equal(Math.round(telemetry.bytesPerSecond), 1024 * 1024);
  assert.equal(telemetry.etaSeconds, 120);
  assert.equal(formatActivityUploadEta(telemetry.etaSeconds), '2 min');
});

test('activity modal uses one batch preparation and direct binary Drive uploads', () => {
  const modalSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  const apiSource = fs.readFileSync(new URL('../src/lib/activityRecordsApi.ts', import.meta.url), 'utf8');
  const serverSource = fs.readFileSync(new URL('../api/activity-records.js', import.meta.url), 'utf8');
  assert.match(modalSource, /prepareActivityUploadBatch\(readyInputs\.map/);
  assert.match(modalSource, /runActivityUploadPools\(readyUploads/);
  assert.match(modalSource, /uploadPreparedActivityMediaDirect/);
  assert.doesNotMatch(modalSource, /await uploadActivityPhoto\(/);
  assert.match(apiSource, /xhr\.open\('PUT', uploadUrl\)/);
  assert.match(apiSource, /xhr\.send\(chunk\)/);
  assert.match(apiSource, /ACTIVITY_UPLOAD_CHUNK_ENDPOINT/);
  assert.match(apiSource, /putProxyUploadChunk/);
  assert.match(apiSource, /touchDirectUploadProgress/);
  assert.match(apiSource, /action: 'touchDirectUpload'/);
  assert.match(apiSource, /Content-Type', 'application\/octet-stream'/);
  assert.match(serverSource, /body\.action === 'prepareDirectUploadBatch'/);
  assert.match(serverSource, /ensureActivityMediaFolders/);
  assert.match(serverSource, /body\.action === 'finalizeDirectUpload'/);
  assert.match(serverSource, /body\.action === 'touchDirectUpload'/);
});

test('stale upload reservations expire while active uploads renew their lease', () => {
  const now = Date.now();
  const activeLease = {
    status: 'uploading',
    uploadLeaseUntil: { toMillis: () => now + 30_000 },
  };
  const expiredLease = {
    status: 'uploading',
    uploadLeaseUntil: { toMillis: () => now - 1 },
  };
  const legacyFresh = {
    status: 'uploading',
    updatedAt: { toMillis: () => now - 1_000 },
  };
  const legacyStale = {
    status: 'uploading',
    updatedAt: { toMillis: () => now - ACTIVITY_UPLOAD_LEASE_MS - 1 },
  };

  assert.equal(getActivityUploadLeaseExpiryMillis(activeLease), now + 30_000);
  assert.equal(isActivityUploadLeaseExpired(activeLease, now), false);
  assert.equal(isActivityUploadLeaseExpired(expiredLease, now), true);
  assert.equal(isActivityUploadLeaseExpired(legacyFresh, now), false);
  assert.equal(isActivityUploadLeaseExpired(legacyStale, now), true);
  assert.equal(isActivityUploadLeaseExpired({ status: 'active' }, now), false);

  const repositorySource = fs.readFileSync(new URL('../api/_lib/activityRecordsRepository.js', import.meta.url), 'utf8');
  assert.match(repositorySource, /isActivityUploadLeaseExpired\(existing, now\.toMillis\(\)\)/);
  assert.match(repositorySource, /uploadAttemptId: data\.uploadAttemptId/);
  assert.match(repositorySource, /uploadLeaseUntil: createActivityUploadLease\(now\)/);
});

test('batch preparation reuses one resolved Drive folder tree for all media', () => {
  const driveSource = fs.readFileSync(new URL('../api/_lib/activityRecordsDrive.js', import.meta.url), 'utf8');
  const serverSource = fs.readFileSync(new URL('../api/activity-records.js', import.meta.url), 'utf8');
  assert.match(driveSource, /export async function ensureActivityMediaFolders/);
  assert.match(driveSource, /accessToken: preparedAccessToken/);
  assert.match(driveSource, /folderId: preparedFolderId/);
  assert.match(serverSource, /const folderBundle = await ensureActivityMediaFolders/);
  assert.match(serverSource, /accessToken: folderBundle\.accessToken/);
  assert.match(serverSource, /folderId: folderBundle\.folders\[input\.mediaType\]/);
});

test('binary proxy fallback stays below Vercel payload limits and validates upload ownership', () => {
  const routeSource = fs.readFileSync(new URL('../api/activity-upload-chunk.js', import.meta.url), 'utf8');
  const localServerSource = fs.readFileSync(new URL('../drive-api-server.js', import.meta.url), 'utf8');
  const viteSource = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.equal(ACTIVITY_PROXY_UPLOAD_CHUNK_BYTES, 4 * 1024 * 1024);
  assert.match(routeSource, /bodyParser: false/);
  assert.match(routeSource, /resolveAccessContext\(req\)/);
  assert.match(routeSource, /getActivityRecord\(context, patientId, recordId\)/);
  assert.match(routeSource, /uploadActivityResumableChunk/);
  assert.match(routeSource, /updateActivityUploadProgress/);
  assert.match(localServerSource, /activity-upload-chunk/);
  assert.match(localServerSource, /express\.raw/);
  assert.match(viteSource, /\/api\/activity-upload-chunk/);
});

test('resumable session is initialized with the trusted browser origin for Drive CORS', () => {
  const driveSource = fs.readFileSync(new URL('../api/_lib/activityRecordsDrive.js', import.meta.url), 'utf8');
  const serverSource = fs.readFileSync(new URL('../api/activity-records.js', import.meta.url), 'utf8');
  assert.match(driveSource, /browserOrigin = ''/);
  assert.match(driveSource, /Origin: browserOrigin/);
  assert.match(serverSource, /const browserOrigin = getTrustedBrowserOrigin\(req\)/);
  assert.match(serverSource, /browserOrigin,/);
});

test('single Android selection accepts 20, 45 and 50 files without a manual batch limit', () => {
  assert.equal(MAX_ACTIVITY_FILES_PER_SELECTION, 50);
  for (const incomingCount of [20, 45, 50]) {
    const result = validateActivityBatchSelection({
      incomingCount,
      confirmedCount: 0,
      queuedItems: [],
    });
    assert.equal(result.allowed, true);
    assert.equal(getAcceptedActivityBatchFiles(Array.from({ length: incomingCount }), result).length, incomingCount);
  }
});

test('selection above fifty is blocked without creating a partial queue', () => {
  const incomingFiles = Array.from({ length: 51 }, (_, index) => ({ id: index }));
  const result = validateActivityBatchSelection({
    incomingCount: incomingFiles.length,
    confirmedCount: 0,
    queuedItems: [],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'selection-too-large');
  assert.deepEqual(getAcceptedActivityBatchFiles(incomingFiles, result), []);
  assert.match(getActivitySelectionErrorMessage(result), /no máximo 50 arquivos/i);
});

test('activity accepts exactly fifty confirmed media and rejects the fifty-first', () => {
  assert.equal(MAX_ACTIVITY_TOTAL_MEDIA, 50);
  assert.equal(getActivityRemainingSlots(45), 5);
  const allowed = validateActivityBatchSelection({
    incomingCount: 5,
    confirmedCount: 45,
    queuedItems: [],
  });
  const blocked = validateActivityBatchSelection({
    incomingCount: 6,
    confirmedCount: 45,
    queuedItems: [],
  });
  assert.equal(allowed.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'activity-limit-exceeded');
  assert.match(getActivitySelectionErrorMessage(blocked), /5 vagas restantes/i);
});

test('one selection can confirm forty-five media in the same activity state', () => {
  let activityState = {
    confirmedCount: 0,
    category: 'Memória',
    visibility: 'internal_only',
    description: 'Mesma atividade',
    authorization: 'authorized',
    patientId: 'patient-1',
    sessionId: 'session-1',
  };
  const selection = validateActivityBatchSelection({
    incomingCount: 45,
    confirmedCount: activityState.confirmedCount,
    queuedItems: [],
  });
  assert.equal(selection.allowed, true);
  activityState = recordConfirmedActivityMedia(activityState, 45);
  assert.equal(activityState.confirmedCount, 45);
  assert.equal(getActivityRemainingSlots(activityState.confirmedCount), 5);
});

test('confirmed media stay outside later queues and cannot be selected for upload again', () => {
  const queueAfterConfirmation = [
    { id: 'pending-next-batch', status: 'queued', needsReselection: false },
  ];
  assert.deepEqual(selectActivityUploadItems(queueAfterConfirmation).map(item => item.id), ['pending-next-batch']);
  assert.equal(selectActivityUploadItems(queueAfterConfirmation).some(item => item.id === 'already-confirmed'), false);
});

test('new batch is blocked while current batch is busy or unresolved', () => {
  for (const currentItem of [
    { status: 'preparing' },
    { status: 'uploading' },
    { status: 'failed', needsReselection: false },
    { status: 'failed', needsReselection: true },
  ]) {
    const result = validateActivityBatchSelection({
      incomingCount: 1,
      confirmedCount: 12,
      queuedItems: [currentItem],
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'batch-unresolved');
  }
  const busyResult = validateActivityBatchSelection({
    incomingCount: 1,
    confirmedCount: 12,
    queuedItems: [],
    busy: true,
  });
  assert.equal(busyResult.code, 'batch-busy');
});

test('new batch becomes available only after the previous queue is empty', () => {
  assert.equal(canAddNextActivityBatch({
    confirmedCount: 12,
    queuedItems: [{ status: 'failed' }],
  }), false);
  assert.equal(canAddNextActivityBatch({
    confirmedCount: 12,
    queuedItems: [],
  }), true);
  assert.equal(canAddNextActivityBatch({
    confirmedCount: 50,
    queuedItems: [],
  }), false);
});

test('activity metadata remains unchanged between successive batches', () => {
  const metadata = {
    category: 'Atenção',
    visibility: 'share_allowed',
    description: 'Observação comum aos lotes',
    authorization: { internalRecordingStatus: 'authorized', guardianSharingStatus: 'authorized' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    professional: 'Profissional',
  };
  const preserved = preserveActivityBatchMetadata(metadata);
  assert.deepEqual(preserved, metadata);
  assert.notEqual(preserved, metadata);
});

test('batch overview separates confirmed, current, remaining and failure states', () => {
  const overview = getActivityBatchOverview(24, [
    { status: 'queued' },
    { status: 'uploading' },
    { status: 'failed', needsReselection: false },
    { status: 'failed', needsReselection: true },
  ]);
  assert.deepEqual(overview, {
    confirmed: 24,
    currentBatch: 4,
    remaining: 22,
    total: 4,
    needsReselection: 1,
    retryable: 1,
    pending: 1,
    acquiring: 0,
    duplicates: 0,
    verificationWarnings: 0,
    uploading: 1,
    available: 2,
  });
});

test('closing the modal preserves confirmed media and discards only unresolved local items', () => {
  assert.deepEqual(getActivityCloseImpact(24, [{ id: 1 }, { id: 2 }]), {
    confirmedPreserved: 24,
    localItemsDiscarded: 2,
  });
});

test('more than eight selected files keep technical retention without extra visual previews', () => {
  let nextUrl = 0;
  const createUrl = () => `blob:test-${++nextUrl}`;
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...createActivityMediaRetention({ index }, index < MAX_ACTIVITY_VISUAL_PREVIEWS, createUrl),
  }));
  assert.equal(items.filter(item => item.previewUrl).length, 8);
  assert.equal(items.filter(item => item.retentionUrl).length, 12);
  assert.equal(items[8].previewUrl, '');
  assert.ok(items[8].retentionUrl);
});

test('incremental SHA-256 matches the platform hash across multiple chunks', async () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 17);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  const hasher = new IncrementalSha256();
  hasher.update(bytes.subarray(0, 31));
  hasher.update(bytes.subarray(31, 2_000_003));
  hasher.update(bytes.subarray(2_000_003));
  assert.equal(hasher.digestHex(), expected);
  assert.equal(await hashBlobIncrementally(new Blob([bytes]), { chunkSize: 777_777 }), expected);
});

test('durable acquisition estimates quota and blocks before an unsafe write', async () => {
  const files = [
    { size: 8_000_000, type: 'image/jpeg' },
    { size: 120_000_000, type: 'video/mp4' },
  ];
  assert.equal(estimateActivityAcquisitionBytes(files), 129_800_000);
  const storageStatus = await inspectDurableActivityStorage({
    getDirectory: async () => ({}),
    estimate: async () => ({ quota: 200_000_000, usage: 30_000_000 }),
  });
  assert.equal(storageStatus.supported, true);
  assert.equal(assertDurableActivityStorageCapacity({
    requiredBytes: 100_000_000,
    storageStatus,
  }).ok, true);
  assert.equal(assertDurableActivityStorageCapacity({
    requiredBytes: 120_000_000,
    storageStatus,
  }).reason, 'insufficient-storage');
  const localHttpFallback = await inspectDurableActivityStorage(
    { estimate: async () => ({ quota: 500_000_000, usage: 0 }) },
    {},
  );
  assert.equal(localHttpFallback.supported, true);
  assert.equal(localHttpFallback.mode, 'indexeddb');
});

test('OPFS acquisition writes in a stream and removes the retained file on cleanup', async () => {
  const files = new Map();
  const directory = {
    async getFileHandle(name) {
      return {
        async createWritable() {
          const chunks = [];
          return {
            async write(chunk) { chunks.push(new Uint8Array(chunk)); },
            async close() { files.set(name, new Blob(chunks)); },
            async abort() { files.delete(name); },
          };
        },
        async getFile() { return files.get(name); },
      };
    },
    async removeEntry(name) {
      if (!files.delete(name)) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
    },
  };
  const storage = {
    async getDirectory() {
      return { async getDirectoryHandle() { return directory; } };
    },
  };
  const source = new Blob([Buffer.from('conteudo-duravel')]);
  const persisted = await persistActivityBlob({
    blob: source,
    attemptId: 'attempt/opfs',
    storage,
    calculateHash: true,
  });
  assert.equal(persisted.persistedBlob.size, source.size);
  assert.equal(
    persisted.sha256,
    crypto.createHash('sha256').update(Buffer.from('conteudo-duravel')).digest('hex'),
  );
  assert.equal(files.size, 1);
  await deletePersistedActivityFile(persisted.durableName, storage);
  assert.equal(files.size, 0);
});

test('Android selection starts the first read of every file before any asynchronous storage check', async () => {
  const started = [];
  const files = Array.from({ length: 45 }, (_, index) => ({
    size: index + 1,
    type: 'image/jpeg',
    stream() {
      return {
        getReader() {
          return {
            read() {
              started.push(index);
              return Promise.resolve({ done: true, value: undefined });
            },
            cancel() { return Promise.resolve(); },
          };
        },
      };
    },
  }));
  const pinned = pinActivityMediaSelection(files);
  assert.equal(pinned.length, 45);
  assert.deepEqual(started, Array.from({ length: 45 }, (_, index) => index));
  await releasePinnedActivityMediaSelection(pinned);

  const modalSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  const pinCall = modalSource.indexOf('pinnedSelection = pinActivityMediaSelection(selectedFiles)');
  const storageCheck = modalSource.indexOf('await inspectDurableActivityStorage()');
  assert.ok(pinCall >= 0);
  assert.ok(storageCheck > pinCall);
});

test('IndexedDB fallback stores protected Android files in bounded chunks', () => {
  const acquisitionSource = fs.readFileSync(new URL('../src/lib/activityMediaAcquisition.js', import.meta.url), 'utf8');
  assert.match(acquisitionSource, /ACTIVITY_MEDIA_CHUNK_STORE = 'chunks'/);
  assert.match(acquisitionSource, /INDEXED_DB_CHUNK_BYTES = 2 \* 1024 \* 1024/);
  assert.match(acquisitionSource, /persistPinnedItemToIndexedDb/);
  assert.match(acquisitionSource, /readIndexedDbMedia/);
  assert.doesNotMatch(acquisitionSource, /store\.put\(\{ durableName: item\.durableName, blob: item\.blob \}\)/);
});

test('selection protection copies every original before media processing begins', async () => {
  const files = new Map();
  const directory = {
    async getFileHandle(name) {
      return {
        async createWritable() {
          const chunks = [];
          return {
            async write(chunk) { chunks.push(new Uint8Array(chunk)); },
            async close() { files.set(name, new Blob(chunks)); },
            async abort() { files.delete(name); },
          };
        },
        async getFile() { return files.get(name); },
      };
    },
  };
  const storage = {
    async getDirectory() {
      return { async getDirectoryHandle() { return directory; } };
    },
  };
  const selected = Array.from({ length: 45 }, (_, index) => ({
    blob: new Blob([`arquivo-${index}`]),
    attemptId: `attempt-${index}`,
  }));
  const results = await persistActivitySelectionBlobs({
    items: selected,
    storage,
    indexedDb: null,
    opfsConcurrency: 3,
  });
  assert.equal(results.length, 45);
  assert.equal(results.every(result => result.status === 'fulfilled'), true);
  assert.equal(files.size, 45);

  const modalSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  const protectionCall = modalSource.indexOf('persistActivitySelectionBlobs({');
  const processingPhase = modalSource.indexOf('// Fase 2: somente depois que todos os arquivos possíveis estão protegidos');
  assert.ok(protectionCall >= 0);
  assert.ok(processingPhase > protectionCall);
  assert.match(modalSource, /Protegendo arquivo no celular/);
});

test('persisted thumbnail remains recoverable independently from the original file', async () => {
  const files = new Map();
  const directory = {
    async getFileHandle(name) {
      return {
        async createWritable() {
          const chunks = [];
          return {
            async write(chunk) { chunks.push(new Uint8Array(chunk)); },
            async close() { files.set(name, new Blob(chunks, { type: 'image/jpeg' })); },
            async abort() { files.delete(name); },
          };
        },
        async getFile() { return files.get(name); },
      };
    },
  };
  const storage = {
    async getDirectory() {
      return { async getDirectoryHandle() { return directory; } };
    },
  };
  const thumbnail = await persistActivityBlob({
    blob: new Blob(['small-preview'], { type: 'image/jpeg' }),
    attemptId: 'attempt-thumbnail-reload',
    storage,
  });
  const recovered = await readPersistedActivityFile({
    durableName: thumbnail.durableName,
    originalName: 'thumbnail.jpg',
    type: 'image/jpeg',
    lastModified: 123,
    storage,
    indexedDb: null,
  });
  assert.equal(recovered.name, 'thumbnail.jpg');
  assert.equal(recovered.type, 'image/jpeg');
  assert.equal(await recovered.text(), 'small-preview');
});

test('acquisition cleanup removes both durable media and persisted thumbnail', async () => {
  const removed = [];
  const directory = {
    async removeEntry(name) { removed.push(name); },
  };
  const storage = {
    async getDirectory() {
      return { async getDirectoryHandle() { return directory; } };
    },
  };
  await cleanupActivityMediaAcquisition({
    attemptId: 'attempt-cleanup',
    durableName: 'attempt-cleanup.media',
    thumbnailName: 'attempt-cleanup-thumbnail.media',
    storage,
    indexedDb: null,
  });
  assert.deepEqual(removed.sort(), [
    'attempt-cleanup-thumbnail.media',
    'attempt-cleanup.media',
  ]);
});

test('persistent manifest contains only technical recovery metadata', () => {
  const manifest = buildActivityMediaManifest({
    attemptId: 'attempt-1',
    scopeKey: 'scope-hash',
    durableName: 'attempt-1.media',
    originalName: 'IMG_1.jpg',
    originalSelectionPosition: 9,
    mediaType: 'photo',
    mimeType: 'image/jpeg',
    fileSize: 123,
    originalContentHash: 'a'.repeat(64),
    preparedContentHash: 'b'.repeat(64),
    width: 100,
    height: 80,
    lastModified: 10,
    thumbnailName: 'attempt-1-thumbnail.media',
    thumbnailMimeType: 'image/jpeg',
    thumbnailStatus: 'ready',
  });
  assert.equal(manifest.originalSelectionPosition, 9);
  assert.equal('patientName' in manifest, false);
  assert.equal('description' in manifest, false);
  assert.equal('token' in manifest, false);
  assert.equal(manifest.thumbnailName, 'attempt-1-thumbnail.media');
  assert.equal(manifest.thumbnailStatus, 'ready');
});

function createThumbnailCanvasFixture() {
  const canvas = {
    width: 0,
    height: 0,
    drawCalls: 0,
    getContext() {
      return {
        fillStyle: '',
        fillRect() {},
        drawImage: () => { canvas.drawCalls += 1; },
      };
    },
    toBlob(callback) {
      callback(new Blob(['thumbnail'], { type: 'image/jpeg' }));
    },
  };
  return canvas;
}

test('photo thumbnail is small, closes ImageBitmap and releases canvas memory', async () => {
  let bitmapClosed = false;
  const canvas = createThumbnailCanvasFixture();
  const thumbnail = await createActivityPhotoThumbnail(new Blob(['photo']), {
    createImageBitmap: async () => ({
      width: 2400,
      height: 1200,
      close: () => { bitmapClosed = true; },
    }),
    createCanvas: () => canvas,
  });
  assert.deepEqual(getActivityThumbnailDimensions(2400, 1200), { width: 360, height: 180 });
  assert.equal(thumbnail.status, 'ready');
  assert.equal(thumbnail.width, 360);
  assert.equal(thumbnail.height, 180);
  assert.equal(bitmapClosed, true);
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);
  assert.equal(canvas.drawCalls, 1);
});

test('video thumbnail captures one frame and disposes video and temporary URL', async () => {
  const revoked = [];
  const canvas = createThumbnailCanvasFixture();
  let removed = false;
  let paused = false;
  const video = {
    videoWidth: 1920,
    videoHeight: 1080,
    duration: 9,
    onloadedmetadata: null,
    onloadeddata: null,
    onseeked: null,
    onerror: null,
    preload: '',
    muted: false,
    playsInline: false,
    autoplay: true,
    pause: () => { paused = true; },
    removeAttribute() {},
    remove: () => { removed = true; },
    load() {
      if (this.src && this.onloadedmetadata) {
        queueMicrotask(() => this.onloadedmetadata?.());
      }
    },
    set currentTime(_value) {
      queueMicrotask(() => this.onseeked?.());
    },
  };
  const thumbnail = await createActivityVideoThumbnail(
    new Blob(['video'], { type: 'video/mp4' }),
    {
      createObjectURL: () => 'blob:video-thumbnail-test',
      revokeObjectURL: url => revoked.push(url),
      createVideo: () => video,
      createCanvas: () => canvas,
    },
  );
  assert.equal(thumbnail.status, 'ready');
  assert.equal(thumbnail.width, 360);
  assert.equal(thumbnail.height, 203);
  assert.equal(video.autoplay, false);
  assert.equal(paused, true);
  assert.equal(removed, true);
  assert.deepEqual(revoked, ['blob:video-thumbnail-test']);
  assert.equal(canvas.width, 1);
});

test('twenty and fifty thumbnails are generated sequentially beyond the old preview limit', async () => {
  for (const count of [20, 50]) {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: count }, (_, index) => ({
      id: index,
      sourceFile: { id: index },
      contentHash: String(index).padStart(64, '0'),
    }));
    const results = await generateActivityThumbnailsSequentially(
      items,
      async item => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active -= 1;
        return { blob: new Blob([String(item.id)]), status: 'ready' };
      },
    );
    assert.equal(results.length, count);
    assert.equal(results.every(result => result.status === 'ready'), true);
    assert.equal(maxActive, 1);
    assert.equal(results[12].status, 'ready');
    assert.deepEqual(items.map(item => item.contentHash), Array.from({ length: count }, (_, index) => String(index).padStart(64, '0')));
  }
});

test('thumbnail failure stays explicit and does not require media reselection', async () => {
  const [result] = await generateActivityThumbnailsSequentially(
    [{ id: 'video', acquired: true, needsReselection: false }],
    async () => { throw new Error('no decodable frame'); },
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.item.acquired, true);
  assert.equal(result.item.needsReselection, false);
});

test('twenty acquired mixed media survive an API failure without undefined documents or duplicate retries', async () => {
  const technicalFirestoreError = 'Cannot use "undefined" as a Firestore value in originalContentHash';
  const items = Array.from({ length: 20 }, (_, index) => {
    const mediaType = index % 3 === 0 ? 'video' : 'photo';
    const originalContentHash = mediaType === 'video' ? String(index + 1).padStart(64, 'a') : undefined;
    const preparedContentHash = mediaType === 'photo' ? String(index + 1).padStart(64, 'b') : undefined;
    return {
      id: `media-${index}`,
      uploadAttemptId: `attempt-${index}`,
      mediaType,
      sourceFile: { durableName: `attempt-${index}.media` },
      status: 'failed',
      needsReselection: false,
      errorMessage: sanitizeActivityMediaErrorMessage(technicalFirestoreError),
      document: sanitizeFirestoreDocument({
        originalContentHash,
        originalContentHashAlgorithm: originalContentHash ? 'SHA-256' : undefined,
        preparedContentHash,
        preparedContentHashAlgorithm: preparedContentHash ? 'SHA-256' : undefined,
        checksums: {
          drive: undefined,
          known: index === 0 ? '' : null,
        },
      }),
    };
  });
  const thumbnails = await generateActivityThumbnailsSequentially(
    items,
    async item => {
      if (item.id === 'media-12') throw new Error('frame unavailable');
      return { blob: new Blob([item.id], { type: 'image/jpeg' }), status: 'ready' };
    },
  );
  const retry = selectActivityUploadItems(items, 'failed');
  const hasUndefined = value => {
    if (Array.isArray(value)) return value.some(hasUndefined);
    if (!value || typeof value !== 'object') return value === undefined;
    return Object.values(value).some(hasUndefined);
  };

  assert.equal(items.every(item => item.sourceFile.durableName.endsWith('.media')), true);
  assert.equal(items.every(item => item.needsReselection === false), true);
  assert.equal(items.every(item => !/Firestore|undefined/i.test(item.errorMessage)), true);
  assert.equal(items.every(item => !hasUndefined(item.document)), true);
  assert.equal(thumbnails.length, 20);
  assert.equal(thumbnails.filter(item => item.status === 'ready').length, 19);
  assert.equal(thumbnails[12].status, 'unavailable');
  assert.deepEqual(retry.map(item => item.uploadAttemptId), items.map(item => item.uploadAttemptId));
  assert.equal(new Set(retry.map(item => item.uploadAttemptId)).size, 20);
});

test('duplicate detection depends on content hash, not equal names or sizes', () => {
  const firstHash = '1'.repeat(64);
  const secondHash = '2'.repeat(64);
  const known = new Set([firstHash]);
  assert.equal(isExactActivityMediaDuplicate(known, firstHash), true);
  assert.equal(isExactActivityMediaDuplicate(known, secondHash), false);
  assert.equal(isExactActivityMediaDuplicate(known, ''), false);
  assert.equal(getActivityRemainingSlots(0, 47), 3);
});

test('technical retention is released after success, removal or modal cleanup', () => {
  const revoked = [];
  const revoke = url => revoked.push(url);
  const success = { previewUrl: 'blob:preview-success', retentionUrl: 'blob:retain-success' };
  const removed = { previewUrl: '', retentionUrl: 'blob:retain-removed' };
  const closed = { previewUrl: 'blob:preview-closed', retentionUrl: 'blob:retain-closed' };
  releaseActivityMediaRetention(success, revoke);
  releaseActivityMediaRetention(removed, revoke);
  releaseActivityMediaRetention(closed, revoke);
  assert.deepEqual(revoked.sort(), [
    'blob:preview-closed',
    'blob:preview-success',
    'blob:retain-closed',
    'blob:retain-removed',
    'blob:retain-success',
  ]);
});

test('replacement releases old retention and preserves visual preview policy', () => {
  const revoked = [];
  let created = 0;
  const result = replaceActivityMediaRetention(
    { previewUrl: '', retentionUrl: 'blob:old-retention' },
    {},
    () => `blob:new-${++created}`,
    url => revoked.push(url),
  );
  assert.deepEqual(revoked, ['blob:old-retention']);
  assert.equal(result.previewUrl, '');
  assert.equal(result.retentionUrl, 'blob:new-1');
});

test('failed replacement creation keeps the old technical retention alive', () => {
  const revoked = [];
  assert.throws(() => replaceActivityMediaRetention(
    { previewUrl: '', retentionUrl: 'blob:old-retention' },
    {},
    () => { throw new Error('cannot create replacement'); },
    url => revoked.push(url),
  ));
  assert.deepEqual(revoked, []);
});

test('slice probe failure does not block successful real processing', async () => {
  const events = [];
  const prepared = await processAfterNonBlockingProbe({
    probe: async () => { throw Object.assign(new Error('slice failed'), { code: 'activity-records/probe-failed' }); },
    process: async () => ({ mediaType: 'photo', file: { size: 123 } }),
    onProbeResult: result => events.push(result.readable),
  });
  assert.deepEqual(events, [false]);
  assert.equal(prepared.file.size, 123);
});

test('real read failure is classified as requiring reselection', async () => {
  const error = Object.assign(new Error('unavailable'), { code: 'activity-records/local-file-unavailable' });
  await assert.rejects(
    processAfterNonBlockingProbe({ probe: async () => undefined, process: async () => { throw error; } }),
    candidate => classifyActivityMediaError(candidate) === 'real-read-failed',
  );
});

test('Android permission read errors are translated and require only that file to be selected again', () => {
  const error = Object.assign(
    new Error('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file or directory was acquired.'),
    { name: 'NotReadableError' },
  );
  assert.equal(isActivityMediaFileReadError(error), true);
  assert.equal(classifyActivityMediaError(error), 'real-read-failed');
  assert.equal(
    sanitizeActivityMediaErrorMessage(error.message),
    'O arquivo original não pôde ser lido pelo celular. Selecione novamente somente este arquivo.',
  );
});

test('prepared JPEG is retained independently from the original file for retry', () => {
  const preparedFile = { name: 'prepared.jpg', size: 1000 };
  const retry = createPreparedPhotoRetry({
    mediaType: 'photo',
    file: preparedFile,
    width: 1200,
    height: 800,
    sha256: 'a'.repeat(64),
    lastModified: 123,
  });
  assert.equal(retry.file, preparedFile);
  assert.equal(retry.sha256, 'a'.repeat(64));
});

test('partial result uses short failure wording and separates successful media', () => {
  assert.equal(
    formatActivityUploadSummary({ saved: 9, failed: 36, pending: 0 }),
    '9 mídias salvas. 36 falharam. Tente novamente apenas as mídias com falha.',
  );
  assert.equal(
    getActivityUploadSummaryTone({ saved: 9, failed: 36, pending: 0, duplicates: 0 }),
    'error',
  );
});

test('same-session duplicate errors are informational and never retryable', () => {
  for (const code of [
    'activity-records/duplicate',
    'activity-records/duplicate-same-session',
    'activity-records/duplicate_same_session',
    'activity-records/already-confirmed',
  ]) {
    assert.equal(isSameSessionDuplicateError({ code }), true);
  }
  assert.equal(isSameSessionDuplicateError({ code: 'activity-records/network-error' }), false);
});

test('mixed successful upload and same-session duplicates uses a yellow warning summary', () => {
  const summary = { saved: 10, failed: 0, pending: 0, duplicates: 4, totalConfirmed: 30 };
  assert.equal(getActivityUploadSummaryTone(summary), 'warning');
  assert.equal(getActivityUploadSummaryTitle(summary), 'Mídias repetidas');
  assert.equal(
    formatActivityUploadSummary(summary),
    '10 mídias novas salvas. 4 repetidas não foram enviadas.',
  );
});

test('selection containing only duplicates uses a yellow warning, not success or error', () => {
  const summary = { saved: 0, failed: 0, pending: 0, duplicates: 4, totalConfirmed: 20 };
  assert.equal(getActivityUploadSummaryTone(summary), 'warning');
  assert.equal(getActivityUploadSummaryTitle(summary), 'Mídias repetidas');
  assert.equal(
    formatActivityUploadSummary(summary),
    '4 mídias repetidas. Nenhuma nova mídia foi enviada.',
  );
});

test('activity notifications use simple severity colors and remain readable', () => {
  const modalSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  const toastSource = fs.readFileSync(new URL('../src/components/Common/Toast.tsx', import.meta.url), 'utf8');

  assert.match(modalSource, /Repetidas identificadas/);
  assert.match(modalSource, /border-amber-300 bg-amber-50/);
  assert.match(modalSource, /border-status-red-text\/35 bg-status-red-bg/);
  assert.match(modalSource, /aria-label="Resumo do envio"/);
  assert.match(modalSource, />Falharam</);
  assert.match(toastSource, /warning: 'bg-amber-400 text-slate-950'/);
  assert.match(toastSource, /error: 'bg-status-red-text text-white'/);
  assert.match(toastSource, /warning: 12000/);
  assert.match(toastSource, /error: 12000/);
  assert.match(toastSource, /Fechar notificação/);
});

test('queue and card messages avoid internal retry and reselection jargon', () => {
  const status = getActivityQueueStatusMessage({
    acquiring: 0,
    pending: 2,
    uploading: 0,
    duplicates: 1,
    verificationWarnings: 1,
    retryable: 1,
    needsReselection: 1,
  });
  assert.match(status, /aguardando envio/i);
  assert.match(status, /nova tentativa/i);
  assert.match(status, /selecionada novamente/i);
  assert.doesNotMatch(status, /retryable|needsReselection/i);

  const retry = getActivityFailurePresentation({ needsReselection: false, errorMessage: 'Falha temporária.' });
  assert.equal(retry.title, 'O envio não foi concluído');
  const reselection = getActivityFailurePresentation({ needsReselection: true, errorMessage: '' });
  assert.equal(reselection.title, 'Selecione este arquivo novamente');
});

test('completed upload invites more media and reports the total limit when reached', () => {
  assert.equal(
    formatActivityUploadSummary({ saved: 12, failed: 0, pending: 0, totalConfirmed: 12 }),
    '12 mídias salvas. Você pode adicionar mais mídias ou finalizar a atividade.',
  );
  assert.equal(
    formatActivityUploadSummary({ saved: 5, failed: 0, pending: 0, totalConfirmed: 50 }),
    '5 mídias salvas. Limite de 50 mídias atingido.',
  );
});

test('save action is hidden when every remaining item needs reselection', () => {
  const items = Array.from({ length: 36 }, (_, index) => ({
    id: index,
    status: 'failed',
    needsReselection: true,
  }));
  assert.equal(getActivityQueueCounts(items).available, 0);
  assert.equal(shouldShowActivitySaveButton(items), false);
  assert.deepEqual(selectActivityUploadItems(items, 'all'), []);
});

test('multiple reselection matches unavailable items by stable local metadata', () => {
  const items = [
    { id: 'photo', originalName: 'IMG_1.jpg', fileSize: 100, mediaType: 'photo', needsReselection: true },
    { id: 'video', originalName: 'VID_1.mp4', fileSize: 200, mediaType: 'video', needsReselection: true },
  ];
  const files = [
    { name: 'VID_1.mp4', size: 200, type: 'video/mp4' },
    { name: 'IMG_1.jpg', size: 100, type: '' },
    { name: 'OTHER.jpg', size: 300, type: 'image/jpeg' },
  ];
  const result = matchActivityMediaReplacements(items, files);
  assert.deepEqual(result.matches.map(match => match.item.id), ['video', 'photo']);
  assert.equal(result.unmatchedFiles.length, 1);
  assert.equal(result.unmatchedItems.length, 0);
});

test('completed retry is idempotent only for the same attempt and media fingerprint', () => {
  const existing = {
    status: 'active',
    uploadAttemptId: 'attempt-1',
    sha256: 'a'.repeat(64),
    mediaType: 'photo',
  };
  assert.equal(isSameCompletedActivityUpload(existing, { ...existing }), true);
  assert.equal(isSameCompletedActivityUpload(existing, { ...existing, uploadAttemptId: 'attempt-2' }), false);
  assert.equal(isSameCompletedActivityUpload(existing, { ...existing, sha256: 'b'.repeat(64) }), false);
  assert.equal(isSameCompletedActivityUpload(existing, { ...existing, mediaType: 'video' }), false);
});

test('lost client response does not duplicate a server-confirmed retry', () => {
  const confirmed = {
    status: 'active',
    uploadAttemptId: 'attempt-response-lost',
    sha256: 'f'.repeat(64),
    mediaType: 'photo',
  };
  const retriedRequest = { ...confirmed };
  assert.equal(isSameCompletedActivityUpload(confirmed, retriedRequest), true);
});

test('interrupted video retry resumes only the same attempt and content', () => {
  const uploading = {
    status: 'uploading',
    uploadAttemptId: 'attempt-video',
    sha256: '7'.repeat(64),
    mediaType: 'video',
    uploadedBytes: 18 * 1024 * 1024,
  };
  assert.equal(isSameInProgressActivityUpload(uploading, { ...uploading }), true);
  assert.equal(isSameInProgressActivityUpload(uploading, { ...uploading, uploadAttemptId: 'other' }), false);
  assert.equal(isSameInProgressActivityUpload(uploading, { ...uploading, sha256: '6'.repeat(64) }), false);
});

test('dedupe key is deterministic and scoped by workspace, patient and session', () => {
  const base = { workspaceId: 'w1', patientId: 'p1', sessionId: 's1', sha256: 'a'.repeat(64) };
  assert.equal(buildActivityDedupeKey(base), buildActivityDedupeKey(base));
  assert.notEqual(buildActivityDedupeKey(base), buildActivityDedupeKey({ ...base, sessionId: 's2' }));
});

test('dedupe key supports multiple sessions without depending on their order', () => {
  const base = {
    workspaceId: 'w1',
    patientId: 'p1',
    sessionId: 's1',
    sessionIds: ['s1', 's2'],
    sha256: 'a'.repeat(64),
  };
  assert.equal(
    buildActivityDedupeKey(base),
    buildActivityDedupeKey({ ...base, sessionIds: ['s2', 's1', 's2'] }),
  );
  assert.notEqual(
    buildActivityDedupeKey(base),
    buildActivityDedupeKey({ ...base, sessionIds: ['s1'] }),
  );
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
    preparedContentHash: 'b'.repeat(64),
    width: 1280,
    height: 720,
    description: ' atividade ',
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
  });
  assert.equal(result.description, 'atividade');
  assert.equal(result.category, 'Memória');
  assert.equal(result.mediaType, 'photo');
  assert.equal(result.originalContentHash, undefined);
  assert.equal(result.preparedContentHash, 'b'.repeat(64));
  assert.deepEqual(result.sessionIds, ['session-1']);
});

test('upload validation normalizes a remessa vinculada a duas sessões', () => {
  const result = validateUploadInput({
    patientId: 'patient-1',
    sessionId: 'session-1',
    sessionIds: ['session-2', 'session-1', 'session-2'],
    uploadAttemptId: 'attempt-multi-session',
    category: 'Memória',
    visibility: 'internal_only',
    sha256: '9'.repeat(64),
    preparedContentHash: '9'.repeat(64),
    width: 1280,
    height: 720,
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
  });
  assert.deepEqual(result.sessionIds, ['session-2', 'session-1']);
  assert.equal(result.sessionId, 'session-1');
});

test('upload validation accepts expected video metadata', () => {
  const result = validateUploadInput({
    patientId: 'patient-1',
    sessionId: 'session-1',
    uploadAttemptId: 'attempt-1',
    category: 'Atenção',
    visibility: 'internal_only',
    sha256: 'd'.repeat(64),
    originalContentHash: 'd'.repeat(64),
    width: 1920,
    height: 1080,
    durationSeconds: 12,
    fileName: 'video.mp4',
    mimeType: 'video/mp4',
  });
  assert.equal(result.category, 'Atenção');
  assert.equal(result.mediaType, 'video');
  assert.equal(result.durationSeconds, 12);
  assert.equal(result.originalContentHash, 'd'.repeat(64));
});

test('video duration accepts up to four minutes and rejects longer files', () => {
  const base = {
    patientId: 'patient-1',
    sessionId: 'session-1',
    uploadAttemptId: 'attempt-duration',
    category: 'Atenção',
    visibility: 'share_allowed',
    sha256: 'e'.repeat(64),
    width: 1920,
    height: 1080,
    fileName: 'video.mp4',
    mimeType: 'video/mp4',
  };
  assert.equal(validateUploadInput({ ...base, durationSeconds: 240 }).durationSeconds, 240);
  assert.throws(() => validateUploadInput({ ...base, durationSeconds: 241 }), /no máximo 4 minutos/i);
});

test('backend accepts the new default and intervention categories', () => {
  const base = {
    patientId: 'p', sessionId: 's', uploadAttemptId: 'a', visibility: 'internal_only',
    sha256: 'c'.repeat(64), width: 100, height: 100, fileName: 'atividade.jpg', mimeType: 'image/jpeg',
  };
  assert.equal(validateUploadInput({ ...base, category: 'Atividade Neuropsicopedagógica' }).category, 'Atividade Neuropsicopedagógica');
  assert.equal(validateUploadInput({ ...base, category: 'Atividade de Intervenção' }).category, 'Atividade de Intervenção');
});

test('backend keeps accepting the legacy category for historical compatibility', () => {
  const result = validateUploadInput({
    patientId: 'p', sessionId: 's', uploadAttemptId: 'legacy', category: 'Atividade pedagógica', visibility: 'internal_only',
    sha256: 'd'.repeat(64), width: 100, height: 100, fileName: 'atividade.jpg', mimeType: 'image/jpeg',
  });
  assert.equal(result.category, 'Atividade pedagógica');
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
  assert.equal(MAX_ACTIVITY_VIDEO_DURATION_SECONDS, 240);
  assert.equal(MAX_ACTIVITY_VIDEO_CHUNK_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_ACTIVITY_VIDEO_CHUNK_BYTES % ACTIVITY_VIDEO_CHUNK_ALIGNMENT_BYTES, 0);
  assert.ok(Math.ceil(MAX_ACTIVITY_VIDEO_CHUNK_BYTES / 3) * 4 < 4 * 1024 * 1024);
});

test('Firestore document sanitizer removes undefined recursively and preserves valid falsy values', () => {
  const sentinel = new Date('2026-06-13T14:00:00.000Z');
  const sanitized = sanitizeFirestoreDocument({
    originalContentHash: 'a'.repeat(64),
    preparedContentHash: undefined,
    nested: {
      missing: undefined,
      enabled: false,
      count: 0,
      empty: '',
      explicitNull: null,
      sentinel,
    },
    list: [
      { keep: 'value', remove: undefined },
      undefined,
      false,
      0,
      '',
      null,
    ],
    emptyArray: [],
  });
  assert.deepEqual(sanitized, {
    originalContentHash: 'a'.repeat(64),
    nested: {
      enabled: false,
      count: 0,
      empty: '',
      explicitNull: null,
      sentinel,
    },
    list: [
      { keep: 'value' },
      false,
      0,
      '',
      null,
    ],
    emptyArray: [],
  });
  assert.equal(sanitized.nested.sentinel, sentinel);
});

test('photo and video Firestore documents omit non-applicable hash fields', () => {
  const photo = sanitizeFirestoreDocument({
    preparedContentHash: 'b'.repeat(64),
    preparedContentHashAlgorithm: 'SHA-256',
    originalContentHash: undefined,
    originalContentHashAlgorithm: undefined,
  });
  const video = sanitizeFirestoreDocument({
    originalContentHash: 'c'.repeat(64),
    originalContentHashAlgorithm: 'SHA-256',
    preparedContentHash: undefined,
    preparedContentHashAlgorithm: undefined,
  });
  const unknown = sanitizeFirestoreDocument({
    originalContentHash: undefined,
    preparedContentHash: undefined,
    driveChecksum: undefined,
  });
  assert.deepEqual(photo, {
    preparedContentHash: 'b'.repeat(64),
    preparedContentHashAlgorithm: 'SHA-256',
  });
  assert.deepEqual(video, {
    originalContentHash: 'c'.repeat(64),
    originalContentHashAlgorithm: 'SHA-256',
  });
  assert.deepEqual(unknown, {});
});

test('raw Firestore undefined error is never exposed in the media card', () => {
  const raw = 'Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value (found in field "originalContentHash").';
  const safe = sanitizeActivityMediaErrorMessage(raw);
  assert.equal(safe, 'Não foi possível registrar esta mídia. O arquivo permanece disponível para nova tentativa.');
  assert.equal(/firestore|undefined/i.test(safe), false);
});

function createLegacyDuplicateDependencies(overrides = {}) {
  const updates = [];
  return {
    updates,
    dependencies: {
      findByHash: async () => [],
      findCandidates: async () => [],
      claim: async (_context, _patientId, _recordId, verificationId) => ({
        claimed: true,
        verificationId,
      }),
      complete: async (_context, _patientId, recordId, _verificationId, fingerprint) => {
        const record = {
          id: recordId,
          patientId: 'patient-1',
          sessionId: 'session-old',
          sessionDate: '2026-06-13',
          sessionTime: '14:00',
          mediaType: 'video',
          sha256: fingerprint.sha256,
          originalContentHash: fingerprint.sha256,
          status: 'active',
        };
        updates.push({ recordId, fingerprint });
        return record;
      },
      fail: async () => undefined,
      fingerprint: async () => ({
        sha256: 'a'.repeat(64),
        byteSize: 100,
        source: 'server-stream',
        streamed: true,
        driveChecksums: {},
      }),
      ...overrides,
    },
  };
}

test('new record with SHA-256 is detected without scanning legacy files', async () => {
  let candidateQueries = 0;
  const result = await checkPatientActivityMediaDuplicate({
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    sha256: 'a'.repeat(64),
    fileSize: 100,
    mediaType: 'photo',
    mimeType: 'image/jpeg',
    dependencies: createLegacyDuplicateDependencies({
      findByHash: async () => [{
        id: 'record-new',
        sessionId: 'session-1',
        sessionDate: '2026-06-13',
        sessionTime: '14:00',
      }],
      findCandidates: async () => {
        candidateQueries += 1;
        return [];
      },
    }).dependencies,
  });
  assert.equal(result.scope, 'same-session');
  assert.equal(candidateQueries, 0);
});

test('duplicate linked to several sessions is recognized as same-session for any linked session', async () => {
  const result = await checkPatientActivityMediaDuplicate({
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-2',
    sha256: 'b'.repeat(64),
    fileSize: 100,
    mediaType: 'photo',
    mimeType: 'image/jpeg',
    dependencies: createLegacyDuplicateDependencies({
      findByHash: async () => [{
        id: 'record-multi-session',
        sessionId: 'session-1',
        sessionIds: ['session-1', 'session-2'],
        sessionDate: '2026-06-13',
        sessionTime: '14:00',
      }],
      findCandidates: async () => [],
    }).dependencies,
  });
  assert.equal(result.scope, 'same-session');
  assert.equal(result.existing.recordId, 'record-multi-session');
});

test('legacy video metadata hash is not accepted as a verified content hash', () => {
  const hash = '8'.repeat(64);
  const legacyVideo = {
    mediaType: 'video',
    sha256: hash,
  };
  assert.equal(hasVerifiedActivityContentHash(legacyVideo, hash), false);
  assert.equal(needsLegacyActivityHashVerification(legacyVideo), true);
  assert.equal(hasVerifiedActivityContentHash({
    ...legacyVideo,
    originalContentHash: hash,
    hashAlgorithm: 'SHA-256',
  }, hash), true);
});

test('legacy record reuses a stored compatible Drive SHA-256 and persists it', async () => {
  let downloads = 0;
  const hash = 'b'.repeat(64);
  const fixture = createLegacyDuplicateDependencies({
    findCandidates: async () => [{
      id: 'legacy-checksum',
      driveFileId: 'drive-1',
      driveSha256Checksum: hash,
      fileSize: 100,
      mediaType: 'video',
      sessionId: 'session-old',
    }],
    fingerprint: async () => {
      downloads += 1;
      throw new Error('download should not run');
    },
  });
  const result = await checkPatientActivityMediaDuplicate({
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    sha256: hash,
    fileSize: 100,
    mediaType: 'video',
    mimeType: 'video/mp4',
    dependencies: fixture.dependencies,
  });
  assert.equal(result.scope, 'other-session');
  assert.equal(downloads, 0);
  assert.equal(fixture.updates[0].fingerprint.source, 'stored-drive-sha256');
});

test('legacy Drive file without SHA-256 is hashed as a stream without a full buffer', async () => {
  const chunks = [
    Uint8Array.from([1, 2, 3]),
    Uint8Array.from([4, 5]),
    Uint8Array.from([6, 7, 8, 9]),
  ];
  let readIndex = 0;
  let requestOptions;
  const fingerprint = await calculateActivityDriveFingerprint({
    fileId: 'drive-stream',
    ownership: {
      ownerUserId: 'owner-1',
      patientId: 'patient-1',
      recordId: 'record-1',
      mediaType: 'video',
    },
    metadataLoader: async () => ({
      id: 'drive-stream',
      size: '9',
      mimeType: 'video/mp4',
      appProperties: {
        category: 'activity-record-media',
        mediaType: 'video',
        ownerUserId: 'owner-1',
        patientId: 'patient-1',
        activityRecordId: 'record-1',
      },
    }),
    accessTokenLoader: async () => 'test-token',
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response(new ReadableStream({
        pull(controller) {
          if (readIndex >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(chunks[readIndex]);
          readIndex += 1;
        },
      }), { status: 200 });
    },
  });
  assert.equal(fingerprint.streamed, true);
  assert.equal(fingerprint.byteSize, 9);
  assert.equal(
    fingerprint.sha256,
    crypto.createHash('sha256').update(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))).digest('hex'),
  );
  assert.equal(readIndex, 3);
  assert.equal(requestOptions.method, undefined);
  assert.equal('body' in requestOptions, false);
});

test('Drive SHA-256 checksum is reused without downloading the legacy file', async () => {
  let downloads = 0;
  const hash = '9'.repeat(64);
  const fingerprint = await calculateActivityDriveFingerprint({
    fileId: 'drive-checksum',
    ownership: {
      ownerUserId: 'owner-1',
      patientId: 'patient-1',
      recordId: 'record-1',
      mediaType: 'photo',
    },
    metadataLoader: async () => ({
      id: 'drive-checksum',
      size: '100',
      mimeType: 'image/jpeg',
      sha256Checksum: hash,
      md5Checksum: 'a'.repeat(32),
      appProperties: {
        category: 'activity-record-media',
        mediaType: 'photo',
        ownerUserId: 'owner-1',
        patientId: 'patient-1',
        activityRecordId: 'record-1',
      },
    }),
    fetchImpl: async () => {
      downloads += 1;
      throw new Error('download should not run');
    },
  });
  assert.equal(fingerprint.sha256, hash);
  assert.equal(fingerprint.source, 'drive-sha256');
  assert.equal(fingerprint.streamed, false);
  assert.equal(downloads, 0);
});

test('Drive streaming hash timeout returns a specific inconclusive error', async () => {
  await assert.rejects(
    calculateActivityDriveFingerprint({
      fileId: 'drive-timeout',
      ownership: {
        ownerUserId: 'owner-1',
        patientId: 'patient-1',
        recordId: 'record-timeout',
        mediaType: 'video',
      },
      timeoutMs: 5,
      metadataLoader: async () => ({
        id: 'drive-timeout',
        size: '100',
        mimeType: 'video/mp4',
        appProperties: {
          category: 'activity-record-media',
          mediaType: 'video',
          ownerUserId: 'owner-1',
          patientId: 'patient-1',
          activityRecordId: 'record-timeout',
        },
      }),
      accessTokenLoader: async () => 'test-token',
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }),
    }),
    error => error.code === 'activity-records/hash-verification-timeout',
  );
});

test('legacy hash is persisted and reused on the second duplicate check', async () => {
  const hash = 'c'.repeat(64);
  let downloads = 0;
  let cached = false;
  const fixture = createLegacyDuplicateDependencies({
    findByHash: async () => cached ? [{
      id: 'legacy-cached',
      sessionId: 'session-old',
      sessionDate: '2026-06-10',
      sessionTime: '09:00',
    }] : [],
    findCandidates: async () => cached ? [] : [{
      id: 'legacy-cached',
      driveFileId: 'drive-cached',
      fileSize: 100,
      mediaType: 'video',
      sessionId: 'session-old',
    }],
    fingerprint: async () => {
      downloads += 1;
      return {
        sha256: hash,
        byteSize: 100,
        source: 'server-stream',
        streamed: true,
        driveChecksums: {},
      };
    },
    complete: async (_context, _patientId, recordId, _verificationId, fingerprint) => {
      cached = true;
      fixture.updates.push({ recordId, fingerprint });
      return {
        id: recordId,
        sessionId: 'session-old',
        sessionDate: '2026-06-10',
        sessionTime: '09:00',
        sha256: hash,
        originalContentHash: hash,
      };
    },
  });
  const input = {
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    sha256: hash,
    fileSize: 100,
    mediaType: 'video',
    mimeType: 'video/mp4',
    dependencies: fixture.dependencies,
  };
  assert.equal((await checkPatientActivityMediaDuplicate(input)).scope, 'other-session');
  assert.equal((await checkPatientActivityMediaDuplicate(input)).scope, 'other-session');
  assert.equal(downloads, 1);
  assert.equal(fixture.updates.length, 1);
});

test('same name or size with different content is not treated as exact duplicate', async () => {
  const fixture = createLegacyDuplicateDependencies({
    findCandidates: async () => [{
      id: 'same-name-size',
      driveFileId: 'drive-different',
      fileName: 'video.mp4',
      fileSize: 100,
      mediaType: 'video',
      sessionId: 'session-old',
    }],
    fingerprint: async () => ({
      sha256: 'd'.repeat(64),
      byteSize: 100,
      source: 'server-stream',
      streamed: true,
      driveChecksums: {},
    }),
  });
  const result = await checkPatientActivityMediaDuplicate({
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    sha256: 'e'.repeat(64),
    fileSize: 100,
    mediaType: 'video',
    mimeType: 'video/mp4',
    dependencies: fixture.dependencies,
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.verification, 'complete');
});

test('inconclusive legacy verification is explicit and reveals no other patient', async () => {
  let queriedPatient = '';
  const fixture = createLegacyDuplicateDependencies({
    findCandidates: async (_context, patientId) => {
      queriedPatient = patientId;
      return [{
        id: 'legacy-failed',
        driveFileId: 'drive-failed',
        fileSize: 100,
        mediaType: 'photo',
        sessionId: 'hidden-session',
      }];
    },
    fingerprint: async () => {
      throw Object.assign(new Error('timeout'), {
        code: 'activity-records/hash-verification-timeout',
      });
    },
  });
  const result = await checkPatientActivityMediaDuplicate({
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    sha256: 'f'.repeat(64),
    fileSize: 100,
    mediaType: 'photo',
    mimeType: 'image/jpeg',
    dependencies: fixture.dependencies,
  });
  assert.equal(queriedPatient, 'patient-1');
  assert.equal(result.verification, 'inconclusive');
  assert.equal(result.existing, null);
  assert.equal(JSON.stringify(result).includes('hidden-session'), false);
});

test('two simultaneous legacy checks share one fingerprint calculation', async () => {
  let calculations = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const hash = '1'.repeat(64);
  const fixture = createLegacyDuplicateDependencies({
    findCandidates: async () => [{
      id: 'legacy-race',
      driveFileId: 'drive-race',
      fileSize: 100,
      mediaType: 'video',
      sessionId: 'session-old',
    }],
    fingerprint: async () => {
      calculations += 1;
      await gate;
      return {
        sha256: hash,
        byteSize: 100,
        source: 'server-stream',
        streamed: true,
        driveChecksums: {},
      };
    },
  });
  const input = {
    context: { ownerUserId: 'owner-1' },
    patientId: 'patient-1',
    sessionId: 'session-1',
    sha256: hash,
    fileSize: 100,
    mediaType: 'video',
    mimeType: 'video/mp4',
    dependencies: fixture.dependencies,
  };
  const first = checkPatientActivityMediaDuplicate(input);
  const second = checkPatientActivityMediaDuplicate(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getActiveLegacyVerificationCount(), 1);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calculations, 1);
  assert.equal(results.every(result => result.duplicate), true);
  assert.equal(getActiveLegacyVerificationCount(), 0);
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

test('video dedupe key uses the content hash instead of mutable file metadata', () => {
  const base = {
    workspaceId: 'w1',
    patientId: 'p1',
    sessionId: 's1',
    sha256: '9'.repeat(64),
    fileName: 'video.mp4',
    fileSize: 87_000_000,
    durationSeconds: 36,
    lastModified: 1_700_000_000_000,
  };
  assert.equal(buildActivityVideoDedupeKey(base), buildActivityVideoDedupeKey(base));
  assert.equal(
    buildActivityVideoDedupeKey(base),
    buildActivityVideoDedupeKey({
      ...base,
      fileName: 'renomeado.mp4',
      fileSize: base.fileSize + 1,
      lastModified: base.lastModified + 1,
    }),
  );
  assert.notEqual(
    buildActivityVideoDedupeKey(base),
    buildActivityVideoDedupeKey({ ...base, sha256: '8'.repeat(64) }),
  );
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
  assert.equal(parseActivityResumableRange(`bytes=0-${600 * 1024 * 1024 - 1}`), 600 * 1024 * 1024);
  assert.equal(parseActivityResumableRange(`bytes=0-${1024 * 1024 * 1024 - 1}`), 1024 * 1024 * 1024);
  assert.equal(parseActivityResumableRange(`bytes=0-${2 * 1024 * 1024 * 1024 - 1}`), 2 * 1024 * 1024 * 1024);
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

test('resumable chunk recovers after a network error when Drive confirms progress', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
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
    assert.equal(calls, 2);
    assert.deepEqual(result, { completed: false, nextOffset: 4, file: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resumable chunk exposes a Drive rejection when progress cannot be recovered', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'rejected' } }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
  try {
    await assert.rejects(
      uploadActivityResumableChunk({
        uploadUrl: 'https://upload.example/session',
        chunkBuffer: Buffer.from([1, 2, 3, 4]),
        start: 0,
        totalSize: 8,
        mimeType: 'video/mp4',
      }),
      error => error.code === 'activity-records/upload-chunk-failed',
    );
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
