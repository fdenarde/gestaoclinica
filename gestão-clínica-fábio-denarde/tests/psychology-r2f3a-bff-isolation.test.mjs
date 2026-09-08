import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaTemplatesBffHandler } from '../api/_lib/metaTemplatesBff.js';

function responseHarness() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value || ''; },
  };
}

test('BFF envia somente templates ligados à Psicologia e colisões sanitizadas', async () => {
  const provider = { readSnapshot: async () => ({ lastSyncAt: '2026-08-18T12:00:00.000Z', templates: [
    { id: 'neuro', name: 'neuro_legacy', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
    { id: 'psych', name: 'psicologia_contextual', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
    { id: 'collision', name: 'psicologia_lembrete_vespera_online', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
  ] }) };
  const handler = createMetaTemplatesBffHandler({ provider });
  const response = responseHarness();
  await handler({ method: 'GET' }, response, { contextId: 'PSICOLOGIA', bindings: [{ metaTemplateId: 'psych', contextId: 'PSICOLOGIA' }] });
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.templates.map(item => item.id), ['psych']);
  assert.equal(payload.institutionalTemplateCount, 3);
  assert.deepEqual(payload.collisionChecks, [
    { technicalName: 'psicologia_lembrete_vespera_presencial', language: 'pt_BR', collision: false },
    { technicalName: 'psicologia_lembrete_vespera_online', language: 'pt_BR', collision: true },
  ]);
  assert.equal(payload.canRead, true);
  assert.equal(payload.canWrite, false);
  assert.equal(payload.contextBindingStatus, 'VERIFIED');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('BFF bloqueia qualquer método que não seja GET', async () => {
  const response = responseHarness();
  await createMetaTemplatesBffHandler({ provider: { readSnapshot: async () => ({ templates: [] }) } })({ method: 'POST' }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET');
});
