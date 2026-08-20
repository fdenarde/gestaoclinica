import { buildPsychologyCollectionPath, PSYCHOLOGY_AGGREGATES, type PsychologyAggregate } from './namespace';
import type { FirestorePsychologyEmulatorClient } from './repositories/firestore';
import { assertPsychologyPersistenceScope, type PsychologyPersistenceScope } from './scope';

export interface PsychologyMigrationPlan {
  sourceVersion: string;
  destinationVersion: 'r2d1-canonical-v1';
  scope: PsychologyPersistenceScope;
  totals: Record<PsychologyAggregate, number>;
  warnings: string[];
  conflicts: string[];
  invalidRecords: Array<{ aggregate: PsychologyAggregate; id: string; reason: string }>;
  actions: string[];
  writesPerformed: false;
  requiresBackup: true;
  rollbackPlan: string;
}

export interface PsychologyMigrationEmulatorDestination {
  backend: 'emulator';
  scope: PsychologyPersistenceScope;
  client: Pick<FirestorePsychologyEmulatorClient, 'list'>;
}

export interface PsychologyMigrationDestinationValidation {
  backend: 'emulator';
  destinationNamespace: string;
  scope: PsychologyPersistenceScope;
  existingPatientCount: number;
  writesPerformed: false;
}

export interface PsychologyMigrationSimulation {
  destination: PsychologyMigrationDestinationValidation;
  plannedWrites: number;
  writesPerformed: false;
  requiresBackup: true;
}

const SOURCE_KEYS: Record<PsychologyAggregate, string> = {
  patients: 'patients',
  sessions: 'sessions',
  sessionRecords: 'sessionRecords',
  personalAppointments: 'personalCommitments',
  services: 'services',
  locations: 'locations',
  charges: 'charges',
  payments: 'payments',
  expenses: 'expenses',
  packages: 'sessionPackages',
  documents: 'documents',
  attachments: 'attachments',
  settings: 'settings',
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : [];
}

function recordId(record: Record<string, unknown>, fallback: string): string {
  return typeof record.id === 'string' && record.id ? record.id : `${fallback}-missing-id`;
}

/**
 * Builds a manifest only. It never calls a repository and never mutates the
 * source object, localStorage, Firestore or any other destination.
 */
export function buildPsychologyMigrationPlan(source: unknown, scope: PsychologyPersistenceScope): PsychologyMigrationPlan {
  assertPsychologyPersistenceScope(scope);
  const input = asObject(source);
  const totals = Object.fromEntries(PSYCHOLOGY_AGGREGATES.map(aggregate => [aggregate, 0])) as Record<PsychologyAggregate, number>;
  const warnings: string[] = [];
  const conflicts: string[] = [];
  const invalidRecords: PsychologyMigrationPlan['invalidRecords'] = [];
  const ids = new Map<PsychologyAggregate, Set<string>>();
  const recordsByAggregate = new Map<PsychologyAggregate, Record<string, unknown>[]>();

  for (const aggregate of PSYCHOLOGY_AGGREGATES) {
    const rawValue = input[SOURCE_KEYS[aggregate]];
    const records = aggregate === 'settings' ? (rawValue && typeof rawValue === 'object' ? [asObject(rawValue)] : []) : asArray(rawValue);
    totals[aggregate] = records.length;
    recordsByAggregate.set(aggregate, records);
    ids.set(aggregate, new Set());
    for (const [index, record] of records.entries()) {
      const id = recordId(record, `${aggregate}-${index}`);
      const idSet = ids.get(aggregate)!;
      if (idSet.has(id)) conflicts.push(`ID duplicado em ${aggregate}: ${id}`);
      idSet.add(id);
      const hasRequiredScope = record.professionalId === scope.professionalId && record.context === scope.context;
      if (!hasRequiredScope) {
        invalidRecords.push({
          aggregate,
          id,
          reason: !record.professionalId ? 'professionalId ausente' : record.context !== scope.context ? 'context diferente de PSICOLOGIA' : 'professionalId fora do scope',
        });
      }
      if (aggregate !== 'settings' && !record.createdAt) warnings.push(`${aggregate}/${id} sem createdAt; revisão necessária.`);
      if (aggregate !== 'settings' && !record.updatedAt) warnings.push(`${aggregate}/${id} sem updatedAt; revisão necessária.`);
    }
  }

  const has = (aggregate: PsychologyAggregate, id: unknown): boolean => typeof id === 'string' && Boolean(ids.get(aggregate)?.has(id));
  const checkReference = (aggregate: PsychologyAggregate, record: Record<string, unknown>, field: string, target: PsychologyAggregate): void => {
    const value = record[field];
    if (value && !has(target, value)) conflicts.push(`${aggregate}/${recordId(record, 'unknown')} referencia ${target}/${String(value)} inexistente`);
  };
  for (const record of recordsByAggregate.get('sessions') || []) checkReference('sessions', record, 'patientId', 'patients');
  for (const record of recordsByAggregate.get('sessionRecords') || []) {
    checkReference('sessionRecords', record, 'patientId', 'patients');
    checkReference('sessionRecords', record, 'sessionId', 'sessions');
  }
  for (const record of recordsByAggregate.get('charges') || []) {
    checkReference('charges', record, 'patientId', 'patients');
    checkReference('charges', record, 'sessionId', 'sessions');
  }
  for (const record of recordsByAggregate.get('payments') || []) {
    checkReference('payments', record, 'patientId', 'patients');
    checkReference('payments', record, 'chargeId', 'charges');
  }
  for (const aggregate of ['packages', 'documents', 'attachments'] as const) {
    for (const record of recordsByAggregate.get(aggregate) || []) checkReference(aggregate, record, 'patientId', 'patients');
  }

  const sourceVersion = String(input.schemaVersion || 'legacy-local');
  if (sourceVersion !== '2') warnings.push(`Origem ${sourceVersion} ainda precisa de normalização compatível.`);
  if (!input.workspaceId) warnings.push('Origem local não possui workspaceId persistido; será exigida confirmação no futuro.');
  return {
    sourceVersion,
    destinationVersion: 'r2d1-canonical-v1',
    scope,
    totals,
    warnings: [...new Set(warnings)],
    conflicts: [...new Set(conflicts)],
    invalidRecords,
    actions: [
      'read-source-only',
      'validate-required-scope',
      'validate-references-and-duplicates',
      'would-create-backup-before-real-migration',
      'would-upsert-canonical-records-after-explicit-authorization',
    ],
    writesPerformed: false,
    requiresBackup: true,
    rollbackPlan: 'Antes de qualquer migração real futura, restaurar o backup R2B1 e manter o adapter local legado como fallback; R2D1 não executa rollback nem escrita.',
  };
}

export async function validatePsychologyMigrationDestination(
  destination: PsychologyMigrationEmulatorDestination,
): Promise<PsychologyMigrationDestinationValidation> {
  assertPsychologyPersistenceScope(destination.scope);
  if (destination.backend !== 'emulator') throw new Error('Destino de migration R2D1B deve ser explicitamente emulator.');
  const existingPatients = await destination.client.list<Record<string, unknown>>(
    buildPsychologyCollectionPath(destination.scope, 'patients'),
  );
  return {
    backend: 'emulator',
    destinationNamespace: buildPsychologyCollectionPath(destination.scope, 'patients').replace(/\/patients$/, ''),
    scope: destination.scope,
    existingPatientCount: existingPatients.length,
    writesPerformed: false,
  };
}

export async function simulatePsychologyMigrationToEmulator(
  plan: PsychologyMigrationPlan,
  destination: PsychologyMigrationEmulatorDestination,
): Promise<PsychologyMigrationSimulation> {
  if (plan.scope.professionalId !== destination.scope.professionalId || plan.scope.workspaceId !== destination.scope.workspaceId) {
    throw new Error('Plano de migration e destino emulado precisam usar o mesmo scope.');
  }
  const validated = await validatePsychologyMigrationDestination(destination);
  return {
    destination: validated,
    plannedWrites: Object.values(plan.totals).reduce((total, count) => total + count, 0),
    writesPerformed: false,
    requiresBackup: true,
  };
}
