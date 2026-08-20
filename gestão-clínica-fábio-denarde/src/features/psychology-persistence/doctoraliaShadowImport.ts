import type {
  PsychologyCanonicalSessionStatus,
  PsychologyPatient,
  PsychologySession,
  PsychologySessionRecord,
  PsychologyStore,
} from '../psychology-pilot/psychologyDomain';
import type { PsychologySessionStatus } from '../psychology-pilot/psychologyDomain';
import { createEmptyPsychologyStore } from '../psychology-pilot/psychologyDomain';
import type { PsychologyLocation, PsychologyService } from '../psychology-pilot/psychologyR2a';
import { createPsychologyPeriod } from '../psychology-pilot/psychologyFinancialLedger';
import { getPsychologySessionsReport } from '../psychology-pilot/psychologyReports';
import type {
  DoctoraliaImportAnalysis,
  DoctoraliaPatientCandidate,
  DoctoraliaAppointmentCandidate,
} from '../psychology-import-export/types';
import type { PsychologyPersistenceScope } from './scope';
import { assertPsychologyPersistenceScope, toLegacyPsychologyScope } from './scope';
import type { PsychologyRepositoryBundle } from './repositoryTypes';
import {
  createPsychologyMemoryState,
  type PsychologyMemoryState,
} from './repositories/memory';
import type {
  PsychologyClinicalSessionRecord,
  PsychologyLocationRecord,
  PsychologyPatientRecord,
  PsychologyServiceRecord,
  PsychologySessionRecordEntity,
} from './types';

export const DOCTORALIA_SHADOW_CUTOFF = '2025-01-01' as const;
export const DOCTORALIA_SHADOW_TIMEZONE = 'America/Sao_Paulo' as const;
export const DOCTORALIA_SHADOW_DESTINATION = 'MEMORY' as const;
export const DOCTORALIA_SHADOW_SOURCE = 'DOCTORALIA' as const;

export type DoctoraliaShadowCanonicalStatus = PsychologyCanonicalSessionStatus;

type CanonicalPatient = PsychologyPatientRecord;
type CanonicalSession = PsychologySessionRecordEntity;
type CanonicalService = PsychologyServiceRecord;
type CanonicalLocation = PsychologyLocationRecord;

export interface DoctoraliaShadowSourceFile {
  name: string;
  sha256: string;
}

export interface DoctoraliaShadowImportInput {
  analysis: DoctoraliaImportAnalysis;
  scope: PsychologyPersistenceScope;
  migrationId: string;
  sourceFiles: readonly DoctoraliaShadowSourceFile[];
  now: string;
  performanceMs?: { parsing: number; planning: number };
}

export interface DoctoraliaShadowExcludedPatient {
  externalPatientId: string;
  reason: 'NO_APPOINTMENTS_FOUND';
  recoverable: true;
}

export interface DoctoraliaShadowMigrationManifest {
  migrationId: string;
  source: typeof DOCTORALIA_SHADOW_SOURCE;
  sourceFiles: string[];
  sourceChecksums: Record<string, string>;
  cutoffDate: typeof DOCTORALIA_SHADOW_CUTOFF;
  timezone: typeof DOCTORALIA_SHADOW_TIMEZONE;
  scope: PsychologyPersistenceScope;
  patientCounts: {
    sourceTotal: number;
    candidates: number;
    active: number;
    inactive: number;
    excludedGroupC: number;
    externalReferences: number;
  };
  sessionCounts: {
    sourceTotal: number;
    eligible: number;
    cancelled: number;
    legacyAttendanceUnknown: number;
    scheduled: number;
  };
  serviceCounts: { source: number; planned: number };
  locationCounts: { source: number; planned: number; physical: number };
  clinicalBackgroundCounts: { source: number; planned: number };
  excludedCounts: { groupC: number };
  warnings: string[];
  conflicts: string[];
  writesPlanned: number;
  writesPerformedShadow: number;
  destination: typeof DOCTORALIA_SHADOW_DESTINATION;
  reconciliationStatus: 'PENDING' | 'PASS' | 'FAIL';
}

export interface DoctoraliaShadowMigrationPlan {
  input: DoctoraliaShadowImportInput;
  manifest: DoctoraliaShadowMigrationManifest;
  patients: CanonicalPatient[];
  sessions: CanonicalSession[];
  services: CanonicalService[];
  locations: CanonicalLocation[];
  clinicalBackgrounds: PsychologyClinicalSessionRecord[];
  excludedPatients: DoctoraliaShadowExcludedPatient[];
  patientIdByExternalId: ReadonlyMap<string, string>;
  sessionIdByExternalEventId: ReadonlyMap<string, string>;
  serviceIdByNormalizedName: ReadonlyMap<string, string>;
  locationIdByNormalizedName: ReadonlyMap<string, string>;
}

export interface DoctoraliaShadowReconciliation {
  status: 'PASS' | 'FAIL';
  patient: {
    sourceCandidates: number;
    destination: number;
    sourceActive: number;
    destinationActive: number;
    sourceInactive: number;
    destinationInactive: number;
    excludedGroupC: number;
    externalReferenceCoverage: number;
    duplicateExternalReferences: number;
  };
  session: {
    sourceEligible: number;
    destination: number;
    statusCounts: Record<DoctoraliaShadowCanonicalStatus, number>;
    sourceStatusCounts: Record<DoctoraliaShadowCanonicalStatus, number>;
    orphanPatientReferences: number;
    orphanServiceReferences: number;
    orphanLocationReferences: number;
    onlineWithPhysicalLocation: number;
    positiveDurations: number;
    civilDateTimeMatches: number;
  };
  services: { source: number; destination: number; duplicateExternalReferences: number };
  locations: { source: number; destination: number; physical: number; duplicateExternalReferences: number };
  clinical: { sourceBackgrounds: number; destinationBackgrounds: number; administrativeMedicationLeaks: number };
  finance: { charges: number; payments: number; expenses: number };
  reports: { total: number; cancelled: number; realized: number; absences: number; attendanceRate: number | null };
  idempotency: { firstPassCounts: Record<string, number>; secondPassCounts: Record<string, number>; duplicateDelta: number; passed: boolean };
  queryPatterns: { dateRange: number; patient: number; paginatedPatients: number };
  performanceMs: { parsing: number; planning: number; firstShadowImport: number; secondShadowImport: number; reconciliation: number };
  failures: string[];
}

export interface DoctoraliaShadowImportRun {
  plan: DoctoraliaShadowMigrationPlan;
  reconciliation: DoctoraliaShadowReconciliation;
  writesPerformedShadow: number;
  store: PsychologyStore;
}

function normalizedKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toLocaleLowerCase();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalId(kind: string, value: string): string {
  return `doctoralia-${kind}-${stableHash(`${kind}:${value}`)}-${stableHash(value).slice(0, 6)}`;
}

function externalReference(externalId: string, importedAt: string) {
  return { source: DOCTORALIA_SHADOW_SOURCE, externalId, importedAt };
}

function sourceStatusFor(status: DoctoraliaShadowCanonicalStatus): string {
  if (status === 'CANCELLED') return 'cancelada';
  return 'agendada';
}

function canonicalStatusFor(appointment: DoctoraliaAppointmentCandidate): DoctoraliaShadowCanonicalStatus {
  return appointment.status;
}

function mostCommonDuration(appointments: readonly DoctoraliaAppointmentCandidate[], serviceName: string): number {
  const counts = new Map<number, number>();
  appointments.filter(item => normalizedKey(item.service) === normalizedKey(serviceName)).forEach(item => counts.set(item.durationMinutes, (counts.get(item.durationMinutes) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 50;
}

function serviceModality(appointments: readonly DoctoraliaAppointmentCandidate[], serviceName: string): PsychologyService['modality'] {
  const modalities = new Set(appointments.filter(item => normalizedKey(item.service) === normalizedKey(serviceName)).map(item => item.modality));
  if (modalities.has('ONLINE') && modalities.has('PRESENCIAL')) return 'BOTH';
  return modalities.has('ONLINE') ? 'ONLINE' : 'PRESENTIAL';
}

function preferredModality(appointments: readonly DoctoraliaAppointmentCandidate[], patientExternalId: string): 'online' | 'presencial' {
  const patientAppointments = appointments.filter(item => item.externalPatientId === patientExternalId);
  return patientAppointments.length > 0 && patientAppointments.every(item => item.modality === 'ONLINE') ? 'online' : 'presencial';
}

function copyPatient(candidate: DoctoraliaPatientCandidate, appointments: readonly DoctoraliaAppointmentCandidate[], scope: PsychologyPersistenceScope, now: string): CanonicalPatient {
  const id = canonicalId('patient', candidate.externalPatientId);
  return {
    id,
    workspaceId: scope.workspaceId,
    professionalId: scope.professionalId,
    context: scope.context,
    name: candidate.name,
    birthDate: candidate.birthDate || '',
    phone: candidate.phone || '',
    additionalPhone: candidate.additionalPhone,
    email: candidate.email,
    address: candidate.address,
    demographics: candidate.demographics,
    migrationReview: candidate.migrationReview ? { required: true, reason: candidate.migrationReview.reason } : undefined,
    preferredModality: preferredModality(appointments, candidate.externalPatientId),
    externalReferences: [externalReference(candidate.externalPatientId, now)],
    active: candidate.status === 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

function buildLocations(analysis: DoctoraliaImportAnalysis, scope: PsychologyPersistenceScope, now: string): { locations: CanonicalLocation[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const locations = analysis.dryRun.locations.map((source, index) => {
    const key = source.normalizedKey || normalizedKey(source.name);
    const id = canonicalId('location', key);
    ids.set(key, id);
    return {
      id,
      workspaceId: scope.workspaceId,
      professionalId: scope.professionalId,
      context: scope.context,
      type: index === 0 ? 'PRIMARY_OFFICE' : index === 1 ? 'EXTERNAL_OFFICE' : 'OTHER',
      displayName: source.name,
      active: true,
      isPrimary: index === 0,
      color: index === 0 ? '#DC2626' : index === 1 ? '#EA580C' : '#2563EB',
      colorKey: index === 0 ? 'PRESENTIAL_PRIMARY' : index === 1 ? 'EXTERNAL_OFFICE' : undefined,
      externalReferences: [externalReference(key, now)],
      createdAt: now,
      updatedAt: now,
    } satisfies CanonicalLocation;
  });
  return { locations, ids };
}

function buildServices(analysis: DoctoraliaImportAnalysis, scope: PsychologyPersistenceScope, now: string): { services: CanonicalService[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const services = analysis.dryRun.services.map(source => {
    const key = source.normalizedKey || normalizedKey(source.name);
    const id = canonicalId('service', key);
    ids.set(key, id);
    return {
      id,
      workspaceId: scope.workspaceId,
      professionalId: scope.professionalId,
      context: scope.context,
      name: source.name,
      defaultDurationMinutes: mostCommonDuration(analysis.dryRun.appointments, source.name),
      defaultPrice: 0,
      modality: serviceModality(analysis.dryRun.appointments, source.name),
      active: true,
      externalReferences: [externalReference(key, now)],
      createdAt: now,
      updatedAt: now,
    } satisfies CanonicalService;
  });
  return { services, ids };
}

function buildSessions(
  appointments: readonly DoctoraliaAppointmentCandidate[],
  patientIds: ReadonlyMap<string, string>,
  serviceIds: ReadonlyMap<string, string>,
  locationIds: ReadonlyMap<string, string>,
  scope: PsychologyPersistenceScope,
  now: string,
): { sessions: CanonicalSession[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const sessions = appointments.map(appointment => {
    const id = canonicalId('session', appointment.externalEventId);
    ids.set(appointment.externalEventId, id);
    const canonicalStatus = canonicalStatusFor(appointment);
    const locationKey = normalizedKey(appointment.locationName || '');
    return {
      id,
      workspaceId: scope.workspaceId,
      professionalId: scope.professionalId,
      context: scope.context,
      patientId: patientIds.get(appointment.externalPatientId) || '',
      date: appointment.civilDate,
      time: appointment.startTime,
      durationMinutes: appointment.durationMinutes,
      modality: appointment.modality === 'ONLINE' ? 'online' : 'presencial',
      serviceId: serviceIds.get(normalizedKey(appointment.service)),
      locationId: appointment.modality === 'PRESENCIAL' ? locationIds.get(locationKey) : undefined,
      locationType: appointment.modality === 'PRESENCIAL' ? (locationKey ? undefined : 'OTHER') : undefined,
      status: sourceStatusFor(canonicalStatus) as PsychologySessionStatus,
      canonicalStatus,
      externalSource: DOCTORALIA_SHADOW_SOURCE,
      externalEventId: appointment.externalEventId,
      externalScheduleId: appointment.externalScheduleId,
      sourceStatus: appointment.sourceStatus,
      createdAt: now,
      updatedAt: now,
    } satisfies CanonicalSession;
  });
  return { sessions, ids };
}

function buildClinicalBackgrounds(
  analysis: DoctoraliaImportAnalysis,
  patientIds: ReadonlyMap<string, string>,
  scope: PsychologyPersistenceScope,
  now: string,
): PsychologyClinicalSessionRecord[] {
  return analysis.dryRun.clinicalBackgrounds.map(background => ({
    id: canonicalId('clinical-background', background.externalPatientId),
    workspaceId: scope.workspaceId,
    patientId: patientIds.get(background.externalPatientId) || '',
    professionalId: scope.professionalId,
    context: scope.context,
    content: background.medications,
    date: '',
    sessionDate: '',
    sessionTime: '',
    authorProfessionalId: scope.professionalId,
    externalSource: DOCTORALIA_SHADOW_SOURCE,
    createdAt: now,
    updatedAt: now,
  }));
}

function countStatus(sessions: readonly PsychologySession[]): Record<DoctoraliaShadowCanonicalStatus, number> {
  return {
    CANCELLED: sessions.filter(item => item.canonicalStatus === 'CANCELLED').length,
    LEGACY_ATTENDANCE_UNKNOWN: sessions.filter(item => item.canonicalStatus === 'LEGACY_ATTENDANCE_UNKNOWN').length,
    SCHEDULED: sessions.filter(item => item.canonicalStatus === 'SCHEDULED').length,
  };
}

function duplicateExternalReferences(items: readonly { externalReferences?: readonly { source: string; externalId: string }[] }[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  items.flatMap(item => item.externalReferences || []).forEach(reference => {
    const key = `${reference.source}:${reference.externalId}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  });
  return duplicates;
}

function sourceStatusCounts(appointments: readonly DoctoraliaAppointmentCandidate[]): Record<DoctoraliaShadowCanonicalStatus, number> {
  return {
    CANCELLED: appointments.filter(item => item.status === 'CANCELLED').length,
    LEGACY_ATTENDANCE_UNKNOWN: appointments.filter(item => item.status === 'LEGACY_ATTENDANCE_UNKNOWN').length,
    SCHEDULED: appointments.filter(item => item.status === 'SCHEDULED').length,
  };
}

function sourceConflictCodes(analysis: DoctoraliaImportAnalysis): string[] {
  const missingPatientReference = analysis.dryRun.appointments.filter(item => !analysis.dryRun.patients.some(patient => patient.externalPatientId === item.externalPatientId)).length;
  return [
    ...(missingPatientReference > 0 ? [`missing_patient_reference:${missingPatientReference}`] : []),
    ...(analysis.bundle.conflicts.length > missingPatientReference ? [`adapter_other_conflicts:${analysis.bundle.conflicts.length - missingPatientReference}`] : []),
  ];
}

export function createDoctoraliaShadowMigrationPlan(input: DoctoraliaShadowImportInput): DoctoraliaShadowMigrationPlan {
  assertPsychologyPersistenceScope(input.scope);
  if (!input.migrationId.trim()) throw new Error('R2B4 exige migrationId controlado.');
  if (input.sourceFiles.length !== 2) throw new Error('R2B4 exige os dois arquivos Doctoralia e seus checksums.');
  const analysis = input.analysis;
  const patientIdByExternalId = new Map<string, string>();
  const patients = analysis.dryRun.patients.map(candidate => {
    const patient = copyPatient(candidate, analysis.dryRun.appointments, input.scope, input.now);
    patientIdByExternalId.set(candidate.externalPatientId, patient.id);
    return patient;
  });
  const { services, ids: serviceIdByNormalizedName } = buildServices(analysis, input.scope, input.now);
  const { locations, ids: locationIdByNormalizedName } = buildLocations(analysis, input.scope, input.now);
  const { sessions, ids: sessionIdByExternalEventId } = buildSessions(analysis.dryRun.appointments, patientIdByExternalId, serviceIdByNormalizedName, locationIdByNormalizedName, input.scope, input.now);
  const clinicalBackgrounds = buildClinicalBackgrounds(analysis, patientIdByExternalId, input.scope, input.now);
  const excludedPatients = analysis.dryRun.notImportedPatients.map(item => ({ externalPatientId: item.externalPatientId, reason: 'NO_APPOINTMENTS_FOUND' as const, recoverable: true as const }));
  const sourceStatus = sourceStatusCounts(analysis.dryRun.appointments);
  const writesPlanned = patients.length + sessions.length + services.length + locations.length + clinicalBackgrounds.length;
  const manifest: DoctoraliaShadowMigrationManifest = {
    migrationId: input.migrationId,
    source: DOCTORALIA_SHADOW_SOURCE,
    sourceFiles: input.sourceFiles.map(item => item.name),
    sourceChecksums: Object.fromEntries(input.sourceFiles.map(item => [item.name, item.sha256])),
    cutoffDate: DOCTORALIA_SHADOW_CUTOFF,
    timezone: DOCTORALIA_SHADOW_TIMEZONE,
    scope: input.scope,
    patientCounts: {
      sourceTotal: analysis.dryRun.patientCounts.total,
      candidates: patients.length,
      active: patients.filter(item => item.active).length,
      inactive: patients.filter(item => !item.active).length,
      excludedGroupC: excludedPatients.length,
      externalReferences: patients.flatMap(item => item.externalReferences || []).length,
    },
    sessionCounts: {
      sourceTotal: analysis.dryRun.appointmentCounts.totalOriginal,
      eligible: sessions.length,
      cancelled: sourceStatus.CANCELLED,
      legacyAttendanceUnknown: sourceStatus.LEGACY_ATTENDANCE_UNKNOWN,
      scheduled: sourceStatus.SCHEDULED,
    },
    serviceCounts: { source: analysis.dryRun.services.length, planned: services.length },
    locationCounts: { source: analysis.dryRun.locations.length, planned: locations.length, physical: locations.length },
    clinicalBackgroundCounts: { source: analysis.dryRun.clinicalBackgrounds.length, planned: clinicalBackgrounds.length },
    excludedCounts: { groupC: excludedPatients.length },
    warnings: [...new Set(['status_mapping_conservative', ...analysis.bundle.warnings.map(item => item.code)])],
    conflicts: sourceConflictCodes(analysis),
    writesPlanned,
    writesPerformedShadow: 0,
    destination: DOCTORALIA_SHADOW_DESTINATION,
    reconciliationStatus: 'PENDING',
  };
  return { input, manifest, patients, sessions, services, locations, clinicalBackgrounds, excludedPatients, patientIdByExternalId, sessionIdByExternalEventId, serviceIdByNormalizedName, locationIdByNormalizedName };
}

async function upsertPlan(plan: DoctoraliaShadowMigrationPlan, repositories: PsychologyRepositoryBundle): Promise<number> {
  let writes = 0;
  for (const patient of plan.patients) { await repositories.patients.upsert(plan.input.scope, patient as never); writes += 1; }
  for (const service of plan.services) { await repositories.services.upsert(plan.input.scope, service as never); writes += 1; }
  for (const location of plan.locations) { await repositories.locations.upsert(plan.input.scope, location as never); writes += 1; }
  for (const session of plan.sessions) { await repositories.sessions.upsert(plan.input.scope, session as never); writes += 1; }
  for (const record of plan.clinicalBackgrounds) { await repositories.sessionRecords.upsert(plan.input.scope, record as never); writes += 1; }
  return writes;
}

async function listCanonicalStore(repositories: PsychologyRepositoryBundle, scope: PsychologyPersistenceScope): Promise<PsychologyStore> {
  const [patients, sessions, personalCommitments, sessionRecords, services, locations, charges, payments, expenses, sessionPackages, documents, attachments] = await Promise.all([
    repositories.patients.list(scope), repositories.sessions.list(scope), repositories.personalAppointments.list(scope), repositories.sessionRecords.list(scope),
    repositories.services.list(scope), repositories.locations.list(scope), repositories.financial.listCharges(scope), repositories.financial.listPayments(scope),
    repositories.financial.listExpenses(scope), repositories.packages.list(scope), repositories.documents.list(scope), repositories.attachments.list(scope),
  ]);
  const store = createEmptyPsychologyStore(toLegacyPsychologyScope(scope));
  return {
    ...store,
    patients: patients as unknown as PsychologyStore['patients'],
    sessions: sessions as unknown as PsychologyStore['sessions'],
    personalCommitments: personalCommitments as unknown as PsychologyStore['personalCommitments'],
    sessionRecords: sessionRecords as unknown as PsychologyStore['sessionRecords'],
    services: services as unknown as PsychologyStore['services'],
    locations: locations as unknown as PsychologyStore['locations'],
    charges: charges as unknown as PsychologyStore['charges'],
    payments: payments as unknown as PsychologyStore['payments'],
    expenses: expenses as unknown as PsychologyStore['expenses'],
    sessionPackages: sessionPackages as unknown as PsychologyStore['sessionPackages'],
    documents: documents as unknown as PsychologyStore['documents'],
    attachments: attachments as unknown as PsychologyStore['attachments'],
  };
}

function idempotencyCounts(store: PsychologyStore): Record<string, number> {
  return { patients: store.patients.length, sessions: store.sessions.length, services: store.services.length, locations: store.locations.length, clinicalBackgrounds: store.sessionRecords.length, charges: store.charges.length, payments: store.payments.length, expenses: store.expenses.length };
}

function customReportPeriod(store: PsychologyStore) {
  const dates = store.sessions.map(item => item.date).sort();
  return createPsychologyPeriod('custom', new Date(`${dates[0] || DOCTORALIA_SHADOW_CUTOFF}T12:00:00`), dates[0] || DOCTORALIA_SHADOW_CUTOFF, dates.at(-1) || DOCTORALIA_SHADOW_CUTOFF);
}

function reconcilePlan(plan: DoctoraliaShadowMigrationPlan, store: PsychologyStore, firstPassCounts: Record<string, number>, secondPassCounts: Record<string, number>, performanceMs: DoctoraliaShadowReconciliation['performanceMs']): DoctoraliaShadowReconciliation {
  const failures: string[] = [];
  const sourceStatus = sourceStatusCounts(plan.input.analysis.dryRun.appointments);
  const destinationStatus = countStatus(store.sessions);
  const patientIds = new Set(store.patients.map(item => item.id));
  const serviceIds = new Set(store.services.map(item => item.id));
  const locationIds = new Set(store.locations.map(item => item.id));
  const orphanPatientReferences = store.sessions.filter(item => !patientIds.has(item.patientId)).length;
  const orphanServiceReferences = store.sessions.filter(item => item.serviceId && !serviceIds.has(item.serviceId)).length;
  const orphanLocationReferences = store.sessions.filter(item => item.modality === 'presencial' && (!item.locationId || !locationIds.has(item.locationId))).length;
  const onlineWithPhysicalLocation = store.sessions.filter(item => item.modality === 'online' && item.locationId).length;
  const positiveDurations = store.sessions.filter(item => item.durationMinutes > 0).length;
  const sourceByEvent = new Map(plan.input.analysis.dryRun.appointments.map(item => [item.externalEventId, item]));
  const civilDateTimeMatches = store.sessions.filter(item => {
    const source = sourceByEvent.get(item.externalEventId || '');
    return Boolean(source && source.civilDate === item.date && source.startTime === item.time);
  }).length;
  const externalReferenceCoverage = store.patients.filter(item => item.externalReferences?.some(reference => reference.source === DOCTORALIA_SHADOW_SOURCE)).length;
  const duplicatePatientRefs = duplicateExternalReferences(store.patients);
  const duplicateServiceRefs = duplicateExternalReferences(store.services);
  const duplicateLocationRefs = duplicateExternalReferences(store.locations);
  const clinicalBackgrounds = store.sessionRecords.filter(item => item.id.startsWith('doctoralia-clinical-background-'));
  const administrativeMedicationLeaks = store.patients.filter(item => 'medications' in item || 'medication' in item).length;
  const period = customReportPeriod(store);
  const report = getPsychologySessionsReport(store, { period, sessionStatus: 'all', modality: 'all', patientStatus: 'all' });
  const dateRange = store.sessions.filter(item => item.date >= DOCTORALIA_SHADOW_CUTOFF && item.date <= period.endDate).length;
  const patientQueryId = store.sessions[0]?.patientId;
  const patientQuery = patientQueryId ? store.sessions.filter(item => item.patientId === patientQueryId).length : 0;
  const paginatedPatients = store.patients.slice(0, 50).length;
  const idempotencyDuplicateDelta = Object.values(secondPassCounts).reduce((sum, count, index) => sum + Math.max(0, count - Object.values(firstPassCounts)[index]), 0);
  const idempotencyPassed = idempotencyDuplicateDelta === 0 && secondPassCounts.patients === plan.patients.length && secondPassCounts.sessions === plan.sessions.length && secondPassCounts.services === plan.services.length && secondPassCounts.locations === plan.locations.length;
  const checks: Array<[boolean, string]> = [
    [store.patients.length === plan.patients.length, 'patient count mismatch'],
    [store.patients.filter(item => item.active).length === plan.patients.filter(item => item.active).length, 'patient active count mismatch'],
    [store.patients.filter(item => !item.active).length === plan.patients.filter(item => !item.active).length, 'patient inactive count mismatch'],
    [store.sessions.length === plan.sessions.length, 'session count mismatch'],
    [JSON.stringify(destinationStatus) === JSON.stringify(sourceStatus), 'session status count mismatch'],
    [store.services.length === plan.services.length, 'service count mismatch'],
    [store.locations.length === plan.locations.length, 'location count mismatch'],
    [externalReferenceCoverage === plan.patients.length, 'patient external reference coverage mismatch'],
    [duplicatePatientRefs === 0 && duplicateServiceRefs === 0 && duplicateLocationRefs === 0, 'duplicate external references found'],
    [orphanPatientReferences === 0 && orphanServiceReferences === 0 && orphanLocationReferences === 0 && onlineWithPhysicalLocation === 0, 'orphan or fake online location found'],
    [positiveDurations === plan.sessions.length, 'non-positive duration found'],
    [civilDateTimeMatches === plan.sessions.length, 'civil date/time shift found'],
    [clinicalBackgrounds.length === plan.clinicalBackgrounds.length && administrativeMedicationLeaks === 0, 'clinical medication isolation mismatch'],
    [store.charges.length === 0 && store.payments.length === 0 && store.expenses.length === 0, 'financial records were created'],
    [report.total === plan.sessions.length && report.cancelled === sourceStatus.CANCELLED && report.realized === 0 && report.absences === 0 && report.attendanceRate === null, 'reports distorted conservative statuses'],
    [idempotencyPassed, 'second shadow run was not idempotent'],
  ];
  checks.forEach(([passed, message]) => { if (!passed) failures.push(message); });
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    patient: { sourceCandidates: plan.patients.length, destination: store.patients.length, sourceActive: plan.patients.filter(item => item.active).length, destinationActive: store.patients.filter(item => item.active).length, sourceInactive: plan.patients.filter(item => !item.active).length, destinationInactive: store.patients.filter(item => !item.active).length, excludedGroupC: plan.excludedPatients.length, externalReferenceCoverage, duplicateExternalReferences: duplicatePatientRefs },
    session: { sourceEligible: plan.sessions.length, destination: store.sessions.length, statusCounts: destinationStatus, sourceStatusCounts: sourceStatus, orphanPatientReferences, orphanServiceReferences, orphanLocationReferences, onlineWithPhysicalLocation, positiveDurations, civilDateTimeMatches },
    services: { source: plan.services.length, destination: store.services.length, duplicateExternalReferences: duplicateServiceRefs },
    locations: { source: plan.locations.length, destination: store.locations.length, physical: store.locations.filter(item => item.type !== 'OTHER' || item.active).length, duplicateExternalReferences: duplicateLocationRefs },
    clinical: { sourceBackgrounds: plan.clinicalBackgrounds.length, destinationBackgrounds: clinicalBackgrounds.length, administrativeMedicationLeaks },
    finance: { charges: store.charges.length, payments: store.payments.length, expenses: store.expenses.length },
    reports: { total: report.total, cancelled: report.cancelled, realized: report.realized, absences: report.absences, attendanceRate: report.attendanceRate },
    idempotency: { firstPassCounts, secondPassCounts, duplicateDelta: idempotencyDuplicateDelta, passed: idempotencyPassed },
    queryPatterns: { dateRange, patient: patientQuery, paginatedPatients },
    performanceMs,
    failures,
  };
}

export async function runDoctoraliaShadowImport(plan: DoctoraliaShadowMigrationPlan, repositories: PsychologyRepositoryBundle): Promise<DoctoraliaShadowImportRun> {
  const firstStarted = Date.now();
  const firstWrites = await upsertPlan(plan, repositories);
  const firstStore = await listCanonicalStore(repositories, plan.input.scope);
  const firstPassCounts = idempotencyCounts(firstStore);
  const secondStarted = Date.now();
  await upsertPlan(plan, repositories);
  const secondStore = await listCanonicalStore(repositories, plan.input.scope);
  const secondPassCounts = idempotencyCounts(secondStore);
  const reconciliationStarted = Date.now();
  const reconciliation = reconcilePlan(plan, secondStore, firstPassCounts, secondPassCounts, { parsing: plan.input.performanceMs?.parsing || 0, planning: plan.input.performanceMs?.planning || 0, firstShadowImport: secondStarted - firstStarted, secondShadowImport: reconciliationStarted - secondStarted, reconciliation: Date.now() - reconciliationStarted });
  plan.manifest.writesPerformedShadow = firstWrites;
  plan.manifest.reconciliationStatus = reconciliation.status;
  return { plan, reconciliation, writesPerformedShadow: firstWrites, store: secondStore };
}

export function rollbackDoctoraliaShadowMemory(state: PsychologyMemoryState): void {
  Object.values(state).forEach(collection => collection.clear());
}

export function createDoctoraliaShadowMemoryDestination(scope: PsychologyPersistenceScope) {
  assertPsychologyPersistenceScope(scope);
  const state = createPsychologyMemoryState();
  return { state, scope };
}
