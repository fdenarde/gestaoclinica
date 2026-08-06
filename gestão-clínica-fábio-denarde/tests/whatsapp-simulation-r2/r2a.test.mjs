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

const { SIMULATION_FIXTURES, SIMULATION_TENANT_DATA } = await import('../../src/features/whatsapp-simulation/simulationFixtures.ts');
const { createSimulationProvider } = await import('../../src/features/whatsapp-simulation/simulationProvider.ts');
const { createInitialSimulationState, resetSimulationState } = await import('../../src/features/whatsapp-simulation/state/simulationStore.ts');
const { getSelectedConversation, selectCategoryCounts, selectVisibleConversations } = await import('../../src/features/whatsapp-simulation/state/simulationSelectors.ts');
const actions = await import('../../src/features/whatsapp-simulation/state/simulationActions.ts');
const { assertValidConversationTransition, canTransitionConversation } = await import('../../src/features/whatsapp-simulation/domain/conversationStateMachine.ts');
const { hasSimulationPermission, SIMULATION_PROFILES } = await import('../../src/features/whatsapp-simulation/domain/permissionPolicy.ts');

const tenantA = 'SIM-TENANT-A';
const tenantB = 'SIM-TENANT-B';

function freshState() {
  return createInitialSimulationState();
}

function selectA(state, conversationId = 'SIM-CONVERSA-001') {
  return actions.selectSimulationConversation(state, tenantA, conversationId);
}

test('os dois tenants sintéticos existem', () => {
  const state = freshState();
  assert.deepEqual(Object.keys(state.tenants).sort(), [tenantA, tenantB]);
  assert.equal(SIMULATION_TENANT_DATA[tenantA].tenant.id, tenantA);
  assert.equal(SIMULATION_TENANT_DATA[tenantB].tenant.id, tenantB);
});

test('tenants não compartilham contatos', () => {
  const idsA = SIMULATION_TENANT_DATA[tenantA].conversations.map(item => item.contact.id);
  const idsB = SIMULATION_TENANT_DATA[tenantB].conversations.map(item => item.contact.id);
  assert.equal(idsA.some(id => idsB.includes(id)), false);
});

test('tenants não compartilham conversas', () => {
  const idsA = SIMULATION_TENANT_DATA[tenantA].conversations.map(item => item.id);
  const idsB = SIMULATION_TENANT_DATA[tenantB].conversations.map(item => item.id);
  assert.equal(idsA.some(id => idsB.includes(id)), false);
});

test('tenants não compartilham mensagens', () => {
  const idsA = SIMULATION_TENANT_DATA[tenantA].conversations.flatMap(item => item.messages.map(message => message.id));
  const idsB = SIMULATION_TENANT_DATA[tenantB].conversations.flatMap(item => item.messages.map(message => message.id));
  assert.equal(idsA.some(id => idsB.includes(id)), false);
});

test('tenants não compartilham notas', () => {
  const state = freshState();
  const withNote = actions.createInternalSimulationNote(state, tenantA, 'SIM-CONVERSA-001', 'Nota exclusivamente sintética.');
  assert.equal(withNote.tenants[tenantA].conversations[0].notes.length, 1);
  assert.equal(withNote.tenants[tenantB].conversations[0].notes.length, 0);
  assert.equal(withNote.tenants[tenantA].conversations[0].notes[0].tenantId, tenantA);
});

test('troca de tenant limpa seleção', () => {
  const state = selectA(freshState());
  const switched = actions.switchSimulationTenant(state, tenantB);
  assert.equal(switched.activeTenantId, tenantB);
  assert.equal(switched.selectedConversationId, '');
});

test('troca de tenant limpa filtros e pesquisa', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { search: 'Contato', status: 'nova', professionalId: 'SIM-PROF-A-001', tagId: 'SIM-TAG-A-NOVO', category: 'unread' });
  state = actions.switchSimulationTenant(state, tenantB);
  assert.deepEqual(state.filters, { category: 'all', search: '', status: '', professionalId: '', tagId: '' });
});

test('pesquisa por nome fictício funciona', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { search: 'Contato Fictício 002' });
  assert.deepEqual(selectVisibleConversations(state, tenantA).map(item => item.id), ['SIM-CONVERSA-002']);
});

test('pesquisa por identificador sintético funciona', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { search: 'SIM-CONTATO-001' });
  assert.deepEqual(selectVisibleConversations(state, tenantA).map(item => item.id), ['SIM-CONVERSA-001']);
});

test('filtro por status funciona', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { status: 'aguardando_contato' });
  assert.deepEqual(selectVisibleConversations(state, tenantA).map(item => item.id), ['SIM-CONVERSA-002']);
});

test('filtro por profissional funciona', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { professionalId: 'SIM-PROF-A-002' });
  assert.deepEqual(selectVisibleConversations(state, tenantA).map(item => item.id), ['SIM-CONVERSA-002']);
});

test('filtro por etiqueta funciona', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { tagId: 'SIM-TAG-A-RETORNO' });
  assert.deepEqual(selectVisibleConversations(state, tenantA).map(item => item.id), ['SIM-CONVERSA-002']);
});

test('limpar filtros funciona', () => {
  let state = actions.setSimulationFilters(freshState(), tenantA, { search: 'Contato', status: 'nova', category: 'unread' });
  state = actions.clearSimulationFilters(state, tenantA);
  assert.deepEqual(state.filters, { category: 'all', search: '', status: '', professionalId: '', tagId: '' });
});

test('contadores das categorias são derivados do estado atual', () => {
  const countsA = selectCategoryCounts(freshState(), tenantA);
  assert.deepEqual(countsA, { all: 2, unread: 1, awaiting_team: 0, awaiting_contact: 1, scheduled: 0, failed: 0, finished: 0 });
  const stateB = actions.switchSimulationTenant(freshState(), tenantB);
  assert.deepEqual(selectCategoryCounts(stateB, tenantB), { all: 1, unread: 1, awaiting_team: 1, awaiting_contact: 0, scheduled: 0, failed: 0, finished: 0 });
});

test('ordenação respeita prioridade, não lidas e atividade', () => {
  assert.deepEqual(selectVisibleConversations(freshState(), tenantA).map(item => item.id), ['SIM-CONVERSA-002', 'SIM-CONVERSA-001']);
});

test('atribuição de profissional funciona dentro do tenant', () => {
  const state = actions.assignSimulationProfessional(freshState(), tenantA, 'SIM-CONVERSA-001', 'SIM-PROF-A-002');
  assert.equal(state.tenants[tenantA].conversations[0].assignedProfessionalId, 'SIM-PROF-A-002');
  assert.match(state.tenants[tenantA].conversations[0].history.at(-1).label, /Profissional/);
});

test('prioridade pode ser alterada por perfil permitido', () => {
  let state = actions.setSimulationProfile(freshState(), 'professional');
  state = actions.changeSimulationPriority(state, tenantA, 'SIM-CONVERSA-001', 'alta');
  assert.equal(state.tenants[tenantA].conversations.find(item => item.id === 'SIM-CONVERSA-001').priority, 'alta');
});

test('etiquetas podem ser alteradas por perfil permitido', () => {
  const state = actions.toggleSimulationTag(freshState(), tenantA, 'SIM-CONVERSA-001', 'SIM-TAG-A-PRIORIDADE');
  assert.equal(state.tenants[tenantA].conversations[0].tagIds.includes('SIM-TAG-A-PRIORIDADE'), true);
});

test('nota interna é criada com identificação sintética', () => {
  const state = actions.createInternalSimulationNote(freshState(), tenantA, 'SIM-CONVERSA-001', 'Revisar retorno fictício.');
  const note = state.tenants[tenantA].conversations[0].notes[0];
  assert.equal(note.id, 'SIM-NOTA-SIM-TENANT-A-SIM-CONVERSA-001-1');
  assert.equal(note.conversationId, 'SIM-CONVERSA-001');
  assert.match(note.author, /Usuário simulado/);
});

test('nota interna não cria mensagem', () => {
  const before = freshState().tenants[tenantA].conversations[0].messages.length;
  const after = actions.createInternalSimulationNote(freshState(), tenantA, 'SIM-CONVERSA-001', 'Nota sem mensagem.');
  assert.equal(after.tenants[tenantA].conversations[0].messages.length, before);
});

test('nota interna não utiliza provider', () => {
  const notesSource = fs.readFileSync(path.join(featureRoot, 'state', 'simulationActions.ts'), 'utf8');
  const noteFunction = notesSource.slice(notesSource.indexOf('export function createInternalSimulationNote'), notesSource.indexOf('export function registerSyntheticInboundMessage'));
  assert.doesNotMatch(noteFunction, /provider|registerMessage/);
});

test('nota interna não altera fila nem estado de mensagem', () => {
  const before = freshState().tenants[tenantA].conversations[0];
  const after = actions.createInternalSimulationNote(freshState(), tenantA, before.id, 'Nota sem fila.').tenants[tenantA].conversations[0];
  assert.equal(after.scheduled, before.scheduled);
  assert.deepEqual(after.messages, before.messages);
});

test('nota interna respeita tenant', () => {
  assert.throws(() => actions.createInternalSimulationNote(freshState(), tenantA, 'SIM-CONVERSA-003', 'Acesso cruzado.'), /tenant|Tenant/);
});

test('nota interna respeita permissão', () => {
  const state = actions.setSimulationProfile(freshState(), 'read_only');
  assert.throws(() => actions.createInternalSimulationNote(state, tenantA, 'SIM-CONVERSA-001', 'Não permitido.'), /permissão/);
});

test('conversa pode ser finalizada', () => {
  const state = actions.finalizeSimulationConversation(freshState(), tenantA, 'SIM-CONVERSA-001');
  assert.equal(state.tenants[tenantA].conversations[0].state, 'finalizada');
});

test('conversa finalizada bloqueia composição', () => {
  const state = actions.finalizeSimulationConversation(freshState(), tenantA, 'SIM-CONVERSA-001');
  assert.throws(() => actions.registerSimulatedMessage(state, createSimulationProvider(), tenantA, 'Resposta bloqueada.'), /finalizada/);
});

test('conversa pode ser reaberta', () => {
  const finalized = actions.finalizeSimulationConversation(freshState(), tenantA, 'SIM-CONVERSA-001');
  const reopened = actions.reopenSimulationConversation(finalized, tenantA, 'SIM-CONVERSA-001');
  assert.equal(reopened.tenants[tenantA].conversations[0].state, 'reaberta');
});

test('transição inválida é rejeitada', () => {
  assert.equal(canTransitionConversation('nova', 'finalizada'), false);
  assert.throws(() => assertValidConversationTransition('nova', 'finalizada'), /Transição inválida/);
});

test('resposta simulada altera conversa para aguardando contato', () => {
  const state = actions.registerSimulatedMessage(freshState(), createSimulationProvider(), tenantA, 'Resposta de teste R2-A.');
  assert.equal(state.tenants[tenantA].conversations[0].state, 'aguardando_contato');
});

test('entrada fictícia altera conversa para aguardando equipe', () => {
  const state = actions.registerSyntheticInboundMessage(freshState(), tenantA, 'SIM-CONVERSA-001', 'Nova entrada fictícia.');
  assert.equal(state.tenants[tenantA].conversations[0].state, 'aguardando_equipe');
  assert.equal(state.tenants[tenantA].conversations[0].messages.at(-1).direction, 'inbound');
});

test('histórico registra alterações locais', () => {
  let state = freshState();
  state = actions.changeSimulationPriority(state, tenantA, 'SIM-CONVERSA-001', 'alta');
  state = actions.createInternalSimulationNote(state, tenantA, 'SIM-CONVERSA-001', 'Histórico de teste.');
  state = actions.finalizeSimulationConversation(state, tenantA, 'SIM-CONVERSA-001');
  const history = state.tenants[tenantA].conversations[0].history;
  assert.ok(history.some(entry => entry.kind === 'priority_changed'));
  assert.ok(history.some(entry => entry.kind === 'note_added'));
  assert.ok(history.some(entry => entry.label.includes('finalizada')));
});

test('administrador da plataforma pode trocar tenant', () => {
  assert.equal(actions.switchSimulationTenant(freshState(), tenantB).activeTenantId, tenantB);
});

test('administrador da clínica não pode trocar tenant', () => {
  const state = actions.setSimulationProfile(freshState(), 'clinic_admin');
  assert.throws(() => actions.switchSimulationTenant(state, tenantB), /permissão/);
});

test('profissional possui apenas permissões aprovadas', () => {
  assert.equal(hasSimulationPermission('professional', 'view'), true);
  assert.equal(hasSimulationPermission('professional', 'register_message'), true);
  assert.equal(hasSimulationPermission('professional', 'create_note'), true);
  assert.equal(hasSimulationPermission('professional', 'change_priority'), true);
  assert.equal(hasSimulationPermission('professional', 'assign_professional'), false);
  assert.equal(hasSimulationPermission('professional', 'manage_tags'), false);
  assert.equal(hasSimulationPermission('professional', 'switch_tenant'), false);
});

test('atendente possui apenas permissões aprovadas', () => {
  assert.equal(hasSimulationPermission('attendant', 'view'), true);
  assert.equal(hasSimulationPermission('attendant', 'register_message'), true);
  assert.equal(hasSimulationPermission('attendant', 'create_note'), true);
  assert.equal(hasSimulationPermission('attendant', 'finalize_conversation'), true);
  assert.equal(hasSimulationPermission('attendant', 'change_priority'), false);
  assert.equal(hasSimulationPermission('attendant', 'assign_professional'), false);
});

test('somente leitura não altera estado', () => {
  let state = actions.setSimulationProfile(freshState(), 'read_only');
  assert.equal(hasSimulationPermission('read_only', 'view'), true);
  assert.equal(hasSimulationPermission('read_only', 'register_message'), false);
  assert.equal(hasSimulationPermission('read_only', 'create_note'), false);
  assert.throws(() => actions.changeSimulationPriority(state, tenantA, 'SIM-CONVERSA-001', 'alta'), /permissão/);
  assert.throws(() => actions.finalizeSimulationConversation(state, tenantA, 'SIM-CONVERSA-001'), /permissão/);
});

test('bloqueio de permissão ocorre também na store', () => {
  const readOnly = actions.setSimulationProfile(freshState(), 'read_only');
  assert.throws(() => actions.assignSimulationProfessional(readOnly, tenantA, 'SIM-CONVERSA-001', 'SIM-PROF-A-002'), /permissão/);
  assert.throws(() => actions.switchSimulationTenant(readOnly, tenantB), /permissão/);
});

test('botão de simulação permanece claramente identificado', () => {
  const dashboard = fs.readFileSync(path.join(featureRoot, 'SimulationDashboard.tsx'), 'utf8') + fs.readFileSync(path.join(featureRoot, 'components', 'inbox', 'ConversationView.tsx'), 'utf8');
  assert.match(dashboard, /Registrar mensagem/);
  assert.match(dashboard, /simulad/i);
  assert.doesNotMatch(dashboard, />\s*Enviar\s*</i);
});

test('banner de simulação permanece visível no shell', () => {
  const header = fs.readFileSync(path.join(featureRoot, 'components', 'SimulationHeader.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(featureRoot, 'components', 'SimulationShell.tsx'), 'utf8');
  assert.match(shell, /Ambiente de demonstração — nenhuma mensagem será enviada/);
  assert.match(header, /Conexão do WhatsApp/);
});

test('R1 continua funcionando com provider fictício, falha, idempotência e status', () => {
  const provider = createSimulationProvider();
  const input = { provider: 'simulation', tenantId: tenantA, conversationId: 'SIM-CONVERSA-001', operationKey: 'SIM-OP-R1-001', body: 'Mensagem R1.' };
  const first = provider.registerMessage(input);
  assert.equal(first.status, 'simulated_queued');
  assert.equal(provider.registerMessage(input).duplicate, true);
  assert.equal(provider.registerMessage({ ...input, operationKey: 'SIM-OP-R1-FAIL', shouldFail: true }).status, 'simulated_failed');
  assert.equal(provider.advanceStatus(first.status), 'simulated_processed');
  assert.equal(provider.cancelStatus(first.status), 'simulated_cancelled');
});

test('reinicialização restaura todos os dados simulados em memória', () => {
  let state = actions.createInternalSimulationNote(freshState(), tenantA, 'SIM-CONVERSA-001', 'Alteração descartável.');
  state = actions.switchSimulationTenant(state, tenantB);
  state = actions.setSimulationProfile(state, 'read_only');
  const reset = resetSimulationState();
  assert.equal(reset.activeTenantId, tenantA);
  assert.equal(reset.profileId, 'platform_admin');
  assert.equal(reset.selectedConversationId, 'SIM-CONVERSA-001');
  assert.equal(reset.tenants[tenantA].conversations[0].notes.length, 0);
});

test('operação cruzada entre tenants falha na store', () => {
  assert.throws(() => actions.selectSimulationConversation(freshState(), tenantA, 'SIM-CONVERSA-003'), /tenant|Tenant/);
  assert.throws(() => actions.changeSimulationPriority(freshState(), tenantA, 'SIM-CONVERSA-003', 'alta'), /tenant|Tenant/);
});

test('pesquisa e filtros permanecem limitados ao tenant ativo', () => {
  let state = freshState();
  state = actions.setSimulationFilters(state, tenantA, { search: 'Contato Fictício 003' });
  assert.equal(selectVisibleConversations(state, tenantA).length, 0);
  const tenantBState = actions.switchSimulationTenant(state, tenantB);
  assert.equal(selectVisibleConversations(tenantBState, tenantB).length, 1);
});

test('cinco perfis simulados estão disponíveis', () => {
  assert.deepEqual(SIMULATION_PROFILES.map(profile => profile.id), ['platform_admin', 'clinic_admin', 'professional', 'attendant', 'read_only']);
});

test('nenhuma chamada de rede é usada no módulo', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
});

test('axios não é utilizado', () => {
  assert.doesNotMatch(source, /\baxios\b/i);
});

test('nenhum WebSocket externo é utilizado', () => {
  assert.doesNotMatch(source, /WebSocket/i);
});

test('nenhum XMLHttpRequest é utilizado', () => {
  assert.doesNotMatch(source, /XMLHttpRequest/i);
});

test('nenhuma variável de ambiente é lida', () => {
  assert.doesNotMatch(source, /process\.env|import\.meta\.env/i);
});

test('nenhum Firebase é importado', () => {
  assert.doesNotMatch(source, /firebase|firebase-admin/i);
});

test('nenhum módulo do robô é importado', () => {
  assert.doesNotMatch(source, /whatsapp-web\.js|server\.js|scheduler|watchdog|OperationalReport/i);
});

test('nenhuma persistência é utilizada', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/i);
});

test('nenhum telefone real existe nas fixtures', () => {
  const serialized = JSON.stringify(SIMULATION_FIXTURES);
  assert.doesNotMatch(serialized, /\b\d{8,15}\b/);
  assert.doesNotMatch(serialized, /\(\d{2}\)\s?\d{4,5}[- ]?\d{4}/);
});

test('nenhum campo clínico existe nas fixtures', () => {
  const forbiddenKeys = /patientId|patient|guardian|diagnosis|anamnesis|clinicalRecord|payment|session|agenda/i;
  assert.doesNotMatch(JSON.stringify(SIMULATION_FIXTURES), forbiddenKeys);
});

test('App.tsx preserva o contrato de integração WhatsApp', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  assert.match(app, /WhatsappSimulationDashboard/);
  assert.match(app, /activeTab === 'whatsapp'/);
  assert.doesNotMatch(app, /activeTab === 'whatsapp-simulacao'/);
});

test('integração App preserva o dashboard simulado sem depender do estado do índice', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  assert.match(app, /const WhatsappSimulationDashboard = lazy\(\(\) => import\('\.\/features\/whatsapp-simulation\/SimulationDashboard'\)\)/);
  assert.match(app, /const canAccessWhatsappSimulation/);
  assert.match(app, /accessProfile\.role === 'admin'/);
  assert.match(app, /accessProfile\.role === 'professional'/);
  assert.match(app, /activeTab === 'whatsapp' && canAccessWhatsappSimulation && <WhatsappSimulationDashboard embedded \/>/);
  assert.doesNotMatch(app, /activeTab === 'whatsapp-simulacao'/);
});
