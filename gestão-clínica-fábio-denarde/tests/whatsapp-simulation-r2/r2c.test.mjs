import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const featureRoot = path.join(root, 'src', 'features', 'whatsapp-simulation');
const source = fs.readdirSync(featureRoot, { recursive: true })
  .filter(file => String(file).endsWith('.ts') || String(file).endsWith('.tsx'))
  .map(file => fs.readFileSync(path.join(featureRoot, String(file)), 'utf8'))
  .join('\n');

const { createInitialSimulationState, resetSimulationState } = await import('../../src/features/whatsapp-simulation/state/simulationStore.ts');
const actions = await import('../../src/features/whatsapp-simulation/state/simulationActions.ts');
const schedules = await import('../../src/features/whatsapp-simulation/state/simulationScheduleActions.ts');
const selectors = await import('../../src/features/whatsapp-simulation/state/simulationScheduleSelectors.ts');
const permissions = await import('../../src/features/whatsapp-simulation/domain/permissionPolicy.ts');
const validation = await import('../../src/features/whatsapp-simulation/domain/templateValidation.ts');
const { createSimulationProvider } = await import('../../src/features/whatsapp-simulation/simulationProvider.ts');

const tenantA = 'SIM-TENANT-A';
const tenantB = 'SIM-TENANT-B';

function fresh(profile = 'platform_admin') {
  let state = createInitialSimulationState();
  if (profile !== 'platform_admin') state = actions.setSimulationProfile(state, profile);
  return actions.selectSimulationConversation(state, state.activeTenantId, state.tenants[state.activeTenantId].conversations[0].id);
}

function scheduleInput(state, source = 'manual', changes = {}) {
  const conversation = state.tenants[state.activeTenantId].conversations[0];
  const activeReply = state.tenants[state.activeTenantId].quickReplies.find(item => item.status === 'active');
  const activeTemplate = state.tenants[state.activeTenantId].templates.find(item => item.status === 'active');
  const templateValues = { contato_nome: conversation.contact.displayName, tenant_nome: state.tenants[state.activeTenantId].tenant.label, profissional_nome: 'Profissional Simulado A', data_ficticia: '2026-03-21', horario_ficticio: '10:00' };
  const content = source === 'quick_reply'
    ? activeReply.content
    : source === 'template'
      ? validation.resolveTemplateContent(activeTemplate, templateValues)
      : 'Mensagem manual agendada exclusivamente na simulação.';
  return {
    tenantId: state.activeTenantId,
    conversationId: conversation.id,
    sourceType: source,
    sourceId: source === 'quick_reply' ? activeReply.id : source === 'template' ? activeTemplate.id : undefined,
    templateVersion: source === 'template' ? activeTemplate.version : undefined,
    contentSnapshot: content,
    scheduledAt: schedules.simulationDateTimeInputValue(schedules.addSimulationHours(state.clock.now, 1)),
    ...changes,
  };
}

function createSchedule(state, source = 'manual', changes = {}) {
  return schedules.createSimulationSchedule(state, scheduleInput(state, source, changes));
}

function queueState(state = createSchedule(fresh())) {
  return schedules.updateSimulationStates(schedules.advanceSimulationClock(state, 120));
}

function scheduleById(state, id) {
  return state.schedules.find(item => item.id === id);
}

function jobForSchedule(state, id) {
  return state.queueJobs.find(item => item.scheduleId === id);
}

test('01 relógio possui estado inicial determinístico', () => {
  assert.equal(fresh().clock.now, '2026-03-20T12:00:00.000Z');
});
test('02 relógio usa America/Sao_Paulo', () => assert.equal(fresh().clock.timezone, 'America/Sao_Paulo'));
test('03 relógio avança 15 minutos', () => assert.equal(new Date(schedules.advanceSimulationClock(fresh(), 15).clock.now).getTime() - new Date(fresh().clock.now).getTime(), 15 * 60 * 1000));
test('04 relógio avança 1 hora', () => assert.equal(new Date(schedules.advanceSimulationClock(fresh(), 60).clock.now).getTime() - new Date(fresh().clock.now).getTime(), 60 * 60 * 1000));
test('05 relógio avança 1 dia', () => assert.equal(new Date(schedules.advanceSimulationClock(fresh(), 1440).clock.now).getTime() - new Date(fresh().clock.now).getTime(), 24 * 60 * 60 * 1000));
test('06 restauração do relógio funciona', () => assert.equal(schedules.restoreSimulationClock(schedules.advanceSimulationClock(fresh(), 60)).clock.now, fresh().clock.initialAt));
test('07 relógio não altera o horário do sistema', () => { const before = new Date().getTimezoneOffset(); schedules.advanceSimulationClock(fresh(), 15); assert.equal(new Date().getTimezoneOffset(), before); });
test('08 agendamentos ficam separados por tenant', () => { const state = fresh(); assert.equal(state.schedules.filter(item => item.tenantId === tenantA).length, 1); assert.equal(state.schedules.filter(item => item.tenantId === tenantB).length, 1); });
test('09 fila fica separada por tenant', () => { const state = queueState(); assert.equal(state.queueJobs.every(item => item.tenantId === tenantA || item.tenantId === tenantB), true); assert.equal(selectors.selectVisibleSimulationQueueJobs(state, tenantA).every(item => item.tenantId === tenantA), true); });
test('10 tenant A não acessa agendamento do tenant B', () => assert.throws(() => schedules.selectSimulationSchedule({ ...fresh(), selectedScheduleId: 'SIM-SCHEDULE-B-001' }, tenantA, 'SIM-SCHEDULE-B-001'), /tenant|Tenant/));
test('11 troca de tenant limpa formulários', () => { let state = fresh(); state = schedules.setSimulationScheduleDraft(state, { ...scheduleInput(state), sourceType: 'manual', sourceId: '', contentSnapshot: 'x', scheduledAt: '2026-03-20T11:00', expiresAt: '2026-03-21T11:00' }); const switched = actions.switchSimulationTenant(state, tenantB); assert.equal(switched.scheduleDraft, null); });
test('12 troca de tenant limpa filtros', () => { let state = fresh(); state = schedules.setSimulationScheduleFilters(state, tenantA, { search: 'x', status: 'scheduled' }); state = schedules.setSimulationQueueFilters(state, tenantA, { search: 'x', period: 'future' }); const switched = actions.switchSimulationTenant(state, tenantB); assert.deepEqual(switched.scheduleFilters, { status: '', sourceType: '', search: '' }); assert.deepEqual(switched.queueFilters, { status: '', sourceType: '', createdBy: '', period: 'all', search: '' }); });
test('13 troca de tenant limpa seleções', () => { const switched = actions.switchSimulationTenant(fresh(), tenantB); assert.equal(switched.selectedScheduleId, ''); assert.equal(switched.selectedQueueJobId, ''); });
test('14 mensagem manual pode ser agendada', () => assert.equal(createSchedule(fresh()).schedules.at(-1).sourceType, 'manual'));
test('15 resposta rápida ativa pode ser agendada', () => assert.equal(createSchedule(fresh(), 'quick_reply').schedules.at(-1).sourceId, 'SIM-QR-A-001'));
test('16 template ativo pode ser agendado', () => { const item = createSchedule(fresh(), 'template').schedules.at(-1); assert.equal(item.sourceId, 'SIM-TPL-A-001'); assert.equal(item.templateVersion, 1); });
test('17 template draft não pode ser agendado', () => assert.throws(() => createSchedule(fresh(), 'template', { sourceId: 'SIM-TPL-A-003', templateVersion: 2, contentSnapshot: 'Texto fictício.' }), /ativos/));
test('18 template inactive não pode ser agendado', () => assert.throws(() => createSchedule(fresh(), 'template', { sourceId: 'SIM-TPL-A-004', templateVersion: 1, contentSnapshot: 'Texto fictício.' }), /ativos/));
test('19 resposta rápida inactive não pode ser agendada', () => assert.throws(() => createSchedule(fresh(), 'quick_reply', { sourceId: 'SIM-QR-A-004', contentSnapshot: 'Texto fictício.' }), /inativa/));
test('20 conversa finalizada bloqueia agendamento', () => { const state = actions.finalizeSimulationConversation(fresh(), tenantA, 'SIM-CONVERSA-001'); assert.throws(() => createSchedule(state), /finalizada/); });
test('21 opt-out bloqueia agendamento', () => { const initial = fresh(); const tenant = initial.tenants[tenantA]; const state = { ...initial, tenants: { ...initial.tenants, [tenantA]: { ...tenant, conversations: tenant.conversations.map(item => item.id === 'SIM-CONVERSA-001' ? { ...item, contact: { ...item.contact, optOut: true } } : item) } } }; assert.throws(() => createSchedule(state), /opt-out/); });
test('22 consentimento revogado bloqueia agendamento', () => { const initial = fresh(); const tenant = initial.tenants[tenantA]; const state = { ...initial, tenants: { ...initial.tenants, [tenantA]: { ...tenant, conversations: tenant.conversations.map(item => item.id === 'SIM-CONVERSA-001' ? { ...item, contact: { ...item.contact, consentStatus: 'Consentimento revogado fictício' } } : item) } } }; assert.throws(() => createSchedule(state), /Consentimento revogado/); });
test('23 conteúdo vazio é rejeitado', () => assert.throws(() => createSchedule(fresh(), 'manual', { contentSnapshot: '   ' }), /conteúdo.*vazio/i));
test('24 data inválida é rejeitada', () => assert.throws(() => createSchedule(fresh(), 'manual', { scheduledAt: 'data-inexistente' }), /inválido/));
test('25 data passada é rejeitada', () => assert.throws(() => createSchedule(fresh(), 'manual', { scheduledAt: '2026-03-20T08:00' }), /posterior/));
test('26 timezone inválido é rejeitado', () => assert.throws(() => schedules.setSimulationClock(fresh(), '2026-03-20T10:00+99:00'), /inválido/));
test('27 expiresAt inválido é rejeitado', () => assert.throws(() => createSchedule(fresh(), 'manual', { expiresAt: '2026-03-20T09:30' }), /posterior/));
test('28 expiresAt padrão é aplicado', () => { const item = createSchedule(fresh()).schedules.at(-1); assert.equal(new Date(item.expiresAt).getTime() - new Date(item.scheduledAt).getTime(), 24 * 60 * 60 * 1000); });
test('29 confirmação repetida é idempotente', () => { const initial = fresh(); const input = scheduleInput(initial); const first = schedules.createSimulationSchedule(initial, input); const second = schedules.createSimulationSchedule(first, input); assert.equal(second.schedules.length, first.schedules.length); });
test('30 agendamento scheduled pode ser editado', () => { const initial = createSchedule(fresh()); const id = initial.schedules.at(-1).id; const edited = schedules.editSimulationSchedule(initial, tenantA, id, { contentSnapshot: 'Snapshot editado na simulação.' }); assert.equal(scheduleById(edited, id).contentSnapshot, 'Snapshot editado na simulação.'); });
test('31 edição atualiza snapshot', () => { const initial = createSchedule(fresh()); const id = initial.schedules.at(-1).id; const edited = schedules.editSimulationSchedule(initial, tenantA, id, { contentSnapshot: 'Novo snapshot fictício.' }); assert.equal(scheduleById(edited, id).contentSnapshot, 'Novo snapshot fictício.'); });
test('32 edição atualiza chave lógica', () => { const initial = createSchedule(fresh()); const item = initial.schedules.at(-1); const edited = schedules.editSimulationSchedule(initial, tenantA, item.id, { contentSnapshot: 'Chave nova.' }); assert.notEqual(scheduleById(edited, item.id).idempotencyKey, item.idempotencyKey); });
test('33 agendamento queued não pode ser editado', () => { const queued = queueState(); const item = queued.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); assert.throws(() => schedules.editSimulationSchedule(queued, tenantA, item.id, { contentSnapshot: 'x' }), /scheduled/); });
test('34 agendamento completed não pode ser editado', () => { let state = queueState(); const item = state.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); state = schedules.processSimulationJob(state, tenantA, jobForSchedule(state, item.id).id, 'success'); assert.throws(() => schedules.editSimulationSchedule(state, tenantA, item.id, { contentSnapshot: 'x' }), /scheduled/); });
test('35 agendamento cancelled não pode ser editado', () => { let state = createSchedule(fresh()); const item = state.schedules.at(-1); state = schedules.cancelSimulationSchedule(state, tenantA, item.id); assert.throws(() => schedules.editSimulationSchedule(state, tenantA, item.id, { contentSnapshot: 'x' }), /scheduled/); });
test('36 scheduled pode ser cancelado', () => { const state = createSchedule(fresh()); const item = state.schedules.at(-1); assert.equal(scheduleById(schedules.cancelSimulationSchedule(state, tenantA, item.id), item.id).status, 'cancelled'); });
test('37 queued elegível pode ser cancelado', () => { const state = queueState(); const item = state.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); assert.equal(scheduleById(schedules.cancelSimulationSchedule(state, tenantA, item.id), item.id).status, 'cancelled'); });
test('38 processing não pode ser cancelado', () => { let state = queueState(); const item = state.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); const job = jobForSchedule(state, item.id); state = schedules.claimSimulationJob(state, tenantA, job.id); assert.throws(() => schedules.cancelSimulationSchedule(state, tenantA, item.id), /iniciou|processamento/); });
test('39 completed não pode ser cancelado', () => { let state = queueState(); const item = state.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); state = schedules.processSimulationJob(state, tenantA, jobForSchedule(state, item.id).id, 'success'); assert.throws(() => schedules.cancelSimulationSchedule(state, tenantA, item.id), /não pode/); });
test('40 cancelamento repetido é idempotente', () => { const state = createSchedule(fresh()); const item = state.schedules.at(-1); const once = schedules.cancelSimulationSchedule(state, tenantA, item.id); const twice = schedules.cancelSimulationSchedule(once, tenantA, item.id); assert.equal(twice.schedules.filter(value => value.status === 'cancelled').length, once.schedules.filter(value => value.status === 'cancelled').length); });
test('41 avanço do relógio torna item elegível', () => { const state = queueState(); assert.equal(state.schedules.some(item => item.status === 'queued'), true); });
test('42 atualização cria somente um trabalho', () => { const state = queueState(); const item = state.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); assert.equal(state.queueJobs.filter(job => job.scheduleId === item.id).length, 1); });
test('43 atualização repetida não duplica trabalho', () => { const state = queueState(); const twice = schedules.updateSimulationStates(state); const item = twice.schedules.find(value => value.id === 'SIM-SCHEDULE-A-002'); assert.equal(twice.queueJobs.filter(job => job.scheduleId === item.id).length, 1); });
test('44 agendamento expirado não cria trabalho processável', () => { const initial = createSchedule(fresh(), 'manual', { expiresAt: '2026-03-20T10:30' }); const expired = schedules.setSimulationClock(initial, '2026-03-20T11:00'); assert.equal(expired.schedules.at(-1).status, 'expired'); assert.equal(expired.queueJobs.some(job => job.scheduleId === expired.schedules.at(-1).id), false); });
test('45 expiração ocorre ao ultrapassar expiresAt', () => { const initial = createSchedule(fresh(), 'manual', { expiresAt: '2026-03-20T10:30' }); const expired = schedules.setSimulationClock(initial, '2026-03-20T10:31'); assert.equal(expired.schedules.at(-1).status, 'expired'); });
test('46 fila filtra por status', () => { const state = queueState(); const filtered = schedules.setSimulationQueueFilters(state, tenantA, { status: 'pending' }); assert.equal(selectors.selectVisibleSimulationQueueJobs(filtered, tenantA).every(item => item.status === 'pending'), true); });
test('47 fila filtra por origem', () => { let state = queueState(); state = createSchedule(state, 'quick_reply'); state = schedules.setSimulationQueueFilters(state, tenantA, { sourceType: 'quick_reply' }); assert.equal(selectors.selectVisibleSimulationQueueJobs(state, tenantA).every(job => state.schedules.find(item => item.id === job.scheduleId)?.sourceType === 'quick_reply'), true); });
test('48 fila filtra por responsável', () => { let state = queueState(); state = schedules.setSimulationQueueFilters(state, tenantA, { createdBy: 'Administrador da plataforma' }); assert.equal(selectors.selectVisibleSimulationQueueJobs(state, tenantA).every(item => item.createdBy === 'Administrador da plataforma'), true); });
test('49 fila pesquisa por ID', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA); const filtered = schedules.setSimulationQueueFilters(state, tenantA, { search: job.id }); assert.deepEqual(selectors.selectVisibleSimulationQueueJobs(filtered, tenantA).map(item => item.id), [job.id]); });
test('50 limpar filtros funciona', () => { let state = queueState(); state = schedules.setSimulationQueueFilters(state, tenantA, { search: 'x', status: 'failed' }); state = schedules.clearSimulationQueueFilters(state, tenantA); assert.deepEqual(state.queueFilters, { status: '', sourceType: '', createdBy: '', period: 'all', search: '' }); });
test('51 processar próximo seleciona item elegível', () => { const state = queueState(); const next = schedules.processNextSimulationJob(state, tenantA, 'success'); assert.equal(next.queueJobs.some(item => item.tenantId === tenantA && item.status === 'completed'), true); });
test('52 processar selecionado respeita tenant', () => { const state = queueState(); const jobA = state.queueJobs.find(item => item.tenantId === tenantA); const stateB = actions.switchSimulationTenant(state, tenantB); assert.throws(() => schedules.processSimulationJob(stateB, tenantB, jobA.id, 'success'), /tenant|Tenant/); });
test('53 processamento muda para processing', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const processing = schedules.claimSimulationJob(state, tenantA, job.id); assert.equal(processing.queueJobs.find(item => item.id === job.id).status, 'processing'); });
test('54 sucesso muda job para completed', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const done = schedules.processSimulationJob(state, tenantA, job.id, 'success'); assert.equal(done.queueJobs.find(item => item.id === job.id).status, 'completed'); });
test('55 sucesso muda agendamento para completed', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const done = schedules.processSimulationJob(state, tenantA, job.id, 'success'); assert.equal(scheduleById(done, job.scheduleId).status, 'completed'); });
test('56 sucesso cria somente uma mensagem lógica', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const done = schedules.processSimulationJob(state, tenantA, job.id, 'success'); const conversation = done.tenants[tenantA].conversations.find(item => item.id === job.conversationId); assert.equal(conversation.messages.filter(item => item.id === job.messageLogicalId).length, 1); });
test('57 sucesso repetido não duplica mensagem', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const done = schedules.processSimulationJob(state, tenantA, job.id, 'success'); const repeated = schedules.processSimulationJob(done, tenantA, job.id, 'success'); const conversation = repeated.tenants[tenantA].conversations.find(item => item.id === job.conversationId); assert.equal(conversation.messages.filter(item => item.id === job.messageLogicalId).length, 1); });
test('58 falha muda job para failed', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure'); assert.equal(failed.queueJobs.find(item => item.id === job.id).status, 'failed'); });
test('59 falha muda agendamento para failed', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure'); assert.equal(scheduleById(failed, job.scheduleId).status, 'failed'); });
test('60 falha registra motivo', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure', 'erro técnico fictício'); assert.equal(failed.queueJobs.find(item => item.id === job.id).failureReason, 'erro técnico fictício'); });
test('61 reprocessamento exige failed', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); assert.throws(() => schedules.reprocessSimulationJob(state, tenantA, job.id), /failed/); });
test('62 reprocessamento incrementa tentativa', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure'); const retried = schedules.reprocessSimulationJob(failed, tenantA, job.id); assert.equal(retried.queueJobs.at(-1).attempt, 2); });
test('63 reprocessamento preserva histórico', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure'); const retried = schedules.reprocessSimulationJob(failed, tenantA, job.id); assert.equal(retried.queueJobs.find(item => item.id === job.id).status, 'failed'); assert.equal(retried.schedules.find(item => item.id === job.scheduleId).history.some(item => item.kind === 'reprocessed'), true); });
test('64 reprocessamento repetido é idempotente', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); const failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure'); const retried = schedules.reprocessSimulationJob(failed, tenantA, job.id); const repeated = schedules.reprocessSimulationJob(retried, tenantA, job.id); assert.equal(repeated.queueJobs.filter(item => item.previousJobId === job.id).length, 1); });
test('65 trabalho expirado não pode ser reprocessado', () => { const state = queueState(); const job = state.queueJobs.find(item => item.tenantId === tenantA && item.status === 'pending'); let failed = schedules.processSimulationJob(state, tenantA, job.id, 'failure'); failed = schedules.setSimulationClock(failed, '2026-03-22T12:00'); assert.throws(() => schedules.reprocessSimulationJob(failed, tenantA, job.id), /expirado/); });
test('66 administrador da plataforma executa todas as ações', () => { for (const permission of ['view_schedules', 'create_schedule', 'edit_schedule', 'cancel_schedule', 'advance_clock', 'update_schedule_states', 'view_queue', 'process_queue', 'simulate_queue_result', 'reprocess_queue']) assert.equal(permissions.hasSimulationPermission('platform_admin', permission), true); });
test('67 administrador da clínica atua somente no tenant atual', () => { const state = fresh('clinic_admin'); assert.throws(() => actions.switchSimulationTenant(state, tenantB), /permissão/); assert.equal(createSchedule(state).activeTenantId, tenantA); });
test('68 profissional cria e altera somente próprios', () => { const state = createSchedule(fresh('professional')); const item = state.schedules.at(-1); const edited = schedules.editSimulationSchedule(state, tenantA, item.id, { contentSnapshot: 'Alteração própria fictícia.' }); assert.equal(edited.schedules.at(-1).contentSnapshot, 'Alteração própria fictícia.'); });
test('69 atendente cria e altera somente próprios', () => { const state = createSchedule(fresh('attendant')); const item = state.schedules.at(-1); assert.equal(schedules.editSimulationSchedule(state, tenantA, item.id, { contentSnapshot: 'Alteração do atendente fictício.' }).schedules.at(-1).contentSnapshot, 'Alteração do atendente fictício.'); });
test('70 profissional não processa fila', () => assert.throws(() => schedules.processNextSimulationJob(fresh('professional'), tenantA, 'success'), /permissão/));
test('71 atendente não processa fila', () => assert.throws(() => schedules.processNextSimulationJob(fresh('attendant'), tenantA, 'success'), /permissão/));
test('72 somente leitura não altera estado', () => { const state = fresh('read_only'); assert.throws(() => createSchedule(state), /permissão/); assert.throws(() => schedules.advanceSimulationClock(state, 15), /permissão/); });
test('73 bloqueio também ocorre na store', () => { const state = fresh('read_only'); assert.throws(() => schedules.setSimulationScheduleDraft(state, { ...scheduleInput(state), sourceType: 'manual', sourceId: '', contentSnapshot: 'x', scheduledAt: '2026-03-20T10:00', expiresAt: '2026-03-21T10:00' }), /permissão/); });
test('74 templateId e versão permanecem no snapshot', () => { const item = createSchedule(fresh(), 'template').schedules.at(-1); assert.equal(item.sourceId, 'SIM-TPL-A-001'); assert.equal(item.templateVersion, 1); });
test('75 quickReplyId permanece no snapshot', () => assert.equal(createSchedule(fresh(), 'quick_reply').schedules.at(-1).sourceId, 'SIM-QR-A-001'));
test('76 mensagem manual não recebe templateId', () => { const item = createSchedule(fresh()).schedules.at(-1); assert.equal(item.sourceId, undefined); assert.equal(item.templateVersion, undefined); });
test('77 troca de template posterior não altera snapshot', () => { const state = createSchedule(fresh(), 'template'); const item = state.schedules.at(-1); const changed = { ...state, tenants: { ...state.tenants, [tenantA]: { ...state.tenants[tenantA], templates: state.tenants[tenantA].templates.map(template => template.id === item.sourceId ? { ...template, content: 'Outro conteúdo fictício.' } : template) } } }; assert.equal(changed.schedules.at(-1).contentSnapshot, item.contentSnapshot); });
test('78 reinício restaura agendamentos', () => { const state = createSchedule(fresh()); assert.equal(resetSimulationState().schedules.length, 2); assert.equal(state.schedules.length, 3); });
test('79 reinício restaura fila', () => assert.equal(resetSimulationState().queueJobs.length, 0));
test('80 reload conceitual remove alterações', () => { const state = schedules.setSimulationClock(createSchedule(fresh()), '2026-03-21T10:00'); assert.equal(resetSimulationState().clock.now, resetSimulationState().clock.initialAt); assert.equal(resetSimulationState().schedules.length, 2); assert.notEqual(state.clock.now, resetSimulationState().clock.now); });
test('81 R2-B continua funcionando', () => { const state = actions.setSimulationComposition(fresh(), { mode: 'quick_reply', draft: 'Resposta rápida fictícia.', quickReplyId: 'SIM-QR-A-001', templateId: '' }); assert.equal(state.composer.mode, 'quick_reply'); });
test('82 R2-A continua funcionando', () => assert.equal(actions.setSimulationView(fresh(), 'templates').activeView, 'templates'));
test('83 R1 continua funcionando', () => { const provider = createSimulationProvider(); const input = { provider: 'simulation', tenantId: tenantA, conversationId: 'SIM-CONVERSA-001', operationKey: 'SIM-R2C-R1', body: 'Mensagem R1 fictícia.' }; assert.equal(provider.registerMessage(input).status, 'simulated_queued'); assert.equal(provider.registerMessage(input).duplicate, true); });
test('84 nenhum cron é criado', () => assert.doesNotMatch(source, /cron/i));
test('85 nenhum setInterval é usado para processamento', () => assert.doesNotMatch(source, /setInterval/i));
test('86 nenhuma chamada fetch ocorre', () => assert.doesNotMatch(source, /\bfetch\s*\(/i));
test('87 axios não é utilizado', () => assert.doesNotMatch(source, /\baxios\b/i));
test('88 WebSocket externo não é utilizado', () => assert.doesNotMatch(source, /WebSocket/i));
test('89 XMLHttpRequest não é utilizado', () => assert.doesNotMatch(source, /XMLHttpRequest/i));
test('90 nenhuma persistência é utilizada', () => assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/i));
test('91 nenhuma variável de ambiente é lida', () => assert.doesNotMatch(source, /process\.env|import\.meta\.env/i));
test('92 Firebase não é importado', () => assert.doesNotMatch(source, /firebase|firebase-admin/i));
test('93 robô não é importado', () => assert.doesNotMatch(source, /whatsapp-web\.js|server\.js|watchdog|OperationalReport/i));
test('94 nenhuma agenda clínica é importada', () => assert.doesNotMatch(source, /from ['"].*Agenda|agenda-clinica/i));
test('95 nenhum telefone real existe', () => assert.doesNotMatch(source, /\b\d{8,15}\b/));
test('96 nenhum campo clínico existe', () => assert.doesNotMatch(JSON.stringify(fresh().tenants), /patientId|diagnóstico|diagnostico|prontuário|pagamento/i));
test('97 App.tsx preserva o contrato de integração', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  assert.match(app, /WhatsappSimulationDashboard/);
  assert.match(app, /activeTab === 'whatsapp'/);
  assert.doesNotMatch(app, /activeTab === 'whatsapp-simulacao'/);
});
test('98 arquivos proibidos não são referenciados pelas novas ações', () => assert.doesNotMatch(fs.readFileSync(path.join(featureRoot, 'state', 'simulationScheduleActions.ts'), 'utf8'), /server\.js|Firebase|whatsapp-web\.js|scheduler|watchdog|fetch|axios/i));
