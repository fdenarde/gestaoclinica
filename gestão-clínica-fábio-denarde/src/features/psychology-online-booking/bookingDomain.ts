import type {
  BookingBlock,
  PublicAppointment,
  PublicBookingAvailabilityPeriod,
  PublicBookingDayAvailability,
  PublicBookingException,
  PublicBookingExceptionType,
  PublicBookingLocation,
  PublicBookingModality,
  PublicBookingService,
  PublicBookingSettings,
  PublicBookingSlot,
  PublicBookingSourceChannel,
  PublicAppointmentMessagingContext,
  PublicAppointmentSummary,
} from './types';
import { PSYCHOLOGY_SERVICE_CATALOG, canonicalPsychologyServiceId, psychologyCatalogEntry } from '../psychology-pilot/psychologyServiceCatalog';

export const LOCAL_ONLINE_BOOKING_STORAGE_KEY = 'gestao-clinica:psychology-r2e1:online-booking:v1';
export const LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID = 'psychology-local-professional';
export const LOCAL_ONLINE_BOOKING_DEFAULT_SLUG = 'leila-chaves';
export const DEFAULT_MANAGEMENT_TOKEN_TTL_DAYS = 180;
export const PUBLIC_BOOKING_START_GRID_MINUTES = 60;

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
};

export function publicBookingWeekdayLabel(dayOfWeek: number): string {
  return WEEKDAY_LABELS[dayOfWeek] || 'Dia';
}

export function normalizeProfessionalSlug(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function normalizeSourceChannel(value: unknown): PublicBookingSourceChannel {
  const normalized = String(value || '').trim().toLocaleLowerCase();
  return normalized === 'google' || normalized === 'whatsapp' || normalized === 'site' || normalized === 'direct'
    ? normalized
    : 'direct';
}

export function serviceAllowsModality(service: Pick<PublicBookingService, 'onlineEnabled' | 'inPersonEnabled' | 'modalities'>, modality: PublicBookingModality): boolean {
  if (modality === 'ONLINE') return service.onlineEnabled ?? Boolean(service.modalities?.includes('ONLINE'));
  return service.inPersonEnabled ?? Boolean(service.modalities?.includes('PRESENCIAL'));
}

export function isValidGoogleMapsUrl(value: string): boolean {
  const candidate = String(value || '').trim();
  if (!candidate) return true;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && (parsed.hostname === 'www.google.com' || parsed.hostname === 'google.com' || parsed.hostname === 'maps.google.com' || parsed.hostname === 'maps.app.goo.gl' || parsed.hostname === 'goo.gl');
  } catch {
    return false;
  }
}

export const LOCATION_REMINDER_INCOMPLETE_MESSAGE = 'Complete o endereço e o Google Maps para utilizar este local nos lembretes.';

export function isLocationReadyForReminder(location: Pick<PublicBookingLocation, 'displayName' | 'fullAddress' | 'googleMapsUrl'> & Partial<Pick<PublicBookingLocation, 'address'>>): boolean {
  const address = location.fullAddress || location.address || '';
  return Boolean(location.displayName.trim() && address.trim() && location.googleMapsUrl.trim() && isValidGoogleMapsUrl(location.googleMapsUrl));
}

export function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : -1;
}

export function minutesToTime(value: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export function dateToLocalDateTime(date: string, time: string): Date | null {
  if (!isValidIsoDate(date) || timeToMinutes(time) < 0) return null;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

function overlaps(startTime: string, durationMinutes: number, block: BookingBlock): boolean {
  const start = timeToMinutes(startTime);
  const end = start + durationMinutes;
  const blockStart = timeToMinutes(block.startTime);
  const blockEnd = blockStart + Math.max(1, block.durationMinutes);
  return start < blockEnd && blockStart < end;
}

function exceptionApplies(exception: PublicBookingException, modality: PublicBookingModality, locationId?: string): boolean {
  return (!exception.modality || exception.modality === modality) && (!exception.locationId || exception.locationId === locationId);
}

function exceptionRange(exception: PublicBookingException): { start: number; end: number } | null {
  const start = timeToMinutes(exception.startTime || '');
  const end = timeToMinutes(exception.endTime || '');
  return start >= 0 && end > start ? { start, end } : null;
}

export type PublicBookingAgendaMarkerKind = 'NONE' | 'BLOCK_DAY' | 'BLOCK_PERIOD' | 'OPEN_PERIOD';

export interface PublicBookingAgendaMarker {
  kind: PublicBookingAgendaMarkerKind;
  exception?: PublicBookingException;
}

export function getPublicBookingAgendaMarker(settings: PublicBookingSettings, date: string, startTime: string, endTime: string): PublicBookingAgendaMarker {
  const exceptions = settings.publicBookingExceptions.filter(exception => exception.civilDate === date);
  const blockDay = exceptions.find(exception => exception.type === 'BLOCK_DAY');
  if (blockDay) return { kind: 'BLOCK_DAY', exception: blockDay };
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start < 0 || end <= start) return { kind: 'NONE' };
  const blockPeriod = exceptions.find(exception => {
    const range = exceptionRange(exception);
    return exception.type === 'BLOCK_PERIOD' && range && start < range.end && range.start < end;
  });
  if (blockPeriod) return { kind: 'BLOCK_PERIOD', exception: blockPeriod };
  const openPeriod = exceptions.find(exception => {
    const range = exceptionRange(exception);
    return exception.type === 'OPEN_PERIOD' && range && start < range.end && range.start < end;
  });
  return openPeriod ? { kind: 'OPEN_PERIOD', exception: openPeriod } : { kind: 'NONE' };
}

export interface CreatePublicBookingExceptionInput {
  professionalId: string;
  civilDate: string;
  type: PublicBookingExceptionType;
  startTime?: string;
  endTime?: string;
  modality?: PublicBookingModality;
  locationId?: string;
  note?: string;
  id?: string;
  now?: Date;
}

export function createPublicBookingException(input: CreatePublicBookingExceptionInput): PublicBookingException {
  const now = input.now || new Date();
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: input.id || `public-exception-${Date.now().toString(36)}-${suffix}`,
    professionalId: input.professionalId,
    civilDate: input.civilDate,
    type: input.type,
    startTime: input.type === 'BLOCK_DAY' ? undefined : input.startTime,
    endTime: input.type === 'BLOCK_DAY' ? undefined : input.endTime,
    modality: input.modality,
    locationId: input.locationId,
    note: input.note,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

interface EffectivePublicPeriod {
  start: number;
  end: number;
  extra: boolean;
}

function subtractBlockedPeriods(period: EffectivePublicPeriod, blocked: Array<{ start: number; end: number }>): EffectivePublicPeriod[] {
  let remaining: EffectivePublicPeriod[] = [period];
  blocked.forEach(block => {
    remaining = remaining.flatMap(item => {
      if (block.end <= item.start || block.start >= item.end) return [item];
      const pieces: EffectivePublicPeriod[] = [];
      if (item.start < block.start) pieces.push({ ...item, end: block.start });
      if (block.end < item.end) pieces.push({ ...item, start: block.end });
      return pieces.filter(piece => piece.end > piece.start);
    });
  });
  return remaining;
}

function effectivePublicPeriods(settings: PublicBookingSettings, date: string, modality: PublicBookingModality, locationId?: string): EffectivePublicPeriod[] {
  const exceptions = settings.publicBookingExceptions.filter(exception => exception.civilDate === date && exceptionApplies(exception, modality, locationId));
  if (exceptions.some(exception => exception.type === 'BLOCK_DAY')) return [];
  const habitual: EffectivePublicPeriod[] = settings.publicBookingAvailability
    .filter(period => period.enabled && period.dayOfWeek === weekdayOf(date) && period.modalities.includes(modality) && (modality === 'ONLINE' || !period.locationIds?.length || Boolean(locationId && period.locationIds.includes(locationId))))
    .map(period => ({ start: timeToMinutes(period.startTime), end: timeToMinutes(period.endTime), extra: false }))
    .filter(period => period.start >= 0 && period.end > period.start);
  const extras: EffectivePublicPeriod[] = exceptions
    .filter(exception => exception.type === 'OPEN_PERIOD')
    .map(exception => exceptionRange(exception))
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .map(range => ({ ...range, extra: true }));
  const blocked = exceptions
    .filter(exception => exception.type === 'BLOCK_PERIOD')
    .map(exception => exceptionRange(exception))
    .filter((range): range is { start: number; end: number } => Boolean(range));
  return [...habitual, ...extras].flatMap(period => subtractBlockedPeriods(period, blocked));
}

export function getPublishedSlots(input: {
  settings: PublicBookingSettings;
  serviceId: string;
  modality: PublicBookingModality;
  locationId?: string;
  fromDate: string;
  throughDate: string;
  now?: Date;
  existingBlocks?: readonly BookingBlock[];
  holds?: readonly BookingBlock[];
}): PublicBookingSlot[] {
  const { settings } = input;
  const service = settings.publishedServices.find(item => item.id === input.serviceId && item.active);
  const location = input.modality === 'PRESENCIAL' ? settings.locations.find(item => item.id === input.locationId && item.active) : undefined;
  if (!settings.active || !service || !serviceAllowsModality(service, input.modality) || !settings.publishedModalities.some(item => item.id === input.modality && item.active)) return [];
  if (input.modality === 'PRESENCIAL' && (!location || !service.allowedLocationIds.includes(location.id))) return [];
  if (!isValidIsoDate(input.fromDate) || !isValidIsoDate(input.throughDate)) return [];
  const startDate = new Date(`${input.fromDate}T12:00:00`);
  const endDate = new Date(`${input.throughDate}T12:00:00`);
  if (startDate > endDate) return [];
  const now = input.now || new Date();
  const earliest = new Date(now.getTime() + settings.minNoticeHours * 60 * 60 * 1000);
  const latest = new Date(now.getTime() + Math.min(90, settings.maxAdvanceDays) * 24 * 60 * 60 * 1000);
  const blocks = [...(input.existingBlocks || []), ...(input.holds || [])];
  const slots: PublicBookingSlot[] = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatDateKey(cursor);
    const dayStart = new Date(`${date}T00:00:00`);
    if (dayStart > latest) continue;
    const publicPeriods = effectivePublicPeriods(settings, date, input.modality, input.locationId);
    for (const period of publicPeriods) {
      const firstPublicStart = Math.ceil(period.start / PUBLIC_BOOKING_START_GRID_MINUTES) * PUBLIC_BOOKING_START_GRID_MINUTES;
      for (let minute = firstPublicStart; minute + service.durationMinutes <= period.end; minute += PUBLIC_BOOKING_START_GRID_MINUTES) {
        const time = minutesToTime(minute);
        const dateTime = dateToLocalDateTime(date, time);
        if (!dateTime || dateTime < earliest || dateTime > latest) continue;
        if (minute % PUBLIC_BOOKING_START_GRID_MINUTES !== 0) continue;
        if (blocks.some(block => block.date === date && overlaps(time, service.durationMinutes, block))) continue;
        slots.push({ date, time, endTime: minutesToTime(minute + service.durationMinutes), durationMinutes: service.durationMinutes, serviceId: service.id, modality: input.modality, locationId: input.locationId });
      }
    }
  }
  return slots.filter((slot, index, all) => all.findIndex(item => item.date === slot.date && item.time === slot.time && item.modality === slot.modality && item.locationId === slot.locationId) === index);
}

function createRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Web Crypto indisponível para gerar o link seguro.');
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  const encoded = typeof btoa === 'function' ? btoa(binary) : '';
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createManagementToken(): string {
  return bytesToBase64Url(createRandomBytes(32));
}

/** Capability opaque and independent from the consultation management token. */
export function createMapsNavigationRef(): string {
  return `maps_${bytesToBase64Url(createRandomBytes(32))}`;
}

export async function hashManagementToken(token: string): Promise<string> {
  if (!token || !globalThis.crypto?.subtle) throw new Error('Web Crypto indisponível para validar o link seguro.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function hashMapsNavigationRef(ref: string): Promise<string> {
  if (!ref || !globalThis.crypto?.subtle) throw new Error('Web Crypto indisponível para validar a navegação do mapa.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(ref));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export function getAppointmentManagementUrl(appointmentId: string, managementToken: string): string {
  if (!appointmentId || !managementToken) throw new Error('O link de gerenciamento exige appointmentId e token bruto temporário.');
  const path = `/consulta/${encodeURIComponent(managementToken)}`;
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

export function getMapsNavigationUrl(navigationRef: string): string {
  if (!navigationRef) throw new Error('A navegação do mapa exige uma capability válida.');
  const path = `/maps/${encodeURIComponent(navigationRef)}`;
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

export function buildRescheduleRequestMessage(summary: Pick<import('./types').PublicAppointmentSummary, 'professionalName' | 'date' | 'time'>): string {
  const date = summary.date.split('-').reverse().join('/');
  return `Olá, preciso reagendar meu atendimento com ${summary.professionalName}, atualmente marcado para ${date} às ${summary.time}. Poderia me informar outros horários disponíveis?`;
}

export function buildAppointmentMessagingContext(summary: Pick<PublicAppointmentSummary, 'modality' | 'professionalName' | 'date' | 'time' | 'locationName' | 'locationAddress' | 'googleMapsUrl' | 'mapsNavigationUrl'>): PublicAppointmentMessagingContext {
  const base = {
    appointmentModality: summary.modality,
    professionalDisplayName: summary.professionalName,
    date: summary.date,
    time: summary.time,
  };
  return summary.modality === 'PRESENCIAL'
    ? { ...base, locationDisplayName: summary.locationName, locationFullAddress: summary.locationAddress, locationGoogleMapsUrl: summary.googleMapsUrl, mapsNavigationUrl: summary.mapsNavigationUrl }
    : base;
}

export function buildWhatsAppRescheduleUrl(phoneE164: string, message: string): string | null {
  const phone = String(phoneE164 || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function createDefaultPublicBookingSettings(now = new Date()): PublicBookingSettings {
  const updatedAt = now.toISOString();
  const weekdays = [1, 2, 3, 4, 5];
  const weeklyAvailability = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: weekdays.includes(dayOfWeek),
    periods: weekdays.includes(dayOfWeek) ? [{ startTime: '09:00', endTime: '18:00' }] : [],
  }));
  const locations: PublicBookingLocation[] = [{
    id: 'psychology-location-primary-office',
    professionalId: LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID,
    displayName: 'Shopping Moxuara',
    fullAddress: '',
    city: 'Cariacica',
    state: 'ES',
    googleMapsUrl: '',
    active: true,
    sortOrder: 1,
  }, {
    id: 'psychology-location-external-office',
    professionalId: LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID,
    displayName: 'SPAC — Centro de Saúde e Movimento',
    fullAddress: '',
    city: 'Vila Velha',
    state: 'ES',
    googleMapsUrl: '',
    active: true,
    sortOrder: 2,
  }];
  const allowedLocationIds = locations.map(location => location.id);
  const services: PublicBookingService[] = PSYCHOLOGY_SERVICE_CATALOG.map(entry => ({
    id: entry.id,
    name: entry.name,
    durationMinutes: entry.defaultDurationMinutes,
    active: true,
    sortOrder: entry.sortOrder,
    onlineEnabled: entry.modality !== 'PRESENTIAL',
    inPersonEnabled: entry.modality !== 'ONLINE',
    allowedLocationIds,
  }));
  const publicBookingAvailability = weekdays.map(dayOfWeek => ({
    dayOfWeek,
    enabled: true,
    startTime: '10:00',
    endTime: '17:00',
    modalities: ['ONLINE', 'PRESENCIAL'] as PublicBookingModality[],
    locationIds: allowedLocationIds,
  }));
  return {
    id: 'online-booking',
    context: 'PSICOLOGIA',
    professionalId: LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID,
    professionalSlug: LOCAL_ONLINE_BOOKING_DEFAULT_SLUG,
    professionalName: 'Leila Chaves',
    clinicDisplayName: 'Gestão Clínica',
    timezone: 'America/Sao_Paulo',
    active: true,
    maxAdvanceDays: 21,
    minNoticeHours: 24,
    cancellationEnabled: true,
    cancellationCutoffHours: 16,
    whatsappContactPhoneE164: '552799529638',
    slotIntervalMinutes: 30,
    weeklyAvailability,
    publicBookingAvailability,
    publicBookingExceptions: [],
    publishedServices: services,
    publishedModalities: [
      { id: 'ONLINE', label: 'Online', active: true },
      { id: 'PRESENCIAL', label: 'Presencial', active: true },
    ],
    locations,
    updatedAt,
  };
}

export function normalizePublicBookingSettings(value: unknown, now = new Date()): PublicBookingSettings {
  const fallback = createDefaultPublicBookingSettings(now);
  const input = value && typeof value === 'object' ? value as Partial<PublicBookingSettings> : {};
  const professionalSlug = normalizeProfessionalSlug(String(input.professionalSlug || fallback.professionalSlug)) || fallback.professionalSlug;
  const maxAdvanceDays = Math.max(1, Math.min(90, Number(input.maxAdvanceDays) || fallback.maxAdvanceDays));
  const minNoticeHours = Math.max(0, Math.min(168, Number(input.minNoticeHours) || 0));
  const cancellationCutoffHours = Math.max(0, Math.min(168, Number(input.cancellationCutoffHours) || 0));
  const slotIntervalMinutes = Math.max(5, Math.min(180, Number(input.slotIntervalMinutes) || fallback.slotIntervalMinutes));
  const rawServices = Array.isArray(input.publishedServices) ? input.publishedServices as Array<Partial<PublicBookingService> & { modalities?: PublicBookingModality[] }> : [];
  const migrateLegacyServices = rawServices.length === 1 && ['psychotherapy-individual', 'psychology-service-psychotherapy'].includes(String(rawServices[0].id || '')) && !('onlineEnabled' in rawServices[0]);
  const activeLocationIds = fallback.locations.map(location => location.id);
  const rawLocations = Array.isArray(input.locations) ? input.locations as Array<Partial<PublicBookingLocation> & { name?: string; address?: string }> : [];
  const migrateLegacyLocations = rawLocations.length === 1 && rawLocations[0].id === 'consultorio-gestao-clinica' && !('fullAddress' in rawLocations[0]);
  const legacyLocationIdMap: Record<string, string> = {
    'location-shopping-moxuara': 'psychology-location-primary-office',
    'location-spac-centro-saude-movimento': 'psychology-location-external-office',
  };
  const locations = (migrateLegacyLocations || !rawLocations.length ? fallback.locations : rawLocations.map((item, index) => ({
    id: legacyLocationIdMap[String(item.id || '')] || String(item.id || `location-${index + 1}`),
    professionalId: fallback.professionalId,
    displayName: String(item.displayName || item.name || `Local ${index + 1}`).trim() || `Local ${index + 1}`,
    fullAddress: String(item.fullAddress ?? item.address ?? '').trim(),
    city: String(item.city || '').trim(),
    state: String(item.state || '').trim().toUpperCase(),
    googleMapsUrl: isValidGoogleMapsUrl(String(item.googleMapsUrl || '').trim()) ? String(item.googleMapsUrl || '').trim() : '',
    active: item.active !== false,
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index + 1,
  }))).sort((a, b) => a.sortOrder - b.sortOrder);
  const locationIds = locations.map(location => location.id);
  const services = (migrateLegacyServices || !rawServices.length ? fallback.publishedServices : rawServices.map((item, index) => {
    const legacyModalities = Array.isArray(item.modalities) ? item.modalities : [];
    const id = canonicalPsychologyServiceId(item.id || `public-service-${index + 1}`);
    const catalogEntry = psychologyCatalogEntry(id);
    return {
      id,
      name: catalogEntry?.name || String(item.name || `Atendimento ${index + 1}`).trim() || `Atendimento ${index + 1}`,
      durationMinutes: Math.max(5, Number(item.durationMinutes) || catalogEntry?.defaultDurationMinutes || 50),
      active: item.active !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index + 1,
      onlineEnabled: item.onlineEnabled ?? legacyModalities.includes('ONLINE'),
      inPersonEnabled: item.inPersonEnabled ?? legacyModalities.includes('PRESENCIAL'),
      allowedLocationIds: Array.isArray(item.allowedLocationIds) && item.allowedLocationIds.length
        ? (item.allowedLocationIds.map(id => legacyLocationIdMap[String(id)] || String(id)).filter(id => locationIds.includes(id)).length
          ? item.allowedLocationIds.map(id => legacyLocationIdMap[String(id)] || String(id)).filter(id => locationIds.includes(id))
          : locationIds)
        : locationIds,
    } satisfies PublicBookingService;
  })).sort((a, b) => a.sortOrder - b.sortOrder);
  const rawAvailability = Array.isArray(input.publicBookingAvailability) ? input.publicBookingAvailability as PublicBookingAvailabilityPeriod[] : fallback.publicBookingAvailability;
  const fallbackPublicModalities = fallback.publishedModalities.filter(item => item.active).map(item => item.id);
  const publicBookingAvailability = rawAvailability.map(period => ({
    ...period,
    modalities: Array.isArray(period.modalities) ? period.modalities : fallbackPublicModalities,
    locationIds: period.locationIds?.some(id => locationIds.includes(id)) ? period.locationIds.filter(id => locationIds.includes(id)) : locationIds,
  }));
  const rawExceptions = Array.isArray(input.publicBookingExceptions) ? input.publicBookingExceptions as Array<Partial<PublicBookingException>> : [];
  const publicBookingExceptions: PublicBookingException[] = rawExceptions.flatMap((item, index) => {
    const type = item.type === 'BLOCK_DAY' || item.type === 'BLOCK_PERIOD' || item.type === 'OPEN_PERIOD' ? item.type : null;
    const civilDate = String(item.civilDate || '').trim();
    const startTime = item.startTime ? String(item.startTime).trim() : undefined;
    const endTime = item.endTime ? String(item.endTime).trim() : undefined;
    const rangeIsValid = type === 'BLOCK_DAY' || (timeToMinutes(startTime || '') >= 0 && timeToMinutes(endTime || '') > timeToMinutes(startTime || ''));
    if (!type || !isValidIsoDate(civilDate) || !rangeIsValid) return [];
    return [{
      id: String(item.id || `public-exception-${index + 1}`),
      professionalId: fallback.professionalId,
      civilDate,
      type,
      startTime,
      endTime,
      modality: item.modality === 'ONLINE' || item.modality === 'PRESENCIAL' ? item.modality : undefined,
      locationId: item.locationId && locationIds.includes(item.locationId) ? item.locationId : undefined,
      note: String(item.note || '').trim() || undefined,
      createdAt: String(item.createdAt || now.toISOString()),
      updatedAt: String(item.updatedAt || now.toISOString()),
    }];
  });
  return {
    ...fallback,
    ...clone(input),
    id: 'online-booking',
    context: 'PSICOLOGIA',
    professionalId: fallback.professionalId,
    professionalSlug,
    professionalName: String(input.professionalName || fallback.professionalName).trim() || fallback.professionalName,
    clinicDisplayName: String(input.clinicDisplayName || fallback.clinicDisplayName).trim() || fallback.clinicDisplayName,
    active: input.active !== false,
    maxAdvanceDays,
    minNoticeHours: Number.isFinite(Number(input.minNoticeHours)) ? Math.max(0, Math.min(168, Number(input.minNoticeHours))) : fallback.minNoticeHours,
    cancellationEnabled: input.cancellationEnabled !== false,
    cancellationCutoffHours: Number.isFinite(Number(input.cancellationCutoffHours)) ? cancellationCutoffHours : fallback.cancellationCutoffHours,
    whatsappContactPhoneE164: String(input.whatsappContactPhoneE164 || fallback.whatsappContactPhoneE164) === '5527999990000'
      ? fallback.whatsappContactPhoneE164
      : String(input.whatsappContactPhoneE164 || fallback.whatsappContactPhoneE164).replace(/\D/g, '').slice(0, 15),
    slotIntervalMinutes,
    weeklyAvailability: Array.isArray(input.weeklyAvailability) ? input.weeklyAvailability as PublicBookingDayAvailability[] : fallback.weeklyAvailability,
    publicBookingAvailability,
    publicBookingExceptions,
    publishedServices: services,
    publishedModalities: Array.isArray(input.publishedModalities) ? input.publishedModalities as PublicBookingSettings['publishedModalities'] : fallback.publishedModalities,
    locations,
    updatedAt: String(input.updatedAt || now.toISOString()),
  };
}

export function appointmentIsActive(appointment: Pick<PublicAppointment, 'appointmentStatus'>): boolean {
  return appointment.appointmentStatus !== 'CANCELLED_BY_PATIENT';
}
