import type {
  PsychologyAttachment,
  PsychologyDocument,
  PsychologyPatient,
  PsychologyPersonalCommitment,
  PsychologySession,
  PsychologySessionRecord,
} from '../psychology-pilot/psychologyDomain';
import type {
  PsychologyCharge,
  PsychologyExpense,
  PsychologyLocation,
  PsychologyPayment,
  PsychologyService,
  PsychologySessionPackage,
  PsychologySettings,
} from '../psychology-pilot/psychologyR2a';
import type { PsychologyAggregate } from './namespace';

export type { PsychologyPersistenceScope } from './scope';
export type { PsychologyAggregate } from './namespace';

export interface PsychologyScopedPersistenceFields {
  workspaceId: string;
  professionalId: string;
  context: 'PSICOLOGIA';
  createdAt: string;
  updatedAt: string;
}

export type PsychologyPatientRecord = PsychologyPatient & PsychologyScopedPersistenceFields;
export type PsychologySessionRecordEntity = PsychologySession & PsychologyScopedPersistenceFields;
export type PsychologyClinicalSessionRecord = PsychologySessionRecord & PsychologyScopedPersistenceFields;
export type PsychologyPersonalAppointmentRecord = PsychologyPersonalCommitment & PsychologyScopedPersistenceFields;
export type PsychologyServiceRecord = PsychologyService & PsychologyScopedPersistenceFields;
export type PsychologyLocationRecord = PsychologyLocation & PsychologyScopedPersistenceFields;
export type PsychologyChargeRecord = PsychologyCharge & PsychologyScopedPersistenceFields;
export type PsychologyPaymentRecord = PsychologyPayment & PsychologyScopedPersistenceFields;
export type PsychologyExpenseRecord = PsychologyExpense & PsychologyScopedPersistenceFields;
export type PsychologyPackageRecord = PsychologySessionPackage & PsychologyScopedPersistenceFields;
export type PsychologyDocumentRecord = PsychologyDocument & PsychologyScopedPersistenceFields;
export type PsychologyAttachmentRecord = PsychologyAttachment & PsychologyScopedPersistenceFields;

export interface PsychologySettingsRecord extends PsychologyScopedPersistenceFields {
  id: 'settings';
  settings: PsychologySettings;
}

export interface PsychologyAggregateRecordMap {
  patients: PsychologyPatientRecord;
  sessions: PsychologySessionRecordEntity;
  sessionRecords: PsychologyClinicalSessionRecord;
  personalAppointments: PsychologyPersonalAppointmentRecord;
  services: PsychologyServiceRecord;
  locations: PsychologyLocationRecord;
  charges: PsychologyChargeRecord;
  payments: PsychologyPaymentRecord;
  expenses: PsychologyExpenseRecord;
  packages: PsychologyPackageRecord;
  documents: PsychologyDocumentRecord;
  attachments: PsychologyAttachmentRecord;
  settings: PsychologySettingsRecord;
}

export type PsychologyPersistedRecord = PsychologyAggregateRecordMap[PsychologyAggregate];

export interface PsychologyPermissionContext {
  workspaceId: string;
  professionalId: string;
  context: 'PSICOLOGIA';
  role?: 'admin' | 'professional' | 'responsible' | 'monitoring';
  permissions?: readonly string[];
}
