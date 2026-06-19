import type { Patient, Session } from '../types';

export type ActivityGallerySessionState = 'not_applicable' | 'waiting' | 'overdue' | 'sent' | 'excused';
export type ActivityGalleryJustificationReason =
  | 'atividade sem registro visual'
  | 'responsável não autorizou'
  | 'sessão administrativa'
  | 'atendimento virtual'
  | 'mídia não produzida'
  | 'problema técnico'
  | 'outro';

export interface ActivityGalleryJustification {
  active: boolean;
  reason: ActivityGalleryJustificationReason;
  note: string;
  createdAt: string | null;
  createdByUserId: string;
  createdByName: string;
  updatedAt: string | null;
  updatedByUserId: string;
  updatedByName: string;
  removedAt?: string | null;
  removedByUserId?: string;
  removedByName?: string;
}

export interface ActivityGalleryStatusRecord {
  sessionId: string;
  patientId: string;
  hasMedia: boolean;
  mediaCount: number;
  lastUploadAt: string | null;
  lastUploadedByUserId: string;
  lastUploadedByName: string;
  lastRecordId: string;
  justification: ActivityGalleryJustification | null;
  updatedAt: string | null;
}

export interface ActivityGallerySessionSummary extends Session {
  state: ActivityGallerySessionState;
  endAt: string | null;
  deadlineAt: string | null;
  elapsedHours: number;
  overdueHours: number;
  escalation: 0 | 24 | 48 | 72;
  mediaCount: number;
  lastUploadAt: string | null;
  justification: ActivityGalleryJustification | null;
}

export interface ProfessionalActivityGalleryPatient {
  patient: Patient;
  professionalNames: string[];
  latestSession: ActivityGallerySessionSummary | null;
  latestUploadAt: string | null;
  hasAnyMedia: boolean | null;
  status: 'idle' | 'waiting' | 'overdue' | 'sent' | 'excused';
  pendingCount: number;
  overdueCount: number;
  sessions: ActivityGallerySessionSummary[];
}

export interface ProfessionalActivityGalleryMetrics {
  latePatientCount: number;
  waitingSessionCount: number;
  regularizedTodayCount: number;
  lateSessionCount: number;
  nextTransitionAt: string | null;
}

export interface ProfessionalActivityGalleryResponse {
  monitoringStart: string | null;
  metrics: ProfessionalActivityGalleryMetrics;
  items: ProfessionalActivityGalleryPatient[];
  professionals: string[];
  patientOptions: { id: string; name: string }[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ProfessionalActivityGalleryFilters {
  search?: string;
  status?: 'all' | 'overdue' | 'waiting' | 'sent' | 'no-media' | 'excused';
  professional?: string;
  patientId?: string;
  dateFrom?: string;
  dateTo?: string;
  archive?: 'active' | 'archived' | 'all';
  page?: number;
  pageSize?: number;
}

export interface ActivityGalleryAuditEntry {
  id: string;
  patientId: string;
  sessionIds: string[];
  action: string;
  actorUserId: string;
  actorName: string;
  createdAt: string | null;
  details: Record<string, unknown>;
}
