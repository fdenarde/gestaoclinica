import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const featureRoot = path.join(root, 'src', 'features', 'whatsapp-simulation');
const featureFiles = fs.readdirSync(featureRoot, { recursive: true })
  .filter(file => String(file).endsWith('.ts') || String(file).endsWith('.tsx'))
  .map(file => path.join(featureRoot, String(file)));
const source = featureFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

const { SIMULATION_TENANT_DATA } = await import('../../src/features/whatsapp-simulation/simulationFixtures.ts');
const { createSimulationProvider } = await import('../../src/features/whatsapp-simulation/simulationProvider.ts');
const { createInitialSimulationState, resetSimulationState } = await import('../../src/features/whatsapp-simulation/state/simulationStore.ts');
const selectors = await import('../../src/features/whatsapp-simulation/state/simulationSelectors.ts');
const actions = await import('../../src/features/whatsapp-simulation/state/simulationActions.ts');
const permissions = await import('../../src/features/whatsapp-simulation/domain/permissionPolicy.ts');
const validation = await import('../../src/features/whatsapp-simulation/domain/templateValidation.ts');

const tenantA = 'SIM-TENANT-A';
const tenantB = 'SIM-TENANT-B';

function freshState() {
  return createInitialSimulationState();
}

function selectedA(state = freshState()) {
  return actions.selectSimulationConversation(state, tenantA, 'SIM-CONVERSA-001');
}

function activeTemplate(state = freshState(), templateId = 'SIM-TPL-A-001') {
  return state.tenants[tenantA].templates.find(template => template.id === templateId);
}

function previewFor(state, source = 'manual') {
  const metadata = source === 'template'
    ? { source: 'template', templateId: 'SIM-TPL-A-001', templateVersion: 1 }
    : source === 'quick_reply'
      ? { source: 'quick_reply', quickReplyId: 'SIM-QR-A-001' }
      : { source: 'manual' };
  return actions.createSimulationPreview(selectedA(state), tenantA, source === 'template' ? 'Olá, Contato Fictício 001.' : 'Mensagem sintética de teste.', metadata);
}

test('cada tenant possui quatro respostas rápidas sintéticas', () => {
  assert.equal(SIMULATION_TENANT_DATA[tenantA].quickReplies.length, 4);
  assert.equal(SIMULATION_TENANT_DATA[tenantB].quickReplies.length, 4);
});

test('cada tenant possui templates independentes', () => {
  const idsA = SIMULATION_TENANT_DATA[tenantA].templates.map(item => item.id);
  const idsB = SIMULATION_TENANT_DATA[tenantB].templates.map(item => item.id);
  assert.equal(idsA.length, 4);
  assert.equal(idsB.length, 4);
  assert.equal(idsA.some(id => idsB.includes(id)), false);
});

test('tenant A não acessa template do tenant B', () => {
  assert.throws(() => actions.selectSimulationTemplate(freshState(), tenantA, 'SIM-TPL-B-001'), /tenant|Tenant/);
});

test('tenant B não acessa resposta rápida do tenant A', () => {
  const state = actions.switchSimulationTenant(freshState(), tenantB);
  assert.throws(() => actions.setSimulationComposition(state, { mode: 'quick_reply', draft: 'texto', quickReplyId: 'SIM-QR-A-001', templateId: '' }), /tenant|Tenant/);
});

test('troca de tenant limpa seleção, filtros, template, draft, composição e preview', () => {
  let state = selectedA();
  state = actions.setTemplateFilters(state, tenantA, { search: 'retorno', category: 'retorno', status: 'active' });
  state = actions.selectSimulationTemplate(state, tenantA, 'SIM-TPL-A-001');
  state = actions.setSimulationTemplateDraft(state, { name: 'Draft', description: 'Draft sintético', category: 'atendimento', content: 'Texto', allowedVariables: [] });
  state = actions.setSimulationComposition(state, { mode: 'quick_reply', draft: 'Atalho', quickReplyId: 'SIM-QR-A-001', templateId: '' });
  state = actions.setSimulationPreview(state, previewFor(state, 'quick_reply'));
  const switched = actions.switchSimulationTenant(state, tenantB);
  assert.equal(switched.activeTenantId, tenantB);
  assert.equal(switched.selectedConversationId, '');
  assert.deepEqual(switched.templateFilters, { search: '', category: '', status: '' });
  assert.equal(switched.selectedTemplateId, '');
  assert.equal(switched.templateDraft, null);
  assert.equal(switched.preview, null);
  assert.deepEqual(switched.composer, { mode: 'manual', draft: '', quickReplyId: '', templateId: '' });
});

test('pesquisa por nome de template funciona', () => {
  const state = actions.setTemplateFilters(freshState(), tenantA, { search: 'confirmação' });
  assert.deepEqual(selectors.selectVisibleTemplates(state, tenantA).map(item => item.id), ['SIM-TPL-A-001']);
});

test('filtro por categoria de template funciona', () => {
  const state = actions.setTemplateFilters(freshState(), tenantA, { category: 'retorno' });
  assert.deepEqual(selectors.selectVisibleTemplates(state, tenantA).map(item => item.id), ['SIM-TPL-A-002']);
});

test('filtro por status de template funciona', () => {
  const state = actions.setTemplateFilters(freshState(), tenantA, { status: 'inactive' });
  assert.deepEqual(selectors.selectVisibleTemplates(state, tenantA).map(item => item.id), ['SIM-TPL-A-004']);
});

test('limpar filtros de template funciona', () => {
  let state = actions.setTemplateFilters(freshState(), tenantA, { search: 'x', category: 'retorno', status: 'active' });
  state = actions.clearTemplateFilters(state, tenantA);
  assert.deepEqual(state.templateFilters, { search: '', category: '', status: '' });
  assert.equal(selectors.selectVisibleTemplates(state, tenantA).length, 4);
});

test('administrador da plataforma administra templates', () => {
  const state = actions.createSimulationTemplate(freshState(), tenantA, { name: 'Novo template', description: 'Descrição sintética', category: 'atendimento', content: 'Texto fictício.', allowedVariables: [] });
  assert.equal(state.tenants[tenantA].templates.at(-1).status, 'draft');
});

test('administrador da clínica administra somente o tenant atual', () => {
  const clinic = actions.setSimulationProfile(freshState(), 'clinic_admin');
  const created = actions.createSimulationTemplate(clinic, tenantA, { name: 'Draft da clínica', description: 'Descrição', category: 'retorno', content: 'Retorno fictício.', allowedVariables: [] });
  assert.equal(created.tenants[tenantA].templates.length, 5);
  assert.throws(() => actions.switchSimulationTenant(clinic, tenantB), /permissão/);
});

test('profissional utiliza template ativo e não administra', () => {
  const professional = actions.setSimulationProfile(freshState(), 'professional');
  const composed = actions.setSimulationComposition(professional, { mode: 'template', draft: 'Texto resolvido', quickReplyId: '', templateId: 'SIM-TPL-A-001' });
  assert.equal(composed.composer.templateId, 'SIM-TPL-A-001');
  assert.throws(() => actions.createSimulationTemplate(professional, tenantA, { name: 'Não permitido', description: 'x', category: 'retorno', content: 'x', allowedVariables: [] }), /permissão/);
});

test('atendente utiliza template ativo', () => {
  const attendant = actions.setSimulationProfile(freshState(), 'attendant');
  const composed = actions.setSimulationComposition(attendant, { mode: 'template', draft: 'Texto resolvido', quickReplyId: '', templateId: 'SIM-TPL-A-001' });
  assert.equal(composed.composer.mode, 'template');
});

test('somente leitura visualiza mas não modifica templates', () => {
  const readOnly = actions.setSimulationProfile(freshState(), 'read_only');
  assert.equal(selectors.selectVisibleTemplates(readOnly, tenantA).length, 4);
  assert.throws(() => actions.setSimulationTemplateDraft(readOnly, { name: 'x', description: 'x', category: 'retorno', content: 'x', allowedVariables: [] }), /permissão/);
  assert.throws(() => actions.setSimulationComposition(readOnly, { mode: 'template', draft: 'x', quickReplyId: '', templateId: 'SIM-TPL-A-001' }), /permissão/);
});

test('permissões de template são aplicadas no domínio', () => {
  assert.equal(permissions.hasSimulationPermission('platform_admin', 'manage_templates'), true);
  assert.equal(permissions.hasSimulationPermission('clinic_admin', 'manage_templates'), true);
  assert.equal(permissions.hasSimulationPermission('professional', 'manage_templates'), false);
  assert.equal(permissions.hasSimulationPermission('attendant', 'use_template'), true);
  assert.equal(permissions.hasSimulationPermission('read_only', 'use_template'), false);
});

test('template draft pode ser editado', () => {
  let state = actions.createSimulationTemplate(freshState(), tenantA, { name: 'Draft editável', description: 'Antes', category: 'retorno', content: 'Antes.', allowedVariables: [] });
  const id = state.tenants[tenantA].templates.at(-1).id;
  state = actions.updateSimulationTemplate(state, tenantA, id, { name: 'Draft editado', description: 'Depois', category: 'retorno', content: 'Depois.', allowedVariables: [] });
  assert.equal(state.tenants[tenantA].templates.find(item => item.id === id).name, 'Draft editado');
});

test('template active não pode ser editado diretamente', () => {
  assert.throws(() => actions.updateSimulationTemplate(freshState(), tenantA, 'SIM-TPL-A-001', { name: 'Alteração', description: 'x', category: 'retorno', content: 'x', allowedVariables: [] }), /draft|editados/);
});

test('duplicação cria novo draft com versão e origem', () => {
  const state = actions.duplicateSimulationTemplate(freshState(), tenantA, 'SIM-TPL-A-001');
  const copy = state.tenants[tenantA].templates.find(item => item.sourceTemplateId === 'SIM-TPL-A-001');
  assert.ok(copy);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.version, 2);
  assert.notEqual(copy.id, 'SIM-TPL-A-001');
});

test('duplicação repetida é idempotente', () => {
  let state = actions.duplicateSimulationTemplate(freshState(), tenantA, 'SIM-TPL-A-001');
  const count = state.tenants[tenantA].templates.length;
  state = actions.duplicateSimulationTemplate(state, tenantA, 'SIM-TPL-A-001');
  assert.equal(state.tenants[tenantA].templates.length, count);
});

test('template draft válido pode ser ativado', () => {
  let state = actions.createSimulationTemplate(freshState(), tenantA, { name: 'Ativável', description: 'x', category: 'atendimento', content: 'Olá {{contato_nome}}.', allowedVariables: ['contato_nome'] });
  const id = state.tenants[tenantA].templates.at(-1).id;
  state = actions.activateSimulationTemplate(state, tenantA, id);
  assert.equal(state.tenants[tenantA].templates.find(item => item.id === id).status, 'active');
});

test('template inválido não pode ser ativado', () => {
  const initial = freshState();
  const invalid = { id: 'SIM-TPL-A-BAD', tenantId: tenantA, name: 'Inválido', description: 'x', category: 'retorno', version: 1, content: '{{variavel_livre}}', allowedVariables: [], status: 'draft', createdBy: 'Usuário sintético', createdAt: '2026-03-01', updatedAt: '2026-03-01', usedInSimulation: false };
  const state = { ...initial, tenants: { ...initial.tenants, [tenantA]: { ...initial.tenants[tenantA], templates: [...initial.tenants[tenantA].templates, invalid] } } };
  assert.throws(() => actions.activateSimulationTemplate(state, tenantA, invalid.id), /Variáveis|permitidas/);
});

test('template active pode ser desativado', () => {
  const state = actions.deactivateSimulationTemplate(freshState(), tenantA, 'SIM-TPL-A-001');
  assert.equal(state.tenants[tenantA].templates.find(item => item.id === 'SIM-TPL-A-001').status, 'inactive');
});

test('template inactive não aparece para uso', () => {
  const inactive = actions.deactivateSimulationTemplate(freshState(), tenantA, 'SIM-TPL-A-001');
  assert.throws(() => actions.setSimulationComposition(inactive, { mode: 'template', draft: 'x', quickReplyId: '', templateId: 'SIM-TPL-A-001' }), /ativos/);
});

test('variável permitida é resolvida com valor fictício', () => {
  const template = activeTemplate();
  assert.equal(validation.resolveTemplateContent(template, { contato_nome: 'Contato Fictício 001' }), 'Olá, Contato Fictício 001. Confirmamos o recebimento da sua mensagem fictícia.');
});

test('variável desconhecida é rejeitada', () => {
  assert.throws(() => validation.assertValidTemplateDraft({ name: 'x', description: 'x', category: 'retorno', content: '{{variavel_livre}}', allowedVariables: [] }), /Variáveis não permitidas/);
});

test('variável obrigatória vazia bloqueia a pré-visualização', () => {
  assert.throws(() => validation.resolveTemplateContent(activeTemplate(), { contato_nome: '' }), /precisa de valor/);
});

test('HTML permitido é tratado como texto', () => {
  const template = { ...activeTemplate(), content: '<b>Texto fictício</b>' };
  assert.equal(validation.resolveTemplateContent(template, {}), '<b>Texto fictício</b>');
});

test('script ou URL executável é rejeitado', () => {
  assert.throws(() => validation.assertValidTemplateDraft({ name: 'x', description: 'x', category: 'retorno', content: '<script>alert(1)</script>', allowedVariables: [] }), /executável/);
  assert.throws(() => validation.assertValidTemplateDraft({ name: 'x', description: 'x', category: 'retorno', content: 'https://externo.invalid', allowedVariables: [] }), /links/);
});

test('resposta rápida ativa entra no compositor', () => {
  const state = actions.setSimulationComposition(freshState(), { mode: 'quick_reply', draft: 'Atalho fictício', quickReplyId: 'SIM-QR-A-001', templateId: '' });
  assert.equal(state.composer.mode, 'quick_reply');
  assert.equal(state.composer.quickReplyId, 'SIM-QR-A-001');
});

test('editar resposta rápida no compositor não altera a fixture', () => {
  const state = actions.setSimulationComposition(freshState(), { mode: 'quick_reply', draft: 'Texto editado localmente', quickReplyId: 'SIM-QR-A-001', templateId: '' });
  assert.equal(state.tenants[tenantA].quickReplies.find(item => item.id === 'SIM-QR-A-001').content, 'Recebemos sua mensagem fictícia e retornaremos em breve.');
  assert.equal(state.composer.draft, 'Texto editado localmente');
});

test('template entra no compositor com texto resolvido', () => {
  const template = activeTemplate();
  const state = actions.setSimulationComposition(freshState(), { mode: 'template', draft: validation.resolveTemplateContent(template, { contato_nome: 'Contato Fictício 001' }), quickReplyId: '', templateId: template.id });
  assert.equal(state.composer.templateId, template.id);
  assert.match(state.composer.draft, /Contato Fictício 001/);
});

test('pré-visualização manual funciona', () => {
  const preview = previewFor(freshState(), 'manual');
  assert.equal(preview.source, 'manual');
  assert.equal(preview.templateId, undefined);
});

test('somente leitura não pode iniciar uma operação de teste', () => {
  const readOnly = actions.setSimulationProfile(selectedA(), 'read_only');
  assert.throws(() => actions.createSimulationPreview(readOnly, tenantA, 'Teste', { source: 'template', templateId: 'SIM-TPL-A-001', templateVersion: 1 }), /permissão/);
});

test('pré-visualização de resposta rápida funciona', () => {
  const preview = previewFor(freshState(), 'quick_reply');
  assert.equal(preview.source, 'quick_reply');
  assert.equal(preview.quickReplyId, 'SIM-QR-A-001');
});

test('pré-visualização de template funciona', () => {
  const preview = previewFor(freshState(), 'template');
  assert.equal(preview.source, 'template');
  assert.equal(preview.templateId, 'SIM-TPL-A-001');
  assert.equal(preview.templateVersion, 1);
});

test('cancelamento da pré-visualização não registra mensagem', () => {
  let state = selectedA();
  state = actions.setSimulationPreview(state, previewFor(state, 'template'));
  const cancelled = actions.clearSimulationPreview(state);
  assert.equal(cancelled.preview, null);
  assert.equal(cancelled.tenants[tenantA].conversations[0].messages.length, 2);
});

test('confirmação registra somente uma mensagem', () => {
  const provider = createSimulationProvider();
  let state = selectedA();
  state = actions.setSimulationPreview(state, previewFor(state, 'manual'));
  const first = actions.registerPreviewedSimulatedMessage(state, provider, tenantA);
  assert.equal(first.tenants[tenantA].conversations[0].messages.length, 3);
  const duplicate = actions.registerSimulatedMessage(first, provider, tenantA, 'Mensagem sintética de teste.', false, { source: 'manual' });
  assert.equal(duplicate.tenants[tenantA].conversations[0].messages.length, 3);
});

test('templateId e templateVersion são registrados na mensagem', () => {
  const provider = createSimulationProvider();
  let state = selectedA();
  state = actions.setSimulationPreview(state, previewFor(state, 'template'));
  const registered = actions.registerPreviewedSimulatedMessage(state, provider, tenantA);
  const message = registered.tenants[tenantA].conversations[0].messages.at(-1);
  assert.equal(message.templateId, 'SIM-TPL-A-001');
  assert.equal(message.templateVersion, 1);
  assert.equal(message.source, 'template');
});

test('quickReplyId é registrado na mensagem', () => {
  const provider = createSimulationProvider();
  let state = selectedA();
  state = actions.setSimulationPreview(state, previewFor(state, 'quick_reply'));
  const registered = actions.registerPreviewedSimulatedMessage(state, provider, tenantA);
  assert.equal(registered.tenants[tenantA].conversations[0].messages.at(-1).quickReplyId, 'SIM-QR-A-001');
});

test('mensagem manual não recebe templateId', () => {
  const provider = createSimulationProvider();
  let state = selectedA();
  state = actions.setSimulationPreview(state, previewFor(state, 'manual'));
  const registered = actions.registerPreviewedSimulatedMessage(state, provider, tenantA);
  assert.equal(registered.tenants[tenantA].conversations[0].messages.at(-1).templateId, undefined);
});

test('registro confirmado atualiza conversa para aguardando contato', () => {
  const provider = createSimulationProvider();
  let state = selectedA();
  state = actions.setSimulationPreview(state, previewFor(state, 'quick_reply'));
  const registered = actions.registerPreviewedSimulatedMessage(state, provider, tenantA);
  assert.equal(registered.tenants[tenantA].conversations[0].state, 'aguardando_contato');
});

test('conversa finalizada bloqueia mensagem manual, rápida e template', () => {
  const finalized = actions.finalizeSimulationConversation(freshState(), tenantA, 'SIM-CONVERSA-001');
  assert.throws(() => actions.createSimulationPreview(finalized, tenantA, 'Manual', { source: 'manual' }), /finalizada/);
  assert.throws(() => actions.createSimulationPreview(finalized, tenantA, 'Rápida', { source: 'quick_reply', quickReplyId: 'SIM-QR-A-001' }), /finalizada/);
  assert.throws(() => actions.createSimulationPreview(finalized, tenantA, 'Template', { source: 'template', templateId: 'SIM-TPL-A-001', templateVersion: 1 }), /finalizada/);
});

test('reiniciar simulação restaura templates e remove drafts', () => {
  let state = actions.createSimulationTemplate(freshState(), tenantA, { name: 'Descartável', description: 'x', category: 'retorno', content: 'x', allowedVariables: [] });
  assert.equal(state.tenants[tenantA].templates.length, 5);
  state = resetSimulationState();
  assert.equal(state.tenants[tenantA].templates.length, 4);
  assert.equal(state.templateDraft, null);
});

test('reiniciar simulação restaura respostas rápidas e composição', () => {
  let state = actions.setSimulationComposition(freshState(), { mode: 'quick_reply', draft: 'Alterada', quickReplyId: 'SIM-QR-A-001', templateId: '' });
  state = resetSimulationState();
  assert.equal(state.composer.mode, 'manual');
  assert.equal(state.tenants[tenantA].quickReplies.find(item => item.id === 'SIM-QR-A-001').content, 'Recebemos sua mensagem fictícia e retornaremos em breve.');
});

test('navegação entre Caixa de entrada e Templates preserva o estado enquanto aberta', () => {
  let state = selectedA();
  state = actions.setSimulationComposition(state, { mode: 'quick_reply', draft: 'Texto preservado', quickReplyId: 'SIM-QR-A-001', templateId: '' });
  state = actions.setSimulationView(state, 'templates');
  state = actions.setSimulationView(state, 'inbox');
  assert.equal(state.composer.draft, 'Texto preservado');
  assert.equal(state.selectedConversationId, 'SIM-CONVERSA-001');
});

test('template inactive não pode ser reativado diretamente', () => {
  const state = actions.deactivateSimulationTemplate(freshState(), tenantA, 'SIM-TPL-A-001');
  assert.throws(() => actions.activateSimulationTemplate(state, tenantA, 'SIM-TPL-A-001'), /draft|duplique/);
});

test('estado permanece somente em memória', () => {
  const state = actions.createSimulationTemplate(freshState(), tenantA, { name: 'Memória', description: 'x', category: 'retorno', content: 'x', allowedVariables: [] });
  const reset = resetSimulationState();
  assert.equal(reset.tenants[tenantA].templates.some(item => item.name === 'Memória'), false);
  assert.equal(state.tenants[tenantA].templates.some(item => item.name === 'Memória'), true);
});

test('R2-B não usa rede, persistência, Firebase ou robô', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /\baxios\b|XMLHttpRequest|WebSocket/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/i);
  assert.doesNotMatch(source, /firebase|firebase-admin|whatsapp-web\.js|server\.js|scheduler|watchdog|OperationalReport/i);
  assert.doesNotMatch(source, /process\.env|import\.meta\.env/i);
});

test('fixtures não possuem telefones, campos clínicos ou dados reais', () => {
  const serialized = JSON.stringify({ templates: SIMULATION_TENANT_DATA, quickReplies: SIMULATION_TENANT_DATA });
  assert.doesNotMatch(serialized, /\b\d{8,15}\b/);
  assert.doesNotMatch(serialized, /patientId|diagnóstico|diagnostico|prontuário|payment|pagamento|agenda|session/i);
});

test('R1 preserva provider, falha controlada, idempotência e status', () => {
  const provider = createSimulationProvider();
  const input = { provider: 'simulation', tenantId: tenantA, conversationId: 'SIM-CONVERSA-001', operationKey: 'SIM-R2B-R1-001', body: 'Mensagem R1 fictícia.' };
  const first = provider.registerMessage(input);
  assert.equal(first.status, 'simulated_queued');
  assert.equal(provider.registerMessage(input).duplicate, true);
  assert.equal(provider.registerMessage({ ...input, operationKey: 'SIM-R2B-R1-FAIL', shouldFail: true }).status, 'simulated_failed');
  assert.equal(provider.advanceStatus(first.status), 'simulated_processed');
});

test('R2-A permanece preservada no banner e nas áreas do módulo', () => {
  const header = fs.readFileSync(path.join(featureRoot, 'components', 'SimulationHeader.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(featureRoot, 'components', 'SimulationShell.tsx'), 'utf8');
  const dashboard = fs.readFileSync(path.join(featureRoot, 'SimulationDashboard.tsx'), 'utf8');
  assert.match(shell, /Ambiente de demonstração — nenhuma mensagem será enviada/);
  assert.match(header, /Conexão do WhatsApp/);
  assert.match(dashboard, /InboxView/);
  assert.match(dashboard, /resetSimulationState|createInitialSimulationState/);
});

test('App.tsx preserva semanticamente a integração do dashboard simulado', () => {
  const app = path.join(root, 'src', 'App.tsx');
  const source = fs.readFileSync(app, 'utf8');
  assert.match(source, /const WhatsappSimulationDashboard = lazy\(\(\) => import\('\.\/features\/whatsapp-simulation\/SimulationDashboard'\)\)/);
  assert.match(source, /const canAccessWhatsappSimulation/);
  assert.match(source, /accessProfile\.role === 'admin'/);
  assert.match(source, /accessProfile\.role === 'professional'/);
  assert.match(source, /activeTab === 'whatsapp' && canAccessWhatsappSimulation && <WhatsappSimulationDashboard embedded \/>/);
  assert.doesNotMatch(source, /activeTab === 'whatsapp-simulacao'/);
});
