import type { PsychologyAggregate } from './namespace';
import type { PsychologyPersistenceScope } from './scope';
import type {
  PsychologyAttachmentRecord,
  PsychologyChargeRecord,
  PsychologyClinicalSessionRecord,
  PsychologyDocumentRecord,
  PsychologyExpenseRecord,
  PsychologyLocationRecord,
  PsychologyPackageRecord,
  PsychologyPatientRecord,
  PsychologyPaymentRecord,
  PsychologyPersonalAppointmentRecord,
  PsychologyServiceRecord,
  PsychologySessionRecordEntity,
  PsychologySettingsRecord,
} from './types';

export interface PsychologyRepository<T extends { id: string }> {
  readonly aggregate: PsychologyAggregate;
  readonly scope: PsychologyPersistenceScope;
  list(scope: PsychologyPersistenceScope): Promise<readonly T[]>;
  get(scope: PsychologyPersistenceScope, id: string): Promise<T | null>;
  upsert(scope: PsychologyPersistenceScope, entity: T): Promise<T>;
  update(scope: PsychologyPersistenceScope, id: string, patch: Partial<T>): Promise<T | null>;
  delete(scope: PsychologyPersistenceScope, id: string): Promise<{ id: string } | null>;
}

export interface PsychologyPatientDeletionResult {
  id: string;
  deleted: boolean;
  reason?: string;
}

export interface PsychologyPatientRepository extends PsychologyRepository<PsychologyPatientRecord> {
  deleteWithResult?: (scope: PsychologyPersistenceScope, id: string) => Promise<PsychologyPatientDeletionResult>;
}
export interface PsychologySessionRepository extends PsychologyRepository<PsychologySessionRecordEntity> {}
export interface PsychologySessionRecordRepository extends PsychologyRepository<PsychologyClinicalSessionRecord> {}
export interface PsychologyPersonalAppointmentRepository extends PsychologyRepository<PsychologyPersonalAppointmentRecord> {}
export interface PsychologyServiceRepository extends PsychologyRepository<PsychologyServiceRecord> {}
export interface PsychologyLocationRepository extends PsychologyRepository<PsychologyLocationRecord> {}
export interface PsychologyPackageRepository extends PsychologyRepository<PsychologyPackageRecord> {}
export interface PsychologySettingsRepository extends PsychologyRepository<PsychologySettingsRecord> {}

export interface PsychologyBackupReadBundle {
  readonly patients: PsychologyPatientRepository;
  readonly sessions: PsychologySessionRepository;
  readonly sessionRecords: PsychologySessionRecordRepository;
  readonly personalAppointments: PsychologyPersonalAppointmentRepository;
  readonly services: PsychologyServiceRepository;
  readonly locations: PsychologyLocationRepository;
  readonly packages: PsychologyPackageRepository;
  readonly documents: PsychologyDocumentRepository;
  readonly attachments: PsychologyAttachmentRepository;
  readonly listCharges: (scope: PsychologyPersistenceScope) => Promise<readonly PsychologyChargeRecord[]>;
  readonly listPayments: (scope: PsychologyPersistenceScope) => Promise<readonly PsychologyPaymentRecord[]>;
  readonly listExpenses: (scope: PsychologyPersistenceScope) => Promise<readonly PsychologyExpenseRecord[]>;
}

export interface PsychologyFinancialRepository {
  readonly scope: PsychologyPersistenceScope;
  listCharges(scope: PsychologyPersistenceScope): Promise<readonly PsychologyChargeRecord[]>;
  getCharge(scope: PsychologyPersistenceScope, id: string): Promise<PsychologyChargeRecord | null>;
  upsertCharge(scope: PsychologyPersistenceScope, entity: PsychologyChargeRecord): Promise<PsychologyChargeRecord>;
  updateCharge(scope: PsychologyPersistenceScope, id: string, patch: Partial<PsychologyChargeRecord>): Promise<PsychologyChargeRecord | null>;
  deleteCharge(scope: PsychologyPersistenceScope, id: string): Promise<{ id: string } | null>;
  listPayments(scope: PsychologyPersistenceScope): Promise<readonly PsychologyPaymentRecord[]>;
  getPayment(scope: PsychologyPersistenceScope, id: string): Promise<PsychologyPaymentRecord | null>;
  createPayment(scope: PsychologyPersistenceScope, entity: PsychologyPaymentRecord): Promise<PsychologyPaymentRecord>;
  updatePayment(scope: PsychologyPersistenceScope, id: string, patch: Partial<PsychologyPaymentRecord>): Promise<PsychologyPaymentRecord | null>;
  deletePayment(scope: PsychologyPersistenceScope, id: string): Promise<{ id: string } | null>;
  listExpenses(scope: PsychologyPersistenceScope): Promise<readonly PsychologyExpenseRecord[]>;
  getExpense(scope: PsychologyPersistenceScope, id: string): Promise<PsychologyExpenseRecord | null>;
  upsertExpense(scope: PsychologyPersistenceScope, entity: PsychologyExpenseRecord): Promise<PsychologyExpenseRecord>;
  updateExpense(scope: PsychologyPersistenceScope, id: string, patch: Partial<PsychologyExpenseRecord>): Promise<PsychologyExpenseRecord | null>;
  deleteExpense(scope: PsychologyPersistenceScope, id: string): Promise<{ id: string } | null>;
}

export interface PsychologyDocumentRepository extends PsychologyRepository<PsychologyDocumentRecord> {
  listAdministrative(scope: PsychologyPersistenceScope, patientId?: string): Promise<readonly PsychologyDocumentRecord[]>;
  listClinical(scope: PsychologyPersistenceScope, patientId?: string): Promise<readonly PsychologyDocumentRecord[]>;
}

export interface PsychologyAttachmentRepository extends PsychologyRepository<PsychologyAttachmentRecord> {
  listAdministrative(scope: PsychologyPersistenceScope, patientId?: string): Promise<readonly PsychologyAttachmentRecord[]>;
  listClinical(scope: PsychologyPersistenceScope, patientId?: string): Promise<readonly PsychologyAttachmentRecord[]>;
}

export interface PsychologyRepositoryBundle {
  readonly scope: PsychologyPersistenceScope;
  readonly patients: PsychologyPatientRepository;
  readonly sessions: PsychologySessionRepository;
  readonly sessionRecords: PsychologySessionRecordRepository;
  readonly personalAppointments: PsychologyPersonalAppointmentRepository;
  readonly financial: PsychologyFinancialRepository;
  readonly services: PsychologyServiceRepository;
  readonly locations: PsychologyLocationRepository;
  readonly packages: PsychologyPackageRepository;
  readonly documents: PsychologyDocumentRepository;
  readonly attachments: PsychologyAttachmentRepository;
  readonly settings: PsychologySettingsRepository;
  readonly backup?: PsychologyBackupReadBundle;
}

export interface PsychologyMemorySeed {
  [K: string]: readonly Record<string, unknown>[] | undefined;
}
