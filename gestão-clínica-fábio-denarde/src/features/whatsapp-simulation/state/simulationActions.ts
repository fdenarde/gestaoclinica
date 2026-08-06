import { transitionConversation, responseStateForConversation, inboundStateForConversation, createSyntheticHistoryEntry } from '../domain/conversationStateMachine';
import { assertSimulationPermission, getSimulationProfile } from '../domain/permissionPolicy';
import { assertActiveTenant, assertConversationInTenant, assertNonEmptySyntheticText, getTenantData } from '../domain/simulationValidation';
import { assertTemplateContentIsAllowed, assertValidTemplateDraft } from '../domain/templateValidation';
import { cloneConversation } from '../simulationFixtures';
import type { SimulationProvider } from '../simulationProvider';
import { EMPTY_QUEUE_FILTERS, EMPTY_SCHEDULE_FILTERS, EMPTY_SIMULATION_COMPOSER, EMPTY_SIMULATION_FILTERS, EMPTY_TEMPLATE_FILTERS } from './simulationStore';
import type {
  SimulationComposerState,
  SimulationConversation,
  SimulationFilters,
  SimulationMessage,
  SimulationMessageMetadata,
  SimulationNote,
  SimulationProfileId,
  SimulationState,
  SimulationTemplate,
  SimulationTemplateDraft,
  SimulationTemplateFilters,
  SimulationTenantId,
  SimulationPreview,
  SimulationView,
} from '../simulationTypes';

function syntheticTime(conversation: SimulationConversation): string {
  return `12:${String((conversation.lastActivityOrder * 7) % 60).padStart(2, '0')}`;
}

function operationKeyFor(conversationId: string, body: string, metadata: SimulationMessageMetadata): string {
  const normalized = body.trim().toLocaleUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 40);
  const source = [metadata.source, metadata.quickReplyId || '', metadata.templateId || '', metadata.templateVersion || ''].join('-');
  return `SIM-OP-${conversationId}-${source}-${normalized || 'VAZIA'}`;
}

function updateOneConversation(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
  updater: (conversation: SimulationConversation) => SimulationConversation,
): SimulationState {
  assertConversationInTenant(state, tenantId, conversationId);
  const tenant = getTenantData(state, tenantId);
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [tenantId]: {
        ...tenant,
        conversations: tenant.conversations.map(conversation =>
          conversation.id === conversationId ? updater(cloneConversation(conversation)) : conversation,
        ),
      },
    },
  };
}

function actorName(state: SimulationState): string {
  return `Usuário simulado — ${getSimulationProfile(state.profileId).label}`;
}

function withNotice(state: SimulationState, notice: string): SimulationState {
  return { ...state, notice };
}

function assertQuickReplyForUse(state: SimulationState, tenantId: SimulationTenantId, quickReplyId: string) {
  assertSimulationPermission(state.profileId, 'use_template');
  assertActiveTenant(state, tenantId);
  const quickReply = getTenantData(state, tenantId).quickReplies.find(item => item.id === quickReplyId);
  if (!quickReply || quickReply.tenantId !== tenantId) throw new Error('Resposta rápida não pertence ao tenant sintético.');
  if (quickReply.status !== 'active') throw new Error('Resposta rápida inativa não pode ser utilizada.');
  return quickReply;
}

function assertTemplateForUse(state: SimulationState, tenantId: SimulationTenantId, templateId: string) {
  assertSimulationPermission(state.profileId, 'use_template');
  assertActiveTenant(state, tenantId);
  const template = getTenantData(state, tenantId).templates.find(item => item.id === templateId);
  if (!template || template.tenantId !== tenantId) throw new Error('Template não pertence ao tenant sintético.');
  if (template.status !== 'active') throw new Error('Somente templates ativos podem ser utilizados.');
  assertTemplateContentIsAllowed(template);
  return template;
}

function assertCompositionSource(
  state: SimulationState,
  tenantId: SimulationTenantId,
  metadata: SimulationMessageMetadata,
): SimulationTemplate | null {
  if (metadata.source === 'manual') {
    if (metadata.quickReplyId || metadata.templateId || metadata.templateVersion) {
      throw new Error('Mensagem manual não pode possuir metadados de template.');
    }
    return null;
  }
  if (metadata.source === 'quick_reply') {
    if (!metadata.quickReplyId || metadata.templateId || metadata.templateVersion) throw new Error('Metadados de resposta rápida inválidos.');
    assertQuickReplyForUse(state, tenantId, metadata.quickReplyId);
    return null;
  }
  if (!metadata.templateId || metadata.quickReplyId) throw new Error('Metadados de template inválidos.');
  const template = assertTemplateForUse(state, tenantId, metadata.templateId);
  if (metadata.templateVersion !== template.version) throw new Error('A versão do template não corresponde ao template ativo.');
  return template;
}

function updateTemplateUsage(state: SimulationState, tenantId: SimulationTenantId, templateId?: string): SimulationState {
  if (!templateId) return state;
  const tenant = getTenantData(state, tenantId);
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [tenantId]: {
        ...tenant,
        templates: tenant.templates.map(template => template.id === templateId ? { ...template, usedInSimulation: true } : template),
      },
    },
  };
}

export function setSimulationProfile(
  state: SimulationState,
  profileId: SimulationProfileId,
): SimulationState {
  getSimulationProfile(profileId);
  return {
    ...state,
    profileId,
    notice: `Perfil simulado ativo: ${getSimulationProfile(profileId).label}.`,
  };
}

export function switchSimulationTenant(
  state: SimulationState,
  tenantId: SimulationTenantId,
): SimulationState {
  assertSimulationPermission(state.profileId, 'switch_tenant');
  const tenant = getTenantData(state, tenantId);
  return {
    ...state,
    activeTenantId: tenantId,
    selectedConversationId: '',
    filters: { ...EMPTY_SIMULATION_FILTERS },
    templateFilters: { ...EMPTY_TEMPLATE_FILTERS },
    selectedTemplateId: '',
    templateDraft: null,
    templateEditingId: '',
    composer: { ...EMPTY_SIMULATION_COMPOSER },
    preview: null,
    selectedScheduleId: '',
    selectedQueueJobId: '',
    scheduleFilters: { ...EMPTY_SCHEDULE_FILTERS },
    queueFilters: { ...EMPTY_QUEUE_FILTERS },
    scheduleDraft: null,
    scheduleEditingId: '',
    schedulePreview: null,
    notice: `Tenant ativo: ${tenant.tenant.label}. Seleção e filtros foram limpos.`,
  };
}

export function selectSimulationConversation(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'view');
  assertConversationInTenant(state, tenantId, conversationId);
  return { ...state, selectedConversationId: conversationId, composer: { ...EMPTY_SIMULATION_COMPOSER }, preview: null, notice: '' };
}

export function setSimulationFilters(
  state: SimulationState,
  tenantId: SimulationTenantId,
  filters: Partial<SimulationFilters>,
): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, filters: { ...state.filters, ...filters } };
}

export function clearSimulationFilters(
  state: SimulationState,
  tenantId: SimulationTenantId,
): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, filters: { ...EMPTY_SIMULATION_FILTERS } };
}

export function registerSimulatedMessage(
  state: SimulationState,
  provider: SimulationProvider,
  tenantId: SimulationTenantId,
  body: string,
  shouldFail = false,
  metadata: SimulationMessageMetadata = { source: 'manual' },
): SimulationState {
  assertSimulationPermission(state.profileId, 'register_message');
  assertActiveTenant(state, tenantId);
  const conversation = assertConversationInTenant(state, tenantId, state.selectedConversationId);
  if (conversation.state === 'finalizada') throw new Error('Conversa finalizada não aceita composição.');
  const normalizedBody = assertNonEmptySyntheticText(body, 'A mensagem simulada');
  const template = assertCompositionSource(state, tenantId, metadata);
  if (metadata.source === 'template' && /{{\s*[a-zA-Z0-9_]+\s*}}/.test(normalizedBody)) {
    throw new Error('Todas as variáveis do template precisam ser resolvidas antes da pré-visualização.');
  }
  const operationKey = operationKeyFor(conversation.id, normalizedBody, metadata);
  const result = provider.registerMessage({
    provider: 'simulation',
    tenantId,
    conversationId: conversation.id,
    operationKey,
    body: normalizedBody,
    shouldFail,
  });
  if (result.duplicate) {
    return withNotice(state, 'Operação repetida: a mesma mensagem simulada foi preservada.');
  }
  const message: SimulationMessage = {
    id: result.messageId,
    tenantId,
    conversationId: conversation.id,
    operationKey: result.operationKey,
    direction: 'outbound',
    body: normalizedBody,
    status: result.status,
    time: result.time,
    source: metadata.source,
    quickReplyId: metadata.quickReplyId,
    templateId: metadata.templateId,
    templateVersion: metadata.templateVersion,
  };
  const time = result.time;
  const nextState = updateOneConversation(
    withNotice(state, shouldFail ? 'Falha simulada registrada na memória local.' : 'Mensagem simulada registrada na memória local.'),
    tenantId,
    conversation.id,
    current => {
      const next = {
        ...current,
        preview: message.body,
        messages: [...current.messages, message],
        history: [...current.history, createSyntheticHistoryEntry(current, tenantId, 'message_registered', `${metadata.source === 'template' ? `Template ${template?.name} v${template.version}` : metadata.source === 'quick_reply' ? 'Resposta rápida simulada' : 'Mensagem manual simulada'} registrada`, actorName(state), time)],
      };
      if (shouldFail) return next;
      let responseConversation = next;
      if (responseConversation.state !== 'aberta' && responseConversation.state !== 'aguardando_contato') {
        responseConversation = transitionConversation(responseConversation, tenantId, 'aberta', actorName(state), time);
      }
      if (responseConversation.state === 'aguardando_contato') return responseConversation;
      return transitionConversation(responseConversation, tenantId, responseStateForConversation(responseConversation), actorName(state), time);
    },
  );
  return updateTemplateUsage(nextState, tenantId, metadata.templateId);
}

export function createSimulationPreview(
  state: SimulationState,
  tenantId: SimulationTenantId,
  body: string,
  metadata: SimulationMessageMetadata,
): SimulationPreview {
  assertSimulationPermission(state.profileId, 'register_message');
  assertActiveTenant(state, tenantId);
  const conversation = assertConversationInTenant(state, tenantId, state.selectedConversationId);
  if (conversation.state === 'finalizada') throw new Error('Conversa finalizada não aceita composição.');
  const normalizedBody = assertNonEmptySyntheticText(body, 'A mensagem simulada');
  const template = assertCompositionSource(state, tenantId, metadata);
  if (metadata.source === 'template' && /{{\s*[a-zA-Z0-9_]+\s*}}/.test(normalizedBody)) {
    throw new Error('Todas as variáveis do template precisam ser resolvidas antes da pré-visualização.');
  }
  const tenant = getTenantData(state, tenantId);
  const professional = tenant.professionals.find(item => item.id === conversation.assignedProfessionalId);
  return {
    id: `SIM-PREVIEW-${tenantId}-${conversation.id}-${Date.now()}`,
    tenantId,
    conversationId: conversation.id,
    contactName: conversation.contact.displayName,
    professionalName: professional?.displayName || 'Profissional Simulado não atribuído',
    tenantName: tenant.tenant.label,
    source: metadata.source,
    sourceLabel: metadata.source === 'template' ? `Template ${template?.name || ''}` : metadata.source === 'quick_reply' ? 'Resposta rápida fictícia' : 'Mensagem manual',
    templateId: metadata.templateId,
    templateName: template?.name,
    templateVersion: metadata.templateVersion,
    quickReplyId: metadata.quickReplyId,
    content: normalizedBody,
  };
}

export function setSimulationPreview(state: SimulationState, preview: SimulationPreview): SimulationState {
  assertActiveTenant(state, preview.tenantId);
  if (preview.conversationId !== state.selectedConversationId) throw new Error('A pré-visualização não pertence à conversa selecionada.');
  return { ...state, preview };
}

export function clearSimulationPreview(state: SimulationState): SimulationState {
  return { ...state, preview: null };
}

export function registerPreviewedSimulatedMessage(
  state: SimulationState,
  provider: SimulationProvider,
  tenantId: SimulationTenantId,
  shouldFail = false,
): SimulationState {
  if (!state.preview) throw new Error('Não há pré-visualização pendente.');
  if (state.preview.tenantId !== tenantId || state.preview.conversationId !== state.selectedConversationId) {
    throw new Error('A pré-visualização ficou obsoleta após a troca de contexto.');
  }
  const metadata: SimulationMessageMetadata = {
    source: state.preview.source,
    quickReplyId: state.preview.quickReplyId,
    templateId: state.preview.templateId,
    templateVersion: state.preview.templateVersion,
  };
  const registered = registerSimulatedMessage(state, provider, tenantId, state.preview.content, shouldFail, metadata);
  return { ...registered, preview: null, composer: { ...EMPTY_SIMULATION_COMPOSER } };
}

export function advanceSelectedSimulationStatus(
  state: SimulationState,
  provider: SimulationProvider,
  tenantId: SimulationTenantId,
): SimulationState {
  assertActiveTenant(state, tenantId);
  const conversation = assertConversationInTenant(state, tenantId, state.selectedConversationId);
  const index = [...conversation.messages].map(message => message.direction).lastIndexOf('outbound');
  if (index < 0) return withNotice(state, 'Não há mensagem de saída para atualizar.');
  return updateOneConversation(state, tenantId, conversation.id, current => ({
    ...current,
    messages: current.messages.map((message, messageIndex) =>
      messageIndex === index ? { ...message, status: provider.advanceStatus(message.status) } : message,
    ),
  }));
}

export function cancelSelectedSimulationMessage(
  state: SimulationState,
  provider: SimulationProvider,
  tenantId: SimulationTenantId,
): SimulationState {
  assertActiveTenant(state, tenantId);
  const conversation = assertConversationInTenant(state, tenantId, state.selectedConversationId);
  const index = [...conversation.messages].map(message => message.direction).lastIndexOf('outbound');
  if (index < 0) return withNotice(state, 'Não há mensagem de saída para cancelar.');
  return updateOneConversation(withNotice(state, 'Cancelamento simulado registrado na memória local.'), tenantId, conversation.id, current => ({
    ...current,
    messages: current.messages.map((message, messageIndex) =>
      messageIndex === index ? { ...message, status: provider.cancelStatus(message.status) } : message,
    ),
  }));
}

export function assignSimulationProfessional(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
  professionalId: string | null,
): SimulationState {
  assertSimulationPermission(state.profileId, 'assign_professional');
  assertActiveTenant(state, tenantId);
  const tenant = getTenantData(state, tenantId);
  if (professionalId && !tenant.professionals.some(professional => professional.id === professionalId)) {
    throw new Error('Profissional não pertence ao tenant sintético.');
  }
  return updateOneConversation(withNotice(state, 'Profissional atribuído na simulação.'), tenantId, conversationId, conversation => ({
    ...conversation,
    assignedProfessionalId: professionalId,
    history: [...conversation.history, createSyntheticHistoryEntry(conversation, tenantId, 'assignment_changed', 'Profissional atribuído', actorName(state), syntheticTime(conversation))],
  }));
}

export function changeSimulationPriority(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
  priority: 'normal' | 'alta',
): SimulationState {
  assertSimulationPermission(state.profileId, 'change_priority');
  return updateOneConversation(withNotice(state, `Prioridade alterada para ${priority}.`), tenantId, conversationId, conversation => ({
    ...conversation,
    priority,
    history: [...conversation.history, createSyntheticHistoryEntry(conversation, tenantId, 'priority_changed', `Prioridade ${priority}`, actorName(state), syntheticTime(conversation))],
  }));
}

export function toggleSimulationTag(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
  tagId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_tags');
  assertActiveTenant(state, tenantId);
  const tenant = getTenantData(state, tenantId);
  if (!tenant.tags.some(tag => tag.id === tagId)) throw new Error('Etiqueta não pertence ao tenant sintético.');
  return updateOneConversation(withNotice(state, 'Etiquetas atualizadas na simulação.'), tenantId, conversationId, conversation => {
    const exists = conversation.tagIds.includes(tagId);
    return {
      ...conversation,
      tagIds: exists ? conversation.tagIds.filter(item => item !== tagId) : [...conversation.tagIds, tagId],
      history: [...conversation.history, createSyntheticHistoryEntry(conversation, tenantId, 'tag_changed', exists ? 'Etiqueta removida' : 'Etiqueta adicionada', actorName(state), syntheticTime(conversation))],
    };
  });
}

export function finalizeSimulationConversation(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'finalize_conversation');
  return updateOneConversation(withNotice(state, 'Conversa finalizada na simulação.'), tenantId, conversationId, conversation => {
    const time = syntheticTime(conversation);
    let ready = conversation;
    if (ready.state !== 'aberta') ready = transitionConversation(ready, tenantId, 'aberta', actorName(state), time);
    return transitionConversation(ready, tenantId, 'finalizada', actorName(state), time);
  });
}

export function reopenSimulationConversation(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'reopen_conversation');
  return updateOneConversation(withNotice(state, 'Conversa reaberta na simulação.'), tenantId, conversationId, conversation =>
    transitionConversation(conversation, tenantId, 'reaberta', actorName(state), syntheticTime(conversation)),
  );
}

export function createInternalSimulationNote(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
  content: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'create_note');
  const normalizedContent = assertNonEmptySyntheticText(content, 'A nota interna');
  return updateOneConversation(withNotice(state, 'Nota interna criada somente na simulação.'), tenantId, conversationId, conversation => {
    const time = syntheticTime(conversation);
    const note: SimulationNote = {
      id: `SIM-NOTA-${tenantId}-${conversationId}-${conversation.notes.length + 1}`,
      tenantId,
      conversationId,
      author: actorName(state),
      content: normalizedContent,
      time,
    };
    return {
      ...conversation,
      notes: [...conversation.notes, note],
      history: [...conversation.history, createSyntheticHistoryEntry(conversation, tenantId, 'note_added', 'Nota interna criada', actorName(state), time)],
    };
  });
}

export function registerSyntheticInboundMessage(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
  body: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'register_message');
  const normalizedBody = assertNonEmptySyntheticText(body, 'A entrada sintética');
  return updateOneConversation(withNotice(state, 'Entrada sintética registrada aguardando equipe.'), tenantId, conversationId, conversation => {
    if (conversation.state === 'finalizada') throw new Error('Conversa finalizada não aceita nova entrada sintética.');
    const time = syntheticTime(conversation);
    const message: SimulationMessage = {
      id: `SIM-MSG-ENTRADA-${conversation.messages.length + 1}`,
      tenantId,
      conversationId,
      operationKey: `SIM-OP-ENTRADA-${conversation.id}-${conversation.messages.length + 1}`,
      direction: 'inbound',
      body: normalizedBody,
      status: 'simulated_read',
      time,
    };
    return {
      ...conversation,
      state: inboundStateForConversation(),
      preview: normalizedBody,
      unreadCount: conversation.unreadCount + 1,
      messages: [...conversation.messages, message],
      history: [...conversation.history, createSyntheticHistoryEntry(conversation, tenantId, 'message_registered', 'Entrada fictícia registrada', actorName(state), time)],
      lastActivity: time,
      lastActivityOrder: conversation.lastActivityOrder + 1,
    };
  });
}

export function setSimulationView(state: SimulationState, view: SimulationView): SimulationState {
  if (view === 'templates') assertSimulationPermission(state.profileId, 'view_templates');
  if (view === 'schedules') assertSimulationPermission(state.profileId, 'view_schedules');
  if (view === 'queue') assertSimulationPermission(state.profileId, 'view_queue');
  return { ...state, activeView: view };
}

export function setSimulationComposition(
  state: SimulationState,
  composition: SimulationComposerState,
): SimulationState {
  assertActiveTenant(state, state.activeTenantId);
  if (composition.mode === 'quick_reply' && composition.quickReplyId) {
    assertQuickReplyForUse(state, state.activeTenantId, composition.quickReplyId);
  }
  if (composition.mode === 'template' && composition.templateId) {
    assertTemplateForUse(state, state.activeTenantId, composition.templateId);
  }
  return { ...state, composer: { ...composition }, preview: null };
}

export function setTemplateFilters(
  state: SimulationState,
  tenantId: SimulationTenantId,
  filters: Partial<SimulationTemplateFilters>,
): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, templateFilters: { ...state.templateFilters, ...filters }, selectedTemplateId: '' };
}

export function clearTemplateFilters(state: SimulationState, tenantId: SimulationTenantId): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, templateFilters: { ...EMPTY_TEMPLATE_FILTERS }, selectedTemplateId: '' };
}

export function selectSimulationTemplate(
  state: SimulationState,
  tenantId: SimulationTenantId,
  templateId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'view_templates');
  assertActiveTenant(state, tenantId);
  const template = getTenantData(state, tenantId).templates.find(item => item.id === templateId);
  if (!template) throw new Error('Template não pertence ao tenant sintético ativo.');
  return { ...state, selectedTemplateId: template.id, notice: '' };
}

export function setSimulationTemplateDraft(
  state: SimulationState,
  draft: SimulationTemplateDraft | null,
  editingTemplateId = '',
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_templates');
  return { ...state, templateDraft: draft ? { ...draft, allowedVariables: [...draft.allowedVariables] } : null, templateEditingId: draft ? editingTemplateId : '' };
}

function templateTime(sequence: number): string {
  return `2026-03-${String((sequence % 20) + 1).padStart(2, '0')} 12:00`;
}

function replaceTenantTemplates(
  state: SimulationState,
  tenantId: SimulationTenantId,
  templates: SimulationTemplate[],
  notice: string,
): SimulationState {
  const tenant = getTenantData(state, tenantId);
  return {
    ...state,
    tenants: { ...state.tenants, [tenantId]: { ...tenant, templates } },
    templateDraft: null,
    templateEditingId: '',
    notice,
  };
}

export function createSimulationTemplate(
  state: SimulationState,
  tenantId: SimulationTenantId,
  draft: SimulationTemplateDraft,
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_templates');
  assertActiveTenant(state, tenantId);
  assertValidTemplateDraft(draft);
  const tenant = getTenantData(state, tenantId);
  const sequence = tenant.templates.length + 1;
  const now = templateTime(sequence);
  const template: SimulationTemplate = {
    id: `SIM-TPL-${tenantId}-USER-${sequence}`,
    tenantId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category,
    version: 1,
    content: draft.content.trim(),
    allowedVariables: [...draft.allowedVariables],
    status: 'draft',
    createdBy: actorName(state),
    createdAt: now,
    updatedAt: now,
    usedInSimulation: false,
  };
  return replaceTenantTemplates(state, tenantId, [...tenant.templates, template], 'Mensagem pronta criada como rascunho.');
}

export function updateSimulationTemplate(
  state: SimulationState,
  tenantId: SimulationTenantId,
  templateId: string,
  draft: SimulationTemplateDraft,
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_templates');
  assertActiveTenant(state, tenantId);
  assertValidTemplateDraft(draft);
  const tenant = getTenantData(state, tenantId);
  const current = tenant.templates.find(item => item.id === templateId);
  if (!current) throw new Error('Template não pertence ao tenant sintético ativo.');
  if (current.status !== 'draft') throw new Error('Somente templates draft podem ser editados diretamente.');
  const updated = { ...current, name: draft.name.trim(), description: draft.description.trim(), category: draft.category, content: draft.content.trim(), allowedVariables: [...draft.allowedVariables], updatedAt: templateTime(tenant.templates.length + 2) };
  return replaceTenantTemplates(state, tenantId, tenant.templates.map(item => item.id === templateId ? updated : item), 'Mensagem pronta atualizada.');
}

export function duplicateSimulationTemplate(
  state: SimulationState,
  tenantId: SimulationTenantId,
  templateId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_templates');
  assertActiveTenant(state, tenantId);
  const tenant = getTenantData(state, tenantId);
  const source = tenant.templates.find(item => item.id === templateId);
  if (!source) throw new Error('Template não pertence ao tenant sintético ativo.');
  const existing = tenant.templates.find(item => item.sourceTemplateId === source.id && item.status === 'draft' && item.version === source.version + 1);
  if (existing) return { ...state, selectedTemplateId: existing.id, notice: 'A mesma mensagem pronta já está preparada para edição.' };
  const sequence = tenant.templates.length + 1;
  const now = templateTime(sequence);
  const copy: SimulationTemplate = {
    ...source,
    id: `SIM-TPL-${tenantId}-COPY-${sequence}`,
    name: `${source.name} — cópia`,
    version: source.version + 1,
    status: 'draft',
    createdBy: actorName(state),
    createdAt: now,
    updatedAt: now,
    sourceTemplateId: source.id,
    allowedVariables: [...source.allowedVariables],
    usedInSimulation: false,
  };
  return replaceTenantTemplates(state, tenantId, [...tenant.templates, copy], 'Cópia da mensagem pronta preparada para edição.');
}

export function activateSimulationTemplate(
  state: SimulationState,
  tenantId: SimulationTenantId,
  templateId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_templates');
  assertActiveTenant(state, tenantId);
  const tenant = getTenantData(state, tenantId);
  const current = tenant.templates.find(item => item.id === templateId);
  if (!current) throw new Error('Template não pertence ao tenant sintético ativo.');
  if (current.status !== 'draft') throw new Error('Somente um draft pode ser ativado; duplique templates inativos.');
  assertTemplateContentIsAllowed(current);
  const updated = { ...current, status: 'active' as const, updatedAt: templateTime(tenant.templates.length + 3) };
  return replaceTenantTemplates(state, tenantId, tenant.templates.map(item => item.id === templateId ? updated : item), 'Mensagem pronta ativada.');
}

export function deactivateSimulationTemplate(
  state: SimulationState,
  tenantId: SimulationTenantId,
  templateId: string,
): SimulationState {
  assertSimulationPermission(state.profileId, 'manage_templates');
  assertActiveTenant(state, tenantId);
  const tenant = getTenantData(state, tenantId);
  const current = tenant.templates.find(item => item.id === templateId);
  if (!current) throw new Error('Template não pertence ao tenant sintético ativo.');
  if (current.status !== 'active') throw new Error('Somente templates ativos podem ser desativados.');
  const updated = { ...current, status: 'inactive' as const, updatedAt: templateTime(tenant.templates.length + 4) };
  return replaceTenantTemplates(state, tenantId, tenant.templates.map(item => item.id === templateId ? updated : item), 'Mensagem pronta desativada.');
}
