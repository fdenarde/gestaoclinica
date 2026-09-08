import type { MessageModalityScope } from './messagingDomain';

export type FutureReminderStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SKIPPED_CANCELLED' | 'SKIPPED_OUTSIDE_WINDOW';
export type ReminderEligibilityStatus = 'ELIGIBLE' | 'BLOCKED_MISSING_DATA' | 'SKIPPED_CANCELLED' | 'SKIPPED_OUTSIDE_WINDOW';
export type PublicRouteStatus = 'READY' | 'DEPLOYMENT_PENDING' | 'BLOCKED';
export type SubmissionState = 'PREFLIGHT_READY' | 'DEPLOYMENT_GATE_PENDING' | 'SUBMISSION_READY' | 'BLOCKED';

export interface R2f3AppointmentSnapshot {
  status: string;
  modality: 'ONLINE' | 'PRESENCIAL';
  professionalDisplayName?: string;
  civilDate?: string;
  startTime?: string;
  locationId?: string;
  location?: { displayName?: string; fullAddress?: string; googleMapsUrl?: string };
  managementUrl?: string;
}

export interface ReminderEligibilityResult {
  status: ReminderEligibilityStatus;
  missing: string[];
  reason: string | null;
  timezone: 'America/Sao_Paulo';
  expectedCivilDate: string;
}

export interface SubmissionCandidate {
  localDraftId: string;
  technicalName: string;
  language: 'pt_BR';
  requestedCategory: 'UTILITY';
  draftVersion: number;
  contentHash: string;
  preflightStatus: 'READY' | 'BLOCKED';
  publicRoutesStatus: PublicRouteStatus;
  collisionStatus: 'UNVERIFIED' | 'NO_COLLISION' | 'COLLISION';
  contextBindingStatus: 'BOUND_LOCAL' | 'BOUND_META' | 'UNVERIFIED';
  submissionState: SubmissionState;
  payloadDryRunValidated: boolean;
}

export function resolveProfessionalDisplayName(displayName: string): string {
  return displayName.trim();
}

export function isCivilEveEligible(now: Date, appointmentCivilDate: string, timeZone: 'America/Sao_Paulo' = 'America/Sao_Paulo'): boolean {
  const today = civilDateInTimeZone(now, timeZone);
  return addCivilDays(today, 1) === appointmentCivilDate;
}

export function civilDateInTimeZone(value: Date, timeZone: 'America/Sao_Paulo' = 'America/Sao_Paulo'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCivilDays(civilDate: string, days: number): string {
  const [year, month, day] = civilDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function evaluateR2f3ReminderEligibility(snapshot: R2f3AppointmentSnapshot, now: Date): ReminderEligibilityResult {
  const expectedCivilDate = civilDateInTimeZone(now);
  if (['CANCELLED', 'CANCELED'].includes(snapshot.status.toUpperCase()) || snapshot.status.toLowerCase() === 'cancelada') return { status: 'SKIPPED_CANCELLED', missing: [], reason: 'Consulta cancelada não é elegível.', timezone: 'America/Sao_Paulo', expectedCivilDate };
  if (!snapshot.civilDate || !isCivilEveEligible(now, snapshot.civilDate)) return { status: 'SKIPPED_OUTSIDE_WINDOW', missing: [], reason: 'A janela civil de véspera não corresponde a amanhã em America/Sao_Paulo.', timezone: 'America/Sao_Paulo', expectedCivilDate };
  const missing: string[] = [];
  if (!resolveProfessionalDisplayName(snapshot.professionalDisplayName || '')) missing.push('professional.displayName');
  if (!snapshot.startTime) missing.push('appointment.startTime');
  if (!validManagementUrl(snapshot.managementUrl)) missing.push('management URL HTTPS válida');
  if (snapshot.modality === 'PRESENCIAL') {
    if (!snapshot.locationId) missing.push('locationId');
    if (!snapshot.location?.displayName) missing.push('location.displayName');
    if (!snapshot.location?.fullAddress) missing.push('location.fullAddress');
  }
  if (missing.length) return { status: 'BLOCKED_MISSING_DATA', missing, reason: `Dados obrigatórios ausentes: ${missing.join(', ')}.`, timezone: 'America/Sao_Paulo', expectedCivilDate };
  return { status: 'ELIGIBLE', missing: [], reason: null, timezone: 'America/Sao_Paulo', expectedCivilDate };
}

export function buildSubmissionCandidate(template: { id: string; technicalName?: string; language: 'pt_BR'; requestedCategory: 'UTILITY'; draftVersion?: number; contentHash?: string; preflightStatus?: 'READY' | 'BLOCKED'; metaNameCollisionStatus?: 'UNVERIFIED' | 'NO_COLLISION' | 'COLLISION'; publicRouteStatus?: PublicRouteStatus; contextBindingStatus?: 'BOUND_LOCAL' | 'BOUND_META' | 'UNVERIFIED'; }, payloadDryRunValidated: boolean): SubmissionCandidate {
  const preflightStatus = template.preflightStatus || 'BLOCKED';
  const publicRoutesStatus = template.publicRouteStatus || 'DEPLOYMENT_PENDING';
  const collisionStatus = template.metaNameCollisionStatus || 'UNVERIFIED';
  const contextBindingStatus = template.contextBindingStatus || 'UNVERIFIED';
  const payloadReady = Boolean(payloadDryRunValidated && preflightStatus === 'READY' && collisionStatus === 'NO_COLLISION');
  const submissionState: SubmissionState = preflightStatus !== 'READY' || collisionStatus !== 'NO_COLLISION' || contextBindingStatus === 'UNVERIFIED'
    ? 'BLOCKED'
    : publicRoutesStatus === 'READY'
      ? 'SUBMISSION_READY'
      : 'DEPLOYMENT_GATE_PENDING';
  return { localDraftId: template.id, technicalName: template.technicalName || '', language: template.language, requestedCategory: template.requestedCategory, draftVersion: template.draftVersion || 1, contentHash: template.contentHash || '', preflightStatus, publicRoutesStatus, collisionStatus, contextBindingStatus, submissionState, payloadDryRunValidated: payloadReady };
}

function validManagementUrl(value: string | undefined): boolean {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' && url.pathname.includes('/consulta/'); } catch { return false; }
}

export function modalityForReminder(modality: 'ONLINE' | 'PRESENCIAL'): MessageModalityScope {
  return modality;
}
