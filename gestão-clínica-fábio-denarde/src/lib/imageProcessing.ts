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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(createImageError('activity-records/read-failed', 'Não foi possível ler a imagem selecionada.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function waitForImageDecode(image: HTMLImageElement): Promise<void> {
  if (image.decode) {
    return image.decode().catch(() => undefined);
  }
  return Promise.resolve();
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const dataUrl = await readFileAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = async () => {
      await waitForImageDecode(image);
      if (!(image.naturalWidth || image.width) || !(image.naturalHeight || image.height)) {
        reject(createImageError('activity-records/read-failed', 'Não foi possível identificar as dimensões da imagem.'));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(createImageError('activity-records/read-failed', 'Não foi possível abrir a imagem selecionada.'));
    image.src = dataUrl;
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
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be6d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
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

function getSanitizedBaseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'atividade';
}

function getTargetDimensions(originalWidth: number, originalHeight: number): { width: number; height: number } {
  const ratio = Math.min(1, MAX_ACTIVITY_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight));
  return {
    width: Math.max(1, Math.round(originalWidth * ratio)),
    height: Math.max(1, Math.round(originalHeight * ratio)),
  };
}

function assertCanvasHasVisibleContent(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const stepX = Math.max(1, Math.floor(width / 16));
  const stepY = Math.max(1, Math.floor(height / 16));
  let sampled = 0;
  let veryDark = 0;
  let hasVisibleSignal = false;

  for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
    for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
      const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
      sampled += 1;
      const brightness = red + green + blue;
      if (alpha > 0 && brightness > 45) hasVisibleSignal = true;
      if (alpha === 0 || brightness < 18) veryDark += 1;
    }
  }

  if (!hasVisibleSignal && sampled > 0 && veryDark / sampled > 0.96) {
    throw createImageError('activity-records/black-preview', 'O navegador preparou a foto como imagem preta. Tire a foto novamente ou escolha a imagem pela galeria.');
  }
}

export async function processActivityPhoto(file: File): Promise<ProcessedActivityPhoto> {
  validateActivityPhotoSource(file);

  // Sempre normalizamos para JPEG padrão antes de enviar ao Drive.
  // Isso evita fotos de câmera móvel com HDR/perfil exótico/variações do Android que aparecem bem na prévia local,
  // mas podem voltar pretas quando servidas depois pela rota da API.
  const image = await loadImageElement(file);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const { width, height } = getTargetDimensions(originalWidth, originalHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw createImageError('activity-records/canvas-unavailable', 'O navegador não conseguiu preparar a imagem.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  assertCanvasHasVisibleContent(canvas);

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_ACTIVITY_OUTPUT_BYTES && quality > 0.58) {
    quality -= 0.06;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > MAX_ACTIVITY_OUTPUT_BYTES) {
    throw createImageError('activity-records/output-too-large', 'A imagem continuou muito grande após a compressão. Selecione outra foto.');
  }

  const processedFile = new File([blob], `${getSanitizedBaseName(file)}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  return {
    file: processedFile,
    previewUrl: URL.createObjectURL(processedFile),
    width,
    height,
    sha256: await sha256Hex(processedFile),
  };
}
