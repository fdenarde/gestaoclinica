import {
  addDaysToDateKey,
  appointmentIsActive,
  buildAppointmentMessagingContext,
  buildRescheduleRequestMessage,
  buildWhatsAppRescheduleUrl,
  createDefaultPublicBookingSettings,
  createMapsNavigationRef,
  createManagementToken,
  dateToLocalDateTime,
  DEFAULT_MANAGEMENT_TOKEN_TTL_DAYS,
  getAppointmentManagementUrl,
  getMapsNavigationUrl,
  getPublishedSlots,
  hashManagementToken,
  hashMapsNavigationRef,
  isValidGoogleMapsUrl,
  LOCAL_ONLINE_BOOKING_STORAGE_KEY,
  normalizePublicBookingSettings,
  normalizeSourceChannel,
  serviceAllowsModality,
} from './bookingDomain';
import type {
  BookingBlock,
  LocalOnlineBookingState,
  ManagementActionResult,
  PublicAppointment,
  PublicAppointmentSummary,
  PublicBookingRepository,
  PublicBookingRequest,
  PublicBookingSettings,
  MapsNavigationResult,
  RescheduleRequestResult,
} from './types';
import {
  createPsychologyScope,
  LOCAL_PSYCHOLOGY_PROFESSIONAL_ID,
  LOCAL_PSYCHOLOGY_STORAGE_KEY,
  parsePsychologyStore,
  serializePsychologyStore,
  upsertPsychologyPatient,
  upsertPsychologySession,
  updatePsychologySessionStatus,
  type PsychologyStore,
} from '../psychology-pilot/psychologyDomain';
import { validatePsychologyPatientAdministrativeInput } from '../../lib/psychologyPatientAdministrative';
import { normalizePhone, normalizePhoneForComparison } from '../../../shared/phoneNormalization.js';

export interface OnlineBookingStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LocalPublicBookingRepositoryOptions {
  storage: OnlineBookingStorageLike;
  now?: () => Date;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(8)), item => item.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function readState(storage: OnlineBookingStorageLike, now: Date): LocalOnlineBookingState {
  const raw = storage.getItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY);
  const canonicalStore = readCanonicalLocalStore(storage);
  if (!raw) return { schemaVersion: 1, settings: syncPublicServicesFromCanonical(syncPublicLocationsFromCanonical(createDefaultPublicBookingSettings(now), canonicalStore), canonicalStore), appointments: [], holds: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalOnlineBookingState>;
    return {
      schemaVersion: 1,
      settings: syncPublicServicesFromCanonical(syncPublicLocationsFromCanonical(normalizePublicBookingSettings(parsed.settings, now), canonicalStore), canonicalStore),
      appointments: Array.isArray(parsed.appointments) ? (parsed.appointments as PublicAppointment[]).map(appointment => ({ ...appointment, serviceId: appointment.serviceId === 'psychology-service-psychotherapy' ? 'psychotherapy-individual' : appointment.serviceId })) : [],
      holds: Array.isArray(parsed.holds) ? parsed.holds : [],
    };
  } catch {
    return { schemaVersion: 1, settings: syncPublicServicesFromCanonical(syncPublicLocationsFromCanonical(createDefaultPublicBookingSettings(now), canonicalStore), canonicalStore), appointments: [], holds: [] };
  }
}

function writeState(storage: OnlineBookingStorageLike, state: LocalOnlineBookingState): void {
  storage.setItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY, JSON.stringify(state));
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLocaleLowerCase();
}

function readCanonicalLocalStore(storage: OnlineBookingStorageLike): PsychologyStore {
  const raw = storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`);
  return parsePsychologyStore(raw, createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
}

function writeCanonicalLocalStore(storage: OnlineBookingStorageLike, store: PsychologyStore): void {
  storage.setItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`, serializePsychologyStore(store));
}

function syncPublicLocationsFromCanonical(settings: PublicBookingSettings, canonicalStore: PsychologyStore): PublicBookingSettings {
  return {
    ...settings,
    locations: settings.locations.map((location, index) => {
      const source = canonicalStore.locations.find(item => item.id === location.id)
        || canonicalStore.locations.find(item => item.displayName.trim().toLocaleLowerCase() === location.displayName.trim().toLocaleLowerCase());
      if (!source) return location;
      return {
        ...location,
        id: source.id,
        professionalId: source.professionalId,
        displayName: source.displayName,
        fullAddress: source.fullAddress || source.address || '',
        city: source.city || location.city,
        state: source.state || location.state,
        googleMapsUrl: source.googleMapsUrl || '',
        active: source.active,
        sortOrder: source.sortOrder || index + 1,
      };
    }),
  };
}

function syncPublicServicesFromCanonical(settings: PublicBookingSettings, canonicalStore: PsychologyStore): PublicBookingSettings {
  const activeLocationIds = canonicalStore.locations.filter(location => location.active).map(location => location.id);
  const existingById = new Map(settings.publishedServices.map(service => [service.id, service]));
  const canonicalIds = new Set(canonicalStore.services.map(service => service.id));
  const services = canonicalStore.services.map((service, index) => {
    const existing = existingById.get(service.id);
    const publication = service.publicBooking;
    return {
      id: service.id,
      name: service.name,
      durationMinutes: service.defaultDurationMinutes,
      active: publication?.active ?? existing?.active ?? false,
      sortOrder: publication?.sortOrder || existing?.sortOrder || index + 1,
      onlineEnabled: publication?.onlineEnabled ?? existing?.onlineEnabled ?? service.modality !== 'PRESENTIAL',
      inPersonEnabled: publication?.inPersonEnabled ?? existing?.inPersonEnabled ?? service.modality !== 'ONLINE',
      allowedLocationIds: (publication?.allowedLocationIds || existing?.allowedLocationIds || activeLocationIds).filter(id => canonicalStore.locations.some(location => location.id === id)),
    };
  });
  const legacyServices = settings.publishedServices
    .filter(service => !canonicalIds.has(service.id))
    .map(service => ({ ...service, active: false }));
  return { ...settings, publishedServices: [...services, ...legacyServices] };
}

function syncCanonicalServicesFromPublic(storage: OnlineBookingStorageLike, publicServices: PublicBookingSettings['publishedServices'], now: string): void {
  const store = readCanonicalLocalStore(storage);
  const publicById = new Map(publicServices.map(service => [service.id, service]));
  const services = store.services.map(service => {
    const published = publicById.get(service.id);
    if (!published) return service;
    return {
      ...service,
      publicBooking: {
        active: published.active,
        onlineEnabled: published.onlineEnabled,
        inPersonEnabled: published.inPersonEnabled,
        allowedLocationIds: [...published.allowedLocationIds],
        sortOrder: Math.max(1, published.sortOrder),
      },
      updatedAt: now,
    };
  });
  writeCanonicalLocalStore(storage, { ...store, services, settings: { ...store.settings, services, updatedAt: now } });
}

function syncCanonicalLocationsFromPublic(storage: OnlineBookingStorageLike, publicLocations: PublicBookingSettings['locations'], now: string): void {
  const store = readCanonicalLocalStore(storage);
  const locations = publicLocations.map((location, index) => {
    const existing = store.locations.find(item => item.id === location.id)
      || store.locations.find(item => item.displayName.trim().toLocaleLowerCase() === location.displayName.trim().toLocaleLowerCase());
    return {
      id: existing?.id || location.id,
      professionalId: store.scope.professionalId,
      context: 'PSICOLOGIA' as const,
      type: existing?.type || (index === 0 ? 'PRIMARY_OFFICE' : 'EXTERNAL_OFFICE'),
      displayName: location.displayName,
      address: location.fullAddress,
      fullAddress: location.fullAddress,
      city: location.city,
      state: location.state,
      googleMapsUrl: location.googleMapsUrl,
      active: location.active,
      isPrimary: existing?.isPrimary ?? index === 0,
      color: existing?.color || store.settings.colors.PRESENTIAL_PRIMARY,
      colorKey: existing?.colorKey || (index === 0 ? 'PRESENTIAL_PRIMARY' : 'EXTERNAL_OFFICE'),
      sortOrder: location.sortOrder,
      externalReferences: existing?.externalReferences,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  });
  const publicIds = new Set(locations.map(location => location.id));
  const preserved = store.locations.filter(location => !publicIds.has(location.id));
  const nextLocations = [...locations, ...preserved];
  writeCanonicalLocalStore(storage, { ...store, locations: nextLocations, settings: { ...store.settings, locations: nextLocations, updatedAt: now } });
}

function getLocalAgendaBlocks(storage: OnlineBookingStorageLike): BookingBlock[] {
  const store = readCanonicalLocalStore(storage);
  const blocks: BookingBlock[] = store.sessions
    .filter(session => session.status !== 'cancelada')
    .map(session => ({ date: session.date, startTime: session.time, durationMinutes: session.durationMinutes, source: 'session' as const }));
  store.personalCommitments.forEach(commitment => {
    const duration = Math.max(1, commitment.durationMinutes || 60);
    const startDate = commitment.date;
    for (let offset = 0; offset <= 90; offset += 1) {
      const date = addDaysToDateKey(startDate, offset);
      const dayMatches = commitment.recurrence === 'Toda semana'
        ? new Date(`${date}T12:00:00`).getDay() === new Date(`${startDate}T12:00:00`).getDay()
        : commitment.recurrence === 'Todo mês'
          ? date.slice(8) === startDate.slice(8)
          : offset === 0;
      if (dayMatches) blocks.push({ date, startTime: commitment.time, durationMinutes: duration, source: 'personal' });
      if (commitment.recurrence === 'Não repetir') break;
    }
  });
  return blocks;
}

function bookingBlocks(state: LocalOnlineBookingState, storage: OnlineBookingStorageLike, excludeAppointmentId?: string): BookingBlock[] {
  const now = new Date();
  const publicBlocks = state.appointments
    .filter(item => item.id !== excludeAppointmentId && appointmentIsActive(item) && !item.managementTokenRevokedAt)
    .map(item => ({ date: item.date, startTime: item.time, durationMinutes: item.durationMinutes, source: 'public-booking' as const }));
  const validHolds = state.holds
    .filter(item => new Date(item.expiresAt).getTime() > now.getTime())
    .map(item => ({ date: item.date, startTime: item.startTime, durationMinutes: item.durationMinutes, source: 'hold' as const }));
  return [...getLocalAgendaBlocks(storage), ...publicBlocks, ...validHolds];
}

function endTimeFor(appointment: Pick<PublicAppointment, 'time' | 'durationMinutes'>): string {
  const start = appointment.time.split(':').map(Number);
  const total = start[0] * 60 + start[1] + appointment.durationMinutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function summaryFor(appointment: PublicAppointment, settings: PublicBookingSettings): PublicAppointmentSummary {
  const location = appointment.locationId ? settings.locations.find(item => item.id === appointment.locationId) : undefined;
  return {
    id: appointment.id,
    professionalName: settings.professionalName,
    clinicDisplayName: settings.clinicDisplayName,
    serviceName: settings.publishedServices.find(service => service.id === appointment.serviceId)?.name,
    modality: appointment.modality,
    locationName: location?.displayName || location?.name,
    locationAddress: location?.fullAddress || location?.address || undefined,
    googleMapsUrl: location?.googleMapsUrl || undefined,
    mapsNavigationUrl: appointment.modality === 'PRESENCIAL' && appointment.mapsNavigationRef ? getMapsNavigationUrl(appointment.mapsNavigationRef) : undefined,
    date: appointment.date,
    time: appointment.time,
    endTime: endTimeFor(appointment),
    appointmentStatus: appointment.appointmentStatus,
    patientConfirmationStatus: appointment.patientConfirmationStatus,
    cancellationEnabled: settings.cancellationEnabled,
    cancellationCutoffHours: settings.cancellationCutoffHours,
  };
}

type ManagementLookupError = { ok: false; code: 'not-found' | 'expired' | 'revoked'; message: string };

function genericManagementError(): ManagementLookupError {
  return { ok: false, code: 'not-found', message: 'Não foi possível localizar este link de gerenciamento.' };
}

function appointmentError(appointment: PublicAppointment | undefined, now: Date): ManagementLookupError | null {
  if (!appointment) return genericManagementError();
  if (appointment.managementTokenRevokedAt) return { ok: false, code: 'revoked', message: 'Este link de gerenciamento não está mais ativo.' };
  if (new Date(appointment.managementTokenExpiresAt).getTime() <= now.getTime()) return { ok: false, code: 'expired', message: 'Este link de gerenciamento expirou.' };
  return null;
}

export function createLocalPublicBookingRepository({ storage, now: nowFactory = () => new Date() }: LocalPublicBookingRepositoryOptions): PublicBookingRepository {
  const getNow = () => nowFactory();

  const findByToken = async (token: string, state: LocalOnlineBookingState): Promise<PublicAppointment | undefined> => {
    if (!token || token.length < 20) return undefined;
    const hash = await hashManagementToken(token);
    return state.appointments.find(item => item.managementTokenHash === hash);
  };

  const updateAppointmentInCanonicalStore = (appointment: PublicAppointment, storageNow: string): void => {
    const store = readCanonicalLocalStore(storage);
    const current = store.sessions.find(item => item.id === appointment.sessionId);
    if (!current) return;
    writeCanonicalLocalStore(storage, updatePsychologySessionStatus(store, appointment.sessionId, 'cancelada', storageNow));
  };

  return {
    async getSettings(slug) {
      const state = readState(storage, getNow());
      return !slug || state.settings.professionalSlug === slug ? clone(state.settings) : null;
    },
    async updateSettings(patch) {
      const now = getNow();
      const state = readState(storage, now);
      const settings = normalizePublicBookingSettings({ ...state.settings, ...patch, updatedAt: now.toISOString() }, now);
      syncCanonicalLocationsFromPublic(storage, settings.locations, now.toISOString());
      syncCanonicalServicesFromPublic(storage, settings.publishedServices, now.toISOString());
      writeState(storage, { ...state, settings });
      return clone(settings);
    },
    async listPublishedSlots(input) {
      const now = input.now || getNow();
      const state = readState(storage, now);
      if (state.settings.professionalSlug !== input.professionalSlug) return [];
      return getPublishedSlots({
        settings: state.settings,
        ...input,
        existingBlocks: bookingBlocks(state, storage),
        holds: [],
        now,
      });
    },
    async createBooking(input, requestedNow) {
      const now = requestedNow || getNow();
      const state = readState(storage, now);
      const settings = state.settings;
      const service = settings.publishedServices.find(item => item.id === input.serviceId && item.active && serviceAllowsModality(item, input.modality));
      const location = input.modality === 'PRESENCIAL'
        ? settings.locations.find(item => item.id === input.locationId && item.active)
        : undefined;
      const validLocation = input.modality === 'ONLINE'
        || Boolean(location && service?.allowedLocationIds.includes(location.id));
      if (settings.professionalSlug !== input.professionalSlug || !settings.active || !service || !validLocation) return { conflict: true, message: 'Este agendamento não está disponível.' };
      const candidate = getPublishedSlots({
        settings,
        serviceId: input.serviceId,
        modality: input.modality,
        locationId: input.modality === 'PRESENCIAL' ? input.locationId : undefined,
        fromDate: input.date,
        throughDate: input.date,
        now,
        existingBlocks: bookingBlocks(state, storage),
      }).find(slot => slot.time === input.time);
      if (!candidate) return { conflict: true, message: 'Este horário acabou de ser ocupado. Escolha outro horário.' };
      const name = input.name.trim();
      let phone = '';
      try {
        phone = normalizePhone(input.phone).displayPhone;
      } catch {
        return { conflict: true, message: 'Informe um telefone válido.' };
      }
      const email = input.email.trim();
      const patientValidation = validatePsychologyPatientAdministrativeInput({
        name,
        dateOfBirth: input.dateOfBirth,
        phone,
        email,
        administrativeResponsible: input.administrativeResponsible,
      }, candidate.date);
      if (Object.keys(patientValidation).length > 0) return { conflict: true, message: Object.values(patientValidation)[0] || 'Confira os dados administrativos.' };
      const nowIso = now.toISOString();
      const existingStore = readCanonicalLocalStore(storage);
      const existingPatient = existingStore.patients.find(patient => {
        try {
          return normalizePhoneForComparison(patient.phone) === normalizePhoneForComparison(phone)
            && (normalizeEmail(patient.email || '') === normalizeEmail(email) || patient.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
        } catch {
          return false;
        }
      });
      const patientStore = upsertPsychologyPatient(existingStore, {
        name,
        dateOfBirth: input.dateOfBirth,
        phone,
        email,
        administrativeResponsible: input.administrativeResponsible,
        preferredModality: input.modality === 'ONLINE' ? 'online' : 'presencial',
        administrativeNote: existingPatient?.administrativeNote || 'Origem: agendamento público local.',
        active: true,
      }, existingPatient?.id, nowIso);
      const patient = patientStore.patients.find(item => item.id === (existingPatient?.id || patientStore.patients[patientStore.patients.length - 1]?.id));
      if (!patient) return { conflict: true, message: 'Não foi possível preparar o cadastro administrativo.' };
      const sessionStore = upsertPsychologySession(patientStore, {
        patientId: patient.id,
        date: candidate.date,
        time: candidate.time,
        durationMinutes: candidate.durationMinutes,
        modality: input.modality === 'ONLINE' ? 'online' : 'presencial',
        serviceId: service.id,
        locationId: input.modality === 'PRESENCIAL' ? input.locationId : undefined,
        locationType: input.modality === 'PRESENCIAL' ? 'PRIMARY_OFFICE' : undefined,
        administrativeNote: 'Criada pelo agendamento público local; sem pagamento nesta etapa.',
        bookingOrigin: 'PATIENT_SELF_BOOKING',
      }, undefined, nowIso);
      const session = sessionStore.sessions.find(item => !patientStore.sessions.some(previous => previous.id === item.id)) || sessionStore.sessions[sessionStore.sessions.length - 1];
      const managementToken = createManagementToken();
      const mapsNavigationRef = input.modality === 'PRESENCIAL' ? createMapsNavigationRef() : undefined;
      const appointment: PublicAppointment = {
        id: createId('appointment'),
        context: 'PSICOLOGIA',
        professionalId: settings.professionalId,
        patientId: patient.id,
        sessionId: session.id,
        serviceId: service.id,
        modality: input.modality,
        locationId: input.modality === 'PRESENCIAL' ? input.locationId : undefined,
        date: candidate.date,
        time: candidate.time,
        durationMinutes: candidate.durationMinutes,
        appointmentStatus: 'SCHEDULED',
        patientConfirmationStatus: 'PENDING',
        source: normalizeSourceChannel(input.source),
        bookingOrigin: 'PATIENT_SELF_BOOKING',
        mapsNavigationRef,
        mapsNavigationRefHash: mapsNavigationRef ? await hashMapsNavigationRef(mapsNavigationRef) : undefined,
        managementTokenHash: await hashManagementToken(managementToken),
        managementTokenExpiresAt: new Date(now.getTime() + DEFAULT_MANAGEMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: nowIso,
        updatedAt: nowIso,
        auditEvents: [{ id: createId('audit'), type: 'PUBLIC_BOOKING_CREATED', createdAt: nowIso, metadata: { source: normalizeSourceChannel(input.source) } }],
      };
      const canonicalKey = `${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`;
      const previousCanonical = storage.getItem(canonicalKey);
      const previousBooking = storage.getItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY);
      try {
        writeCanonicalLocalStore(storage, sessionStore);
        writeState(storage, { ...state, appointments: [...state.appointments, appointment] });
      } catch {
        if (previousCanonical === null) storage.removeItem ? storage.removeItem(canonicalKey) : storage.setItem(canonicalKey, ''); else storage.setItem(canonicalKey, previousCanonical);
        if (previousBooking === null) storage.removeItem ? storage.removeItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY) : storage.setItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY, ''); else storage.setItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY, previousBooking);
        return { conflict: true, message: 'Não foi possível concluir o agendamento. Tente novamente.' };
      }
      return { appointment: clone(appointment), managementToken, managementUrl: getAppointmentManagementUrl(appointment.id, managementToken), mapsNavigationRef, mapsNavigationUrl: mapsNavigationRef ? getMapsNavigationUrl(mapsNavigationRef) : undefined };
    },
    async getAppointmentByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const state = readState(storage, now);
      const appointment = await findByToken(token, state);
      if (!appointment || appointment.managementTokenRevokedAt || new Date(appointment.managementTokenExpiresAt).getTime() <= now.getTime()) return null;
      return summaryFor(appointment, state.settings);
    },
    async confirmByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const state = readState(storage, now);
      const appointment = await findByToken(token, state);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT') return { ok: false, code: 'invalid', message: 'Esta consulta não pode mais ser confirmada.' };
      if (appointment.patientConfirmationStatus !== 'CONFIRMED') {
        const nowIso = now.toISOString();
        appointment.patientConfirmationStatus = 'CONFIRMED';
        appointment.updatedAt = nowIso;
        appointment.auditEvents = [...appointment.auditEvents, { id: createId('audit'), type: 'PATIENT_CONFIRMED', createdAt: nowIso }];
        writeState(storage, state);
      }
      return { ok: true, summary: summaryFor(appointment, state.settings) };
    },
    async cancelByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const state = readState(storage, now);
      const appointment = await findByToken(token, state);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT') return { ok: true, summary: summaryFor(appointment!, state.settings) };
      const appointmentDate = dateToLocalDateTime(appointment.date, appointment.time);
      if (!appointmentDate || !state.settings.cancellationEnabled) return { ok: false, code: 'invalid', message: 'O cancelamento online não está disponível para esta consulta.' };
      const hoursUntil = (appointmentDate.getTime() - now.getTime()) / (60 * 60 * 1000);
      if (hoursUntil < state.settings.cancellationCutoffHours) return { ok: false, code: 'cutoff', message: `O cancelamento online fica disponível até ${state.settings.cancellationCutoffHours} horas antes do horário.` };
      const nowIso = now.toISOString();
      appointment.appointmentStatus = 'CANCELLED_BY_PATIENT';
      appointment.managementTokenRevokedAt = nowIso;
      appointment.updatedAt = nowIso;
      appointment.auditEvents = [...appointment.auditEvents, { id: createId('audit'), type: 'PATIENT_CANCELLED', createdAt: nowIso }];
      writeState(storage, state);
      updateAppointmentInCanonicalStore(appointment, nowIso);
      return { ok: true, summary: summaryFor(appointment, state.settings) };
    },
    async requestRescheduleByManagementToken(token, requestedNow): Promise<RescheduleRequestResult> {
      const now = requestedNow || getNow();
      const state = readState(storage, now);
      const appointment = await findByToken(token, state);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT') return { ok: false, code: 'invalid', message: 'Esta consulta não pode receber uma solicitação de reagendamento.' };
      const summary = summaryFor(appointment, state.settings);
      const whatsappUrl = buildWhatsAppRescheduleUrl(state.settings.whatsappContactPhoneE164, buildRescheduleRequestMessage(summary));
      if (!whatsappUrl) return { ok: false, code: 'invalid', message: 'O contato de atendimento ainda não foi configurado.' };
      return { ok: true, summary, messagingContext: buildAppointmentMessagingContext(summary), whatsappUrl };
    },
    async getMapsNavigationDestination(navigationRef, requestedNow): Promise<MapsNavigationResult> {
      const now = requestedNow || getNow();
      const state = readState(storage, now);
      const ref = String(navigationRef || '');
      if (!ref || ref.length < 20) return { ok: false, code: 'unavailable', message: 'Este atendimento não possui localização presencial disponível.' };
      const refHash = await hashMapsNavigationRef(ref);
      const appointment = state.appointments.find(item => item.mapsNavigationRefHash === refHash);
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT' || appointment.modality !== 'PRESENCIAL' || !appointment.locationId) return { ok: false, code: 'unavailable', message: 'Este atendimento não possui localização presencial disponível.' };
      const location = state.settings.locations.find(item => item.id === appointment.locationId);
      const locationName = location?.displayName || location?.name || 'Local presencial';
      const locationAddress = location?.fullAddress || location?.address || undefined;
      if (!location || !location.googleMapsUrl || !isValidGoogleMapsUrl(location.googleMapsUrl)) return { ok: false, code: 'invalid', message: 'Não foi possível abrir o mapa deste local.', locationName, locationAddress };
      return { ok: true, destinationUrl: location.googleMapsUrl, locationName, locationAddress };
    },
  };
}

export function createMemoryOnlineBookingStorage(initial: Record<string, string> = {}): OnlineBookingStorageLike & { values: Record<string, string> } {
  const values = { ...initial };
  return { values, getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
}
