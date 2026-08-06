import type { SimulationConversation, SimulationTenantData } from '../simulationTypes';
import { cloneQuickReplies, cloneTemplates } from '../templateFixtures';

const tenantId = 'SIM-TENANT-A' as const;

const conversations: SimulationConversation[] = [
  {
    id: 'SIM-CONVERSA-001',
    tenantId,
    contact: {
      id: 'SIM-CONTATO-001',
      displayName: 'Contato Fictício 001',
      reference: 'Responsável Simulado A',
      tenantId,
      relationship: 'Contato de demonstração',
      contactPreference: 'Preferência simulada: texto',
      consentStatus: 'Consentimento fictício registrado',
      optOut: false,
    },
    title: 'Contato Fictício 001',
    preview: 'Olá! Esta é uma conversa de demonstração.',
    unreadCount: 1,
    messages: [
      {
        id: 'SIM-MSG-001',
        tenantId,
        conversationId: 'SIM-CONVERSA-001',
        operationKey: 'SIM-OP-IN-001',
        direction: 'inbound',
        body: 'Olá! Esta é uma conversa de demonstração.',
        status: 'simulated_read',
        time: '09:10',
      },
      {
        id: 'SIM-MSG-002',
        tenantId,
        conversationId: 'SIM-CONVERSA-001',
        operationKey: 'SIM-OP-OUT-001',
        direction: 'outbound',
        body: 'Resposta fictícia registrada apenas na simulação.',
        status: 'simulated_delivered',
        time: '09:12',
      },
    ],
    notes: [],
    history: [
      {
        id: 'SIM-HIST-001',
        tenantId,
        conversationId: 'SIM-CONVERSA-001',
        kind: 'state_changed',
        label: 'Conversa criada como nova',
        actor: 'Sistema fictício',
        time: '09:10',
      },
    ],
    assignedProfessionalId: 'SIM-PROF-A-001',
    priority: 'normal',
    tagIds: ['SIM-TAG-A-NOVO'],
    state: 'nova',
    scheduled: false,
    lastActivity: '09:12',
    lastActivityOrder: 3,
  },
  {
    id: 'SIM-CONVERSA-002',
    tenantId,
    contact: {
      id: 'SIM-CONTATO-002',
      displayName: 'Contato Fictício 002',
      reference: 'Responsável Simulado B',
      tenantId,
      relationship: 'Contato de demonstração',
      contactPreference: 'Preferência simulada: retorno',
      consentStatus: 'Consentimento fictício registrado',
      optOut: false,
    },
    title: 'Contato Fictício 002',
    preview: 'Status desta conversa pode ser avançado manualmente.',
    unreadCount: 0,
    messages: [
      {
        id: 'SIM-MSG-003',
        tenantId,
        conversationId: 'SIM-CONVERSA-002',
        operationKey: 'SIM-OP-IN-002',
        direction: 'inbound',
        body: 'Status desta conversa pode ser avançado manualmente.',
        status: 'simulated_read',
        time: '10:04',
      },
    ],
    notes: [],
    history: [
      {
        id: 'SIM-HIST-002',
        tenantId,
        conversationId: 'SIM-CONVERSA-002',
        kind: 'state_changed',
        label: 'Resposta fictícia aguardando contato',
        actor: 'Sistema fictício',
        time: '10:04',
      },
    ],
    assignedProfessionalId: 'SIM-PROF-A-002',
    priority: 'alta',
    tagIds: ['SIM-TAG-A-RETORNO'],
    state: 'aguardando_contato',
    scheduled: false,
    lastActivity: '10:04',
    lastActivityOrder: 4,
  },
];

export const TENANT_A_DATA: SimulationTenantData = {
  tenant: {
    id: tenantId,
    label: 'Tenant A — Operação Fictícia',
    description: 'Ambiente sintético independente para demonstração.',
  },
  professionals: [
    { id: 'SIM-PROF-A-001', tenantId, displayName: 'Profissional Simulado A', role: 'Equipe fictícia' },
    { id: 'SIM-PROF-A-002', tenantId, displayName: 'Profissional Simulado B', role: 'Equipe fictícia' },
  ],
  tags: [
    { id: 'SIM-TAG-A-NOVO', tenantId, label: 'Novo contato', tone: 'blue' },
    { id: 'SIM-TAG-A-RETORNO', tenantId, label: 'Retorno', tone: 'amber' },
    { id: 'SIM-TAG-A-PRIORIDADE', tenantId, label: 'Prioridade', tone: 'violet' },
  ],
  conversations,
  quickReplies: cloneQuickReplies(tenantId),
  templates: cloneTemplates(tenantId),
};
