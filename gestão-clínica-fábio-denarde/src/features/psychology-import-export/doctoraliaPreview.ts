import type {
  DoctoraliaAddress,
  DoctoraliaAppointmentCandidate,
  DoctoraliaClinicalBackground,
  DoctoraliaDemographics,
  DoctoraliaDryRunResult,
  DoctoraliaNotImportedPatient,
  DoctoraliaPatientCandidate,
} from './types';
import {
  type PsychologyPatient,
  type PsychologyScope,
  type PsychologySession,
  type PsychologyStore,
} from '../psychology-pilot/psychologyDomain';
import type { PsychologyLocation, PsychologyService } from '../psychology-pilot/psychologyR2a';

export const DOCTORALIA_PREVIEW_STORAGE_KEY = 'gestao-clinica:psychology-doctoralia-preview:v1';
export const DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY = `${DOCTORALIA_PREVIEW_STORAGE_KEY}:hidden-cancelled`;
export const DOCTORALIA_PREVIEW_SOURCE = 'DOCTORALIA_PREVIEW' as const;

export function parseDoctoraliaPreviewHiddenCancelledEventIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))] : [];
  } catch {
    return [];
  }
}

export function serializeDoctoraliaPreviewHiddenCancelledEventIds(ids: string[]): string {
  return JSON.stringify([...new Set(ids.filter(item => item.trim().length > 0))]);
}

export interface DoctoraliaPreviewPatientDetails {
  patientId: string;
  externalPatientId: string;
  additionalPhone?: string;
  address: DoctoraliaAddress;
  demographics: DoctoraliaDemographics;
  reviewReason?: DoctoraliaPatientCandidate['migrationReview'];
}

export interface DoctoraliaPreviewBundle {
  version: 1;
  source: typeof DOCTORALIA_PREVIEW_SOURCE;
  createdAt: string;
  cutoff: '2025-01-01';
  timezone: 'America/Sao_Paulo';
  patients: PsychologyPatient[];
  sessions: PsychologySession[];
  services: PsychologyService[];
  locations: PsychologyLocation[];
  patientDetails: DoctoraliaPreviewPatientDetails[];
  clinicalBackgrounds: DoctoraliaClinicalBackground[];
  notImportedPatients: DoctoraliaNotImportedPatient[];
  patientCounts: DoctoraliaDryRunResult['patientCounts'];
  appointmentCounts: DoctoraliaDryRunResult['appointmentCounts'];
  sessionsByDate: Record<string, string[]>;
  sessionsByPatientId: Record<string, string[]>;
}

export interface DoctoraliaPreviewPayload {
  cutoff: '2025-01-01';
  timezone: 'America/Sao_Paulo';
  dryRun: DoctoraliaDryRunResult;
}

export interface PsychologyDoctoraliaPreview {
  bundle: DoctoraliaPreviewBundle;
  store: PsychologyStore;
  patientDetailsById: Map<string, DoctoraliaPreviewPatientDetails>;
  clinicalBackgroundByPatientId: Map<string, DoctoraliaClinicalBackground>;
  sessionsById: Map<string, PsychologySession>;
}

function timestamp(): string {
  return new Date().toISOString();
}

function previewId(kind: string, index: number): string {
  return `doctoralia-preview-${kind}-${String(index + 1).padStart(4, '0')}`;
}

function scopeOf(baseStore: PsychologyStore): PsychologyScope {
  return { professionalId: baseStore.scope.professionalId, context: baseStore.scope.context };
}

function addressText(address: DoctoraliaAddress): string | undefined {
  const lineOne = [address.street, address.number].filter(Boolean).join(', ');
  const lineTwo = [address.neighborhood, address.postalCode && `CEP ${address.postalCode}`].filter(Boolean).join(' · ');
  const lineThree = [address.city, address.state].filter(Boolean).join(' - ');
  return [lineOne, lineTwo, lineThree, address.province, address.country].filter(Boolean).join('\n') || undefined;
}

function preferredModality(appointments: DoctoraliaAppointmentCandidate[], patientId: string): 'online' | 'presencial' {
  const appointment = appointments.find(item => item.externalPatientId === patientId);
  return appointment?.modality === 'ONLINE' ? 'online' : 'presencial';
}

function serviceCatalog(dryRun: DoctoraliaDryRunResult, scope: PsychologyScope, now: string): { items: PsychologyService[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const items = dryRun.services.map((service, index) => {
    const id = previewId('service', index);
    ids.set(service.normalizedKey, id);
    return {
      id,
      professionalId: scope.professionalId,
      context: scope.context,
      name: service.name,
      defaultDurationMinutes: 50,
      defaultPrice: 0,
      modality: 'BOTH' as const,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  });
  return { items, ids };
}

function locationCatalog(dryRun: DoctoraliaDryRunResult, scope: PsychologyScope, baseStore: PsychologyStore, now: string): { items: PsychologyLocation[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const defaultColor = baseStore.settings.colors.PRESENTIAL_PRIMARY || '#7c3aed';
  const items = dryRun.locations.map((location, index) => {
    const id = previewId('location', index);
    ids.set(location.normalizedKey, id);
    return {
      id,
      professionalId: scope.professionalId,
      context: scope.context,
      type: 'OTHER' as const,
      displayName: location.name,
      address: undefined,
      active: true,
      isPrimary: index === 0,
      color: defaultColor,
      colorKey: 'EXTERNAL_OFFICE' as const,
      createdAt: now,
      updatedAt: now,
    };
  });
  return { items, ids };
}

function patientCatalog(dryRun: DoctoraliaDryRunResult, scope: PsychologyScope, appointments: DoctoraliaAppointmentCandidate[], now: string): { items: PsychologyPatient[]; ids: Map<string, string>; details: DoctoraliaPreviewPatientDetails[] } {
  const ids = new Map<string, string>();
  const details: DoctoraliaPreviewPatientDetails[] = [];
  const items = dryRun.patients.map((candidate, index) => {
    const id = previewId('patient', index);
    ids.set(candidate.externalPatientId, id);
    details.push({ patientId: id, externalPatientId: candidate.externalPatientId, additionalPhone: candidate.additionalPhone, address: candidate.address, demographics: candidate.demographics, reviewReason: candidate.migrationReview });
    return {
      id,
      professionalId: scope.professionalId,
      context: scope.context,
      name: candidate.name,
      birthDate: candidate.birthDate || '',
      phone: candidate.phone || candidate.additionalPhone || '',
      email: candidate.email,
      preferredModality: preferredModality(appointments, candidate.externalPatientId),
      administrativeNote: undefined,
      active: candidate.status === 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      externalReferences: [{ source: 'DOCTORALIA', externalId: candidate.externalPatientId, importedAt: now }],
    };
  });
  return { items, ids, details };
}

function sessionCatalog(dryRun: DoctoraliaDryRunResult, scope: PsychologyScope, patientIds: Map<string, string>, serviceIds: Map<string, string>, locationIds: Map<string, string>, now: string): PsychologySession[] {
  return dryRun.appointments.map((appointment, index) => ({
    id: previewId('session', index),
    professionalId: scope.professionalId,
    context: scope.context,
    patientId: patientIds.get(appointment.externalPatientId) || '',
    date: appointment.civilDate,
    time: appointment.startTime,
    durationMinutes: appointment.durationMinutes,
    modality: appointment.modality === 'ONLINE' ? 'online' : 'presencial',
    serviceId: serviceIds.get(appointment.service.replace(/\s+/g, '').toLocaleLowerCase()) || undefined,
    locationId: appointment.locationName ? locationIds.get(appointment.locationName.replace(/\s+/g, '').toLocaleLowerCase()) : undefined,
    locationType: appointment.modality === 'PRESENCIAL' ? 'OTHER' : undefined,
    administrativeNote: appointment.status === 'LEGACY_ATTENDANCE_UNKNOWN' ? 'Histórico — comparecimento não informado' : undefined,
    status: appointment.status === 'CANCELLED' ? 'cancelada' : 'agendada',
    createdAt: now,
    updatedAt: now,
    previewStatus: appointment.status,
    sourceStatus: appointment.sourceStatus,
    externalSource: 'DOCTORALIA',
    externalEventId: appointment.externalEventId,
    externalScheduleId: appointment.externalScheduleId,
  }));
}

function catalogKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toLocaleLowerCase();
}

function replaceCatalogRefs(sessions: PsychologySession[], dryRun: DoctoraliaDryRunResult, serviceIds: Map<string, string>, locationIds: Map<string, string>): PsychologySession[] {
  return sessions.map((session, index) => {
    const appointment = dryRun.appointments[index];
    return {
      ...session,
      serviceId: serviceIds.get(catalogKey(appointment.service)),
      locationId: appointment.locationName ? locationIds.get(catalogKey(appointment.locationName)) : undefined,
    };
  });
}

export function createDoctoraliaPreviewBundle(payload: DoctoraliaPreviewPayload, baseStore: PsychologyStore, createdAt = timestamp()): DoctoraliaPreviewBundle {
  const scope = scopeOf(baseStore);
  const service = serviceCatalog(payload.dryRun, scope, createdAt);
  const location = locationCatalog(payload.dryRun, scope, baseStore, createdAt);
  const patient = patientCatalog(payload.dryRun, scope, payload.dryRun.appointments, createdAt);
  const sessions = replaceCatalogRefs(sessionCatalog(payload.dryRun, scope, patient.ids, service.ids, location.ids, createdAt), payload.dryRun, service.ids, location.ids);
  const sessionsByDate: Record<string, string[]> = {};
  const sessionsByPatientId: Record<string, string[]> = {};
  sessions.forEach(session => {
    sessionsByDate[session.date] = [...(sessionsByDate[session.date] || []), session.id];
    sessionsByPatientId[session.patientId] = [...(sessionsByPatientId[session.patientId] || []), session.id];
  });
  return {
    version: 1,
    source: DOCTORALIA_PREVIEW_SOURCE,
    createdAt,
    cutoff: payload.cutoff,
    timezone: payload.timezone,
    patients: patient.items,
    sessions,
    services: service.items,
    locations: location.items,
    patientDetails: patient.details,
    clinicalBackgrounds: payload.dryRun.clinicalBackgrounds,
    notImportedPatients: payload.dryRun.notImportedPatients,
    patientCounts: payload.dryRun.patientCounts,
    appointmentCounts: payload.dryRun.appointmentCounts,
    sessionsByDate,
    sessionsByPatientId,
  };
}

export function createDoctoraliaPreviewFromBundle(bundle: DoctoraliaPreviewBundle, baseStore: PsychologyStore): PsychologyDoctoraliaPreview {
  const scope = scopeOf(baseStore);
  const settings = { ...baseStore.settings, services: bundle.services, locations: bundle.locations };
  const store: PsychologyStore = {
    ...baseStore,
    scope,
    settings,
    patients: bundle.patients,
    sessions: bundle.sessions,
    personalCommitments: baseStore.personalCommitments,
    sessionRecords: [],
    services: bundle.services,
    locations: bundle.locations,
    charges: [],
    payments: [],
    expenses: [],
    sessionPackages: [],
    documents: [],
    attachments: [],
  };
  const sessionsById = new Map(bundle.sessions.map(session => [session.id, session]));
  return {
    bundle,
    store,
    patientDetailsById: new Map(bundle.patientDetails.map(item => [item.patientId, item])),
    clinicalBackgroundByPatientId: new Map(bundle.clinicalBackgrounds.map(item => [item.externalPatientId, item])),
    sessionsById,
  };
}

export function createDoctoraliaPreview(payload: DoctoraliaPreviewPayload, baseStore: PsychologyStore, createdAt = timestamp()): PsychologyDoctoraliaPreview {
  return createDoctoraliaPreviewFromBundle(createDoctoraliaPreviewBundle(payload, baseStore, createdAt), baseStore);
}

export function serializeDoctoraliaPreviewBundle(bundle: DoctoraliaPreviewBundle): string {
  return JSON.stringify(bundle);
}

export function parseDoctoraliaPreviewBundle(raw: string | null): DoctoraliaPreviewBundle | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DoctoraliaPreviewBundle;
    return parsed?.version === 1 && parsed.source === DOCTORALIA_PREVIEW_SOURCE ? parsed : null;
  } catch {
    return null;
  }
}

export function formatDoctoraliaAddress(address: DoctoraliaAddress): string[] {
  return addressText(address)?.split('\n') || [];
}

function formatDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDoctoraliaPreviewSessionsForDate(preview: PsychologyDoctoraliaPreview, date: string): PsychologySession[] {
  return (preview.bundle.sessionsByDate[date] || [])
    .map(id => preview.sessionsById.get(id))
    .filter((session): session is PsychologySession => Boolean(session));
}

export function getDoctoraliaPreviewSessionsForRange(preview: PsychologyDoctoraliaPreview, start: string, end: string): PsychologySession[] {
  const result: PsychologySession[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cursor <= last) {
    result.push(...getDoctoraliaPreviewSessionsForDate(preview, formatDateKey(cursor)));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function getDoctoraliaPreviewSessionsForPatient(preview: PsychologyDoctoraliaPreview, patientId: string): PsychologySession[] {
  return (preview.bundle.sessionsByPatientId[patientId] || [])
    .map(id => preview.sessionsById.get(id))
    .filter((session): session is PsychologySession => Boolean(session));
}
