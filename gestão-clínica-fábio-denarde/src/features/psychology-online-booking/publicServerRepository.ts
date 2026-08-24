import {
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
  normalizePublicBookingSettings,
  normalizeSourceChannel,
  serviceAllowsModality,
} from './bookingDomain';
import type {
  BookingBlock,
  ManagementActionResult,
  MapsNavigationResult,
  PublicAppointment,
  PublicAppointmentMessagingContext,
  PublicAppointmentSummary,
  PublicBookingRepository,
  PublicBookingRequest,
  PublicBookingSettings,
  PublicBookingResult,
  RescheduleRequestResult,
} from './types';
import { validatePsychologyPatientAdministrativeInput } from '../../lib/psychologyPatientAdministrative';
import { normalizePhone } from '../../../shared/phoneNormalization.js';

export type PublicCapabilityType = 'MANAGEMENT' | 'MAPS_NAVIGATION';

export interface PublicCapabilityRecord {
  capabilityHash: string;
  capabilityType: PublicCapabilityType;
  appointmentId: string;
  context: 'PSICOLOGIA';
  professionalId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface PublicBookingServerState {
  settings: PublicBookingSettings;
  appointments: Map<string, PublicAppointment>;
  capabilities: Map<string, PublicCapabilityRecord>;
}

export interface CanonicalPublicBookingPatient {
  id: string;
  professionalId: string;
  tenantId?: string;
  context: 'PSICOLOGIA';
  name: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  preferredModality: 'online' | 'presencial';
  active: true;
  administrativeResponsible?: {
    fullName: string;
    relationship: string;
    phone: string;
    email: string;
  };
  administrativeNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalPublicBookingSession {
  id: string;
  professionalId: string;
  tenantId?: string;
  context: 'PSICOLOGIA';
  patientId: string;
  date: string;
  time: string;
  durationMinutes: number;
  modality: 'online' | 'presencial';
  serviceId: string;
  locationId?: string;
  locationType?: 'PRIMARY_OFFICE' | 'EXTERNAL_OFFICE' | 'OTHER';
  administrativeNote: string;
  status: 'agendada';
  bookingOrigin: 'PATIENT_SELF_BOOKING';
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalPublicBookingRecord {
  patient: CanonicalPublicBookingPatient;
  session: CanonicalPublicBookingSession;
}

export interface PublicBookingServerStore {
  getState(professionalId?: string): PublicBookingServerState;
  loadState?(professionalId?: string): Promise<PublicBookingServerState>;
  saveState?(state: PublicBookingServerState): Promise<void>;
  persistBooking?(state: PublicBookingServerState, record: CanonicalPublicBookingRecord & { appointment: PublicAppointment }): Promise<{ appointment?: PublicAppointment }>;
  getCapability?(capabilityHash: string): Promise<PublicCapabilityRecord | null>;
  getAppointment?(appointmentId: string): Promise<PublicAppointment | null>;
}

export interface PublicBookingServerRepositoryOptions {
  state: PublicBookingServerState;
  now?: () => Date;
  capabilityLookup?: (capabilityHash: string) => Promise<PublicCapabilityRecord | null>;
  appointmentLookup?: (appointmentId: string) => Promise<PublicAppointment | null>;
}

export interface PublicBookingServerHttpRequest {
  method: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface PublicBookingServerHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalize(value: unknown, maxLength = 240): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeStoredPhone(value: unknown): string {
  try {
    return normalizePhone(value).displayPhone;
  } catch {
    return '';
  }
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLocaleLowerCase();
}

function scopeKey(professionalId: string): string {
  return normalize(professionalId, 128) || 'psychology-local-professional';
}

function isActiveAppointment(appointment: PublicAppointment): boolean {
  return appointment.appointmentStatus === 'SCHEDULED';
}

function appointmentBlocks(state: PublicBookingServerState, excludeAppointmentId?: string): BookingBlock[] {
  return [...state.appointments.values()]
    .filter(item => item.id !== excludeAppointmentId && isActiveAppointment(item))
    .map(item => ({ date: item.date, startTime: item.time, durationMinutes: item.durationMinutes, source: 'public-booking' as const }));
}

function endTimeFor(appointment: Pick<PublicAppointment, 'time' | 'durationMinutes'>): string {
  const [hours, minutes] = appointment.time.split(':').map(Number);
  const total = hours * 60 + minutes + appointment.durationMinutes;
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
    locationName: location?.displayName,
    locationAddress: location?.fullAddress || undefined,
    googleMapsUrl: location?.googleMapsUrl || undefined,
    date: appointment.date,
    time: appointment.time,
    endTime: endTimeFor(appointment),
    appointmentStatus: appointment.appointmentStatus,
    patientConfirmationStatus: appointment.patientConfirmationStatus,
    cancellationEnabled: settings.cancellationEnabled,
    cancellationCutoffHours: settings.cancellationCutoffHours,
  };
}

function genericManagementError(): { ok: false; code: 'not-found'; message: string } {
  return { ok: false, code: 'not-found', message: 'Não foi possível localizar este link de gerenciamento.' };
}

function capabilityFor(state: PublicBookingServerState, hash: string, type: PublicCapabilityType, now: Date): PublicCapabilityRecord | null {
  const capability = state.capabilities.get(hash);
  if (!capability || capability.capabilityType !== type || capability.revokedAt || new Date(capability.expiresAt).getTime() <= now.getTime()) return null;
  return capability;
}

function appointmentError(appointment: PublicAppointment | undefined, now: Date) {
  if (!appointment) return genericManagementError();
  if (appointment.managementTokenRevokedAt) return { ok: false as const, code: 'revoked' as const, message: 'Este link de gerenciamento não está mais ativo.' };
  if (new Date(appointment.managementTokenExpiresAt).getTime() <= now.getTime()) return { ok: false as const, code: 'expired' as const, message: 'Este link de gerenciamento expirou.' };
  return null;
}

function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function responsibleForStorage(value: unknown): CanonicalPublicBookingPatient['administrativeResponsible'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const responsible = value as Record<string, unknown>;
  return {
    fullName: normalize(responsible.fullName, 160),
    relationship: normalize(responsible.relationship, 80),
    phone: normalizeStoredPhone(responsible.phone),
    email: normalizeEmail(String(responsible.email || '')),
  };
}

function canonicalBookingRecord(appointment: PublicAppointment, input: PublicBookingRequest, now: Date): CanonicalPublicBookingRecord {
  const nowIso = now.toISOString();
  const modality = input.modality === 'ONLINE' ? 'online' : 'presencial';
  const responsible = responsibleForStorage(input.administrativeResponsible);
  const patient: CanonicalPublicBookingPatient = {
    id: appointment.patientId,
    professionalId: appointment.professionalId,
    context: 'PSICOLOGIA',
    name: normalize(input.name, 160),
    dateOfBirth: normalize(input.dateOfBirth, 32),
    phone: normalizeStoredPhone(input.phone),
    email: normalizeEmail(input.email),
    preferredModality: modality,
    active: true,
    ...(responsible ? { administrativeResponsible: responsible } : {}),
    administrativeNote: 'Criada pelo agendamento público; sem pagamento nesta etapa.',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const session: CanonicalPublicBookingSession = {
    id: appointment.sessionId,
    professionalId: appointment.professionalId,
    context: 'PSICOLOGIA',
    patientId: appointment.patientId,
    date: appointment.date,
    time: appointment.time,
    durationMinutes: appointment.durationMinutes,
    modality,
    serviceId: appointment.serviceId,
    ...(modality === 'presencial' && appointment.locationId ? { locationId: appointment.locationId, locationType: 'PRIMARY_OFFICE' } : {}),
    administrativeNote: 'Criada pelo agendamento público; sem pagamento nesta etapa.',
    status: 'agendada',
    bookingOrigin: 'PATIENT_SELF_BOOKING',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return { patient, session };
}

export function createMemoryPublicBookingServerStore(initialSettings?: PublicBookingSettings, now = new Date()): PublicBookingServerStore {
  const initial = normalizePublicBookingSettings(initialSettings || createDefaultPublicBookingSettings(now), now);
  const states = new Map<string, PublicBookingServerState>();
  const getState = (professionalId = initial.professionalId) => {
    const key = scopeKey(professionalId);
    const existing = states.get(key);
    if (existing) return existing;
    const state: PublicBookingServerState = { settings: clone(initial), appointments: new Map(), capabilities: new Map() };
    states.set(key, state);
    return state;
  };
  return { getState };
}

export function createServerPublicBookingRepository({ state, now: nowFactory = () => new Date(), capabilityLookup, appointmentLookup }: PublicBookingServerRepositoryOptions): PublicBookingRepository {
  const getNow = () => nowFactory();
  const findManagementAppointment = async (token: string, now: Date): Promise<PublicAppointment | undefined> => {
    if (!token || token.length < 20) return undefined;
    const capabilityHash = await hashManagementToken(token);
    const capability = capabilityLookup
      ? await capabilityLookup(capabilityHash)
      : capabilityFor(state, capabilityHash, 'MANAGEMENT', now);
    if (!capability || capability.capabilityType !== 'MANAGEMENT' || capability.revokedAt || new Date(capability.expiresAt).getTime() <= now.getTime()) return undefined;
    const appointment = appointmentLookup ? await appointmentLookup(capability.appointmentId) : state.appointments.get(capability.appointmentId);
    if (appointment && !state.appointments.has(appointment.id)) state.appointments.set(appointment.id, appointment);
    return appointment;
  };

  return {
    async getSettings(slug) {
      return !slug || state.settings.professionalSlug === slug ? clone(state.settings) : null;
    },
    async updateSettings(patch) {
      const next = normalizePublicBookingSettings({ ...state.settings, ...patch, updatedAt: getNow().toISOString() }, getNow());
      state.settings = next;
      return clone(next);
    },
    async listPublishedSlots(input) {
      const now = input.now || getNow();
      if (state.settings.professionalSlug !== input.professionalSlug) return [];
      return getPublishedSlots({ settings: state.settings, ...input, existingBlocks: appointmentBlocks(state), holds: [], now });
    },
    async createBooking(input: PublicBookingRequest, requestedNow?: Date): Promise<PublicBookingResult | { conflict: true; message: string }> {
      const now = requestedNow || getNow();
      const settings = state.settings;
      const service = settings.publishedServices.find(item => item.id === input.serviceId && item.active && serviceAllowsModality(item, input.modality));
      const location = input.modality === 'PRESENCIAL' ? settings.locations.find(item => item.id === input.locationId && item.active) : undefined;
      const validLocation = input.modality === 'ONLINE' || Boolean(location && service?.allowedLocationIds.includes(location.id));
      if (settings.professionalSlug !== input.professionalSlug || !settings.active || !service || !validLocation) return { conflict: true, message: 'Este agendamento não está disponível.' };
      const candidate = getPublishedSlots({ settings, serviceId: input.serviceId, modality: input.modality, locationId: input.modality === 'PRESENCIAL' ? input.locationId : undefined, fromDate: input.date, throughDate: input.date, now, existingBlocks: appointmentBlocks(state) }).find(slot => slot.time === input.time);
      if (!candidate) return { conflict: true, message: 'Este horário acabou de ser ocupado. Escolha outro horário.' };
      const name = normalize(input.name, 160);
      const phone = normalizeStoredPhone(input.phone);
      const email = normalize(input.email, 160);
      const patientValidation = validatePsychologyPatientAdministrativeInput({
        name,
        dateOfBirth: normalize(input.dateOfBirth, 32),
        phone,
        email,
        administrativeResponsible: input.administrativeResponsible,
      }, candidate.date);
      if (Object.keys(patientValidation).length > 0) return { conflict: true, message: Object.values(patientValidation)[0] || 'Confira os dados administrativos.' };
      const nowIso = now.toISOString();
      const managementToken = createManagementToken();
      const mapsNavigationRef = input.modality === 'PRESENCIAL' ? createMapsNavigationRef() : undefined;
      const managementTokenHash = await hashManagementToken(managementToken);
      const mapsNavigationRefHash = mapsNavigationRef ? await hashMapsNavigationRef(mapsNavigationRef) : undefined;
      const appointmentId = createId('appointment');
      const appointment: PublicAppointment = {
        id: appointmentId,
        context: 'PSICOLOGIA',
        professionalId: settings.professionalId,
        patientId: createId('patient'),
        sessionId: createId('session'),
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
        mapsNavigationRefHash,
        managementTokenHash,
        managementTokenExpiresAt: new Date(now.getTime() + DEFAULT_MANAGEMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: nowIso,
        updatedAt: nowIso,
        auditEvents: [{ id: createId('audit'), type: 'PUBLIC_BOOKING_CREATED', createdAt: nowIso, metadata: { source: normalizeSourceChannel(input.source) } }],
      };
      state.appointments.set(appointment.id, clone(appointment));
      state.capabilities.set(managementTokenHash, { capabilityHash: managementTokenHash, capabilityType: 'MANAGEMENT', appointmentId, context: 'PSICOLOGIA', professionalId: settings.professionalId, createdAt: nowIso, expiresAt: appointment.managementTokenExpiresAt });
      if (mapsNavigationRefHash) state.capabilities.set(mapsNavigationRefHash, { capabilityHash: mapsNavigationRefHash, capabilityType: 'MAPS_NAVIGATION', appointmentId, context: 'PSICOLOGIA', professionalId: settings.professionalId, createdAt: nowIso, expiresAt: appointment.managementTokenExpiresAt });
      const responseAppointment = { ...clone(appointment), ...(mapsNavigationRef ? { mapsNavigationRef } : {}) };
      return { appointment: responseAppointment, managementToken, managementUrl: getAppointmentManagementUrl(appointment.id, managementToken), mapsNavigationRef, mapsNavigationUrl: mapsNavigationRef ? getMapsNavigationUrl(mapsNavigationRef) : undefined };
    },
    async getAppointmentByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      if (!appointment || appointment.managementTokenRevokedAt || new Date(appointment.managementTokenExpiresAt).getTime() <= now.getTime()) return null;
      return summaryFor(appointment, state.settings);
    },
    async confirmByManagementToken(token, requestedNow): Promise<ManagementActionResult> {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT') return { ok: false, code: 'invalid', message: 'Esta consulta não pode mais ser confirmada.' };
      if (appointment.patientConfirmationStatus !== 'CONFIRMED') {
        appointment.patientConfirmationStatus = 'CONFIRMED';
        appointment.updatedAt = now.toISOString();
        appointment.auditEvents = [...appointment.auditEvents, { id: createId('audit'), type: 'PATIENT_CONFIRMED', createdAt: now.toISOString() }];
      }
      return { ok: true, summary: summaryFor(appointment, state.settings) };
    },
    async cancelByManagementToken(token, requestedNow): Promise<ManagementActionResult> {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT') return { ok: true, summary: summaryFor(appointment!, state.settings) };
      const appointmentDate = dateToLocalDateTime(appointment.date, appointment.time);
      if (!appointmentDate || !state.settings.cancellationEnabled) return { ok: false, code: 'invalid', message: 'O cancelamento online não está disponível para esta consulta.' };
      const hoursUntil = (appointmentDate.getTime() - now.getTime()) / (60 * 60 * 1000);
      if (hoursUntil < state.settings.cancellationCutoffHours) return { ok: false, code: 'cutoff', message: `O cancelamento online fica disponível até ${state.settings.cancellationCutoffHours} horas antes do horário.` };
      appointment.appointmentStatus = 'CANCELLED_BY_PATIENT';
      appointment.updatedAt = now.toISOString();
      appointment.auditEvents = [...appointment.auditEvents, { id: createId('audit'), type: 'PATIENT_CANCELLED', createdAt: now.toISOString() }];
      return { ok: true, summary: summaryFor(appointment, state.settings) };
    },
    async requestRescheduleByManagementToken(token, requestedNow): Promise<RescheduleRequestResult> {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT') return { ok: false, code: 'invalid', message: 'Esta consulta não pode receber uma solicitação de reagendamento.' };
      const summary = summaryFor(appointment, state.settings);
      const whatsappUrl = buildWhatsAppRescheduleUrl(state.settings.whatsappContactPhoneE164, buildRescheduleRequestMessage(summary));
      if (!whatsappUrl) return { ok: false, code: 'invalid', message: 'O contato de atendimento ainda não foi configurado.' };
      appointment.updatedAt = now.toISOString();
      appointment.auditEvents = [...appointment.auditEvents, { id: createId('audit'), type: 'RESCHEDULE_REQUEST_INITIATED', createdAt: now.toISOString() }];
      const messagingContext: PublicAppointmentMessagingContext = buildAppointmentMessagingContext(summary);
      return { ok: true, summary, messagingContext, whatsappUrl };
    },
    async getMapsNavigationDestination(navigationRef, requestedNow): Promise<MapsNavigationResult> {
      const now = requestedNow || getNow();
      const ref = String(navigationRef || '');
      if (!ref || ref.length < 20) return { ok: false, code: 'unavailable', message: 'Este atendimento não possui localização presencial disponível.' };
      const capabilityHash = await hashMapsNavigationRef(ref);
      const capability = capabilityLookup
        ? await capabilityLookup(capabilityHash)
        : capabilityFor(state, capabilityHash, 'MAPS_NAVIGATION', now);
      if (!capability || capability.capabilityType !== 'MAPS_NAVIGATION') return { ok: false, code: 'unavailable', message: 'Este atendimento não possui localização presencial disponível.' };
      const appointment = capability
        ? (appointmentLookup ? await appointmentLookup(capability.appointmentId) : state.appointments.get(capability.appointmentId))
        : undefined;
      if (appointment && !state.appointments.has(appointment.id)) state.appointments.set(appointment.id, appointment);
      if (!appointment || appointment.appointmentStatus === 'CANCELLED_BY_PATIENT' || appointment.modality !== 'PRESENCIAL' || !appointment.locationId) return { ok: false, code: 'unavailable', message: 'Este atendimento não possui localização presencial disponível.' };
      const location = state.settings.locations.find(item => item.id === appointment.locationId);
      const locationName = location?.displayName || 'Local presencial';
      const locationAddress = location?.fullAddress || undefined;
      if (!location || !location.googleMapsUrl || !isValidGoogleMapsUrl(location.googleMapsUrl)) return { ok: false, code: 'invalid', message: 'Não foi possível abrir o mapa deste local.', locationName, locationAddress };
      return { ok: true, destinationUrl: location.googleMapsUrl, locationName, locationAddress };
    },
  };
}

export function createPublicBookingServerHandler(options: { store: PublicBookingServerStore; now?: () => Date; allowSettingsWrite?: boolean }) {
  const now = options.now || (() => new Date());
  const response = (status: number, body: Record<string, unknown>): PublicBookingServerHttpResponse => ({ status, body });
  const error = (status: number, message: string, code = 'public-booking/unavailable') => response(status, { error: { code, message } });

  return async (request: PublicBookingServerHttpRequest): Promise<PublicBookingServerHttpResponse> => {
    const method = request.method.toUpperCase();
    const query = request.query || {};
    const resource = normalize(query.resource, 64);
    try {
      const state = options.store.loadState ? await options.store.loadState(query.professionalId) : options.store.getState(query.professionalId);
      const repository = createServerPublicBookingRepository({
        state,
        now,
        capabilityLookup: options.store.getCapability ? options.store.getCapability.bind(options.store) : undefined,
        appointmentLookup: options.store.getAppointment ? options.store.getAppointment.bind(options.store) : undefined,
      });
      const persist = async () => { if (options.store.saveState) await options.store.saveState(state); };
      if (resource === 'settings' && method === 'GET') {
        const settings = await repository.getSettings(query.slug);
        return settings ? response(200, { settings }) : error(404, 'Agendamento público indisponível.', 'public-booking/not-found');
      }
      if (resource === 'settings' && method === 'PUT') {
        if (!options.allowSettingsWrite) return error(403, 'A publicação local de ajustes está desativada.', 'public-booking/settings-write-disabled');
        const body = bodyObject(request.body);
        const settings = await repository.updateSettings(body.settings && typeof body.settings === 'object' ? body.settings as Partial<PublicBookingSettings> : body as Partial<PublicBookingSettings>);
        await persist();
        return response(200, { settings });
      }
      if (resource === 'slots' && method === 'GET') {
        const slots = await repository.listPublishedSlots({ professionalSlug: normalize(query.professionalSlug, 80), serviceId: normalize(query.serviceId, 128), modality: query.modality === 'ONLINE' ? 'ONLINE' : 'PRESENCIAL', locationId: normalize(query.locationId, 128) || undefined, fromDate: normalize(query.fromDate, 32), throughDate: normalize(query.throughDate, 32), now: now() });
        return response(200, { slots });
      }
      if (resource === 'create-booking' && method === 'POST') {
        const input = bodyObject(request.body) as unknown as PublicBookingRequest;
        const requestedNow = now();
        const result = await repository.createBooking(input, requestedNow);
        if (!('conflict' in result)) {
          const record = canonicalBookingRecord(result.appointment, input, requestedNow);
          if (options.store.persistBooking) {
            const persisted = await options.store.persistBooking(state, { ...record, appointment: result.appointment });
            if (persisted?.appointment) result.appointment = { ...result.appointment, ...persisted.appointment };
          } else {
            await persist();
          }
        }
        return 'conflict' in result ? response(409, { result }) : response(201, { result });
      }
      if (resource === 'management' && method === 'GET') {
        const summary = await repository.getAppointmentByManagementToken(normalize(query.token, 240), now());
        return summary ? response(200, { summary }) : error(404, 'Não foi possível localizar este link de gerenciamento.', 'public-booking/not-found');
      }
      if (resource === 'management-action' && method === 'POST') {
        const body = bodyObject(request.body);
        const action = normalize(body.action, 40);
        const token = normalize(body.token, 240);
        if (!['confirm', 'cancel', 'request-reschedule'].includes(action)) return error(422, 'A ação solicitada não está disponível.', 'public-booking/invalid-action');
        const result = action === 'confirm'
          ? await repository.confirmByManagementToken(token, now())
          : action === 'cancel'
            ? await repository.cancelByManagementToken(token, now())
            : await repository.requestRescheduleByManagementToken(token, now());
        if (result.ok) await persist();
        return result.ok ? response(200, { result }) : response(422, { result });
      }
      if (resource === 'maps' && method === 'GET') {
        const result = await repository.getMapsNavigationDestination(normalize(query.navigationRef, 240), now());
        if (!('code' in result)) return response(200, { result });
        return response(404, { result: { ok: false, code: result.code, message: result.message } });
      }
      return error(404, 'Rota pública não encontrada.', 'public-booking/route-not-found');
    } catch {
      return error(500, 'Não foi possível processar esta solicitação pública.', 'public-booking/internal-error');
    }
  };
}
