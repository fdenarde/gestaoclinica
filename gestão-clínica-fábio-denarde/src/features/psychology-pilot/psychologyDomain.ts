export const PSYCHOLOGY_CONTEXT = 'PSICOLOGIA' as const;
export const LOCAL_PSYCHOLOGY_PROFESSIONAL_ID = 'psychology-local-professional';
export const LOCAL_PSYCHOLOGY_STORAGE_KEY = 'gestao-clinica:psychology-r1:v1';

import type { AlarmAdvance, PersonalAppointment, PersonalAppointmentType } from '../../types';
import { getPersonalAppointmentOccurrences, type PersonalAppointmentOccurrence } from '../../lib/personalAgendaTemporal';

import type {
  PsychologyCharge,
  PsychologyLocation,
  PsychologyLocationInput,
  PsychologyPayment,
  PsychologyExpense,
  PsychologySessionPackage,
  PsychologyService,
  PsychologySettings,
  PsychologySessionRecordR2A,
  PsychologyDocumentClassification,
} from './psychologyR2a';
import { createDefaultPsychologySettings, normalizePsychologySettings, PSYCHOLOGY_COLOR_DEFAULTS } from './psychologyR2a';
import { canonicalPsychologyServiceId } from './psychologyServiceCatalog';
import { createPsychologyChargeInLedger, createPsychologyPaymentInLedger } from './psychologyFinancialLedger';
import {
  calculateAgeOnDate,
  civilDateFromDate,
  profileCompleteness as getAdministrativeProfileCompleteness,
  type PsychologyAdministrativeResponsible,
  validatePsychologyPatientAdministrativeInput,
} from '../../lib/psychologyPatientAdministrative';
import { normalizePhone } from '../../../shared/phoneNormalization.js';

export type PsychologyModality = 'presencial' | 'online';

function sanitizeStoredPhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return normalizePhone(raw).displayPhone;
  } catch {
    // Legacy fixtures may intentionally contain incomplete values; validation
    // remains responsible for blocking them at a new-entry boundary.
    return raw;
  }
}
export type PsychologySessionStatus = 'agendada' | 'realizada' | 'falta' | 'cancelada';
export type PsychologyCanonicalSessionStatus = 'CANCELLED' | 'LEGACY_ATTENDANCE_UNKNOWN' | 'SCHEDULED';
export type PsychologyBookingOrigin = 'PATIENT_SELF_BOOKING' | 'PROFESSIONAL';
export type PsychologyPersonalType = PersonalAppointmentType;
export type PsychologyLegacyPersonalType = PsychologyPersonalType | 'Reunião';
export const PSYCHOLOGY_MENTORING_TYPE = 'Mentoria' as const;

export interface PsychologyScope {
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
}

export interface PsychologyPatient {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  name: string;
  /** Canonical civil date. Empty is allowed only for legacy records. */
  dateOfBirth?: string;
  /** @deprecated Read compatibility alias for records created before R2F3-E. */
  birthDate?: string;
  phone: string;
  additionalPhone?: string;
  email?: string;
  address?: PsychologyPatientAddress;
  demographics?: PsychologyPatientDemographics;
  migrationReview?: PsychologyPatientMigrationReview;
  preferredModality: PsychologyModality;
  administrativeNote?: string;
  administrativeNotes?: string;
  administrativeResponsible?: PsychologyAdministrativeResponsible;
  externalReferences?: PsychologyExternalReference[];
  inReview?: boolean;
  reviewMarkedAt?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PsychologyPatientAddress {
  street?: string;
  number?: string;
  postalCode?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  province?: string;
  country?: string;
}

export interface PsychologyPatientDemographics {
  religion?: string;
  education?: string;
  profession?: string;
  nationality?: string;
}

export interface PsychologyPatientMigrationReview {
  required: true;
  reason: string;
}

export interface PsychologyExternalReference {
  source: string;
  externalId: string;
  importedAt?: string;
}

export interface PsychologyDocument {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  patientId: string;
  category: string;
  classification: PsychologyDocumentClassification;
  filename: string;
  mimeType: string;
  size?: number;
  storageRef?: string;
  externalSource?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PsychologyAttachment {
  id: string;
  patientId: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  documentId?: string;
  sessionRecordId?: string;
  filename: string;
  mimeType: string;
  size?: number;
  storageRef?: string;
  classification: PsychologyDocumentClassification;
  externalSource?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PsychologySession {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  patientId: string;
  date: string;
  time: string;
  durationMinutes: number;
  modality: PsychologyModality;
  serviceId?: string;
  locationId?: string;
  locationType?: 'PRIMARY_OFFICE' | 'EXTERNAL_OFFICE' | 'OTHER';
  chargeId?: string;
  administrativeNote?: string;
  status: PsychologySessionStatus;
  /** Ephemeral metadata used only by the read-only Doctoralia preview. */
  previewStatus?: 'CANCELLED' | 'SCHEDULED' | 'LEGACY_ATTENDANCE_UNKNOWN';
  /** Canonical Doctoralia status used by the R2B4 shadow import; unlike previewStatus it is persisted in the canonical record. */
  canonicalStatus?: PsychologyCanonicalSessionStatus;
  sourceStatus?: string;
  externalSource?: string;
  externalEventId?: string;
  externalScheduleId?: string;
  /** Canonical creator dimension; absent means a legacy record with unknown origin. */
  bookingOrigin?: PsychologyBookingOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface PsychologyPersonalCommitment {
  id: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
  date: string;
  time: string;
  durationMinutes: number;
  type: PsychologyLegacyPersonalType;
  title?: string;
  note?: string;
  recurrence: PersonalAppointment['recurrence'];
  alarmEnabled: boolean;
  alarmAdvance?: AlarmAdvance;
  alarmSound?: string;
  alarmVolume?: number;
  alarmFadeIn?: boolean;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PsychologyPersonalCommitmentOccurrence = PsychologyPersonalCommitment & {
  occurrenceId: string;
  occDate: Date;
  occurrenceDateTime: Date;
};

export type PsychologySessionRecord = PsychologySessionRecordR2A & {
  sessionDate: string;
  sessionTime: string;
  /** Legacy local alias kept only to read existing R1 records. */
  text?: string;
};

export interface PsychologyStore {
  schemaVersion: 2;
  scope: PsychologyScope;
  settings: PsychologySettings;
  patients: PsychologyPatient[];
  sessions: PsychologySession[];
  personalCommitments: PsychologyPersonalCommitment[];
  sessionRecords: PsychologySessionRecord[];
  services: PsychologyService[];
  locations: PsychologyLocation[];
  charges: PsychologyCharge[];
  payments: PsychologyPayment[];
  expenses: PsychologyExpense[];
  sessionPackages: PsychologySessionPackage[];
  documents: PsychologyDocument[];
  attachments: PsychologyAttachment[];
}

export interface PsychologyPatientInput {
  name: string;
  /** Canonical field for new writes. The legacy alias is accepted only at this boundary. */
  dateOfBirth?: string;
  /** @deprecated Compatibility input for pre-R2F3-E fixtures/imports. */
  birthDate?: string;
  phone: string;
  email: string;
  preferredModality: PsychologyModality;
  administrativeNote: string;
  active: boolean;
  administrativeResponsible?: PsychologyAdministrativeResponsible;
  externalReferences?: PsychologyExternalReference[];
}

export interface PsychologyNewPatientInput extends Omit<PsychologyPatientInput, 'dateOfBirth' | 'birthDate'> {
  dateOfBirth: string;
}

export interface PsychologySessionInput {
  patientId: string;
  date: string;
  time: string;
  durationMinutes: number;
  modality: PsychologyModality;
  serviceId?: string;
  locationId?: string;
  locationType?: 'PRIMARY_OFFICE' | 'EXTERNAL_OFFICE' | 'OTHER';
  chargeId?: string;
  administrativeNote: string;
  bookingOrigin?: PsychologyBookingOrigin;
}

export interface PsychologyPersonalInput {
  date: string;
  time: string;
  durationMinutes: number;
  type: PsychologyPersonalType;
  title?: string;
  note: string;
  recurrence?: PersonalAppointment['recurrence'];
  alarmEnabled?: boolean;
  alarmAdvance?: AlarmAdvance;
  alarmSound?: string;
  alarmVolume?: number;
  alarmFadeIn?: boolean;
  isDone?: boolean;
}

export interface PsychologyChargeInput {
  patientId: string;
  sessionId?: string;
  serviceId?: string;
  packageId?: string;
  description: string;
  amount: number;
  dueDate?: string;
  createdBy?: string;
  exempt?: boolean;
  exemptionReason?: string;
}

export interface PsychologyPaymentInput {
  chargeId: string;
  patientId: string;
  sessionId?: string;
  amount: number;
  date: string;
  method: PsychologyPayment['method'];
  createdBy?: string;
  operationKey?: string;
}

export interface PsychologySessionPackageInput {
  patientId: string;
  name: string;
  totalSessions: number;
  usedSessions?: number;
  startDate: string;
  endDate?: string;
  active?: boolean;
  price?: number;
}

export interface PsychologySessionValidationOptions {
  ignoreSessionId?: string;
  /** New internal appointment forms must opt into the canonical service contract. */
  requireService?: boolean;
  /** New and edited internal appointments must opt into local conflict detection. */
  checkConflicts?: boolean;
}

export function createPsychologyScope(professionalId = LOCAL_PSYCHOLOGY_PROFESSIONAL_ID): PsychologyScope {
  return { professionalId, context: PSYCHOLOGY_CONTEXT };
}

export function createEmptyPsychologyStore(scope = createPsychologyScope()): PsychologyStore {
  const settings = createDefaultPsychologySettings(scope);
  return {
    schemaVersion: 2,
    scope,
    settings,
    patients: [],
    sessions: [],
    personalCommitments: [],
    sessionRecords: [],
    services: settings.services,
    locations: settings.locations,
    charges: [],
    payments: [],
    expenses: [],
    sessionPackages: [],
    documents: [],
    attachments: [],
  };
}

function belongsToScope(item: { professionalId?: string; context?: string }, scope: PsychologyScope): boolean {
  return item.professionalId === scope.professionalId && item.context === scope.context;
}

export function normalizePsychologyStore(value: unknown, scope = createPsychologyScope()): PsychologyStore {
  const input = value && typeof value === 'object' ? value as Partial<PsychologyStore> : {};
  const settings = normalizePsychologySettings({
    ...(input.settings || {}),
    services: Array.isArray(input.services) ? input.services : (input.settings as PsychologySettings | undefined)?.services,
    locations: Array.isArray(input.locations) ? input.locations : (input.settings as PsychologySettings | undefined)?.locations,
  }, scope);
  const personalCommitments = Array.isArray(input.personalCommitments)
    ? input.personalCommitments.filter(item => belongsToScope(item, scope)).map(item => ({
      ...item,
      recurrence: item.recurrence || 'Não repetir',
      alarmEnabled: Boolean(item.alarmEnabled),
      isDone: Boolean(item.isDone),
      note: item.note || '',
    })) as PsychologyPersonalCommitment[]
    : [];
  return {
    schemaVersion: 2,
    scope,
    settings,
    patients: Array.isArray(input.patients) ? input.patients.filter(item => belongsToScope(item, scope)).map(item => {
      const dateOfBirth = String(item.dateOfBirth || item.birthDate || '').trim();
      const responsible = item.administrativeResponsible && typeof item.administrativeResponsible === 'object'
        ? {
          fullName: String(item.administrativeResponsible.fullName || '').trim(),
          relationship: String(item.administrativeResponsible.relationship || '').trim(),
          phone: String(item.administrativeResponsible.phone || '').trim(),
          email: String(item.administrativeResponsible.email || '').trim().toLocaleLowerCase(),
        }
        : undefined;
      return {
      ...item,
      dateOfBirth,
      birthDate: dateOfBirth || undefined,
      administrativeResponsible: responsible,
      administrativeNotes: item.administrativeNotes || item.administrativeNote || undefined,
      externalReferences: Array.isArray(item.externalReferences) ? item.externalReferences.filter(reference => reference && String(reference.source || '').trim() && String(reference.externalId || '').trim()).map(reference => ({ source: String(reference.source).trim(), externalId: String(reference.externalId).trim(), importedAt: reference.importedAt ? String(reference.importedAt) : undefined })) : undefined,
      inReview: Boolean(item.inReview),
      reviewMarkedAt: item.reviewMarkedAt ? String(item.reviewMarkedAt) : undefined,
      };
    }) as PsychologyPatient[] : [],
    sessions: Array.isArray(input.sessions) ? input.sessions.filter(item => belongsToScope(item, scope)).map(item => {
      const bookingOrigin = item.bookingOrigin === 'PATIENT_SELF_BOOKING' || item.bookingOrigin === 'PROFESSIONAL' ? item.bookingOrigin : undefined;
      return {
        ...item,
        serviceId: item.serviceId ? canonicalPsychologyServiceId(item.serviceId) : undefined,
        ...(bookingOrigin ? { bookingOrigin } : {}),
      };
    }) as PsychologySession[] : [],
    personalCommitments,
    sessionRecords: Array.isArray(input.sessionRecords) ? input.sessionRecords.filter(item => belongsToScope(item, scope)).map(item => ({
      ...item,
      sessionId: item.sessionId || undefined,
      date: item.date || item.sessionDate,
      authorProfessionalId: item.authorProfessionalId || item.professionalId,
    })) as PsychologySessionRecord[] : [],
    services: settings.services,
    locations: Array.isArray(input.locations) ? input.locations.filter(item => belongsToScope(item, scope)) as PsychologyLocation[] : settings.locations,
    charges: Array.isArray(input.charges) ? input.charges.filter(item => belongsToScope(item, scope)) as PsychologyCharge[] : [],
    payments: Array.isArray(input.payments) ? input.payments.filter(item => belongsToScope(item, scope)) as PsychologyPayment[] : [],
    expenses: Array.isArray(input.expenses) ? input.expenses.filter(item => belongsToScope(item, scope)) as PsychologyExpense[] : [],
    sessionPackages: Array.isArray(input.sessionPackages) ? input.sessionPackages.filter(item => belongsToScope(item, scope)).map(item => ({
      ...item,
      name: String(item.name || 'Pacote de sessões').trim() || 'Pacote de sessões',
      totalSessions: Math.max(1, Math.floor(Number(item.totalSessions) || 1)),
      usedSessions: Math.max(0, Math.min(Math.floor(Number(item.usedSessions) || 0), Math.max(1, Math.floor(Number(item.totalSessions) || 1)))),
      active: item.active !== false,
    })) as PsychologySessionPackage[] : [],
    documents: Array.isArray(input.documents) ? input.documents.filter(item => belongsToScope(item, scope) && item.context === PSYCHOLOGY_CONTEXT) as PsychologyDocument[] : [],
    attachments: Array.isArray(input.attachments) ? input.attachments.filter(item => belongsToScope(item, scope) && item.context === PSYCHOLOGY_CONTEXT) as PsychologyAttachment[] : [],
  };
}

export function validatePsychologyPatient(input: PsychologyPatientInput): Partial<Record<keyof PsychologyPatientInput, string>> {
  const errors: Partial<Record<keyof PsychologyPatientInput, string>> = {};
  const dateOfBirth = String(input.dateOfBirth || input.birthDate || '').trim();
  const validation = validatePsychologyPatientAdministrativeInput({ name: input.name, dateOfBirth, phone: input.phone, email: input.email, administrativeResponsible: input.administrativeResponsible }, civilDateFromDate(new Date()));
  Object.entries(validation).forEach(([field, message]) => {
    const outputField = field === 'dateOfBirth' && input.dateOfBirth === undefined && input.birthDate !== undefined ? 'birthDate' : field;
    (errors as Record<string, string>)[outputField] = message;
  });
  return errors;
}

export function validatePsychologyPatientProfile(input: PsychologyPatientInput): Partial<Record<keyof PsychologyPatientInput, string>> {
  return validatePsychologyPatient(input);
}

export function getPsychologyPatientDateOfBirth(patient: Pick<PsychologyPatient, 'dateOfBirth' | 'birthDate'>): string {
  return String(patient.dateOfBirth || patient.birthDate || '').trim();
}

export const PSYCHOLOGY_ADOLESCENT_SERVICE_ID = 'psychotherapy-adolescent';

export function getPsychologyAutomaticServiceIdForPatient(patient: Pick<PsychologyPatient, 'dateOfBirth' | 'birthDate'> | undefined, referenceCivilDate = civilDateFromDate(new Date())): string | undefined {
  if (!patient) return undefined;
  const age = calculateAgeOnDate(getPsychologyPatientDateOfBirth(patient), referenceCivilDate);
  return age !== null && age < 18 ? PSYCHOLOGY_ADOLESCENT_SERVICE_ID : undefined;
}

export function synchronizePsychologyServiceForPatient(store: PsychologyStore, patientId: string, currentServiceId?: string, referenceCivilDate = civilDateFromDate(new Date())): string | undefined {
  const automaticServiceId = getPsychologyAutomaticServiceIdForPatient(store.patients.find(patient => patient.id === patientId), referenceCivilDate);
  if (automaticServiceId && store.services.some(service => service.id === automaticServiceId && service.active)) return automaticServiceId;
  if (canonicalPsychologyServiceId(currentServiceId) === PSYCHOLOGY_ADOLESCENT_SERVICE_ID) {
    return store.services.find(service => service.active && service.id !== PSYCHOLOGY_ADOLESCENT_SERVICE_ID)?.id;
  }
  return currentServiceId ? canonicalPsychologyServiceId(currentServiceId) : undefined;
}

export function getPsychologyPatientProfileCompleteness(patient: Pick<PsychologyPatient, 'name' | 'dateOfBirth' | 'birthDate' | 'phone' | 'email' | 'administrativeResponsible'>, referenceCivilDate = civilDateFromDate(new Date())) {
  return getAdministrativeProfileCompleteness({
    name: patient.name,
    dateOfBirth: getPsychologyPatientDateOfBirth(patient),
    phone: patient.phone,
    email: patient.email,
    administrativeResponsible: patient.administrativeResponsible,
  }, referenceCivilDate);
}

function sessionTimeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : -1;
}

export function validatePsychologySession(input: PsychologySessionInput, store: PsychologyStore, options: PsychologySessionValidationOptions = {}): string | null {
  if (!store.patients.some(patient => patient.id === input.patientId && patient.active)) return 'Selecione um paciente ativo.';
  if (!input.date) return 'Informe a data da sessão.';
  if (!input.time) return 'Informe o horário da sessão.';
  if (sessionTimeToMinutes(input.time) < 0) return 'Informe um horário válido.';
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 1) return 'Informe uma duração válida.';
  if (options.requireService && !input.serviceId) return 'Selecione um serviço.';
  const service = input.serviceId ? store.services.find(item => item.id === canonicalPsychologyServiceId(input.serviceId)) : undefined;
  if (input.serviceId && !service) return 'Selecione um serviço válido.';
  if (service && input.durationMinutes !== service.defaultDurationMinutes) return `A duração deve seguir o serviço selecionado (${service.defaultDurationMinutes} min).`;
  if (service && ((input.modality === 'online' && service.modality === 'PRESENTIAL') || (input.modality === 'presencial' && service.modality === 'ONLINE'))) return 'O serviço selecionado não atende esta modalidade.';
  if (input.modality === 'presencial') {
    if (!input.locationId) return 'Selecione um local ativo para a sessão presencial.';
    if (!store.locations.some(location => location.id === input.locationId && location.active && location.professionalId === store.scope.professionalId)) return 'Selecione um local ativo para a sessão presencial.';
  }
  const start = sessionTimeToMinutes(input.time);
  const end = start + input.durationMinutes;
  const conflicts = (options.checkConflicts ?? Boolean(options.ignoreSessionId)) && store.sessions.some(session => {
    if (session.id === options.ignoreSessionId || session.status === 'cancelada' || session.date !== input.date) return false;
    const sessionStart = sessionTimeToMinutes(session.time);
    const sessionEnd = sessionStart + session.durationMinutes;
    return start >= 0 && sessionStart >= 0 && start < sessionEnd && sessionStart < end;
  });
  if (conflicts) return 'Este horário já está ocupado por outra sessão.';
  return null;
}

export function getPsychologyAgendaSessionsForSlot(sessions: PsychologySession[], date: string, time: string): PsychologySession[] {
  return sessions.filter(session => session.date === date && session.time === time && session.status !== 'cancelada');
}

function createId(prefix: string): string {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}-${randomPart}`;
}

export function updatePsychologySettings(store: PsychologyStore, patch: Partial<PsychologySettings>, now = new Date().toISOString()): PsychologyStore {
  const settings = normalizePsychologySettings({ ...store.settings, ...patch }, store.scope, now);
  return { ...store, settings, services: settings.services, locations: settings.locations };
}

export function renamePsychologyLocation(store: PsychologyStore, type: PsychologyLocation['type'], displayName: string, now = new Date().toISOString()): PsychologyStore {
  const normalizedName = displayName.trim();
  if (!normalizedName) return store;
  const target = store.locations.find(location => location.type === type);
  return target ? updatePsychologyLocation(store, target.id, { displayName: normalizedName }, now) : store;
}

export function setPsychologyCategoryColor(store: PsychologyStore, category: keyof PsychologySettings['colors'], color: string, now = new Date().toISOString()): PsychologyStore {
  return updatePsychologySettings(store, { colors: { ...store.settings.colors, [category]: color } }, now);
}

export function restorePsychologyDefaultColors(store: PsychologyStore, now = new Date().toISOString()): PsychologyStore {
  return updatePsychologySettings(store, { colors: { ...PSYCHOLOGY_COLOR_DEFAULTS } }, now);
}

export function createPsychologyLocation(store: PsychologyStore, input: PsychologyLocationInput, now = new Date().toISOString()): PsychologyStore {
  const displayName = input.displayName.trim();
  if (!displayName) return store;
  const location: PsychologyLocation = {
    id: createId('location'),
    professionalId: store.scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    type: 'OTHER',
    displayName,
    address: input.address?.trim() || '',
    fullAddress: input.fullAddress?.trim() || input.address?.trim() || '',
    city: input.city?.trim() || '',
    state: input.state?.trim().toUpperCase() || '',
    googleMapsUrl: input.googleMapsUrl?.trim() || '',
    sortOrder: input.sortOrder || store.locations.length + 1,
    active: input.active !== false,
    isPrimary: Boolean(input.isPrimary),
    color: input.color || PSYCHOLOGY_COLOR_DEFAULTS.PRESENTIAL_PRIMARY,
    createdAt: now,
    updatedAt: now,
  };
  const locations = [...store.locations, location].map(item => ({ ...item, isPrimary: location.isPrimary ? item.id === location.id : item.isPrimary }));
  return updatePsychologySettings({ ...store, locations }, { locations }, now);
}

export function updatePsychologyLocation(store: PsychologyStore, id: string, patch: PsychologyLocationInput, now = new Date().toISOString()): PsychologyStore {
  const existing = store.locations.find(location => location.id === id);
  if (!existing) return store;
  const displayName = patch.displayName === undefined ? existing.displayName : patch.displayName.trim();
  if (!displayName) return store;
  const locations = store.locations.map(location => location.id === id ? {
    ...location,
    displayName,
    address: patch.address === undefined ? location.address || '' : patch.address.trim(),
    fullAddress: patch.fullAddress === undefined ? location.fullAddress || location.address || '' : patch.fullAddress.trim(),
    city: patch.city === undefined ? location.city || '' : patch.city.trim(),
    state: patch.state === undefined ? location.state || '' : patch.state.trim().toUpperCase(),
    googleMapsUrl: patch.googleMapsUrl === undefined ? location.googleMapsUrl || '' : patch.googleMapsUrl.trim(),
    sortOrder: patch.sortOrder === undefined ? location.sortOrder : Math.max(1, patch.sortOrder),
    active: patch.active === undefined ? location.active : patch.active,
    isPrimary: patch.isPrimary === undefined ? location.isPrimary : patch.isPrimary,
    color: patch.color || location.color,
    updatedAt: now,
  } : location);
  const primaryRequested = patch.isPrimary === true;
  const normalizedLocations = primaryRequested
    ? locations.map(location => ({ ...location, isPrimary: location.id === id }))
    : locations;
  return updatePsychologySettings({ ...store, locations: normalizedLocations }, { locations: normalizedLocations }, now);
}

export function setPsychologyPrimaryLocation(store: PsychologyStore, id: string, now = new Date().toISOString()): PsychologyStore {
  if (!store.locations.some(location => location.id === id && location.active)) return store;
  const locations = store.locations.map(location => ({ ...location, isPrimary: location.id === id, updatedAt: location.id === id ? now : location.updatedAt }));
  return updatePsychologySettings({ ...store, locations }, { locations }, now);
}

export function setPsychologyLocationColor(store: PsychologyStore, id: string, color: string, now = new Date().toISOString()): PsychologyStore {
  return updatePsychologyLocation(store, id, { displayName: store.locations.find(location => location.id === id)?.displayName || '', color }, now);
}

export function setPsychologyLocationActive(store: PsychologyStore, id: string, active: boolean, now = new Date().toISOString()): PsychologyStore {
  const location = store.locations.find(item => item.id === id);
  if (!location) return store;
  return updatePsychologyLocation(store, id, { displayName: location.displayName, active, isPrimary: active ? location.isPrimary : false }, now);
}

export function createPsychologyCharge(store: PsychologyStore, input: PsychologyChargeInput, now = new Date().toISOString()): PsychologyStore {
  return createPsychologyChargeInLedger(store, input, now).store;
}

export function createPsychologyPayment(store: PsychologyStore, input: PsychologyPaymentInput, now = new Date().toISOString()): PsychologyStore {
  return createPsychologyPaymentInLedger(store, input, now).store;
}

export function upsertPsychologyPatient(store: PsychologyStore, input: PsychologyPatientInput, id?: string, now = new Date().toISOString()): PsychologyStore {
  const existing = id ? store.patients.find(patient => patient.id === id) : undefined;
  const dateOfBirth = String(input.dateOfBirth || input.birthDate || '').trim();
  const responsibleInput = input.administrativeResponsible;
  const hasResponsibleData = Boolean(responsibleInput && [responsibleInput.fullName, responsibleInput.relationship, responsibleInput.phone, responsibleInput.email].some(value => String(value || '').trim()));
  const responsible = hasResponsibleData && responsibleInput
    ? {
      fullName: responsibleInput.fullName.trim(),
      relationship: responsibleInput.relationship.trim(),
      phone: sanitizeStoredPhone(responsibleInput.phone),
      email: responsibleInput.email.trim().toLocaleLowerCase(),
    }
    : existing?.administrativeResponsible;
  const patient: PsychologyPatient = {
    id: id || createId('patient'),
    professionalId: store.scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    name: input.name.trim(),
    dateOfBirth,
    birthDate: dateOfBirth || undefined,
    phone: sanitizeStoredPhone(input.phone),
    email: input.email.trim() || undefined,
    preferredModality: input.preferredModality,
    administrativeNote: input.administrativeNote.trim() || undefined,
    administrativeNotes: input.administrativeNote.trim() || undefined,
    administrativeResponsible: responsible,
    externalReferences: input.externalReferences?.filter(item => item.source.trim() && item.externalId.trim()).map(item => ({ ...item, source: item.source.trim(), externalId: item.externalId.trim() })),
    inReview: existing?.inReview,
    reviewMarkedAt: existing?.reviewMarkedAt,
    active: input.active,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { ...store, patients: existing ? store.patients.map(item => item.id === patient.id ? patient : item) : [...store.patients, patient] };
}

export function upsertPsychologySession(store: PsychologyStore, input: PsychologySessionInput, id?: string, now = new Date().toISOString()): PsychologyStore {
  const existing = id ? store.sessions.find(session => session.id === id) : undefined;
  const service = input.serviceId ? store.services.find(item => item.id === canonicalPsychologyServiceId(input.serviceId)) : undefined;
  const location = input.modality === 'presencial' ? store.locations.find(item => item.id === input.locationId && item.professionalId === store.scope.professionalId) : undefined;
  const session: PsychologySession = {
    id: id || createId('session'),
    professionalId: store.scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    patientId: input.patientId,
    date: input.date,
    time: input.time,
    durationMinutes: service?.defaultDurationMinutes ?? input.durationMinutes,
    modality: input.modality,
    serviceId: input.serviceId ? canonicalPsychologyServiceId(input.serviceId) : undefined,
    locationId: input.modality === 'presencial' ? input.locationId : undefined,
    locationType: input.modality === 'presencial' ? location?.type || input.locationType : undefined,
    chargeId: input.chargeId,
    administrativeNote: input.administrativeNote.trim() || undefined,
    bookingOrigin: existing?.bookingOrigin || (!existing ? input.bookingOrigin || 'PROFESSIONAL' : undefined),
    status: existing?.status === 'cancelada' ? 'agendada' : existing?.status || 'agendada',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { ...store, sessions: existing ? store.sessions.map(item => item.id === session.id ? session : item) : [...store.sessions, session] };
}

export function updatePsychologySessionStatus(store: PsychologyStore, sessionId: string, status: PsychologySessionStatus, now = new Date().toISOString()): PsychologyStore {
  return { ...store, sessions: store.sessions.map(session => session.id === sessionId ? { ...session, status, updatedAt: now } : session) };
}

export function upsertPsychologyPersonalCommitment(store: PsychologyStore, input: PsychologyPersonalInput, id?: string, now = new Date().toISOString()): PsychologyStore {
  const existing = id ? store.personalCommitments.find(item => item.id === id) : undefined;
  const commitment: PsychologyPersonalCommitment = {
    id: id || createId('personal'),
    professionalId: store.scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    date: input.date,
    time: input.time,
    durationMinutes: input.durationMinutes,
    type: input.type,
    title: input.title?.trim() || undefined,
    note: input.note.trim() || undefined,
    recurrence: input.recurrence || existing?.recurrence || 'Não repetir',
    alarmEnabled: input.alarmEnabled ?? existing?.alarmEnabled ?? false,
    alarmAdvance: input.alarmEnabled ? input.alarmAdvance : undefined,
    alarmSound: input.alarmEnabled ? input.alarmSound : undefined,
    alarmVolume: input.alarmEnabled ? input.alarmVolume : undefined,
    alarmFadeIn: input.alarmEnabled ? input.alarmFadeIn : undefined,
    isDone: input.isDone ?? existing?.isDone ?? false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { ...store, personalCommitments: existing ? store.personalCommitments.map(item => item.id === commitment.id ? commitment : item) : [...store.personalCommitments, commitment] };
}

export function savePsychologySessionRecord(store: PsychologyStore, sessionId: string, text: string, now = new Date().toISOString()): PsychologyStore {
  const session = store.sessions.find(item => item.id === sessionId && belongsToScope(item, store.scope));
  if (!session || !text.trim()) return store;
  const existing = store.sessionRecords.find(item => item.sessionId === sessionId && belongsToScope(item, store.scope));
  const record: PsychologySessionRecord = {
    id: existing?.id || createId('record'),
    sessionId,
    patientId: session.patientId,
    professionalId: store.scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    sessionDate: session.date,
    sessionTime: session.time,
    content: text.trim(),
    text: text.trim(),
    date: session.date,
    authorProfessionalId: store.scope.professionalId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { ...store, sessionRecords: existing ? store.sessionRecords.map(item => item.id === record.id ? record : item) : [...store.sessionRecords, record] };
}

export function getPsychologyDayItems(store: PsychologyStore, date: string): Array<{ kind: 'session'; item: PsychologySession } | { kind: 'personal'; item: PsychologyPersonalCommitment }> {
  const sessions = store.sessions.filter(item => item.date === date && belongsToScope(item, store.scope)).map(item => ({ kind: 'session' as const, item }));
  const personal = getPsychologyPersonalOccurrences(store, new Date(`${date}T00:00:00`), new Date(`${date}T23:59:59`)).map(item => ({ kind: 'personal' as const, item }));
  return [...sessions, ...personal].sort((a, b) => a.item.time.localeCompare(b.item.time));
}

export function toPsychologyPersonalAppointment(commitment: PsychologyPersonalCommitment): PersonalAppointment {
  return {
    id: commitment.id,
    type: (commitment.type === 'Reunião' ? 'Outro' : commitment.type) as PersonalAppointmentType,
    date: commitment.date,
    time: commitment.time,
    durationMinutes: commitment.durationMinutes,
    recurrence: commitment.recurrence || 'Não repetir',
    notes: commitment.note || '',
    alarmEnabled: Boolean(commitment.alarmEnabled),
    alarmAdvance: commitment.alarmAdvance,
    alarmSound: commitment.alarmSound,
    alarmVolume: commitment.alarmVolume,
    alarmFadeIn: commitment.alarmFadeIn,
    isDone: Boolean(commitment.isDone),
  };
}

export function fromPsychologyPersonalAppointment(appointment: PersonalAppointment, scope: PsychologyScope, existing?: PsychologyPersonalCommitment, now = new Date().toISOString()): PsychologyPersonalCommitment {
  return {
    id: appointment.id,
    professionalId: scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    date: appointment.date,
    time: appointment.time,
    durationMinutes: appointment.durationMinutes,
    type: appointment.type as PsychologyPersonalType,
    title: existing?.title || appointment.type,
    note: appointment.notes,
    recurrence: appointment.recurrence,
    alarmEnabled: appointment.alarmEnabled,
    alarmAdvance: appointment.alarmAdvance,
    alarmSound: appointment.alarmSound,
    alarmVolume: appointment.alarmVolume,
    alarmFadeIn: appointment.alarmFadeIn,
    isDone: appointment.isDone,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export function getPsychologyPersonalOccurrences(store: PsychologyStore, start: Date, end: Date): PsychologyPersonalCommitmentOccurrence[] {
  return getPersonalAppointmentOccurrences(
    store.personalCommitments.filter(item => belongsToScope(item, store.scope)).map(toPsychologyPersonalAppointment),
    start,
    end,
  ).map((occurrence: PersonalAppointmentOccurrence) => {
    const date = `${occurrence.occDate.getFullYear()}-${String(occurrence.occDate.getMonth() + 1).padStart(2, '0')}-${String(occurrence.occDate.getDate()).padStart(2, '0')}`;
    const existing = store.personalCommitments.find(item => item.id === occurrence.id);
    return {
      ...(existing || fromPsychologyPersonalAppointment(occurrence, store.scope)),
      date,
      time: occurrence.time,
      recurrence: occurrence.recurrence,
      alarmEnabled: occurrence.alarmEnabled,
      alarmAdvance: occurrence.alarmAdvance,
      alarmSound: occurrence.alarmSound,
      alarmVolume: occurrence.alarmVolume,
      alarmFadeIn: occurrence.alarmFadeIn,
      isDone: occurrence.isDone,
      occurrenceId: `${occurrence.id}:${date}`,
      occDate: occurrence.occDate,
      occurrenceDateTime: occurrence.occurrenceDateTime,
    };
  });
}

export function validatePsychologySessionPackage(input: PsychologySessionPackageInput, store: PsychologyStore): string | null {
  if (!store.patients.some(patient => patient.id === input.patientId && patient.active && belongsToScope(patient, store.scope))) return 'Selecione um paciente ativo.';
  if (!input.name.trim()) return 'Informe o nome do pacote.';
  if (!Number.isInteger(input.totalSessions) || input.totalSessions < 1) return 'Informe uma quantidade válida de sessões.';
  if (!Number.isInteger(input.usedSessions || 0) || (input.usedSessions || 0) < 0 || (input.usedSessions || 0) > input.totalSessions) return 'As sessões utilizadas não podem ultrapassar o total.';
  if (!input.startDate) return 'Informe a data inicial do pacote.';
  if (input.endDate && input.endDate < input.startDate) return 'A data final não pode ser anterior à inicial.';
  return null;
}

export function upsertPsychologySessionPackage(store: PsychologyStore, input: PsychologySessionPackageInput, id?: string, now = new Date().toISOString()): PsychologyStore {
  const existing = id ? store.sessionPackages.find(item => item.id === id && belongsToScope(item, store.scope)) : undefined;
  if (validatePsychologySessionPackage(input, store)) return store;
  const totalSessions = Math.floor(input.totalSessions);
  const usedSessions = Math.min(totalSessions, Math.max(0, Math.floor(input.usedSessions || 0)));
  const item: PsychologySessionPackage = {
    id: id || createId('package'),
    patientId: input.patientId,
    professionalId: store.scope.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    name: input.name.trim(),
    totalSessions,
    usedSessions,
    startDate: input.startDate,
    endDate: input.endDate || undefined,
    active: input.active !== false,
    price: typeof input.price === 'number' && input.price >= 0 ? input.price : undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { ...store, sessionPackages: existing ? store.sessionPackages.map(current => current.id === item.id ? item : current) : [...store.sessionPackages, item] };
}

export function getActivePsychologySessionPackages(store: PsychologyStore): PsychologySessionPackage[] {
  return store.sessionPackages.filter(item => belongsToScope(item, store.scope) && item.active && item.usedSessions < item.totalSessions);
}

export function getPsychologySessionPackageRemaining(item: Pick<PsychologySessionPackage, 'totalSessions' | 'usedSessions'>): number {
  return Math.max(0, item.totalSessions - item.usedSessions);
}

export function getPsychologySessionPackageProgress(item: Pick<PsychologySessionPackage, 'totalSessions' | 'usedSessions'>): number {
  if (item.totalSessions < 1) return 0;
  return Math.min(100, Math.max(0, Math.round((item.usedSessions / item.totalSessions) * 100)));
}

export function serializePsychologyStore(store: PsychologyStore): string {
  return JSON.stringify(store);
}

export function parsePsychologyStore(raw: string | null, scope = createPsychologyScope()): PsychologyStore {
  if (!raw) return createEmptyPsychologyStore(scope);
  try {
    return normalizePsychologyStore(JSON.parse(raw), scope);
  } catch {
    return createEmptyPsychologyStore(scope);
  }
}

export function isPsychologyPilotRoute(pathname: string, search: string, isDev: boolean, hostname: string): boolean {
  if (!isDev || !['localhost', '127.0.0.1'].includes(hostname)) return false;
  return pathname.replace(/\/+$/, '') === '/psicologia' || new URLSearchParams(search).get('psicologia') === '1';
}
