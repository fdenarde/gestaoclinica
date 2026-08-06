import type { SimulationConversation, SimulationTenantData } from '../simulationTypes';
import { cloneQuickReplies, cloneTemplates } from '../templateFixtures';

const tenantId = 'SIM-TENANT-B' as const;

const conversations: SimulationConversation[] = [
  {
    id: 'SIM-CONVERSA-003',
    tenantId,
    contact: {
      id: 'SIM-CONTATO-003',
      displayName: 'Contato Fictício 003',
      reference: 'Clínica Sintética B',
      tenantId,
      relationship: 'Contato de demonstração',
      contactPreference: 'Preferência simulada: texto',
      consentStatus: 'Consentimento fictício registrado',
      optOut: false,
    },
    title: 'Contato Fictício 003',
    preview: 'Conversa pertencente a outro tenant sintético.',
    unreadCount: 1,
    messages: [
      {
        id: 'SIM-MSG-004',
        tenantId,
        conversationId: 'SIM-CONVERSA-003',
        operationKey: 'SIM-OP-IN-003',
        direction: 'inbound',
        body: 'Conversa pertencente a outro tenant sintético.',
        status: 'simulated_read',
        time: '11:20',
      },
    ],
    notes: [],
    history: [
      {
        id: 'SIM-HIST-003',
        tenantId,
        conversationId: 'SIM-CONVERSA-003',
        kind: 'state_changed',
        label: 'Nova entrada sintética aguardando equipe',
        actor: 'Sistema fictício',
        time: '11:20',
      },
    ],
    assignedProfessionalId: 'SIM-PROF-B-001',
    priority: 'normal',
    tagIds: ['SIM-TAG-B-RETORNO'],
    state: 'aguardando_equipe',
    scheduled: false,
    lastActivity: '11:20',
    lastActivityOrder: 5,
  },
];

export const TENANT_B_DATA: SimulationTenantData = {
  tenant: {
    id: tenantId,
    label: 'Tenant B — Laboratório Fictício',
    description: 'Segundo ambiente sintético, sem entidades compartilhadas.',
  },
  professionals: [
    { id: 'SIM-PROF-B-001', tenantId, displayName: 'Profissional Simulado C', role: 'Equipe fictícia' },
    { id: 'SIM-PROF-B-002', tenantId, displayName: 'Profissional Simulado D', role: 'Equipe fictícia' },
  ],
  tags: [
    { id: 'SIM-TAG-B-RETORNO', tenantId, label: 'Retorno sintético', tone: 'green' },
    { id: 'SIM-TAG-B-VIP', tenantId, label: 'Demonstração prioritária', tone: 'violet' },
  ],
  conversations,
  quickReplies: cloneQuickReplies(tenantId),
  templates: cloneTemplates(tenantId),
};
