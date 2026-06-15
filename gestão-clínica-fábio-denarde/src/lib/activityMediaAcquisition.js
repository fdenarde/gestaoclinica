import { MAX_ACTIVITY_VIDEO_CHUNK_BYTES } from '../../shared/activityMediaLimits.js';

const ACTIVITY_MEDIA_DIRECTORY = 'activity-media-queue-v1';
const ACTIVITY_MEDIA_DB = 'activity-media-queue-v1';
const ACTIVITY_MEDIA_STORE = 'items';
const ACTIVITY_MEDIA_BLOB_STORE = 'blobs';
const ACTIVITY_MEDIA_CHUNK_STORE = 'chunks';
const INDEXED_DB_CHUNK_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE = MAX_ACTIVITY_VIDEO_CHUNK_BYTES;
const STORAGE_RESERVE_BYTES = 64 * 1024 * 1024;

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
]);

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value, shift) => (value >>> shift) | (value << (32 - shift));

export class IncrementalSha256 {
  constructor() {
    this.state = new Uint32Array(SHA256_INITIAL_STATE);
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.bytesHashed = 0;
    this.finished = false;
    this.words = new Uint32Array(64);
  }

  update(input) {
    if (this.finished) {
      throw new Error('SHA-256 já finalizado.');
    }

    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.bytesHashed += data.byteLength;
    let offset = 0;

    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      const consumed = Math.min(needed, data.byteLength);
      this.buffer.set(data.subarray(0, consumed), this.bufferLength);
      this.bufferLength += consumed;
      offset += consumed;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }

    while (offset + 64 <= data.byteLength) {
      this.processBlock(data, offset);
      offset += 64;
    }

    if (offset < data.byteLength) {
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLength = data.byteLength - offset;
    }

    return this;
  }

  processBlock(data, offset) {
    const words = this.words;
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (
        (data[wordOffset] << 24)
        | (data[wordOffset + 1] << 16)
        | (data[wordOffset + 2] << 8)
        | data[wordOffset + 3]
      ) >>> 0;
    }

    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }

  digestHex() {
    if (!this.finished) {
      const bytesHashed = this.bytesHashed;
      this.buffer[this.bufferLength] = 0x80;
      this.bufferLength += 1;

      if (this.bufferLength > 56) {
        this.buffer.fill(0, this.bufferLength, 64);
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }

      this.buffer.fill(0, this.bufferLength, 56);
      const bitLengthHigh = Math.floor(bytesHashed / 0x20000000);
      const bitLengthLow = (bytesHashed << 3) >>> 0;
      const view = new DataView(this.buffer.buffer);
      view.setUint32(56, bitLengthHigh, false);
      view.setUint32(60, bitLengthLow, false);
      this.processBlock(this.buffer, 0);
      this.finished = true;
    }

    return Array.from(this.state)
      .map((word) => word.toString(16).padStart(8, '0'))
      .join('');
  }
}

export const hashBlobIncrementally = async (
  blob,
  { chunkSize = DEFAULT_CHUNK_SIZE, onProgress } = {},
) => {
  const hasher = new IncrementalSha256();
  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + chunkSize);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    hasher.update(bytes);
    offset = end;
    onProgress?.({ bytesProcessed: offset, totalBytes: blob.size });
  }
  return hasher.digestHex();
};

export const isExactActivityMediaDuplicate = (knownHashes, candidateHash) => {
  if (!/^[a-f0-9]{64}$/.test(String(candidateHash || '').toLowerCase())) return false;
  return new Set(Array.from(knownHashes || [], hash => String(hash).toLowerCase()))
    .has(String(candidateHash).toLowerCase());
};

export const estimateActivityAcquisitionBytes = (files, maxPreparedPhotoBytes = 1_800_000) => {
  const selectedFiles = Array.from(files || []);
  const originalBytes = selectedFiles.reduce((total, file) => total + Number(file?.size || 0), 0);
  const largestPreparedPhoto = selectedFiles.reduce((largest, file) => (
    file?.type?.startsWith('video/')
      ? largest
      : Math.max(largest, Math.min(Number(file?.size || 0), maxPreparedPhotoBytes))
  ), 0);

  // A primeira fase protege todos os arquivos originais. Depois, apenas uma foto por vez
  // é preparada e substitui a cópia original, por isso reservamos o maior arquivo preparado
  // como margem temporária adicional.
  return originalBytes + largestPreparedPhoto;
};

export const inspectDurableActivityStorage = async (
  storage = globalThis.navigator?.storage,
  indexedDb = globalThis.indexedDB,
) => {
  const supportsOpfs = Boolean(storage && typeof storage.getDirectory === 'function');
  const supportsIndexedDb = Boolean(indexedDb);
  if (!supportsOpfs && !supportsIndexedDb) {
    return {
      supported: false,
      mode: 'memory-fallback',
      quota: 0,
      usage: 0,
      available: 0,
      reason: 'opfs-unavailable',
    };
  }

  const estimate = typeof storage?.estimate === 'function'
    ? await storage.estimate()
    : {};
  const quota = Number(estimate.quota || 0);
  const usage = Number(estimate.usage || 0);
  return {
    supported: true,
    mode: supportsOpfs ? 'opfs' : 'indexeddb',
    quota,
    usage,
    available: quota > 0 ? Math.max(0, quota - usage) : Number.POSITIVE_INFINITY,
    reason: '',
  };
};

export const assertDurableActivityStorageCapacity = ({
  requiredBytes,
  storageStatus,
  reserveBytes = STORAGE_RESERVE_BYTES,
}) => {
  if (!storageStatus?.supported) {
    return {
      ok: false,
      reason: 'opfs-unavailable',
      requiredBytes,
      availableBytes: storageStatus?.available || 0,
    };
  }

  if (
    Number.isFinite(storageStatus.available)
    && requiredBytes + reserveBytes > storageStatus.available
  ) {
    return {
      ok: false,
      reason: 'insufficient-storage',
      requiredBytes,
      availableBytes: storageStatus.available,
    };
  }

  return {
    ok: true,
    reason: '',
    requiredBytes,
    availableBytes: storageStatus.available,
  };
};

const sanitizeAttemptId = (attemptId) => String(attemptId).replace(/[^a-zA-Z0-9_-]/g, '_');

const getActivityMediaDirectory = async (storage = globalThis.navigator?.storage) => {
  const root = await storage.getDirectory();
  return root.getDirectoryHandle(ACTIVITY_MEDIA_DIRECTORY, { create: true });
};

const openActivityMediaDatabase = (indexedDb = globalThis.indexedDB) => new Promise((resolve, reject) => {
  if (!indexedDb) {
    reject(new Error('IndexedDB indisponível.'));
    return;
  }
  const request = indexedDb.open(ACTIVITY_MEDIA_DB, 3);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(ACTIVITY_MEDIA_STORE)) {
      const store = database.createObjectStore(ACTIVITY_MEDIA_STORE, { keyPath: 'attemptId' });
      store.createIndex('scopeKey', 'scopeKey', { unique: false });
    }
    if (!database.objectStoreNames.contains(ACTIVITY_MEDIA_BLOB_STORE)) {
      database.createObjectStore(ACTIVITY_MEDIA_BLOB_STORE, { keyPath: 'durableName' });
    }
    if (!database.objectStoreNames.contains(ACTIVITY_MEDIA_CHUNK_STORE)) {
      const chunkStore = database.createObjectStore(ACTIVITY_MEDIA_CHUNK_STORE, { keyPath: 'key' });
      chunkStore.createIndex('durableName', 'durableName', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const runActivityMediaRequest = async (
  storeName,
  mode,
  operation,
  indexedDb = globalThis.indexedDB,
) => {
  const database = await openActivityMediaDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

export const pinActivityMediaSelection = (files) => Array.from(files || []).map((blob, index) => {
  if (!blob || typeof blob.stream !== 'function') {
    const error = new Error('O navegador não conseguiu iniciar a leitura do arquivo selecionado.');
    error.name = 'NotReadableError';
    throw error;
  }
  const reader = blob.stream().getReader();
  // A primeira leitura precisa começar ainda no mesmo evento da seleção. Em alguns
  // Androids, esperar qualquer operação assíncrona antes disso invalida o File.
  const firstRead = reader.read();
  return { blob, index, reader, firstRead };
});

export const releasePinnedActivityMediaSelection = async (items) => {
  await Promise.allSettled(Array.from(items || []).map(async item => {
    await item?.reader?.cancel?.();
  }));
};

const deleteIndexedDbMedia = async (database, durableName) => new Promise((resolve, reject) => {
  const transaction = database.transaction(
    [ACTIVITY_MEDIA_BLOB_STORE, ACTIVITY_MEDIA_CHUNK_STORE],
    'readwrite',
  );
  transaction.objectStore(ACTIVITY_MEDIA_BLOB_STORE).delete(durableName);
  const chunkIndex = transaction.objectStore(ACTIVITY_MEDIA_CHUNK_STORE).index('durableName');
  const cursorRequest = chunkIndex.openCursor(durableName);
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  cursorRequest.onerror = () => reject(cursorRequest.error);
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('A limpeza do arquivo local foi interrompida.'));
});

const putIndexedDbChunk = async (database, record) => new Promise((resolve, reject) => {
  const transaction = database.transaction(ACTIVITY_MEDIA_CHUNK_STORE, 'readwrite');
  const request = transaction.objectStore(ACTIVITY_MEDIA_CHUNK_STORE).put(record);
  request.onerror = () => reject(request.error);
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('A gravação local foi interrompida.'));
});

const saveIndexedDbChunkMetadata = async (database, metadata) => new Promise((resolve, reject) => {
  const transaction = database.transaction(ACTIVITY_MEDIA_BLOB_STORE, 'readwrite');
  const request = transaction.objectStore(ACTIVITY_MEDIA_BLOB_STORE).put(metadata);
  request.onerror = () => reject(request.error);
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('A confirmação local do arquivo foi interrompida.'));
});

const persistSingleBlobToIndexedDb = async (database, durableName, blob) => new Promise((resolve, reject) => {
  const transaction = database.transaction(
    [ACTIVITY_MEDIA_BLOB_STORE, ACTIVITY_MEDIA_CHUNK_STORE],
    'readwrite',
  );
  transaction.objectStore(ACTIVITY_MEDIA_BLOB_STORE).put({ durableName, blob });
  const chunkIndex = transaction.objectStore(ACTIVITY_MEDIA_CHUNK_STORE).index('durableName');
  const cursorRequest = chunkIndex.openCursor(durableName);
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  cursorRequest.onerror = () => reject(cursorRequest.error);
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('A gravação local foi interrompida.'));
});

const readIndexedDbMedia = async (durableName, indexedDb) => {
  const database = await openActivityMediaDatabase(indexedDb);
  try {
    const metadata = await new Promise((resolve, reject) => {
      const transaction = database.transaction(ACTIVITY_MEDIA_BLOB_STORE, 'readonly');
      const request = transaction.objectStore(ACTIVITY_MEDIA_BLOB_STORE).get(durableName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
    if (!metadata) return null;
    if (metadata.blob) return metadata.blob;
    if (!metadata.chunked) return null;

    const chunks = await new Promise((resolve, reject) => {
      const transaction = database.transaction(ACTIVITY_MEDIA_CHUNK_STORE, 'readonly');
      const request = transaction.objectStore(ACTIVITY_MEDIA_CHUNK_STORE)
        .index('durableName')
        .getAll(durableName);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
    chunks.sort((left, right) => Number(left.index) - Number(right.index));
    if (chunks.length !== Number(metadata.chunkCount || 0)) {
      throw new Error('O arquivo local protegido está incompleto.');
    }
    return new Blob(chunks.map(chunk => chunk.blob), {
      type: metadata.type || 'application/octet-stream',
    });
  } finally {
    database.close();
  }
};

const persistPinnedItemToIndexedDb = async ({
  database,
  item,
  onProgress,
  completedItems,
  totalItems,
}) => {
  const durableName = `${sanitizeAttemptId(item.attemptId)}.media`;
  await deleteIndexedDbMedia(database, durableName);

  let chunkIndex = 0;
  let bytesProcessed = 0;
  let pendingParts = [];
  let pendingBytes = 0;

  const flushChunk = async () => {
    if (pendingBytes === 0) return;
    const chunkBlob = new Blob(pendingParts, {
      type: item.blob.type || 'application/octet-stream',
    });
    await putIndexedDbChunk(database, {
      key: `${durableName}:${String(chunkIndex).padStart(8, '0')}`,
      durableName,
      index: chunkIndex,
      blob: chunkBlob,
    });
    chunkIndex += 1;
    pendingParts = [];
    pendingBytes = 0;
  };

  try {
    let readResult = await item.firstRead;
    while (!readResult.done) {
      const bytes = readResult.value instanceof Uint8Array
        ? readResult.value
        : new Uint8Array(readResult.value);
      pendingParts.push(bytes);
      pendingBytes += bytes.byteLength;
      bytesProcessed += bytes.byteLength;
      if (pendingBytes >= INDEXED_DB_CHUNK_BYTES) await flushChunk();
      onProgress?.({
        index: item.index,
        attemptId: item.attemptId,
        bytesProcessed,
        totalBytes: item.blob.size,
        completedItems,
        totalItems,
      });
      readResult = await item.reader.read();
    }
    await flushChunk();
    await saveIndexedDbChunkMetadata(database, {
      durableName,
      chunked: true,
      chunkCount: chunkIndex,
      size: item.blob.size,
      type: item.blob.type || 'application/octet-stream',
      lastModified: item.blob.lastModified || Date.now(),
    });
    return {
      durableName,
      persistedBlob: null,
      sha256: '',
      storageMode: 'indexeddb',
    };
  } catch (error) {
    await item.reader.cancel().catch(() => undefined);
    await deleteIndexedDbMedia(database, durableName).catch(() => undefined);
    throw error;
  }
};

const persistActivitySelectionToIndexedDb = async ({
  items,
  indexedDb,
  onProgress,
  indexedDbConcurrency = 2,
}) => {
  const database = await openActivityMediaDatabase(indexedDb);
  const results = new Array(items.length);
  let nextIndex = 0;
  let completedItems = 0;
  const workerCount = Math.max(1, Math.min(indexedDbConcurrency, items.length));
  try {
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) return;
        const item = items[currentIndex];
        try {
          const value = await persistPinnedItemToIndexedDb({
            database,
            item,
            onProgress,
            completedItems,
            totalItems: items.length,
          });
          completedItems += 1;
          results[currentIndex] = { status: 'fulfilled', value };
        } catch (reason) {
          results[currentIndex] = { status: 'rejected', reason };
        }
      }
    });
    await Promise.all(workers);
    return results;
  } finally {
    database.close();
  }
};

export const persistActivitySelectionBlobs = async ({
  items,
  storage = globalThis.navigator?.storage,
  indexedDb = globalThis.indexedDB,
  onProgress = undefined,
  opfsConcurrency = 3,
  indexedDbConcurrency = 2,
}) => {
  const normalizedItems = Array.from(items || []).map((item, index) => {
    if (item.reader && item.firstRead) {
      return {
        blob: item.blob,
        attemptId: item.attemptId,
        index,
        reader: item.reader,
        firstRead: item.firstRead,
      };
    }
    const [pinned] = pinActivityMediaSelection([item.blob]);
    return {
      blob: item.blob,
      attemptId: item.attemptId,
      index,
      reader: pinned.reader,
      firstRead: pinned.firstRead,
    };
  });
  if (normalizedItems.length === 0) return [];

  if (!storage?.getDirectory) {
    if (!indexedDb) {
      const reason = new Error('Armazenamento local durável indisponível.');
      return normalizedItems.map(() => ({ status: 'rejected', reason }));
    }
    return persistActivitySelectionToIndexedDb({
      items: normalizedItems,
      indexedDb,
      onProgress,
      indexedDbConcurrency,
    });
  }

  // Inicia a primeira leitura de todos os arquivos imediatamente. Isso mantém cada
  // seleção ativa antes que vídeos grandes atrasem o acesso aos arquivos seguintes.
  const pinnedItems = normalizedItems.map((item) => ({
    ...item,
    durableName: `${sanitizeAttemptId(item.attemptId)}.media`,
  }));
  const root = await storage.getDirectory();
  const directory = await root.getDirectoryHandle(ACTIVITY_MEDIA_DIRECTORY, { create: true });
  const results = new Array(pinnedItems.length);
  let nextIndex = 0;
  let completedItems = 0;
  const workerCount = Math.max(1, Math.min(opfsConcurrency, pinnedItems.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= pinnedItems.length) return;
      const item = pinnedItems[currentIndex];
      let writable;
      try {
        const handle = await directory.getFileHandle(item.durableName, { create: true });
        writable = await handle.createWritable();
        let bytesWritten = 0;
        let readResult = await item.firstRead;
        while (!readResult.done) {
          const bytes = readResult.value instanceof Uint8Array
            ? readResult.value
            : new Uint8Array(readResult.value);
          await writable.write(bytes);
          bytesWritten += bytes.byteLength;
          onProgress?.({
            index: item.index,
            attemptId: item.attemptId,
            bytesProcessed: bytesWritten,
            totalBytes: item.blob.size,
            completedItems,
            totalItems: pinnedItems.length,
          });
          readResult = await item.reader.read();
        }
        await writable.close();
        const persistedBlob = await handle.getFile();
        completedItems += 1;
        results[currentIndex] = {
          status: 'fulfilled',
          value: {
            durableName: item.durableName,
            persistedBlob,
            sha256: '',
            storageMode: 'opfs',
          },
        };
      } catch (reason) {
        await item.reader.cancel().catch(() => undefined);
        await writable?.abort?.().catch(() => undefined);
        await directory.removeEntry(item.durableName).catch(() => undefined);
        results[currentIndex] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
};

export const persistActivityBlob = async ({
  blob,
  attemptId,
  storage = globalThis.navigator?.storage,
  indexedDb = globalThis.indexedDB,
  calculateHash = false,
  onProgress = undefined,
}) => {
  const durableName = `${sanitizeAttemptId(attemptId)}.media`;
  if (!storage?.getDirectory) {
    if (!indexedDb) throw new Error('Armazenamento local durável indisponível.');
    const sha256 = calculateHash
      ? await hashBlobIncrementally(blob, { onProgress })
      : '';
    const database = await openActivityMediaDatabase(indexedDb);
    try {
      await persistSingleBlobToIndexedDb(database, durableName, blob);
    } finally {
      database.close();
    }
    return {
      durableName,
      persistedBlob: blob,
      sha256,
      storageMode: 'indexeddb',
    };
  }

  const directory = await getActivityMediaDirectory(storage);
  const handle = await directory.getFileHandle(durableName, { create: true });
  const writable = await handle.createWritable();
  const hasher = calculateHash ? new IncrementalSha256() : null;
  let bytesWritten = 0;

  try {
    const reader = blob.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      await writable.write(bytes);
      hasher?.update(bytes);
      bytesWritten += bytes.byteLength;
      onProgress?.({ bytesProcessed: bytesWritten, totalBytes: blob.size });
    }
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    await directory.removeEntry(durableName).catch(() => undefined);
    throw error;
  }

  const persistedBlob = await handle.getFile();
  return {
    durableName,
    persistedBlob,
    sha256: hasher?.digestHex() || '',
    storageMode: 'opfs',
  };
};

export const readPersistedActivityFile = async ({
  durableName,
  originalName,
  type,
  lastModified,
  storage = globalThis.navigator?.storage,
  indexedDb = globalThis.indexedDB,
}) => {
  let blob;
  if (storage?.getDirectory) {
    try {
      const directory = await getActivityMediaDirectory(storage);
      const handle = await directory.getFileHandle(durableName);
      blob = await handle.getFile();
    } catch (error) {
      if (!indexedDb || error?.name !== 'NotFoundError') throw error;
    }
  }
  if (!blob && indexedDb) {
    blob = await readIndexedDbMedia(durableName, indexedDb);
  }
  if (!blob) {
    const error = new Error('Mídia adquirida não encontrada no armazenamento local.');
    error.name = 'NotFoundError';
    throw error;
  }
  return new File([blob], originalName || durableName, {
    type: type || blob.type || 'application/octet-stream',
    lastModified: lastModified || blob.lastModified || Date.now(),
  });
};

export const deletePersistedActivityFile = async (
  durableName,
  storage = globalThis.navigator?.storage,
  indexedDb = globalThis.indexedDB,
) => {
  if (!durableName) return;
  const deletions = [];
  if (storage?.getDirectory) {
    deletions.push((async () => {
      try {
        const directory = await getActivityMediaDirectory(storage);
        await directory.removeEntry(durableName);
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    })());
  }
  if (indexedDb) {
    deletions.push((async () => {
      const database = await openActivityMediaDatabase(indexedDb);
      try {
        await deleteIndexedDbMedia(database, durableName);
      } finally {
        database.close();
      }
    })());
  }
  const results = await Promise.allSettled(deletions);
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }
};

const openManifestDatabase = (indexedDb = globalThis.indexedDB) => openActivityMediaDatabase(indexedDb);

const runManifestRequest = async (mode, operation, indexedDb) => {
  const database = await openManifestDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(ACTIVITY_MEDIA_STORE, mode);
      const store = transaction.objectStore(ACTIVITY_MEDIA_STORE);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

export const saveActivityMediaManifest = async (
  manifest,
  indexedDb = globalThis.indexedDB,
) => runManifestRequest('readwrite', (store) => store.put(manifest), indexedDb);

export const deleteActivityMediaManifest = async (
  attemptId,
  indexedDb = globalThis.indexedDB,
) => runManifestRequest('readwrite', (store) => store.delete(attemptId), indexedDb);

export const listActivityMediaManifests = async (
  scopeKey,
  indexedDb = globalThis.indexedDB,
) => {
  const database = await openManifestDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(ACTIVITY_MEDIA_STORE, 'readonly');
      const index = transaction.objectStore(ACTIVITY_MEDIA_STORE).index('scopeKey');
      const request = index.getAll(scopeKey);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

export const buildActivityMediaManifest = ({
  attemptId,
  scopeKey,
  durableName,
  originalName,
  originalSelectionPosition,
  mediaType,
  mimeType,
  fileSize,
  originalContentHash,
  preparedContentHash,
  width,
  height,
  duration,
  lastModified,
  storageMode,
  thumbnailName,
  thumbnailMimeType,
  thumbnailStatus,
}) => ({
  attemptId,
  scopeKey,
  durableName,
  originalName,
  originalSelectionPosition,
  mediaType,
  mimeType,
  fileSize,
  originalContentHash,
  preparedContentHash,
  width,
  height,
  duration,
  lastModified,
  storageMode,
  thumbnailName,
  thumbnailMimeType,
  thumbnailStatus,
  storageVersion: 1,
  acquiredAt: new Date().toISOString(),
});

export const buildActivityMediaScopeKey = async ({ patientId, sessionId }) => {
  const value = new TextEncoder().encode(`${patientId || ''}:${sessionId || ''}`);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', value);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  const hasher = new IncrementalSha256();
  hasher.update(value);
  return hasher.digestHex();
};

export const cleanupActivityMediaAcquisition = async ({
  attemptId,
  durableName,
  thumbnailName = '',
  storage = globalThis.navigator?.storage,
  indexedDb = globalThis.indexedDB,
}) => {
  await Promise.allSettled([
    deletePersistedActivityFile(durableName, storage, indexedDb),
    deletePersistedActivityFile(thumbnailName, storage, indexedDb),
    deleteActivityMediaManifest(attemptId, indexedDb),
  ]);
};

export const ACTIVITY_MEDIA_ACQUISITION_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;
export const ACTIVITY_MEDIA_STORAGE_RESERVE_BYTES = STORAGE_RESERVE_BYTES;
