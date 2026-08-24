import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiPsychologyRepositories } from '../src/features/psychology-persistence/repositories/api';

const scope = {
  workspaceId: 'workspace-r2b21-api',
  tenantId: 'workspace-r2b21-api',
  professionalId: 'professional-r2b21-api',
  context: 'PSICOLOGIA' as const,
};

test('R2B21 API repository expõe deleted=false/cancelled/session sem lista posterior', async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-r2b21',
    fetchImpl: (async (input, init) => {
      requests.push({ url: String(input), method: String(init?.method || '') });
      return new Response(JSON.stringify({
        scope,
        deleted: false,
        cancelled: true,
        session: {
          id: 'session-r2b21-api',
          ...scope,
          patientId: 'patient-r2b21-api',
          date: '2026-08-24',
          time: '10:00',
          durationMinutes: 50,
          modality: 'online',
          status: 'cancelada',
          createdAt: '2026-08-23T00:00:00.000Z',
          updatedAt: '2026-08-23T00:00:00.000Z',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
  const repository = repositories.sessions as typeof repositories.sessions & {
    deleteWithResult: (requestedScope: typeof scope, id: string) => Promise<{ deleted: boolean; cancelled: boolean; session?: { id: string; status: string } }>;
  };

  const result = await repository.deleteWithResult(scope, 'session-r2b21-api');

  assert.equal(result.deleted, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.session?.status, 'cancelada');
  assert.deepEqual(requests, [{ url: '/api/psychology/sessions/session-r2b21-api', method: 'DELETE' }]);
});
