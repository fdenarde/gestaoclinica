import type { ActivityRecordCategory } from './activityRecords';

export type GooglePhotosAlbumStatus = 'active' | 'hidden';
export type GooglePhotosAlbumSource = 'session' | 'date';

export interface GooglePhotosAlbum {
  id: string;
  schemaVersion: 2;
  provider: 'google_photos';
  packageKey: string;
  packageNumber: number;
  patientId: string;
  patientName: string;
  source: GooglePhotosAlbumSource;
  sessionId: string | null;
  sessionIds: string[];
  sessionGroupKey: string;
  activityDate: string;
  sessionTime: string | null;
  sessionNumbers: number[];
  title: string;
  category: ActivityRecordCategory;
  url: string;
  visibleToGuardian: boolean;
  observation: string;
  publishedAt: string;
  status: GooglePhotosAlbumStatus;
  createdByUserId: string;
  createdByName: string;
  createdAt: string | null;
  updatedByUserId: string;
  updatedByName: string;
  updatedAt: string | null;
  hiddenAt: string | null;
  reactivatedAt: string | null;
  isVirtual?: boolean;
}

export interface GooglePhotosAlbumCapabilities {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canHide: boolean;
  canReactivate: boolean;
  canRemove: boolean;
}

export interface GooglePhotosAlbumsResponse {
  albums: GooglePhotosAlbum[];
  ownerUserId?: string;
  packageKey: string;
  packageNumber: number;
  permissions: GooglePhotosAlbumCapabilities;
  queryCount: number;
  readUpperBound: number;
  scope: 'manage' | 'portal';
}

export interface GooglePhotosAlbumInput {
  id?: string;
  packageKey?: string;
  packageNumber: number;
  patientId: string;
  sessionIds: string[];
  sessionGroupKey?: string;
  activityDate: string;
  title: string;
  category: ActivityRecordCategory;
  url: string;
  visibleToGuardian: boolean;
  observation: string;
  publishedAt: string;
  status?: GooglePhotosAlbumStatus;
}

export interface GooglePhotosAlbumPackageInput {
  patientId: string;
  packageNumber: number;
  cards: GooglePhotosAlbumInput[];
}
