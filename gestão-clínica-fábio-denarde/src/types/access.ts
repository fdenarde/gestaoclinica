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

export interface ResponsiblePortalPatient {
  id: string;
  name: string;
}

export interface ResponsiblePortalSession {
  id: string;
  patientId: string;
  date: string;
  time: string;
  status: string;
  type: string;
  professionalName: string | null;
}

export interface ResponsiblePortalMedia {
  id: string;
  patientId: string;
  sessionId: string;
  sessionDate: string;
  sessionTime: string;
  category: string;
  mediaType: 'photo' | 'video';
  fileName: string;
  mimeType: string;
  durationSeconds: number | null;
}

export interface ResponsiblePortalData {
  responsible: {
    displayName: string;
    email: string;
  };
  patient: ResponsiblePortalPatient | null;
  sessions: ResponsiblePortalSession[];
  media: ResponsiblePortalMedia[];
}
