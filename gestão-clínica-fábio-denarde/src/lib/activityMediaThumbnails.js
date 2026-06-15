export const ACTIVITY_THUMBNAIL_MAX_DIMENSION = 360;
export const ACTIVITY_THUMBNAIL_QUALITY = 0.72;
export const ACTIVITY_THUMBNAIL_TIMEOUT_MS = 15_000;

export function getActivityThumbnailDimensions(width, height, maxDimension = ACTIVITY_THUMBNAIL_MAX_DIMENSION) {
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canvasToThumbnailBlob(canvas, quality = ACTIVITY_THUMBNAIL_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob
        ? resolve(blob)
        : reject(new Error('Não foi possível gerar a miniatura.')),
      'image/jpeg',
      quality,
    );
  });
}

async function loadThumbnailImage(file, dependencies) {
  const createBitmap = dependencies.createImageBitmap || globalThis.createImageBitmap;
  if (typeof createBitmap === 'function') {
    try {
      const bitmap = await createBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close?.(),
      };
    } catch {
      // Alguns Androids precisam do fallback por Image.
    }
  }

  const createObjectUrl = dependencies.createObjectURL || URL.createObjectURL;
  const revokeObjectUrl = dependencies.revokeObjectURL || URL.revokeObjectURL;
  const createImage = dependencies.createImage || (() => new Image());
  const objectUrl = createObjectUrl(file);
  const image = createImage();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute?.('src');
      revokeObjectUrl(objectUrl);
    };
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup,
    });
    image.onerror = () => {
      cleanup();
      reject(new Error('A foto não pôde ser decodificada para miniatura.'));
    };
    image.src = objectUrl;
  });
}

export async function createActivityPhotoThumbnail(file, dependencies = {}) {
  const image = await loadThumbnailImage(file, dependencies);
  const createCanvas = dependencies.createCanvas || (() => document.createElement('canvas'));
  const { width, height } = getActivityThumbnailDimensions(image.width, image.height);
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas indisponível para miniatura.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image.source, 0, 0, width, height);
    const blob = await (dependencies.canvasToBlob || canvasToThumbnailBlob)(canvas);
    return { blob, width, height, status: 'ready' };
  } finally {
    image.cleanup();
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function createActivityVideoThumbnail(file, dependencies = {}) {
  const createObjectUrl = dependencies.createObjectURL || URL.createObjectURL;
  const revokeObjectUrl = dependencies.revokeObjectURL || URL.revokeObjectURL;
  const createVideo = dependencies.createVideo || (() => document.createElement('video'));
  const createCanvas = dependencies.createCanvas || (() => document.createElement('canvas'));
  const setTimer = dependencies.setTimeout || globalThis.setTimeout;
  const clearTimer = dependencies.clearTimeout || globalThis.clearTimeout;
  const objectUrl = createObjectUrl(file);
  const video = createVideo();

  return new Promise((resolve, reject) => {
    let settled = false;
    let seekRequested = false;
    const timeoutId = setTimer(() => finish(new Error('Tempo limite ao gerar capa do vídeo.')), ACTIVITY_THUMBNAIL_TIMEOUT_MS);

    const cleanup = () => {
      clearTimer(timeoutId);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.pause?.();
      video.removeAttribute?.('src');
      video.load?.();
      video.remove?.();
      revokeObjectUrl(objectUrl);
    };

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };

    const capture = async () => {
      const sourceWidth = Math.round(video.videoWidth || 0);
      const sourceHeight = Math.round(video.videoHeight || 0);
      if (!sourceWidth || !sourceHeight) {
        finish(new Error('O vídeo não forneceu um quadro decodificável.'));
        return;
      }
      const { width, height } = getActivityThumbnailDimensions(sourceWidth, sourceHeight);
      const canvas = createCanvas();
      canvas.width = width;
      canvas.height = height;
      try {
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas indisponível para capa do vídeo.');
        context.fillStyle = '#000000';
        context.fillRect(0, 0, width, height);
        context.drawImage(video, 0, 0, width, height);
        const blob = await (dependencies.canvasToBlob || canvasToThumbnailBlob)(canvas);
        finish(null, { blob, width, height, status: 'ready' });
      } catch (error) {
        finish(error);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.autoplay = false;
    video.onloadedmetadata = () => {
      const duration = Number(video.duration || 0);
      const target = Number.isFinite(duration) && duration > 0
        ? Math.min(1, Math.max(0, duration / 3))
        : 0;
      if (target > 0) {
        seekRequested = true;
        try {
          video.currentTime = target;
        } catch {
          seekRequested = false;
        }
      }
    };
    video.onloadeddata = () => {
      if (!seekRequested) void capture();
    };
    video.onseeked = () => void capture();
    video.onerror = () => finish(new Error('O vídeo não pôde ser decodificado para miniatura.'));
    video.src = objectUrl;
    video.load?.();
  });
}

export async function createActivityMediaThumbnail(file, mediaType, dependencies = {}) {
  return mediaType === 'video'
    ? createActivityVideoThumbnail(file, dependencies)
    : createActivityPhotoThumbnail(file, dependencies);
}

export async function generateActivityThumbnailsSequentially(items, generator, onResult) {
  const results = [];
  for (const item of items) {
    try {
      const thumbnail = await generator(item);
      const result = { item, status: 'ready', thumbnail };
      results.push(result);
      await onResult?.(result);
    } catch (error) {
      const result = { item, status: 'unavailable', error };
      results.push(result);
      await onResult?.(result);
    }
  }
  return results;
}
