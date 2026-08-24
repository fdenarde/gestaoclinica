export const PUBLIC_BOOKING_CONTEXT = 'PSICOLOGIA' as const;

import type { PsychologyBookingOrigin } from '../psychology-pilot/psychologyDomain';
import type { PsychologyAdministrativeResponsible } from '../../lib/psychologyPatientAdministrative';

export type PublicBookingSourceChannel = 'site' | 'direct' | 'google' | 'whatsapp';
export type PublicBookingModality = 'ONLINE' | 'PRESENCIAL';
export type PublicAppointmentStatus = 'SCHEDULED' | 'CANCELLED_BY_PATIENT';
export type PatientConfirmationStatus = 'PENDING' | 'CONFIRMED';

export interface PublicBookingPeriod {
  startTime: string;
  endTime: string;
}

export interface PublicBookingDayAvailability {
  dayOfWeek: number;
  enabled: boolean;
  periods: PublicBookingPeriod[];
}

export interface PublicBookingService {
  id: string;
  name: string;
  durationMinutes: number;
  active: boolean;
  sortOrder: number;
  onlineEnabled: boolean;
  inPersonEnabled: boolean;
  allowedLocationIds: string[];
  /** Legacy local alias; new reads derive modality support from the explicit flags. */
  modalities?: PublicBookingModality[];
}

export interface PublicBookingLocation {
  id: string;
  professionalId: string;
  displayName: string;
  fullAddress: string;
  city: string;
  state: string;
  googleMapsUrl: string;
  active: boolean;
  sortOrder: number;
  /** Legacy local aliases retained only for migration/read compatibility. */
  name?: string;
  address?: string;
}

export interface PublicBookingModalityOption {
  id: PublicBookingModality;
  label: string;
  active: boolean;
}

export interface PublicBookingAvailabilityPeriod extends PublicBookingPeriod {
  dayOfWeek: number;
  enabled: boolean;
  modalities: PublicBookingModality[];
  locationIds?: string[];
}

export type PublicBookingExceptionType = 'BLOCK_DAY' | 'BLOCK_PERIOD' | 'OPEN_PERIOD';

export interface PublicBookingException {
  id: string;
  professionalId: string;
  civilDate: string;
  type: PublicBookingExceptionType;
  startTime?: string;
  endTime?: string;
  modality?: PublicBookingModality;
  locationId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicBookingSettings {
  id: 'online-booking';
  context: typeof PUBLIC_BOOKING_CONTEXT;
  professionalId: string;
  professionalSlug: string;
  professionalName: string;
  clinicDisplayName: string;
  timezone: string;
  active: boolean;
  maxAdvanceDays: number;
  minNoticeHours: number;
  cancellationEnabled: boolean;
  cancellationCutoffHours: number;
  whatsappContactPhoneE164: string;
  slotIntervalMinutes: number;
  weeklyAvailability: PublicBookingDayAvailability[];
  publicBookingAvailability: PublicBookingAvailabilityPeriod[];
  publicBookingExceptions: PublicBookingException[];
  publishedServices: PublicBookingService[];
  publishedModalities: PublicBookingModalityOption[];
  locations: PublicBookingLocation[];
  updatedAt: string;
}

export interface BookingBlock {
  date: string;
  startTime: string;
  durationMinutes: number;
  source: 'session' | 'personal' | 'hold' | 'public-booking';
}

export interface PublicBookingHold extends BookingBlock {
  id: string;
  expiresAt: string;
}

export type PublicBookingFieldValue = string | number | boolean | null;

/**
 * Extensible description of public-booking steps. Every rendered field is
 * required, and a conditional block can make a future administrative field
 * required without weakening the server-side contract.
 */
export interface PublicBookingFieldCondition {
  field: string;
  equals: PublicBookingFieldValue;
}

export interface PublicBookingRequiredField {
  key: string;
  required: true;
  requiredWhen?: PublicBookingFieldCondition;
}

export interface PublicBookingStepContract {
  step: string;
  fields: readonly PublicBookingRequiredField[];
}

export interface PublicBookingRequiredFieldContract {
  version: 1;
  steps: readonly PublicBookingStepContract[];
}

export type PublicBookingPatientInput<TExtension extends object = {}> = {
  name: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  administrativeResponsible?: PsychologyAdministrativeResponsible;
} & TExtension;

export type PublicBookingRequest<TExtension extends object = {}> = PublicBookingPatientInput<TExtension> & {
  professionalSlug: string;
  serviceId: string;
  modality: PublicBookingModality;
  locationId?: string;
  date: string;
  time: string;
  source?: string;
};

export interface PublicAppointmentAuditEvent {
  id: string;
  type: 'PUBLIC_BOOKING_CREATED' | 'PATIENT_CONFIRMED' | 'PATIENT_CANCELLED' | 'RESCHEDULE_REQUEST_INITIATED';
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface PublicAppointment {
  id: string;
  context: typeof PUBLIC_BOOKING_CONTEXT;
  professionalId: string;
  patientId: string;
  sessionId: string;
  serviceId: string;
  modality: PublicBookingModality;
  locationId?: string;
  date: string;
  time: string;
  durationMinutes: number;
  appointmentStatus: PublicAppointmentStatus;
  patientConfirmationStatus: PatientConfirmationStatus;
  source: PublicBookingSourceChannel;
  /** Canonical creator dimension; absent means a legacy appointment. */
  bookingOrigin?: PsychologyBookingOrigin;
  /** Separate opaque capability for current-location map navigation. */
  mapsNavigationRef?: string;
  mapsNavigationRefHash?: string;
  managementTokenHash: string;
  managementTokenExpiresAt: string;
  managementTokenRevokedAt?: string;
  createdAt: string;
  updatedAt: string;
  auditEvents: PublicAppointmentAuditEvent[];
}

export interface LocalOnlineBookingState {
  schemaVersion: 1;
  settings: PublicBookingSettings;
  appointments: PublicAppointment[];
  holds: PublicBookingHold[];
}

export interface PublicBookingSlot {
  date: string;
  time: string;
  endTime: string;
  durationMinutes: number;
  serviceId: string;
  modality: PublicBookingModality;
  locationId?: string;
}

export interface PublicAppointmentSummary {
  id: string;
  professionalName: string;
  clinicDisplayName: string;
  serviceName?: string;
  modality: PublicBookingModality;
  locationName?: string;
  locationAddress?: string;
  googleMapsUrl?: string;
  mapsNavigationUrl?: string;
  date: string;
  time: string;
  endTime: string;
  appointmentStatus: PublicAppointmentStatus;
  patientConfirmationStatus: PatientConfirmationStatus;
  cancellationEnabled: boolean;
  cancellationCutoffHours: number;
}

export interface PublicAppointmentMessagingContext {
  appointmentModality: PublicBookingModality;
  professionalDisplayName: string;
  date: string;
  time: string;
  locationDisplayName?: string;
  locationFullAddress?: string;
  locationGoogleMapsUrl?: string;
  mapsNavigationUrl?: string;
}

export interface PublicBookingResult {
  appointment: PublicAppointment;
  managementToken: string;
  managementUrl: string;
  mapsNavigationRef?: string;
  mapsNavigationUrl?: string;
}

export type ManagementActionResult =
  | { ok: true; summary: PublicAppointmentSummary }
  | { ok: false; code: 'not-found' | 'expired' | 'revoked' | 'cutoff' | 'conflict' | 'invalid'; message: string };

export type RescheduleRequestResult =
  | { ok: true; summary: PublicAppointmentSummary; messagingContext: PublicAppointmentMessagingContext; whatsappUrl: string }
  | { ok: false; code: 'not-found' | 'expired' | 'revoked' | 'invalid'; message: string };

export type MapsNavigationResult =
  | { ok: true; destinationUrl: string; locationName: string; locationAddress?: string }
  | { ok: false; code: 'unavailable' | 'invalid'; message: string; locationName?: string; locationAddress?: string };

export interface PublicBookingRepository {
  getSettings(slug?: string): Promise<PublicBookingSettings | null>;
  updateSettings(patch: Partial<PublicBookingSettings>): Promise<PublicBookingSettings>;
  listPublishedSlots(input: {
    professionalSlug: string;
    serviceId: string;
    modality: PublicBookingModality;
    locationId?: string;
    fromDate: string;
    throughDate: string;
    now?: Date;
  }): Promise<PublicBookingSlot[]>;
  createBooking(input: PublicBookingRequest, now?: Date): Promise<PublicBookingResult | { conflict: true; message: string }>;
  getAppointmentByManagementToken(token: string, now?: Date): Promise<PublicAppointmentSummary | null>;
  confirmByManagementToken(token: string, now?: Date): Promise<ManagementActionResult>;
  cancelByManagementToken(token: string, now?: Date): Promise<ManagementActionResult>;
  requestRescheduleByManagementToken(token: string, now?: Date): Promise<RescheduleRequestResult>;
  getMapsNavigationDestination(navigationRef: string, now?: Date): Promise<MapsNavigationResult>;
}
