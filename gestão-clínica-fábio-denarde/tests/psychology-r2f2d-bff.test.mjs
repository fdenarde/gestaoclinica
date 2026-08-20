import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMetaTemplatesBffHandler } from '../api/_lib/metaTemplatesBff.js';

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value ?? ''); },
  };
}

test('BFF aceita somente GET e devolve DTO sanitizado', async () => {
  const provider = { readSnapshot: async () => ({ connectionStatus: 'CONNECTED', lastSyncAt: '2026-08-17T22:00:00.000Z', canRead: true, canWrite: false, templates: [] }) };
  const handler = createMetaTemplatesBffHandler({ provider });
  const getResponse = responseCapture();
  await handler({ method: 'GET' }, getResponse);
  assert.equal(getResponse.statusCode, 200);
  assert.equal(JSON.parse(getResponse.body).canRead, true);
  assert.equal(JSON.parse(getResponse.body).canWrite, false);

  const postResponse = responseCapture();
  await handler({ method: 'POST' }, postResponse);
  assert.equal(postResponse.statusCode, 405);
  assert.equal(JSON.parse(postResponse.body).error.code, 'META_METHOD_NOT_ALLOWED');
  assert.equal(postResponse.headers.Allow, 'GET');
});

test('browser e UI não conhecem Graph, token Meta, HMAC ou endpoint VPS', async () => {
  const client = await readFile(new URL('../src/features/psychology-messaging/metaBffClient.ts', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /graph\.facebook\.com|META_ACCESS_TOKEN|PSYCHOLOGY_META_BFF_HMAC_SECRET|vps-a193bbc5/i);
  assert.doesNotMatch(ui, /graph\.facebook\.com|META_ACCESS_TOKEN|PSYCHOLOGY_META_BFF_HMAC_SECRET|vps-a193bbc5/i);
  assert.match(client, /\/api\/psychology\/meta\/templates/);
  assert.match(ui, /Verificar conexão/);
  assert.match(ui, /Sincronizar templates/);
  assert.match(ui, /Tentar novamente/);
  assert.match(ui, /Envio à Meta será habilitado após autorização/);
});

test('rota Psychology delega Meta sem abrir operações de escrita', async () => {
  const source = await readFile(new URL('../api/psychology.js', import.meta.url), 'utf8');
  assert.match(source, /resource === 'meta' && id === 'templates'/);
  assert.match(source, /createMetaTemplatesBffHandler/);
  const bff = await readFile(new URL('../api/_lib/metaTemplatesBff.js', import.meta.url), 'utf8');
  assert.match(bff, /req\.method !== 'GET'/);
  assert.match(bff, /META_METHOD_NOT_ALLOWED/);
  assert.doesNotMatch(bff, /META_ACCESS_TOKEN|graph\.facebook\.com/);
});
