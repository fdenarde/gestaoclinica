import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  countMetaTemplateStatuses,
  normalizeMetaTemplateStatus,
} from '../src/features/psychology-messaging/messagingDomain';
import { normalizeMetaTemplateStatusUpdate } from '../src/features/psychology-messaging/metaWebhookContract';
import {
  createMetaTemplateProvider,
  createMetaBffSignature,
  createMetaTemplateBffProvider,
  META_TEMPLATE_WRITE_ENABLED,
  MetaBffError,
  MetaWriteDisabledError,
  readMetaTemplateConfig,
  validateMetaBffSnapshot,
} from '../api/_lib/metaTemplateProvider.js';

test('refino visual centraliza cabeçalho e segmented tabs sem caixa-alta obrigatória', async () => {
  const source = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  assert.match(source, /Configure os lembretes e acompanhe a integração com o WhatsApp/);
  assert.match(source, /justify-center/);
  assert.match(source, /Mensagens/);
  assert.match(source, /Regras de Envio/);
  assert.match(source, /Integração Meta/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected/);
});

test('mensagens têm busca, filtros compactos, card com ações principais e menu secundário', async () => {
  const source = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  for (const marker of ['Buscar mensagens', 'Todos os status', 'Todos os momentos', 'Todas', 'Mais ações', 'Duplicar', 'Excluir rascunho']) assert.match(source, new RegExp(marker));
  assert.match(source, /data-testid="psychology-message-filters"/);
  assert.match(source, /data-testid="psychology-message-card"/);
  assert.match(source, /Nova mensagem/);
});

test('editor usa editor e preview coordenados, variáveis agrupadas e validação explícita', async () => {
  const source = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  assert.match(source, /lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(18rem,0\.9fr\)\]/);
  assert.match(source, /data-testid="psychology-message-live-preview"/);
  for (const marker of ['Dados do atendimento', 'Local presencial', 'Gerenciamento', 'Pronta para configurar', 'Marcar como pronta para Meta']) assert.match(source, new RegExp(marker));
  assert.doesNotMatch(source, /\{\{[0-9]+\}\}/);
});

test('Meta UI separa Conexão, Templates e Segurança/Estado e mantém escrita bloqueada', async () => {
  const source = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  for (const marker of ['data-testid="psychology-meta-connection"', 'data-testid="psychology-meta-templates"', 'data-testid="psychology-meta-security"', 'Verificar conexão', 'Sincronizar templates', 'META_WRITE_ENABLED', 'Envio à Meta será habilitado após autorização']) assert.match(source, new RegExp(marker));
  assert.match(source, /disabled/);
  assert.match(source, /Não conectado/);
  assert.doesNotMatch(source, /graph\.facebook\.com|META_ACCESS_TOKEN|META_PHONE_NUMBER_ID|VITE_.*(?:TOKEN|SECRET)/i);
});

test('browser não possui cliente Graph API nem segredo Meta', async () => {
  const source = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /graph\.facebook\.com|fetch\s*\(|META_ACCESS_TOKEN|META_PHONE_NUMBER_ID|client_secret|Authorization\s*:/i);
});

test('mapper Meta é resiliente e estados desconhecidos viram UNKNOWN', () => {
  assert.equal(normalizeMetaTemplateStatus('APPROVED'), 'APPROVED');
  assert.equal(normalizeMetaTemplateStatus('PENDING'), 'PENDING');
  assert.equal(normalizeMetaTemplateStatus('REJECTED'), 'REJECTED');
  assert.equal(normalizeMetaTemplateStatus('PAUSED'), 'PAUSED');
  assert.equal(normalizeMetaTemplateStatus('DISABLED'), 'DISABLED');
  assert.equal(normalizeMetaTemplateStatus('future_state'), 'UNKNOWN');
  assert.deepEqual(countMetaTemplateStatuses([{ status: 'APPROVED' }, { status: 'PENDING' }, { status: 'UNKNOWN' }]), { approved: 1, pending: 1, rejected: 0, paused: 0, disabled: 0, unknown: 1 });
});

test('contrato de webhook futuro normaliza status sem publicar endpoint ou assinatura', () => {
  assert.deepEqual(normalizeMetaTemplateStatusUpdate({ id: 'meta-template-synthetic', status: 'PAUSED' }, '2026-08-17T12:00:00.000Z'), {
    event: 'message_template_status_update', metaTemplateId: 'meta-template-synthetic', status: 'PAUSED', receivedAt: '2026-08-17T12:00:00.000Z',
  });
  assert.equal(normalizeMetaTemplateStatusUpdate({ status: 'APPROVED' }), null);
});

test('provider real server-side só lê com configuração explícita e é idempotente', async () => {
  const disabled = createMetaTemplateProvider({ env: {} });
  assert.deepEqual(readMetaTemplateConfig({ env: {} }), { graphApiVersion: '', wabaId: '', hasAccessToken: false, readEnabled: false, canRead: false, canWrite: false, metaWriteEnabled: false });
  assert.deepEqual(disabled.capabilities(), { canRead: false, canWrite: false, metaWriteEnabled: false });
  await assert.rejects(() => disabled.listTemplates(), /META_READ_DISABLED/);
  assert.equal(META_TEMPLATE_WRITE_ENABLED, 'NO');

  const calls: Array<{ url: string; accessToken: string }> = [];
  const provider = createMetaTemplateProvider({
    env: { META_TEMPLATE_READ_ENABLED: 'YES', META_GRAPH_API_VERSION: 'v-test', META_WABA_ID: 'WABA_SYNTHETIC', META_ACCESS_TOKEN: 'TOKEN_SYNTHETIC' },
    request: async request => { calls.push(request); return { ok: true, json: async () => ({ data: [{ id: '1', name: 'lembrete', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }, { id: '1', name: 'lembrete', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }, { id: '2', name: 'analise', language: 'pt_BR', category: 'UTILITY', status: 'PENDING' }] }) }; },
  });
  assert.deepEqual(provider.capabilities(), { canRead: true, canWrite: false, metaWriteEnabled: false });
  const first = await provider.listTemplates();
  assert.equal(first.length, 2);
  assert.equal(first[0].status, 'APPROVED');
  const synced = await provider.syncTemplates(first);
  assert.equal(synced.length, 2);
  assert.equal(await provider.getTemplateStatus('1'), 'APPROVED');
  assert.ok(calls.every(call => call.url.includes('message_templates') || call.url.includes('/1?fields=')));
  assert.ok(calls.every(call => call.accessToken === 'TOKEN_SYNTHETIC'));
  await assert.rejects(() => provider.createTemplate({} as never), MetaWriteDisabledError);
  await assert.rejects(() => provider.editTemplate({} as never), MetaWriteDisabledError);
  await assert.rejects(() => provider.deleteTemplate({} as never), MetaWriteDisabledError);
  assert.equal(calls.length, 3);
});

test('ponte BFF R3B6 assina somente GET, valida DTO sanitizado e mantém escrita bloqueada', async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const provider = createMetaTemplateBffProvider({
    env: { PSYCHOLOGY_META_BFF_URL: 'https://backend.example.test', PSYCHOLOGY_META_BFF_HMAC_SECRET: 'a'.repeat(64), PSYCHOLOGY_META_BFF_TIMEOUT_MS: '8000' },
    now: () => 1_700_000_000_000,
    request: async request => {
      calls.push({ url: request.url, headers: request.headers });
      return new Response(JSON.stringify({ connectionStatus: 'CONNECTED', lastSyncAt: '2026-08-17T22:00:00.000Z', canRead: true, canWrite: false, templates: [{ id: '1', name: 'lembrete', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(provider.capabilities(), { canRead: true, canWrite: false, metaWriteEnabled: false });
  const snapshot = await provider.readSnapshot();
  assert.equal(snapshot.templates.length, 1);
  assert.equal(snapshot.templates[0].status, 'APPROVED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://backend.example.test/meta/templates');
  assert.match(calls[0].headers['X-R3B6-Signature'], /^[a-f0-9]{64}$/);
  assert.equal(calls[0].headers['X-R3B6-Timestamp'], '1700000000000');
  assert.equal(createMetaBffSignature({ timestamp: '1700000000000', secret: 'a'.repeat(64) }), calls[0].headers['X-R3B6-Signature']);
  assert.throws(() => validateMetaBffSnapshot({ connectionStatus: 'CONNECTED', lastSyncAt: '2026-08-17T22:00:00.000Z', canRead: true, canWrite: false, token: 'forbidden', templates: [] }), error => error instanceof MetaBffError && error.code === 'META_READ_FAILED');
});
