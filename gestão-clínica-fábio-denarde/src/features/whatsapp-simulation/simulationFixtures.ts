import { TENANT_A_DATA } from './data/tenantAFixtures';
import { TENANT_B_DATA } from './data/tenantBFixtures';
import type { SimulationConversation, SimulationTenantData } from './simulationTypes';
import { cloneQuickReplies, cloneTemplates } from './templateFixtures';

export const SIMULATION_TENANT_DATA: Record<'SIM-TENANT-A' | 'SIM-TENANT-B', SimulationTenantData> = {
  'SIM-TENANT-A': TENANT_A_DATA,
  'SIM-TENANT-B': TENANT_B_DATA,
};

export const SIMULATION_FIXTURES: SimulationConversation[] = [
  ...TENANT_A_DATA.conversations,
  ...TENANT_B_DATA.conversations,
];

export function cloneConversation(conversation: SimulationConversation): SimulationConversation {
  return {
    ...conversation,
    contact: { ...conversation.contact },
    messages: conversation.messages.map(message => ({ ...message })),
    notes: conversation.notes.map(note => ({ ...note })),
    history: conversation.history.map(entry => ({ ...entry })),
    tagIds: [...conversation.tagIds],
  };
}

export function cloneTenantData(data: SimulationTenantData): SimulationTenantData {
  return {
    tenant: { ...data.tenant },
    professionals: data.professionals.map(professional => ({ ...professional })),
    tags: data.tags.map(tag => ({ ...tag })),
    conversations: data.conversations.map(cloneConversation),
    quickReplies: cloneQuickReplies(data.tenant.id),
    templates: cloneTemplates(data.tenant.id),
  };
}

export function cloneSimulationFixtures(): SimulationConversation[] {
  return SIMULATION_FIXTURES.map(cloneConversation);
}
