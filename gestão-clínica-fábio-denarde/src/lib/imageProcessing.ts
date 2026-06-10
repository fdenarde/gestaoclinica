export const MAX_ACTIVITY_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_ACTIVITY_OUTPUT_BYTES = 1_800_000;
export const MAX_ACTIVITY_IMAGE_DIMENSION = 1920;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ProcessedActivityPhoto {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  sha256: string;
}

function createImageError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function validateActivityPhotoSource(file: File): void {
  if (!ALLOWED_TYPES.has(file.type)) {
    if (file.type === 'image/heic' || file.type === 'image/heif' || /\.hei[cf]$/i.test(file.name)) {
      throw createImageError('activity-records/heic-not-supported', 'Imagens HEIC/HEIF ainda não são aceitas. Converta para JPG, PNG ou WEBP.');
    }
    throw createImageError('activity-records/invalid-file-type', 'Selecione uma imagem JPG, PNG ou WEBP.');
  }
  if (file.size <= 0) throw createImageError('activity-records/empty-file', 'O arquivo selecionado está vazio.');
  if (file.size > MAX_ACTIVITY_SOURCE_BYTES) {
    throw createImageError('activity-records/source-too-large', 'A imagem original deve ter no máximo 20 MB.');
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fallback below
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(createImageError('activity-records/read-failed', 'Não foi possível abrir a imagem selecionada.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(createImageError('activity-records/compression-failed', 'Não foi possível preparar a imagem para envio.')),
      'image/jpeg',
      quality,
    );
  });
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256HexFallback(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const bitLength = bytes.length * 8;
  const withOneByteLength = bytes.length + 1;
  const paddingLength = (64 - ((withOneByteLength + 8) % 64)) % 64;
  const totalLength = withOneByteLength + paddingLength + 8;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(totalLength - 4, bitLength >>> 0);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const digest = await subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return sha256HexFallback(buffer);
}

export async function processActivityPhoto(file: File): Promise<ProcessedActivityPhoto> {
  validateActivityPhotoSource(file);
  const bitmap = await loadBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const ratio = Math.min(1, MAX_ACTIVITY_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * ratio));
  const height = Math.max(1, Math.round(originalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw createImageError('activity-records/canvas-unavailable', 'O navegador não conseguiu preparar a imagem.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  let quality = 0.88;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_ACTIVITY_OUTPUT_BYTES && quality > 0.58) {
    quality -= 0.06;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > MAX_ACTIVITY_OUTPUT_BYTES) {
    throw createImageError('activity-records/output-too-large', 'A imagem continuou muito grande após a compressão. Selecione outra foto.');
  }

  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'atividade';
  const processedFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  return {
    file: processedFile,
    previewUrl: URL.createObjectURL(processedFile),
    width,
    height,
    sha256: await sha256Hex(processedFile),
  };
}
