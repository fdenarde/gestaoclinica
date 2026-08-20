import { PSYCHOLOGY_CONTEXT } from './scope';
import type { PsychologyPersistenceScope } from './scope';
import { assertPsychologyPersistenceScope } from './scope';

export const PSYCHOLOGY_PERSISTENCE_CONTEXT = PSYCHOLOGY_CONTEXT;

export const PSYCHOLOGY_AGGREGATES = [
  'patients',
  'sessions',
  'sessionRecords',
  'personalAppointments',
  'services',
  'locations',
  'charges',
  'payments',
  'expenses',
  'packages',
  'documents',
  'attachments',
  'settings',
] as const;

export type PsychologyAggregate = typeof PSYCHOLOGY_AGGREGATES[number];

export function assertPsychologyAggregate(value: string): asserts value is PsychologyAggregate {
  if (!(PSYCHOLOGY_AGGREGATES as readonly string[]).includes(value)) {
    throw new Error(`Agregado Psicologia não permitido: ${value}.`);
  }
}

export function buildPsychologyCollectionPath(
  scope: PsychologyPersistenceScope,
  aggregate: PsychologyAggregate,
): string {
  assertPsychologyPersistenceScope(scope);
  assertPsychologyAggregate(aggregate);
  return `workspaces/${scope.workspaceId}/professionals/${scope.professionalId}/contexts/${PSYCHOLOGY_CONTEXT}/${aggregate}`;
}

export function buildPsychologyDocumentPath(
  scope: PsychologyPersistenceScope,
  aggregate: PsychologyAggregate,
  id: string,
): string {
  if (!id || id.includes('/')) throw new Error('ID de documento Psicologia inválido.');
  return `${buildPsychologyCollectionPath(scope, aggregate)}/${id}`;
}
