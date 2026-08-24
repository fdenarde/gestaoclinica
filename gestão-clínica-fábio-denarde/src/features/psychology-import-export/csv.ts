import Papa from 'papaparse';

export type CsvRow = Record<string, string>;

export interface CsvParseResult {
  rows: CsvRow[];
  fields: string[];
  errors: string[];
}

export function normalizeCsvHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function parseCsvText(text: string): CsvParseResult {
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: header => header.trim(),
  });
  return {
    rows: result.data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? '').trim()]))),
    fields: result.meta.fields || [],
    errors: result.errors.map(error => error.message),
  };
}

export function csvHasPatientShape(fields: string[]): boolean {
  const normalized = new Set(fields.map(normalizeCsvHeader));
  return ['nome', 'name', 'paciente', 'patient'].some(field => normalized.has(field))
    || (normalized.has('id') && (normalized.has('telefone') || normalized.has('phone')));
}

export function getCsvValue(row: CsvRow, ...candidates: string[]): string {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCsvHeader(candidate);
    const entry = entries.find(([key]) => normalizeCsvHeader(key) === normalizedCandidate);
    if (entry?.[1]) return entry[1].trim();
  }
  return '';
}

export function parseDateValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const brazilian = trimmed.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return undefined;
}

export function isValidIsoDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeTimeValue(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})[:h](\d{2})/i);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseNumberValue(value: string): number | undefined {
  const normalized = value.trim().replace(/R\$\s?/i, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
