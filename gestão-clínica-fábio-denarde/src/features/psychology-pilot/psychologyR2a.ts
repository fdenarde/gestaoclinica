import type { PsychologyScope } from './psychologyDomain';
import { PSYCHOLOGY_SERVICE_CATALOG, psychologyCatalogEntry, canonicalPsychologyServiceId } from './psychologyServiceCatalog';

const PSYCHOLOGY_CONTEXT = 'PSICOLOGIA' as const;

export type PsychologyAgendaCategory = 'ONLINE' | 'PRESENTIAL_PRIMARY' | 'PERSONAL' | 'MENTORING' | 'EXTERNAL_OFFICE';
export type PsychologyLocationType = 'PRIMARY_OFFICE' | 'EXTERNAL_OFFICE' | 'OTHER';
/** Legacy lowercase values remain readable; R2C2 derives the canonical status in the ledger. */
export type PsychologyChargeStatus = 'pending' | 'partial' | 'paid' | 'exempt' | 'canceled' | 'cancelled';
export type PsychologyPaymentMethod = 'PIX' | 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
export type PsychologyEventState = 'CONFIRMED' | 'WAITING' | 'REMINDER_SENT' | 'CANCELED' | 'ABSENT';
export type PsychologyDocumentClassification = 'ADMINISTRATIVE' | 'CLINICAL';

export interface PsychologyLocation {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  type: PsychologyLocationType;
  displayName: string;
  address?: string;
  fullAddress?: string;
  city?: string;
  state?: string;
  googleMapsUrl?: string;
  sortOrder?: number;
  active: boolean;
  isPrimary: boolean;
  color: string;
  colorKey?: PsychologyAgendaCategory;
  externalReferences?: PsychologyExternalReference[];
  createdAt: string;
  updatedAt: string;
}

export interface PsychologyLocationInput {
  displayName: string;
  address?: string;
  fullAddress?: string;
  city?: string;
  state?: string;
  googleMapsUrl?: string;
  sortOrder?: number;
  active?: boolean;
  isPrimary?: boolean;
  color?: string;
}

export interface PsychologyService {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  name: string;
  defaultDurationMinutes: number;
  defaultPrice: number;
  modality: 'ONLINE' | 'PRESENTIAL' | 'BOTH';
  active: boolean;
  /** Public-booking publication is a configuration attribute, not a second service identity. */
  publicBooking?: {
    active: boolean;
    onlineEnabled: boolean;
    inPersonEnabled: boolean;
    allowedLocationIds: string[];
    sortOrder: number;
  };
  externalReferences?: PsychologyExternalReference[];
  createdAt: string;
  updatedAt: string;
}

export interface PsychologyExternalReference {
  source: string;
  externalId: string;
  importedAt?: string;
}

export interface PsychologyCharge {
  id: string;
  /** Null when the patient was definitively deleted but the financial fact was paid. */
  patientId: string | null;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  sessionId?: string;
  serviceId?: string;
  description: string;
  amount: number;
  dueDate?: string;
  status: PsychologyChargeStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  packageId?: string;
  canceledAt?: string;
  cancelledAt?: string;
  canceledBy?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  reactivatedAt?: string;
  reactivatedBy?: string;
  exemptionReason?: string;
}

export interface PsychologyPayment {
  id: string;
  /** Null when the originating charge was removed during patient deletion. */
  chargeId: string | null;
  /** Null when the patient was definitively deleted; financial facts remain. */
  patientId: string | null;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  sessionId?: string;
  amount: number;
  date: string;
  method: PsychologyPaymentMethod;
  status: 'active' | 'voided';
  updatedAt: string;
  operationKey?: string;
  createdAt: string;
  createdBy?: string;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  reactivatedAt?: string;
  reactivatedBy?: string;
}

export type PsychologyExpenseCategory = 'Aluguel' | 'Materiais' | 'Serviços' | 'Impostos/Taxas' | 'Marketing' | 'Capacitação' | 'Tecnologia' | 'Outros';
export type PsychologyExpenseStatus = 'REALIZED' | 'PENDING' | 'REVERSED';

export interface PsychologyExpense {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  description: string;
  amount: number;
  date: string;
  category: PsychologyExpenseCategory;
  status: PsychologyExpenseStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  reactivatedAt?: string;
  reactivatedBy?: string;
}

export interface PsychologySessionPackage {
  id: string;
  patientId: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  name: string;
  totalSessions: number;
  usedSessions: number;
  startDate: string;
  endDate?: string;
  active: boolean;
  price?: number;
  serviceId?: string;
  pricePerSession?: number;
  totalPrice?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PsychologySessionRecordR2A {
  id: string;
  patientId: string;
  sessionId?: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  content: string;
  date?: string;
  authorProfessionalId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Presentation data only. Technical identity remains in Settings.scope and
 * in the R2D1 runtime identity; these legacy aliases are kept for old local
 * stores and are normalized from the canonical presentation fields.
 */
export interface PsychologyProfessionalPresentation {
  displayName: string;
  professionalTitle: string;
  professionalRegistration: string;
  clinicDisplayName: string;
  email: string;
  phone: string;
  /** @deprecated use displayName */
  name: string;
  /** @deprecated use professionalRegistration */
  crp: string;
  /** @deprecated use professionalTitle */
  specialty: string;
}

export interface PsychologyAgendaSettings {
  defaultDurationMinutes: number;
  intervalMinutes: number;
  weeklyAvailability: PsychologyDailyAvailability[];
  dayParts: PsychologyAgendaDayParts;
  /** @deprecated derived from weeklyAvailability for legacy local stores. */
  workingDays: number[];
  /** @deprecated derived from weeklyAvailability for legacy local stores. */
  availableTimes: string[];
}

export interface PsychologyAgendaPeriod {
  startTime: string;
  endTime: string;
}

export interface PsychologyAgendaDayParts {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  eveningStart: string;
  eveningEnd: string;
}

export type PsychologyAgendaDayPart = 'morning' | 'afternoon' | 'evening';

export const PSYCHOLOGY_AGENDA_DAYPART_LABELS: Record<PsychologyAgendaDayPart, string> = {
  morning: 'manhã',
  afternoon: 'tarde',
  evening: 'noite',
};

export const PSYCHOLOGY_AGENDA_DAYPART_DEFAULTS: PsychologyAgendaDayParts = {
  morningStart: '08:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '18:00',
  eveningStart: '18:00',
  eveningEnd: '21:00',
};

export interface PsychologyDailyAvailability {
  dayOfWeek: number;
  enabled: boolean;
  periods: PsychologyAgendaPeriod[];
}

export interface PsychologyReminderSettings {
  enabled: boolean;
  advanceMinutes: number;
}

export interface PsychologyColorRegistry {
  ONLINE: string;
  PRESENTIAL_PRIMARY: string;
  PERSONAL: string;
  MENTORING: string;
  EXTERNAL_OFFICE: string;
}

export interface PsychologySettings {
  scope: PsychologyScope;
  professionalProfile: PsychologyProfessionalPresentation;
  agenda: PsychologyAgendaSettings;
  services: PsychologyService[];
  locations: PsychologyLocation[];
  colors: PsychologyColorRegistry;
  reminders: PsychologyReminderSettings;
  updatedAt: string;
}

export const PSYCHOLOGY_COLOR_DEFAULTS: PsychologyColorRegistry = {
  ONLINE: '#16A34A',
  PRESENTIAL_PRIMARY: '#DC2626',
  PERSONAL: '#F97316',
  MENTORING: '#C8803E',
  EXTERNAL_OFFICE: '#EA580C',
};

export const PSYCHOLOGY_CATEGORY_LABELS: Record<PsychologyAgendaCategory, string> = {
  ONLINE: 'Online',
  PRESENTIAL_PRIMARY: 'Presencial',
  PERSONAL: 'Pessoal',
  MENTORING: 'Mentoria',
  EXTERNAL_OFFICE: 'Consultório Externo',
};

export const PSYCHOLOGY_LOCATION_IDS = {
  primary: 'psychology-location-primary-office',
  external: 'psychology-location-external-office',
} as const;

export const PSYCHOLOGY_SERVICE_IDS = {
  psychotherapy: 'psychotherapy-individual',
  couple: 'therapy-couple',
  mentoring: 'mentoring',
  eneagram: 'eneagram-test',
  adolescent: 'psychotherapy-adolescent',
} as const;

export const PSYCHOLOGY_LOCAL_DEFAULT_DISPLAY_NAME = 'Leila Chaves';
export const PSYCHOLOGY_LOCAL_DEFAULT_TITLE = 'Psicóloga';

export function createDefaultPsychologyProfessionalPresentation(scope: PsychologyScope): PsychologyProfessionalPresentation {
  const isLocalFixture = scope.professionalId === 'psychology-local-professional';
  const displayName = isLocalFixture ? PSYCHOLOGY_LOCAL_DEFAULT_DISPLAY_NAME : 'Profissional';
  const professionalTitle = isLocalFixture ? PSYCHOLOGY_LOCAL_DEFAULT_TITLE : 'Psicologia';
  return {
    displayName,
    professionalTitle,
    professionalRegistration: '',
    clinicDisplayName: '',
    email: '',
    phone: '',
    name: displayName,
    crp: '',
    specialty: professionalTitle,
  };
}

export function createDefaultPsychologyLocations(scope: PsychologyScope, now = new Date().toISOString()): PsychologyLocation[] {
  return [
    {
      id: PSYCHOLOGY_LOCATION_IDS.primary,
      professionalId: scope.professionalId,
      context: PSYCHOLOGY_CONTEXT,
      type: 'PRIMARY_OFFICE',
      displayName: 'Shopping Moxuara',
      address: '',
      fullAddress: '',
      city: 'Cariacica',
      state: 'ES',
      googleMapsUrl: '',
      sortOrder: 1,
      active: true,
      isPrimary: true,
      color: PSYCHOLOGY_COLOR_DEFAULTS.PRESENTIAL_PRIMARY,
      colorKey: 'PRESENTIAL_PRIMARY',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PSYCHOLOGY_LOCATION_IDS.external,
      professionalId: scope.professionalId,
      context: PSYCHOLOGY_CONTEXT,
      type: 'EXTERNAL_OFFICE',
      displayName: 'SPAC — Centro de Saúde e Movimento',
      address: '',
      fullAddress: '',
      city: 'Vila Velha',
      state: 'ES',
      googleMapsUrl: '',
      sortOrder: 2,
      active: true,
      isPrimary: false,
      color: PSYCHOLOGY_COLOR_DEFAULTS.EXTERNAL_OFFICE,
      colorKey: 'EXTERNAL_OFFICE',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createDefaultPsychologyServices(scope: PsychologyScope, now = new Date().toISOString()): PsychologyService[] {
  const locationIds = [PSYCHOLOGY_LOCATION_IDS.primary, PSYCHOLOGY_LOCATION_IDS.external];
  return PSYCHOLOGY_SERVICE_CATALOG.map(entry => ({
    id: entry.id,
    professionalId: scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    name: entry.name,
    defaultDurationMinutes: entry.defaultDurationMinutes,
    defaultPrice: entry.defaultPrice,
    modality: entry.modality,
    active: true,
    publicBooking: {
      active: true,
      onlineEnabled: entry.modality !== 'PRESENTIAL',
      inPersonEnabled: entry.modality !== 'ONLINE',
      allowedLocationIds: locationIds,
      sortOrder: entry.sortOrder,
    },
    createdAt: now,
    updatedAt: now,
  }));
}

export const PSYCHOLOGY_WEEKDAY_LABELS: Record<number, string> = {
  0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado',
};

function psychologyTimeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : -1;
}

function psychologyMinutesToTime(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function createPsychologyWeeklyAvailabilityFromLegacy(workingDays: number[], availableTimes: string[]): PsychologyDailyAvailability[] {
  const validDays = [...new Set(workingDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
  const times = [...new Set(availableTimes.map(time => String(time).trim()).filter(time => psychologyTimeToMinutes(time) >= 0))]
    .sort((a, b) => psychologyTimeToMinutes(a) - psychologyTimeToMinutes(b));
  const periods: PsychologyAgendaPeriod[] = [];
  times.forEach(time => {
    const start = psychologyTimeToMinutes(time);
    const previous = periods.at(-1);
    if (!previous || start - psychologyTimeToMinutes(previous.endTime) > 60) periods.push({ startTime: time, endTime: psychologyMinutesToTime(start + 60) });
    else if (start + 60 > psychologyTimeToMinutes(previous.endTime)) previous.endTime = psychologyMinutesToTime(start + 60);
  });
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, enabled: validDays.includes(dayOfWeek), periods: periods.map(period => ({ ...period })) }));
}

function normalizePsychologyPeriods(periods: unknown): PsychologyAgendaPeriod[] {
  if (!Array.isArray(periods)) return [];
  const sorted = periods.map(period => {
    const item = period && typeof period === 'object' ? period as Partial<PsychologyAgendaPeriod> : {};
    const startTime = String(item.startTime || '').trim();
    const endTime = String(item.endTime || '').trim();
    return { startTime, endTime, start: psychologyTimeToMinutes(startTime), end: psychologyTimeToMinutes(endTime) };
  }).filter(period => period.start >= 0 && period.end > period.start).sort((a, b) => a.start - b.start);
  const merged: PsychologyAgendaPeriod[] = [];
  sorted.forEach(period => {
    const previous = merged.at(-1);
    if (!previous || period.start > psychologyTimeToMinutes(previous.endTime)) merged.push({ startTime: period.startTime, endTime: period.endTime });
    else if (period.end > psychologyTimeToMinutes(previous.endTime)) previous.endTime = period.endTime;
  });
  return merged;
}

export function normalizePsychologyWeeklyAvailability(value: unknown, fallback: PsychologyDailyAvailability[]): PsychologyDailyAvailability[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const raw = source.find(item => item && typeof item === 'object' && Number((item as PsychologyDailyAvailability).dayOfWeek) === dayOfWeek) as Partial<PsychologyDailyAvailability> | undefined;
    const periods = normalizePsychologyPeriods(raw?.periods);
    return { dayOfWeek, enabled: Boolean(raw?.enabled) && periods.length > 0, periods };
  });
}

function normalizePsychologyDayPartTime(value: unknown, fallback: string): string {
  const candidate = String(value || '').trim();
  return psychologyTimeToMinutes(candidate) >= 0 ? candidate : fallback;
}

export function normalizePsychologyAgendaDayParts(value: unknown, fallback: PsychologyAgendaDayParts = PSYCHOLOGY_AGENDA_DAYPART_DEFAULTS): PsychologyAgendaDayParts {
  const input = value && typeof value === 'object' ? value as Partial<PsychologyAgendaDayParts> : {};
  const normalized = {
    morningStart: normalizePsychologyDayPartTime(input.morningStart, fallback.morningStart),
    morningEnd: normalizePsychologyDayPartTime(input.morningEnd, fallback.morningEnd),
    afternoonStart: normalizePsychologyDayPartTime(input.afternoonStart, fallback.afternoonStart),
    afternoonEnd: normalizePsychologyDayPartTime(input.afternoonEnd, fallback.afternoonEnd),
    eveningStart: normalizePsychologyDayPartTime(input.eveningStart, fallback.eveningStart),
    eveningEnd: normalizePsychologyDayPartTime(input.eveningEnd, fallback.eveningEnd),
  };
  return {
    morningStart: psychologyTimeToMinutes(normalized.morningEnd) > psychologyTimeToMinutes(normalized.morningStart) ? normalized.morningStart : fallback.morningStart,
    morningEnd: psychologyTimeToMinutes(normalized.morningEnd) > psychologyTimeToMinutes(normalized.morningStart) ? normalized.morningEnd : fallback.morningEnd,
    afternoonStart: psychologyTimeToMinutes(normalized.afternoonEnd) > psychologyTimeToMinutes(normalized.afternoonStart) ? normalized.afternoonStart : fallback.afternoonStart,
    afternoonEnd: psychologyTimeToMinutes(normalized.afternoonEnd) > psychologyTimeToMinutes(normalized.afternoonStart) ? normalized.afternoonEnd : fallback.afternoonEnd,
    eveningStart: psychologyTimeToMinutes(normalized.eveningEnd) > psychologyTimeToMinutes(normalized.eveningStart) ? normalized.eveningStart : fallback.eveningStart,
    eveningEnd: psychologyTimeToMinutes(normalized.eveningEnd) > psychologyTimeToMinutes(normalized.eveningStart) ? normalized.eveningEnd : fallback.eveningEnd,
  };
}

function normalizePsychologyServices(value: unknown, scope: PsychologyScope, defaults: PsychologyService[], locationIds: string[], now: string): PsychologyService[] {
  if (!Array.isArray(value)) return defaults;
  const normalized = value
    .filter(item => item && typeof item === 'object')
    .map((item, index) => {
      const raw = item as Partial<PsychologyService>;
      const id = canonicalPsychologyServiceId(raw.id || `service-${index + 1}`);
      const catalogEntry = psychologyCatalogEntry(id);
      const fallbackService = defaults.find(service => service.id === id);
      const rawPublicBooking = raw.publicBooking && typeof raw.publicBooking === 'object' ? raw.publicBooking : undefined;
      const fallbackPublicBooking = fallbackService?.publicBooking;
      const publicBooking = rawPublicBooking || fallbackPublicBooking ? {
        active: rawPublicBooking?.active ?? fallbackPublicBooking?.active ?? false,
        onlineEnabled: rawPublicBooking?.onlineEnabled ?? fallbackPublicBooking?.onlineEnabled ?? raw.modality !== 'PRESENTIAL',
        inPersonEnabled: rawPublicBooking?.inPersonEnabled ?? fallbackPublicBooking?.inPersonEnabled ?? raw.modality !== 'ONLINE',
        allowedLocationIds: (rawPublicBooking?.allowedLocationIds || fallbackPublicBooking?.allowedLocationIds || locationIds).filter(locationId => locationIds.includes(locationId)),
        sortOrder: Math.max(1, Number(rawPublicBooking?.sortOrder || fallbackPublicBooking?.sortOrder || index + 1)),
      } : undefined;
      return {
        ...raw,
        id,
        professionalId: scope.professionalId,
        context: PSYCHOLOGY_CONTEXT,
        name: String(raw.name || catalogEntry?.name || fallbackService?.name || `Serviço ${index + 1}`).trim() || `Serviço ${index + 1}`,
        defaultDurationMinutes: Math.max(5, Number(raw.defaultDurationMinutes) || catalogEntry?.defaultDurationMinutes || fallbackService?.defaultDurationMinutes || 50),
        defaultPrice: Math.max(0, Number.isFinite(Number(raw.defaultPrice)) ? Number(raw.defaultPrice) : catalogEntry?.defaultPrice || fallbackService?.defaultPrice || 0),
        modality: raw.modality === 'ONLINE' || raw.modality === 'PRESENTIAL' || raw.modality === 'BOTH' ? raw.modality : catalogEntry?.modality || fallbackService?.modality || 'BOTH',
        active: raw.active !== false,
        publicBooking,
        createdAt: String(raw.createdAt || fallbackService?.createdAt || now),
        updatedAt: String(raw.updatedAt || now),
      } satisfies PsychologyService;
    });
  if (normalized.length === 0) return defaults;
  const firstRawId = value.length === 1 && value[0] && typeof value[0] === 'object' ? String((value[0] as Partial<PsychologyService>).id || '') : '';
  const isLegacySingleServiceStore = firstRawId === 'psychology-service-psychotherapy';
  return isLegacySingleServiceStore
    ? [...normalized, ...defaults.filter(service => !normalized.some(current => current.id === service.id))]
    : normalized;
}

export function getPsychologyAgendaDaypart(agenda: Pick<PsychologyAgendaSettings, 'dayParts'>, part: PsychologyAgendaDayPart): PsychologyAgendaPeriod {
  const dayParts = normalizePsychologyAgendaDayParts(agenda.dayParts);
  return part === 'morning'
    ? { startTime: dayParts.morningStart, endTime: dayParts.morningEnd }
    : part === 'afternoon'
      ? { startTime: dayParts.afternoonStart, endTime: dayParts.afternoonEnd }
      : { startTime: dayParts.eveningStart, endTime: dayParts.eveningEnd };
}

export function getPsychologyAvailabilityPeriods(agenda: Pick<PsychologyAgendaSettings, 'weeklyAvailability'>, dayOfWeek: number): PsychologyAgendaPeriod[] {
  return agenda.weeklyAvailability.find(day => day.dayOfWeek === dayOfWeek && day.enabled)?.periods || [];
}

export function getPsychologyAvailabilityTimes(agenda: Pick<PsychologyAgendaSettings, 'weeklyAvailability'>): string[] {
  return [...new Set(agenda.weeklyAvailability.flatMap(day => day.enabled ? day.periods.flatMap(period => {
    const start = psychologyTimeToMinutes(period.startTime);
    const end = psychologyTimeToMinutes(period.endTime);
    return Array.from({ length: Math.max(0, Math.ceil((end - start) / 60)) }, (_, index) => psychologyMinutesToTime(start + index * 60));
  }) : []))].sort();
}

export function isPsychologyTimeWithinAvailability(agenda: Pick<PsychologyAgendaSettings, 'weeklyAvailability'>, dayOfWeek: number, time: string): boolean {
  const minutes = psychologyTimeToMinutes(time);
  return getPsychologyAvailabilityPeriods(agenda, dayOfWeek).some(period => minutes >= psychologyTimeToMinutes(period.startTime) && minutes < psychologyTimeToMinutes(period.endTime));
}

export function isPsychologyDateTimeWithinAvailability(agenda: Pick<PsychologyAgendaSettings, 'weeklyAvailability'>, date: string, time: string): boolean {
  const parsed = new Date(`${date}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && isPsychologyTimeWithinAvailability(agenda, parsed.getDay(), time);
}

export function getPsychologyFirstAvailabilityTime(agenda: Pick<PsychologyAgendaSettings, 'weeklyAvailability'>): string | undefined {
  return agenda.weeklyAvailability.filter(day => day.enabled).flatMap(day => day.periods.map(period => period.startTime)).sort()[0];
}

export function createDefaultPsychologySettings(scope: PsychologyScope, now = new Date().toISOString()): PsychologySettings {
  const workingDays = [1, 2, 3, 4, 5, 6];
  const availableTimes = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
  return {
    scope,
    professionalProfile: createDefaultPsychologyProfessionalPresentation(scope),
    agenda: { defaultDurationMinutes: 50, intervalMinutes: 10, weeklyAvailability: createPsychologyWeeklyAvailabilityFromLegacy(workingDays, availableTimes), dayParts: { ...PSYCHOLOGY_AGENDA_DAYPART_DEFAULTS }, workingDays, availableTimes },
    services: createDefaultPsychologyServices(scope, now),
    locations: createDefaultPsychologyLocations(scope, now),
    colors: { ...PSYCHOLOGY_COLOR_DEFAULTS },
    reminders: { enabled: false, advanceMinutes: 1440 },
    updatedAt: now,
  };
}

export function normalizePsychologyColor(value: unknown, fallback: string): string {
  const candidate = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) && hasReadableContrast(candidate) ? candidate.toUpperCase() : fallback;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/.{2}/g)?.map(item => parseInt(item, 16)) || [0, 0, 0];
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function hasReadableContrast(hex: string): boolean {
  const light = luminance(hex);
  const contrastWhite = 1.05 / (light + 0.05);
  const contrastBlack = (light + 0.05) / 0.05;
  return Math.max(contrastWhite, contrastBlack) >= 3;
}

export function normalizePsychologySettings(value: unknown, scope: PsychologyScope, now = new Date().toISOString()): PsychologySettings {
  const defaults = createDefaultPsychologySettings(scope, now);
  const input = value && typeof value === 'object' ? value as Partial<PsychologySettings> : {};
  const rawAgenda = (input.agenda || {}) as Partial<PsychologyAgendaSettings>;
  const legacyWorkingDays = Array.isArray(rawAgenda.workingDays) ? rawAgenda.workingDays : defaults.agenda.workingDays;
  const legacyAvailableTimes = Array.isArray(rawAgenda.availableTimes) ? rawAgenda.availableTimes : defaults.agenda.availableTimes;
  const weeklyAvailability = normalizePsychologyWeeklyAvailability(rawAgenda.weeklyAvailability, createPsychologyWeeklyAvailabilityFromLegacy(legacyWorkingDays, legacyAvailableTimes));
  const workingDays = weeklyAvailability.filter(day => day.enabled).map(day => day.dayOfWeek);
  const availableTimes = getPsychologyAvailabilityTimes({ weeklyAvailability });
  const dayParts = normalizePsychologyAgendaDayParts(rawAgenda.dayParts, defaults.agenda.dayParts);
  const inputScope = input.scope;
  if (inputScope?.professionalId && inputScope.professionalId !== scope.professionalId) return defaults;
  const colors = (input.colors || {}) as Partial<PsychologyColorRegistry>;
  const rawLocations = Array.isArray(input.locations)
    ? input.locations.filter(item => item && item.context === scope.context && item.professionalId === scope.professionalId) as PsychologyLocation[]
    : defaults.locations;
  const normalizedLocations = rawLocations.map((location, index) => {
    const type: PsychologyLocationType = location.type === 'PRIMARY_OFFICE' || location.type === 'EXTERNAL_OFFICE' || location.type === 'OTHER'
      ? location.type
      : 'OTHER';
    const fallback = type === 'PRIMARY_OFFICE'
      ? defaults.locations[0].color
      : type === 'EXTERNAL_OFFICE'
        ? defaults.locations[1].color
        : PSYCHOLOGY_COLOR_DEFAULTS.PRESENTIAL_PRIMARY;
    return {
      ...location,
      type,
      displayName: String(location.displayName || `Local ${index + 1}`).trim() || `Local ${index + 1}`,
      address: String(location.address || '').trim(),
      active: location.active !== false,
      isPrimary: Boolean(location.isPrimary ?? type === 'PRIMARY_OFFICE'),
      color: normalizePsychologyColor(location.color, fallback),
      colorKey: location.colorKey || (type === 'PRIMARY_OFFICE' ? 'PRESENTIAL_PRIMARY' : type === 'EXTERNAL_OFFICE' ? 'EXTERNAL_OFFICE' : undefined),
    } satisfies PsychologyLocation;
  });
  const locations = normalizedLocations.length ? normalizedLocations : defaults.locations;
  const primaryIndex = Math.max(0, locations.findIndex(location => location.isPrimary && location.active));
  const stableLocations = locations.map((location, index) => ({ ...location, isPrimary: index === primaryIndex }));
  const rawServices = Array.isArray(input.services)
    ? input.services.filter(item => item
      && (item.context === undefined || item.context === scope.context)
      && (item.professionalId === undefined || item.professionalId === scope.professionalId))
    : input.services;
  const services = normalizePsychologyServices(rawServices, scope, defaults.services, stableLocations.map(location => location.id), now);
  const rawProfile = (input.professionalProfile || {}) as Partial<PsychologyProfessionalPresentation>;
  const legacyName = String(rawProfile.name || '').trim();
  const legacyTitle = String(rawProfile.specialty || '').trim();
  const rawDisplayName = String(rawProfile.displayName || '').trim();
  const rawProfessionalTitle = String(rawProfile.professionalTitle || '').trim();
  const displayName = rawDisplayName || (legacyName && legacyName.toLocaleLowerCase() !== 'psicologia' ? legacyName : defaults.professionalProfile.displayName);
  const professionalTitle = rawProfessionalTitle || (legacyTitle && legacyTitle.toLocaleLowerCase() !== 'psicologia' ? legacyTitle : defaults.professionalProfile.professionalTitle);
  const professionalRegistration = String(rawProfile.professionalRegistration ?? rawProfile.crp ?? '').trim();
  const professionalProfile: PsychologyProfessionalPresentation = {
    ...defaults.professionalProfile,
    ...rawProfile,
    displayName,
    professionalTitle,
    professionalRegistration,
    clinicDisplayName: String(rawProfile.clinicDisplayName || '').trim(),
    email: String(rawProfile.email || '').trim(),
    phone: String(rawProfile.phone || '').trim(),
    name: displayName,
    crp: professionalRegistration,
    specialty: professionalTitle,
  };
  const normalizedOnlineColor = normalizePsychologyColor(colors.ONLINE, defaults.colors.ONLINE);
  const normalizedMentoringColor = normalizePsychologyColor(colors.MENTORING, defaults.colors.MENTORING);
  // Older candidates accidentally persisted the Online token for Mentoria.
  // Repair that known cross-category value at the normalization boundary so
  // every agenda surface receives the same semantic token.
  const mentoringColor = normalizedMentoringColor === normalizedOnlineColor
    ? defaults.colors.MENTORING
    : normalizedMentoringColor;
  return {
    ...defaults,
    ...input,
    scope,
    professionalProfile,
    agenda: { ...defaults.agenda, ...rawAgenda, weeklyAvailability, dayParts, workingDays, availableTimes },
    services,
    locations: stableLocations,
    colors: {
      ONLINE: normalizedOnlineColor,
      PRESENTIAL_PRIMARY: normalizePsychologyColor(colors.PRESENTIAL_PRIMARY, defaults.colors.PRESENTIAL_PRIMARY),
      PERSONAL: normalizePsychologyColor(colors.PERSONAL, defaults.colors.PERSONAL),
      MENTORING: mentoringColor,
      EXTERNAL_OFFICE: normalizePsychologyColor(colors.EXTERNAL_OFFICE, defaults.colors.EXTERNAL_OFFICE),
    },
    reminders: { ...defaults.reminders, ...(input.reminders || {}) },
    updatedAt: input.updatedAt || now,
  };
}

export function agendaCategoryForSession(input: { modality: 'presencial' | 'online'; locationType?: PsychologyLocationType }): PsychologyAgendaCategory {
  if (input.modality === 'online') return 'ONLINE';
  return input.locationType === 'EXTERNAL_OFFICE' ? 'EXTERNAL_OFFICE' : 'PRESENTIAL_PRIMARY';
}

export function colorForAgendaCategory(colors: PsychologyColorRegistry, category: PsychologyAgendaCategory): string {
  const fallback = PSYCHOLOGY_COLOR_DEFAULTS[category];
  const color = normalizePsychologyColor(colors[category], fallback);
  return category === 'MENTORING'
    && color === normalizePsychologyColor(colors.ONLINE, PSYCHOLOGY_COLOR_DEFAULTS.ONLINE)
    ? fallback
    : color;
}

export function locationForSession(settings: PsychologySettings, session: { modality: 'presencial' | 'online'; locationId?: string; locationType?: PsychologyLocationType }): PsychologyLocation | undefined {
  if (session.modality === 'online') return undefined;
  return settings.locations.find(location => location.id === session.locationId)
    || settings.locations.find(location => location.type === (session.locationType || 'PRIMARY_OFFICE') && location.active)
    || settings.locations.find(location => location.isPrimary && location.active);
}

export function colorForPsychologyLocation(location: PsychologyLocation | undefined): string {
  if (!location) return PSYCHOLOGY_COLOR_DEFAULTS.PRESENTIAL_PRIMARY;
  const fallback = location.type === 'EXTERNAL_OFFICE'
    ? PSYCHOLOGY_COLOR_DEFAULTS.EXTERNAL_OFFICE
    : PSYCHOLOGY_COLOR_DEFAULTS.PRESENTIAL_PRIMARY;
  return normalizePsychologyColor(location.color, fallback);
}

export type PsychologyAgendaEventSource = 'SESSION' | 'PERSONAL_AGENDA' | 'MENTORING';
/** @deprecated Kept as a read-compatible alias; PERSONAL is the canonical setting. */
export const PSYCHOLOGY_PERSONAL_AGENDA_OVERLAY_COLOR = PSYCHOLOGY_COLOR_DEFAULTS.PERSONAL;

export interface PsychologyAgendaColorTokens {
  baseColor: string;
  softBackground: string;
  softBorder: string;
  strongText: string;
  chipStyle: {
    backgroundColor: string;
    borderColor: string;
    color: string;
  };
}

export interface PsychologyAgendaEventStyle {
  baseColor: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  cancelled: boolean;
  therapyCouple: boolean;
  chipStyle: PsychologyAgendaColorTokens['chipStyle'];
}

function psychologyAgendaServiceKey(value: string | undefined): string {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toLocaleLowerCase();
}

export function isPsychologyTherapyCoupleService(serviceName: string | undefined): boolean {
  const key = psychologyAgendaServiceKey(serviceName);
  return key === 'terapiadecasal' || key.startsWith('terapiadecasal');
}

export function isPsychologyMentoringService(serviceName: string | undefined): boolean {
  const key = psychologyAgendaServiceKey(serviceName);
  return key.includes('mentoria') || key.includes('mentoring');
}

function hexColor(value: string): [number, number, number] {
  const normalized = value.replace('#', '');
  return [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16)) as [number, number, number];
}

function mixPsychologyColor(hex: string, target: string, amount: number): string {
  const sourceRgb = hexColor(hex);
  const targetRgb = hexColor(target);
  return `#${sourceRgb.map((channelValue, index) => Math.round(channelValue + (targetRgb[index] - channelValue) * amount).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function psychologyStrongAgendaText(baseColor: string, softBackground: string): string {
  if (contrastRatio(baseColor, softBackground) >= 4.5) return baseColor;
  for (let amount = 0.1; amount <= 0.9; amount += 0.1) {
    const candidate = mixPsychologyColor(baseColor, '#000000', amount);
    if (contrastRatio(candidate, softBackground) >= 4.5) return candidate;
  }
  return '#1F2937';
}

export function derivePsychologyAgendaColorTokens(baseColor: string): PsychologyAgendaColorTokens {
  const safeBaseColor = normalizePsychologyColor(baseColor, PSYCHOLOGY_COLOR_DEFAULTS.PRESENTIAL_PRIMARY);
  const softBackground = mixPsychologyColor(safeBaseColor, '#FFFFFF', 0.88);
  const softBorder = mixPsychologyColor(safeBaseColor, '#FFFFFF', 0.58);
  const strongText = psychologyStrongAgendaText(safeBaseColor, softBackground);
  return {
    baseColor: safeBaseColor,
    softBackground,
    softBorder,
    strongText,
    chipStyle: { backgroundColor: softBackground, borderColor: softBorder, color: strongText },
  };
}

export function resolvePsychologyAgendaEventStyle(input: {
  source: PsychologyAgendaEventSource;
  colors: PsychologyColorRegistry;
  category?: PsychologyAgendaCategory;
  modality?: 'presencial' | 'online';
  location?: PsychologyLocation;
  serviceName?: string;
  cancelled?: boolean;
}): PsychologyAgendaEventStyle {
  const therapyCouple = isPsychologyTherapyCoupleService(input.serviceName);
  const mentoringService = isPsychologyMentoringService(input.serviceName);
  const category: PsychologyAgendaCategory = input.category || (input.source === 'PERSONAL_AGENDA'
    ? 'PERSONAL'
    : input.source === 'MENTORING'
      ? 'MENTORING'
      : mentoringService
        ? 'MENTORING'
      : agendaCategoryForSession({ modality: input.modality || 'presencial', locationType: input.location?.type }));
  const baseColor = therapyCouple && category !== 'MENTORING' ? '#EAB308' : colorForAgendaCategory(input.colors, category);
  const tokens = derivePsychologyAgendaColorTokens(baseColor);
  const cancelled = Boolean(input.cancelled);
  return {
    baseColor: tokens.baseColor,
    backgroundColor: cancelled ? '#FFFFFF' : tokens.softBackground,
    borderColor: tokens.softBorder,
    textColor: tokens.strongText,
    cancelled,
    therapyCouple,
    chipStyle: cancelled ? { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', color: '#475569' } : tokens.chipStyle,
  };
}

export function isPsychologyChargeOverdue(charge: Pick<PsychologyCharge, 'status' | 'dueDate'>, today: string): boolean {
  return !['paid', 'exempt', 'canceled', 'cancelled'].includes(charge.status) && Boolean(charge.dueDate) && charge.dueDate! < today;
}
