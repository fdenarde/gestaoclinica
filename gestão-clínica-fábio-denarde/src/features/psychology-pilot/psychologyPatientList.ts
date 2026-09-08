import { getPsychologyPatientSummary } from './psychologyPatientProfile';
import { locationForSession, type PsychologyLocation } from './psychologyR2a';
import type { PsychologyPatient, PsychologyStore } from './psychologyDomain';
import { formatPsychologyPhoneDisplay } from './psychologyPhone';

export type PsychologyPatientStatusFilter = 'all' | 'active' | 'inactive' | 'review';
export type PsychologyPatientLastSessionFilter = 'any' | 'recent' | 'oldest' | 'none' | '3m' | '6m' | '12m' | '18m' | '24m';
export type PsychologyPatientNextSessionFilter = 'all' | 'with' | 'without';
export type PsychologyPatientReviewFilter = 'all' | 'in-review' | 'out-of-review';
export type PsychologyPatientListSortKey = 'name' | 'createdAt' | 'lastSession' | 'nextSession' | 'status';
export type PsychologyPatientListSortDirection = 'asc' | 'desc';

export interface PsychologyPatientListItem {
  patient: PsychologyPatient;
  phone: string;
  email: string;
  createdAt: string;
  createdAtValue: number | null;
  lastSession: string;
  lastSessionDate?: string;
  lastSessionValue: number | null;
  nextSession: string;
  nextSessionDate?: string;
  nextSessionValue: number | null;
  modalityLocation: string;
}

export interface PsychologyPatientListFilters {
  query?: string;
  status?: PsychologyPatientStatusFilter;
  lastSession?: PsychologyPatientLastSessionFilter;
  nextSession?: PsychologyPatientNextSessionFilter;
  review?: PsychologyPatientReviewFilter;
}

function normalizeSearchValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

function dateLabel(value?: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

function dateTimeValue(date?: string, time?: string): number | null {
  if (!date) return null;
  const parsed = new Date(`${date}T${time || '00:00'}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function realDateValue(value?: string | number | { seconds?: number; nanoseconds?: number }): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const timestamp = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function formatRealDate(value?: string): string {
  const timestamp = realDateValue(value);
  return timestamp === null
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(timestamp);
}

export function formatPsychologyPatientPhone(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  try {
    return formatPsychologyPhoneDisplay(raw);
  } catch {
    return raw;
  }
}

function cleanLabel(value?: string | null): string {
  const label = String(value ?? '').trim();
  return label || '—';
}

function primaryLocation(store: PsychologyStore): PsychologyLocation | undefined {
  return store.settings.locations.find(location => location.active && location.type === 'PRIMARY_OFFICE')
    || store.settings.locations.find(location => location.active);
}

function modalityLocationLabel(
  store: PsychologyStore,
  patient: PsychologyPatient,
  nextSession?: ReturnType<typeof getPsychologyPatientSummary> extends infer Summary
    ? Summary extends { nextSession?: infer Session } ? Session : never
    : never,
  location?: PsychologyLocation,
): string {
  const modality = nextSession?.modality || patient.preferredModality;
  if (modality === 'online') return 'Online';
  const resolvedLocation = location
    || (nextSession ? locationForSession(store.settings, nextSession) : undefined)
    || primaryLocation(store);
  return resolvedLocation?.displayName ? `Presencial · ${resolvedLocation.displayName}` : 'Presencial';
}

export function getPsychologyPatientListViewModels(
  store: PsychologyStore,
  patients: PsychologyPatient[],
  referenceDate = new Date(),
): PsychologyPatientListItem[] {
  const rows = patients.map((patient, index) => {
    const summary = getPsychologyPatientSummary(store, patient.id, referenceDate);
    const nextSession = summary?.nextSession;
    const lastSession = summary?.lastSession;
    return {
      index,
      patient,
      phone: formatPsychologyPatientPhone(patient.phone),
      email: cleanLabel(patient.email),
      createdAt: formatRealDate(patient.createdAt),
      createdAtValue: realDateValue(patient.createdAt),
      lastSession: lastSession ? dateLabel(lastSession.date) : '—',
      lastSessionDate: lastSession?.date,
      lastSessionValue: dateTimeValue(lastSession?.date, lastSession?.time),
      nextSession: nextSession ? `${dateLabel(nextSession.date)} · ${cleanLabel(nextSession.time)}` : 'Sem agendamento',
      nextSessionDate: nextSession?.date,
      nextSessionValue: dateTimeValue(nextSession?.date, nextSession?.time),
      modalityLocation: modalityLocationLabel(store, patient, nextSession, summary?.location),
    };
  });

  return rows
    .sort((a, b) => a.patient.name.localeCompare(b.patient.name, 'pt-BR', { sensitivity: 'base' }) || a.index - b.index)
    .map(({ index: _index, ...row }) => row);
}

function addMonths(value: Date, months: number): Date {
  const result = new Date(value);
  result.setMonth(result.getMonth() + months);
  return result;
}

function matchesQuery(row: PsychologyPatientListItem, query: string): boolean {
  if (!query) return true;
  const normalizedQuery = normalizeSearchValue(query);
  return [row.patient.name, row.patient.phone, row.phone, row.patient.email || '']
    .some(value => normalizeSearchValue(value).includes(normalizedQuery));
}

export function isPsychologyPatientInReview(row: PsychologyPatientListItem): boolean {
  return Boolean(row.patient.inReview);
}

export function matchesPsychologyPatientLastSessionFilter(
  row: PsychologyPatientListItem,
  filter: PsychologyPatientLastSessionFilter,
  referenceDate = new Date(),
): boolean {
  if (filter === 'any' || filter === 'recent' || filter === 'oldest') return true;
  if (filter === 'none') return row.lastSessionValue === null;
  if (row.lastSessionValue === null) return false;
  const months = Number(filter.replace('m', ''));
  return row.lastSessionValue <= addMonths(referenceDate, -months).getTime();
}

export function filterPsychologyPatientList(
  rows: PsychologyPatientListItem[],
  filters: PsychologyPatientListFilters = {},
  referenceDate = new Date(),
): PsychologyPatientListItem[] {
  const status = filters.status || 'all';
  const lastSession = filters.lastSession || 'any';
  const nextSession = filters.nextSession || 'all';
  const review = filters.review || 'all';
  return rows.filter(row => {
    const inReview = isPsychologyPatientInReview(row);
    if (!matchesQuery(row, filters.query || '')) return false;
    if (status === 'active' && !row.patient.active) return false;
    if (status === 'inactive' && row.patient.active) return false;
    if (status === 'review' && !inReview) return false;
    if (review === 'in-review' && !inReview) return false;
    if (review === 'out-of-review' && inReview) return false;
    if (nextSession === 'with' && row.nextSessionValue === null) return false;
    if (nextSession === 'without' && row.nextSessionValue !== null) return false;
    return matchesPsychologyPatientLastSessionFilter(row, lastSession, referenceDate);
  });
}

function compareValues(a: number | string | null, b: number | string | null, direction: PsychologyPatientListSortDirection): number {
  // Missing dates are always last, independent of direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const comparison = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

export function sortPsychologyPatientList(
  rows: PsychologyPatientListItem[],
  key: PsychologyPatientListSortKey = 'name',
  direction: PsychologyPatientListSortDirection = 'asc',
): PsychologyPatientListItem[] {
  return [...rows].sort((a, b) => {
    const aValue: number | string | null = key === 'name'
      ? normalizeSearchValue(a.patient.name)
      : key === 'status'
        ? (a.patient.active ? 'Ativo' : 'Inativo')
        : key === 'createdAt'
          ? a.createdAtValue
          : key === 'lastSession'
            ? a.lastSessionValue
            : a.nextSessionValue;
    const bValue: number | string | null = key === 'name'
      ? normalizeSearchValue(b.patient.name)
      : key === 'status'
        ? (b.patient.active ? 'Ativo' : 'Inativo')
        : key === 'createdAt'
          ? b.createdAtValue
          : key === 'lastSession'
            ? b.lastSessionValue
            : b.nextSessionValue;
    return compareValues(aValue, bValue, direction)
      || a.patient.name.localeCompare(b.patient.name, 'pt-BR', { sensitivity: 'base' })
      || a.patient.id.localeCompare(b.patient.id);
  });
}

export function countPsychologyPatientList(rows: PsychologyPatientListItem[]): { total: number; active: number; inactive: number; review: number } {
  return {
    total: rows.length,
    active: rows.filter(row => row.patient.active).length,
    inactive: rows.filter(row => !row.patient.active).length,
    review: rows.filter(isPsychologyPatientInReview).length,
  };
}
