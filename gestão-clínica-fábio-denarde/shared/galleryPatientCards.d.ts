export interface ProfessionalGalleryPatientCard {
  id: string;
  name: string;
  photoUrl: string;
  photoDriveFileId: string;
  packageNumber: number;
  consumedCount: number;
  remainingCount: number;
  progressLabel: string;
  latestSessionDate: string;
  hasSessionToday: boolean;
}

export function resolveProfessionalGalleryPatientIdentity(
  patient?: Record<string, any> | null,
  fallbackOption?: Record<string, any> | null,
): Pick<ProfessionalGalleryPatientCard, 'id' | 'name' | 'photoUrl' | 'photoDriveFileId'>;

export function normalizeSessionPackageConsumption<T extends Record<string, any>>(session: T): T;

export function buildProfessionalGalleryPatientCards(options?: {
  patients?: Array<Record<string, any>>;
  patientOptions?: Array<Record<string, any>>;
  sessions?: Array<Record<string, any>>;
  payments?: Array<Record<string, any>>;
  search?: string;
  now?: Date;
}): ProfessionalGalleryPatientCard[];
