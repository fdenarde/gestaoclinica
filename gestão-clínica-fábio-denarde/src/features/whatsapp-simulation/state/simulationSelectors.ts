import { getTenantData, assertActiveTenant } from '../domain/simulationValidation';
import type {
  SimulationCategory,
  SimulationConversation,
  SimulationFilters,
  SimulationProfessional,
  SimulationState,
  SimulationTag,
  SimulationTemplate,
  SimulationTenantId,
} from '../simulationTypes';

export function getActiveTenantData(state: SimulationState) {
  return getTenantData(state, state.activeTenantId);
}

export function getSelectedConversation(
  state: SimulationState,
  tenantId: SimulationTenantId,
): SimulationConversation | null {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).conversations.find(
    conversation => conversation.id === state.selectedConversationId,
  ) || null;
}

export function getConversation(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
): SimulationConversation | null {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).conversations.find(
    conversation => conversation.id === conversationId,
  ) || null;
}

function containsSearch(conversation: SimulationConversation, search: string): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch) return true;
  return [
    conversation.title,
    conversation.id,
    conversation.contact.id,
    conversation.contact.displayName,
    conversation.contact.reference,
  ].some(value => value.toLocaleLowerCase().includes(normalizedSearch));
}

function matchesCategory(conversation: SimulationConversation, category: SimulationCategory): boolean {
  if (category === 'all') return true;
  if (category === 'unread') return conversation.unreadCount > 0;
  if (category === 'awaiting_team') return conversation.state === 'aguardando_equipe';
  if (category === 'awaiting_contact') return conversation.state === 'aguardando_contato';
  if (category === 'scheduled') return conversation.scheduled;
  if (category === 'finished') return conversation.state === 'finalizada';
  return conversation.messages.some(message => message.status === 'simulated_failed');
}

function matchesFilters(conversation: SimulationConversation, filters: SimulationFilters): boolean {
  return (
    containsSearch(conversation, filters.search) &&
    matchesCategory(conversation, filters.category) &&
    (!filters.status || conversation.state === filters.status) &&
    (!filters.professionalId || conversation.assignedProfessionalId === filters.professionalId) &&
    (!filters.tagId || conversation.tagIds.includes(filters.tagId))
  );
}

export function sortConversations(conversations: SimulationConversation[]): SimulationConversation[] {
  return [...conversations].sort((first, second) => {
    if (first.priority !== second.priority) return first.priority === 'alta' ? -1 : 1;
    if ((first.unreadCount > 0) !== (second.unreadCount > 0)) {
      return first.unreadCount > 0 ? -1 : 1;
    }
    return second.lastActivityOrder - first.lastActivityOrder;
  });
}

export function selectVisibleConversations(
  state: SimulationState,
  tenantId: SimulationTenantId,
): SimulationConversation[] {
  assertActiveTenant(state, tenantId);
  const tenant = getTenantData(state, tenantId);
  return sortConversations(tenant.conversations.filter(conversation => matchesFilters(conversation, state.filters)));
}

export function selectCategoryCounts(
  state: SimulationState,
  tenantId: SimulationTenantId,
): Record<SimulationCategory, number> {
  assertActiveTenant(state, tenantId);
  const conversations = getTenantData(state, tenantId).conversations;
  return {
    all: conversations.length,
    unread: conversations.filter(conversation => conversation.unreadCount > 0).length,
    awaiting_team: conversations.filter(conversation => conversation.state === 'aguardando_equipe').length,
    awaiting_contact: conversations.filter(conversation => conversation.state === 'aguardando_contato').length,
    scheduled: conversations.filter(conversation => conversation.scheduled).length,
    failed: conversations.filter(conversation => conversation.messages.some(message => message.status === 'simulated_failed')).length,
    finished: conversations.filter(conversation => conversation.state === 'finalizada').length,
  };
}

export function selectProfessionals(
  state: SimulationState,
  tenantId: SimulationTenantId,
): SimulationProfessional[] {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).professionals;
}

export function selectTags(state: SimulationState, tenantId: SimulationTenantId): SimulationTag[] {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).tags;
}

export function getLatestOutbound(conversation: SimulationConversation | null) {
  return [...(conversation?.messages || [])].reverse().find(message => message.direction === 'outbound') || null;
}

export function getProfessionalName(
  state: SimulationState,
  tenantId: SimulationTenantId,
  professionalId: string | null,
): string {
  if (!professionalId) return 'Não atribuído';
  return selectProfessionals(state, tenantId).find(item => item.id === professionalId)?.displayName || 'Não atribuído';
}

export function getSelectedTemplate(state: SimulationState, tenantId: SimulationTenantId): SimulationTemplate | null {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).templates.find(template => template.id === state.selectedTemplateId) || null;
}

export function selectVisibleTemplates(state: SimulationState, tenantId: SimulationTenantId): SimulationTemplate[] {
  assertActiveTenant(state, tenantId);
  const filters = state.templateFilters;
  const search = filters.search.trim().toLocaleLowerCase();
  return getTenantData(state, tenantId).templates
    .filter(template => !search || [template.name, template.description, template.id].some(value => value.toLocaleLowerCase().includes(search)))
    .filter(template => !filters.category || template.category === filters.category)
    .filter(template => !filters.status || template.status === filters.status)
    .sort((first, second) => first.name.localeCompare(second.name));
}

export function selectActiveQuickReplies(state: SimulationState, tenantId: SimulationTenantId) {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).quickReplies
    .filter(reply => reply.status === 'active')
    .sort((first, second) => first.displayOrder - second.displayOrder);
}

export function selectAllQuickReplies(state: SimulationState, tenantId: SimulationTenantId) {
  assertActiveTenant(state, tenantId);
  return getTenantData(state, tenantId).quickReplies
    .slice()
    .sort((first, second) => first.displayOrder - second.displayOrder);
}
