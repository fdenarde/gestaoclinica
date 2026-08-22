import {
  createPsychologyScope,
  LOCAL_PSYCHOLOGY_PROFESSIONAL_ID,
  PSYCHOLOGY_CONTEXT,
  type PsychologyScope,
} from '../psychology-pilot/psychologyDomain';

export { PSYCHOLOGY_CONTEXT };

/**
 * The existing access model calls the outer tenant boundary a workspaceId.
 * The local pilot has no resolved runtime workspace yet, so its adapter uses
 * this deterministic namespace only as a compatibility bridge.
 */
export const LOCAL_PSYCHOLOGY_WORKSPACE_ID = 'psychology-local-workspace';

export interface PsychologyPersistenceScope {
  workspaceId: string;
  tenantId?: string;
  professionalId: string;
  context: typeof PSYCHOLOGY_CONTEXT;
}

export const createPsychologyPersistenceScope = (
  professionalId = LOCAL_PSYCHOLOGY_PROFESSIONAL_ID,
  workspaceId = LOCAL_PSYCHOLOGY_WORKSPACE_ID,
  tenantId?: string,
): PsychologyPersistenceScope => ({
  workspaceId,
  ...(tenantId ? { tenantId } : {}),
  professionalId,
  context: PSYCHOLOGY_CONTEXT,
});

export const toPsychologyPersistenceScope = (
  scope: PsychologyScope,
  workspaceId = LOCAL_PSYCHOLOGY_WORKSPACE_ID,
): PsychologyPersistenceScope => createPsychologyPersistenceScope(scope.professionalId, workspaceId);

export const toLegacyPsychologyScope = (scope: PsychologyPersistenceScope): PsychologyScope => (
  createPsychologyScope(scope.professionalId)
);

function assertScopePart(value: string, name: string): void {
  if (!value || !value.trim() || value !== value.trim() || value.includes('/')) {
    throw new Error(`Escopo Psicologia inválido: ${name} deve ser um ID opaco sem barras.`);
  }
}

export function assertPsychologyPersistenceScope(scope: PsychologyPersistenceScope): void {
  if (!scope || scope.context !== PSYCHOLOGY_CONTEXT) {
    throw new Error('Escopo Psicologia inválido: context deve ser PSICOLOGIA.');
  }
  assertScopePart(scope.workspaceId, 'workspaceId');
  if (scope.tenantId !== undefined) assertScopePart(scope.tenantId, 'tenantId');
  assertScopePart(scope.professionalId, 'professionalId');
}

export function assertSamePsychologyPersistenceScope(
  expected: PsychologyPersistenceScope,
  actual: PsychologyPersistenceScope,
): void {
  assertPsychologyPersistenceScope(expected);
  assertPsychologyPersistenceScope(actual);
  if (
    expected.workspaceId !== actual.workspaceId
    || expected.tenantId !== actual.tenantId
    || expected.professionalId !== actual.professionalId
    || expected.context !== actual.context
  ) {
    throw new Error('A entidade não pertence ao escopo do repository Psicologia.');
  }
}

export function isPsychologyPersistenceScope(value: unknown): value is PsychologyPersistenceScope {
  try {
    assertPsychologyPersistenceScope(value as PsychologyPersistenceScope);
    return true;
  } catch {
    return false;
  }
}
