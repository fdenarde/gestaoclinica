import type { PatientRegistrationData } from '../types';

export type AccessRole = 'admin' | 'professional' | 'responsible' | 'monitoring';

export type AccessRequestRole = Exclude<AccessRole, 'admin'>;

export type AccessStatus = 'pending' | 'information_requested' | 'approved' | 'rejected' | 'revoked' | 'disabled' | 'canceled';

export type AccessRequestStatus = AccessStatus;

export type AccessContext = AccessRole;

export type AccessPermissionKey =
  | 'access.users.view'
  | 'access.users.manage'
  | 'access.permissions.manage'
  | 'access.view_as_user'
  | 'dashboard.global.view'
  | 'dashboard.own.view'
  | 'patients.list'
  | 'patients.create'
  | 'patients.edit'
  | 'patients.delete'
  | 'patients.clinical_notes.view'
  | 'patients.photo.view'
  | 'patients.photo.upload'
  | 'patients.photo.delete'
  | 'agenda.own.view'
  | 'agenda.general.view'
  | 'agenda.other_patient_identity'
  | 'agenda.edit'
  | 'sessions.status.manage'
  | 'sessions.history.view'
  | 'sessions.remaining.view'
  | 'activities.create'
  | 'activities.edit'
  | 'activities.delete'
  | 'activities.history.view'
  | 'media.gallery.view'
  | 'media.image.upload'
  | 'media.video.upload'
  | 'media.image.download'
  | 'media.video.download'
  | 'media.delete'
  | 'media.share.authorize'
  | 'media.duplicate.override'
  | 'media.video.play'
  | 'documents.view'
  | 'documents.upload'
  | 'documents.download'
  | 'finance.global.view'
  | 'finance.patient.view'
  | 'finance.manage'
  | 'reports.view'
  | 'reports.export'
  | 'settings.clinic.view'
  | 'settings.clinic.manage'
  | 'settings.firebase.manage'
  | 'settings.whatsapp.manage'
  | 'uploads.limits.manage'
  | 'uploads.exception.request'
  | 'uploads.exception.approve'
  | 'consumption.view'
  | 'consumption.manage'
  | 'audit.view'
  | 'audit.export'
  | 'emergency.controls'
  | 'responsible.portal.view'
  | 'responsible.profile.edit'
  | 'responsible.media.interact'
  | 'responsible.notifications'
  | 'monitoring.panel.view'
  | 'monitoring.search.local'
  | 'monitoring.media.download'
  | 'monitoring.any_write'
  | 'notifications.manage'
  | 'session.devices.view'
  | 'session.revoke_all';

export type AccessPermissionOverrides = Partial<Record<AccessPermissionKey, boolean>>;
export type AccessEffectivePermissions = Readonly<Record<AccessPermissionKey, boolean>>;

export interface AccessSuspension {
  active: boolean;
  reason?: string;
  startedAt?: string | null;
  endsAt?: string | null;
}

export interface AccessTemporaryWindow {
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface AccessProfile {
  role: AccessRole;
  status: AccessStatus;
  profiles?: Partial<Record<AccessRequestRole | 'admin', AccessProfileRoleState>>;
  activeProfiles?: AccessRole[];
  uid: string;
  email: string;
  username?: string | null;
  contactEmail?: string | null;
  directAccess?: boolean;
  mustChangePassword?: boolean;
  displayName: string;
  phone: string;
  createdAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedByEmail: string | null;
  linkedPatientIds: string[];
  provider: string;
  requestId: string | null;
  schemaVersion?: number;
  workspaceId?: string;
  enabledContexts?: AccessContext[];
  activeContext?: AccessContext;
  linkedProfessionalIds?: string[];
  permissionOverrides?: AccessPermissionOverrides;
  effectivePermissions?: AccessEffectivePermissions;
  suspension?: AccessSuspension | null;
  temporaryAccess?: AccessTemporaryWindow | null;
  expiresAt?: string | null;
  informationRequestMessage?: string | null;
  informationRequestedAt?: string | null;
  informationRequestedBy?: string | null;
  informationResponseMessage?: string | null;
  informationRespondedAt?: string | null;
  configurationVersion?: number;
}

export interface AccessProfileRoleState {
  role: AccessRole;
  status: AccessStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByEmail?: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedByEmail: string | null;
  suspendedAt?: string | null;
  suspendedBy?: string | null;
  suspendedByEmail?: string | null;
  suspensionReason?: string | null;
  reactivatedAt?: string | null;
  reactivatedBy?: string | null;
  reactivatedByEmail?: string | null;
  expiresAt?: string | null;
  linkedPatientIds: string[];
  requestId: string | null;
  workspaceId?: string;
  enabledContexts?: AccessContext[];
  permissionOverrides?: AccessPermissionOverrides;
  suspension?: AccessSuspension | null;
  temporaryAccess?: AccessTemporaryWindow | null;
  mustChangePassword?: boolean;
}

export interface AccessRequestInput {
  displayName: string;
  email: string;
  phone: string;
  role: AccessRequestRole;
  linkedPatientName: string;
  notes: string;
}

export interface AccessRequestRecord extends AccessRequestInput {
  id: string;
  uid: string | null;
  linkedPatientIds: string[];
  status: AccessRequestStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByEmail: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectedByEmail: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedByEmail: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspendedByEmail: string | null;
  suspensionReason: string | null;
  reactivatedAt: string | null;
  reactivatedBy: string | null;
  reactivatedByEmail: string | null;
  expiresAt: string | null;
  informationRequestMessage: string | null;
  informationRequestedAt: string | null;
  informationRequestedBy: string | null;
  informationRequestedByEmail: string | null;
  informationResponseMessage: string | null;
  informationRespondedAt: string | null;
  emailNotificationStatus: 'sent' | 'skipped' | 'failed' | null;
  emailNotificationError: string | null;
  username?: string | null;
  contactEmail?: string | null;
  directAccess?: boolean;
  mustChangePassword?: boolean;
}


export interface DirectAccessCreateInput {
  role: AccessRequestRole;
  displayName: string;
  username: string;
  contactEmail?: string;
  phone?: string;
  password?: string;
  linkedPatientIds?: string[];
  expiresAt?: string | null;
  mustChangePassword?: boolean;
}

export interface DirectAccessCredentialsResult {
  request: AccessRequestRecord;
  username: string;
  temporaryPassword: string;
  accessPath: string;
}

export interface DirectAccessPasswordResetResult {
  request: AccessRequestRecord;
  temporaryPassword: string;
}

export interface DirectAccessUsernameUpdateResult {
  request: AccessRequestRecord;
}

export interface ResponsiblePortalSettings {
  name: string;
  title: string;
  email: string;
  whatsapp: string;
  address: string;
  visualTheme: 'current' | 'calm-tech' | 'health-balance' | 'soft-welcome';
}

export interface ResponsiblePortalPatient extends PatientRegistrationData {
  id: string;
  firstName: string;
  hasPhoto: boolean;
}

export interface ResponsiblePortalPatientUpdateInput extends PatientRegistrationData {}

export type PatientProfileChangeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PatientProfileChangeRequestSummary {
  id: string;
  status: PatientProfileChangeRequestStatus;
  createdAt: string | null;
  reviewedAt: string | null;
}

export interface PatientProfileChangeRequest {
  id: string;
  patientId: string;
  patientName: string;
  responsibleUid: string;
  responsibleName: string;
  responsibleEmail: string;
  status: PatientProfileChangeRequestStatus;
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewedByEmail: string | null;
  rejectionReason: string | null;
}

export interface ResponsiblePortalSession {
  id: string;
  patientId: string;
  date: string;
  time: string;
  status: string;
  type: string;
  professionalName: string | null;
  notes: string;
  source: string | null;
  isBlocked: boolean;
  consumesPackage: boolean;
  packageConsumptionDecisionRecorded: boolean;
  packageConsumptionDecidedAt?: string;
  packageConsumptionDecidedBy?: string;
  noReplacementReasonCode?: string;
  noReplacementReasonText?: string;
  noReplacementObservation?: string;
  noReplacementRecordedAt?: string;
  noReplacementRecordedBy?: string;
  packageNumber: number;
  sessionNumber: number;
  positionType?: 'none' | 'consumed' | 'planned' | 'projected';
  isFuture: boolean;
}

export interface ResponsiblePortalPayment {
  id: string;
  patientId: string;
  amount: number;
  date: string;
  installment: string;
  method: string;
  packageNumber: number | null;
}

export interface ResponsiblePortalPackage {
  number: number;
  status: 'previous' | 'current' | 'future';
  startDate: string;
  endDate: string;
  consumedCount: number;
  remainingCount: number;
  sessions: ResponsiblePortalSession[];
  financialStatus: 'quitado' | 'pendente';
  paidAmount: number;
  pendingAmount: number;
  installments: ResponsiblePortalPayment[];
}

export interface ResponsiblePortalMediaComment {
  id: string;
  responsibleName: string;
  comment: string;
  createdAt: string | null;
  isOwn: boolean;
}

export interface ResponsiblePortalMedia {
  id: string;
  patientId: string;
  sessionId: string;
  sessionDate: string;
  sessionTime: string;
  sessionNumber: number | null;
  sessionType: string;
  sessionStatus: string;
  packageNumber: number;
  category: string;
  description: string;
  professionalName: string | null;
  mediaType: 'photo' | 'video';
  fileName: string;
  mimeType: string;
  durationSeconds: number | null;
  visibility: string;
  shareStatus: string;
  createdAt: string | null;
  likeCount: number;
  likedByCurrentResponsible: boolean;
  comments: ResponsiblePortalMediaComment[];
}

export interface ResponsiblePortalDocument {
  id: string;
  patientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  note: string;
  uploadedByName: string;
  createdAt: string | null;
  status: 'available' | 'uploading';
}

export interface ResponsiblePortalPatientData {
  patient: ResponsiblePortalPatient;
  currentPackageNumber: number;
  packages: ResponsiblePortalPackage[];
  media: ResponsiblePortalMedia[];
  documents: ResponsiblePortalDocument[];
  latestProfileChangeRequest: PatientProfileChangeRequestSummary | null;
}

export interface ResponsiblePortalData {
  responsible: {
    uid: string;
    displayName: string;
    username: string;
    accountLabel: string;
    email: string;
  };
  settings: ResponsiblePortalSettings;
  patients: ResponsiblePortalPatientData[];
}

export type ResponsiblePortalEventType =
  | 'gallery_access'
  | 'media_view'
  | 'media_view_summary'
  | 'video_playback'
  | 'media_download'
  | 'media_share_instagram'
  | 'media_share_whatsapp'
  | 'media_like'
  | 'media_unlike'
  | 'media_comment';

export interface ResponsiblePortalClientContext {
  portalTab?: string;
  actionLocation?: string;
  deviceType?: string;
  browser?: string;
  platform?: string;
  viewport?: string;
  language?: string;
}

export interface ResponsiblePortalPlaybackSummary {
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  totalPlayedSeconds?: number;
  maxPositionSeconds?: number;
  percentWatched?: number;
  completed?: boolean;
  playCount?: number;
  pauseCount?: number;
  seekCount?: number;
  viewDurationSeconds?: number;
}

export interface ProfessionalPortalNotificationDetail {
  label: string;
  value?: string;
  previousValue?: string;
  newValue?: string;
}



export type ProfessionalNotificationCategory =
  | 'login'
  | 'gallery'
  | 'profile_update'
  | 'document'
  | 'monitoring'
  | 'system'
  | 'access';

export type ProfessionalNotificationPriority = 'urgent' | 'important' | 'informational';

export type ProfessionalNotificationStatus =
  | 'active'
  | 'pending'
  | 'completed'
  | 'archived'
  | 'ignored';

export type ProfessionalNotificationAction =
  | 'mark_read'
  | 'mark_unread'
  | 'complete'
  | 'archive'
  | 'ignore'
  | 'delete';

export type ProfessionalNotificationBulkScope =
  | 'all_unread'
  | 'read_informational'
  | 'all_read'
  | 'archived_deletable';

export interface ProfessionalPortalNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  patientId: string;
  patientName: string;
  responsibleName: string;
  responsibleEmail: string;
  actorUserId: string;
  actorRole: AccessRole | null;
  actorName: string;
  actorEmail: string;
  recordId: string | null;
  documentId: string | null;
  mediaFileName: string | null;
  mediaType: 'photo' | 'video' | null;
  mediaCategory: string | null;
  mediaDescription: string | null;
  sessionId: string | null;
  sessionDate: string | null;
  sessionTime: string | null;
  sessionNumber: number | null;
  playback: ResponsiblePortalPlaybackSummary | null;
  interactionSessionId: string | null;
  actionLocation: string;
  actionTarget: string;
  navigationTarget: 'patient_gallery' | 'patient_profile' | 'patient_documents' | 'none';
  details: ProfessionalPortalNotificationDetail[];
  clientContext: ResponsiblePortalClientContext | null;
  category: ProfessionalNotificationCategory;
  priority: ProfessionalNotificationPriority;
  status: ProfessionalNotificationStatus;
  pendingAction: boolean;
  completed: boolean;
  archived: boolean;
  ignored: boolean;
  protectedFromDeletion: boolean;
  read: boolean;
  readAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ResponsiblePortalActionResult {
  liked?: boolean;
  comment?: ResponsiblePortalMediaComment;
  notificationId?: string;
}

export type MonitoringNotificationTab = 'agenda' | 'galeria';

export interface MonitoringNotificationActionResult {
  recorded: boolean;
  notificationIds: string[];
}

export interface MonitoringPatient {
  id: string;
  name: string;
  fullName: string;
  birthDate: string;
  status: 'Ativo' | 'Concluído' | string;
  photoUrl: string;
  guardianName: string;
  guardianKinship: string;
  whatsapp: string;
}

export interface MonitoringSession {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  time: string;
  durationMinutes: number;
  professionalName: string;
  type: string;
  status: string;
  packageNumber: number | null;
  isBlocked: boolean;
  consumesPackage: boolean;
  source: string | null;
}

export interface MonitoringActivityCount {
  patientId: string;
  count: number;
}

export interface MonitoringPanelData {
  viewer: {
    uid: string;
    email: string;
    displayName: string;
    role: AccessRole;
    adminPreview: boolean;
  };
  settings: {
    name: string;
    title: string;
    visualTheme: ResponsiblePortalSettings['visualTheme'];
  };
  weekRange: {
    start: string;
    end: string;
  };
  patients: MonitoringPatient[];
  sessions: MonitoringSession[];
  weekSessions: MonitoringSession[];
  activityCounts: MonitoringActivityCount[];
  querySummary: {
    patients: string;
    sessions: string;
    weekSessions: string;
    activityCounts: string;
  };
}
