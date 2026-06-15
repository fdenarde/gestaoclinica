import {
  ACTIVITY_PHOTO_UPLOAD_CONCURRENCY,
  ACTIVITY_VIDEO_UPLOAD_CONCURRENCY,
} from '../../shared/activityMediaLimits.js';

async function runPool(items, concurrency, worker) {
  const source = Array.from(items || []);
  let nextIndex = 0;
  const results = new Array(source.length);
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, source.length || 1));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(source[index], index);
    }
  }));

  return results;
}

export async function runActivityUploadPools(
  items,
  worker,
  {
    photoConcurrency = ACTIVITY_PHOTO_UPLOAD_CONCURRENCY,
    videoConcurrency = ACTIVITY_VIDEO_UPLOAD_CONCURRENCY,
  } = {},
) {
  const source = Array.from(items || []);
  const photos = source.filter(item => item.mediaType !== 'video');
  const videos = source.filter(item => item.mediaType === 'video');
  // Fotos clínicas são pequenas e numerosas. Concluí-las primeiro evita que vídeos
  // grandes ocupem toda a banda e atrasem dezenas de confirmações simples.
  const photoResults = await runPool(photos, photoConcurrency, worker);
  const videoResults = await runPool(videos, videoConcurrency, worker);
  return [...photoResults, ...videoResults];
}

export function calculateActivityUploadProgress(items, progressById) {
  const source = Array.from(items || []);
  const totalBytes = source.reduce((sum, item) => sum + Math.max(0, Number(item?.file?.size || item?.fileSize || 0)), 0);
  if (totalBytes <= 0) return { percent: 0, bytesSent: 0, totalBytes: 0 };

  const bytesSent = source.reduce((sum, item) => {
    const size = Math.max(0, Number(item?.file?.size || item?.fileSize || 0));
    const progress = Math.max(0, Math.min(100, Number(progressById?.get?.(item.id) || 0)));
    return sum + (size * progress / 100);
  }, 0);

  return {
    percent: Math.max(0, Math.min(100, Math.round((bytesSent / totalBytes) * 100))),
    bytesSent: Math.round(bytesSent),
    totalBytes,
  };
}

export function calculateActivityUploadTelemetry({ bytesSent, totalBytes, startedAt, now = Date.now() }) {
  const startValue = Number(startedAt);
  const safeStart = Number.isFinite(startValue) ? startValue : Number(now);
  const elapsedSeconds = Math.max(0.25, (Number(now) - safeStart) / 1000);
  const bytesPerSecond = Math.max(0, Number(bytesSent || 0) / elapsedSeconds);
  const remainingBytes = Math.max(0, Number(totalBytes || 0) - Number(bytesSent || 0));
  const etaSeconds = bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : null;
  return { bytesPerSecond, etaSeconds };
}

export function formatActivityUploadEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return 'menos de 1 min';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} min`;
}
