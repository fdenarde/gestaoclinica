export type AccessRole = 'admin' | 'professional' | 'responsible';

export type AccessRequestRole = Exclude<AccessRole, 'admin'>;

export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'disabled' | 'canceled';

export type AccessRequestStatus = AccessStatus;

export interface AccessProfile {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  role: AccessRole;
  status: AccessStatus;
  createdAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedByEmail: string | null;
  linkedPatientIds: string[];
  provider: string;
  requestId: string | null;
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
  emailNotificationStatus: 'sent' | 'skipped' | 'failed' | null;
  emailNotificationError: string | null;
}

export interface ResponsiblePortalSettings {
  name: string;
  title: string;
  email: string;
  whatsapp: string;
  address: string;
  visualTheme: 'current' | 'calm-tech' | 'health-balance' | 'soft-welcome';
}

export interface ResponsiblePortalPatient {
  id: string;
  name: string;
  firstName: string;
  birthDate: string;
  guardianName: string;
  whatsapp: string;
  school: string;
  grade: string;
  shift: string;
  doctorName: string;
  medication: string;
  emergencyContact: string;
  allergies: string;
  hasPhoto: boolean;
}

export interface ResponsiblePortalPatientUpdateInput {
  name: string;
  birthDate: string;
  guardianName: string;
  whatsapp: string;
  school: string;
  grade: string;
  shift: string;
  doctorName: string;
  medication: string;
  emergencyContact: string;
  allergies: string;
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
  packageNumber: number;
  sessionNumber: number;
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
  status: 'current' | 'future';
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
}

export interface ResponsiblePortalData {
  responsible: {
    uid: string;
    displayName: string;
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
