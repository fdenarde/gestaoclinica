export type ActivityAuthorizationStatus = 'authorized' | 'not_authorized' | 'pending';

export interface ActivityMediaAuthorization {
  internalRecordingStatus: ActivityAuthorizationStatus;
  guardianSharingStatus: ActivityAuthorizationStatus;
  authorizedAt?: string;
  authorizedBy?: string;
  notes?: string;
  documentReference?: string;
}

export type ActivityRecordCategory =
  | 'Atividade pedagógica'
  | 'Atenção'
  | 'Memória'
  | 'Linguagem'
  | 'Raciocínio lógico'
  | 'Coordenação motora'
  | 'Coordenação visuomotora'
  | 'Funções executivas'
  | 'Atividade lúdica'
  | 'Evolução'
  | 'Devolutiva'
  | 'Outro';

export type ActivityRecordVisibility = 'internal_only' | 'share_allowed' | 'do_not_share';
export type ActivityRecordStatus = 'uploading' | 'active' | 'failed' | 'cancelled' | 'deleting' | 'delete_failed';
export type ActivityRecordShareStatus = 'not_shared' | 'share_started' | 'shared_confirmed' | 'share_cancelled';

export interface ActivityRecord {
  id: string;
  schemaVersion: 1;
  workspaceId: string;
  ownerUserId: string;
  patientId: string;
  sessionId: string;
  sessionDate: string;
  sessionTime: string;
  sessionNumber: number | null;
  sessionType: string;
  sessionStatusSnapshot: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  activityAt: string;
  category: ActivityRecordCategory;
  description: string;
  mediaType: 'photo';
  visibility: ActivityRecordVisibility;
  storageProvider: 'google-drive';
  driveFileId: string;
  driveFolderId?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  sha256: string;
  status: ActivityRecordStatus;
  uploadStatus: ActivityRecordStatus;
  uploadAttemptId: string;
  dedupeKey: string;
  shareStatus: ActivityRecordShareStatus;
  sharedAt?: string;
  sharedByUserId?: string;
  authorizationSnapshot: ActivityMediaAuthorization;
}

export const ACTIVITY_RECORD_CATEGORIES: ActivityRecordCategory[] = [
  'Atividade pedagógica',
  'Atenção',
  'Memória',
  'Linguagem',
  'Raciocínio lógico',
  'Coordenação motora',
  'Coordenação visuomotora',
  'Funções executivas',
  'Atividade lúdica',
  'Evolução',
  'Devolutiva',
  'Outro',
];

export function getDefaultActivityAuthorization(): ActivityMediaAuthorization {
  return {
    internalRecordingStatus: 'pending',
    guardianSharingStatus: 'pending',
  };
}
