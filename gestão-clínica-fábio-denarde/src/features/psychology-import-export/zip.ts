import type { BackupFile } from './types';

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return !path.split('/').some(part => part === '..' || part === '');
}

function writeU16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function writeU32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export function createStoredZip(files: BackupFile[]): Uint8Array {
  const seen = new Set<string>();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const file of files) {
    if (!isSafeArchivePath(file.path)) throw new Error(`Caminho de backup inválido: ${file.path}`);
    if (seen.has(file.path)) throw new Error(`Arquivo duplicado no backup: ${file.path}`);
    seen.add(file.path);
    const name = encoder.encode(file.path);
    const bytes = new Uint8Array(file.bytes);
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    writeU32(localView, 0, LOCAL_FILE_SIGNATURE);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x0800);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, 0);
    writeU16(localView, 12, 0);
    writeU32(localView, 14, checksum);
    writeU32(localView, 18, bytes.byteLength);
    writeU32(localView, 22, bytes.byteLength);
    writeU16(localView, 26, name.byteLength);
    writeU16(localView, 28, 0);
    local.set(name, 30);
    localChunks.push(local, bytes);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    writeU32(centralView, 0, CENTRAL_FILE_SIGNATURE);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x0800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, 0);
    writeU16(centralView, 14, 0);
    writeU32(centralView, 16, checksum);
    writeU32(centralView, 20, bytes.byteLength);
    writeU32(centralView, 24, bytes.byteLength);
    writeU16(centralView, 28, name.byteLength);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, offset);
    central.set(name, 46);
    centralChunks.push(central);
    offset += local.byteLength + bytes.byteLength;
  }

  const centralDirectory = concatBytes(centralChunks);
  const localData = concatBytes(localChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, END_SIGNATURE);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, files.length);
  writeU16(endView, 10, files.length);
  writeU32(endView, 12, centralDirectory.byteLength);
  writeU32(endView, 16, localData.byteLength);
  writeU16(endView, 20, 0);
  return concatBytes([localData, centralDirectory, end]);
}

export function extractStoredZip(bytes: Uint8Array): BackupFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files: BackupFile[] = [];
  const paths = new Set<string>();
  let offset = 0;
  while (offset + 4 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === CENTRAL_FILE_SIGNATURE || signature === END_SIGNATURE) break;
    if (signature !== LOCAL_FILE_SIGNATURE || offset + 30 > bytes.byteLength) throw new Error('Arquivo ZIP corrompido ou não suportado.');
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x08) !== 0 || method !== 0) throw new Error('Backup ZIP usa uma variante não suportada nesta etapa.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength || compressedSize !== uncompressedSize) throw new Error('Arquivo ZIP corrompido.');
    const path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (!isSafeArchivePath(path)) throw new Error(`Caminho inseguro no backup: ${path}`);
    if (paths.has(path)) throw new Error(`Arquivo duplicado no backup: ${path}`);
    const content = new Uint8Array(bytes.subarray(dataStart, dataEnd));
    if (crc32(content) !== checksum) throw new Error(`Checksum inválido no arquivo ${path}.`);
    paths.add(path);
    files.push({ path, bytes: content });
    offset = dataEnd;
  }
  if (!files.length) throw new Error('Nenhum arquivo suportado foi encontrado no backup ZIP.');
  return files;
}
