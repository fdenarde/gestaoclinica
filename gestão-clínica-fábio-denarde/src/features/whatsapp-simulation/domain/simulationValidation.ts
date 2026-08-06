import type {
  SimulationConversation,
  SimulationState,
  SimulationTenantData,
  SimulationTenantId,
} from '../simulationTypes';

export function getTenantData(
  state: SimulationState,
  tenantId: SimulationTenantId,
): SimulationTenantData {
  const tenant = state.tenants[tenantId];
  if (!tenant) throw new Error('Tenant sintético inexistente.');
  return tenant;
}

export function assertActiveTenant(state: SimulationState, tenantId: SimulationTenantId): void {
  getTenantData(state, tenantId);
  if (state.activeTenantId !== tenantId) {
    throw new Error('A operação precisa utilizar o tenant sintético ativo.');
  }
}

export function assertConversationTenant(
  conversation: SimulationConversation,
  tenantId: SimulationTenantId,
): void {
  if (conversation.tenantId !== tenantId || conversation.contact.tenantId !== tenantId) {
    throw new Error('Acesso cruzado entre tenants sintéticos rejeitado.');
  }
  if (conversation.messages.some(message => message.tenantId !== tenantId)) {
    throw new Error('Mensagem sintética pertence a outro tenant.');
  }
  if (conversation.notes.some(note => note.tenantId !== tenantId)) {
    throw new Error('Nota sintética pertence a outro tenant.');
  }
}

export function assertConversationInTenant(
  state: SimulationState,
  tenantId: SimulationTenantId,
  conversationId: string,
): SimulationConversation {
  assertActiveTenant(state, tenantId);
  const conversation = getTenantData(state, tenantId).conversations.find(
    item => item.id === conversationId,
  );
  if (!conversation) throw new Error('Conversa não pertence ao tenant sintético ativo.');
  assertConversationTenant(conversation, tenantId);
  return conversation;
}

export function assertNonEmptySyntheticText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} não pode ficar vazio.`);
  return normalized;
}
