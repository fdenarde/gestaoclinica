import {
  activityRecordCategoryMatches as matchesNormalizedActivityRecordCategory,
  getActivityRecordCategoryLabel as normalizeActivityRecordCategoryLabel,
} from '../../shared/activityRecordUi.js';

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
  | 'Atividade Neuropsicopedagógica'
  | 'Atividade de Intervenção'
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
  schemaVersion: 1 | 2;
  workspaceId: string;
  ownerUserId: string;
  patientId: string;
  sessionId: string;
  sessionIds?: string[];
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
  mediaType: 'photo' | 'video';
  visibility: ActivityRecordVisibility;
  storageProvider: 'google-drive';
  driveFileId: string;
  driveFolderId?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  durationSeconds?: number;
  thumbnailDriveFileId?: string;
  thumbnailMimeType?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  sha256: string;
  status: ActivityRecordStatus;
  uploadStatus: ActivityRecordStatus;
  uploadAttemptId: string;
  dedupeKey: string;
  shareStatus: ActivityRecordShareStatus;
  sharedAt?: string;
  sharedByUserId?: string;
  authorizationSnapshot: ActivityMediaAuthorization;
  gallerySummaryAppliedAt?: string;
  deletedAt?: string;
  deletedByUserId?: string;
  deletedByName?: string;
  deletionReason?: string;
}

export const DEFAULT_ACTIVITY_RECORD_CATEGORY: ActivityRecordCategory = 'Atividade Neuropsicopedagógica';
export const LEGACY_ACTIVITY_RECORD_CATEGORY: ActivityRecordCategory = 'Atividade pedagógica';

export const ACTIVITY_RECORD_CATEGORIES: ActivityRecordCategory[] = [
  DEFAULT_ACTIVITY_RECORD_CATEGORY,
  'Atividade de Intervenção',
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


export function getActivityRecordCategoryLabel(category: string): string {
  return normalizeActivityRecordCategoryLabel(category);
}

export function activityRecordCategoryMatches(recordCategory: string, selectedCategory: string): boolean {
  return matchesNormalizedActivityRecordCategory(recordCategory, selectedCategory);
}

export function getDefaultActivityAuthorization(): ActivityMediaAuthorization {
  return {
    internalRecordingStatus: 'pending',
    guardianSharingStatus: 'pending',
  };
}
