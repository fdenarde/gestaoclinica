import type {
  SimulationQuickReply,
  SimulationTemplate,
  SimulationTenantId,
} from './simulationTypes';

export const SIMULATION_QUICK_REPLIES: Record<SimulationTenantId, SimulationQuickReply[]> = {
  'SIM-TENANT-A': [
    { id: 'SIM-QR-A-001', tenantId: 'SIM-TENANT-A', title: 'Confirmação de recebimento', content: 'Recebemos sua mensagem fictícia e retornaremos em breve.', category: 'atendimento', status: 'active', displayOrder: 1 },
    { id: 'SIM-QR-A-002', tenantId: 'SIM-TENANT-A', title: 'Retorno em breve', content: 'Olá. A equipe simulada retornará em breve.', category: 'retorno', status: 'active', displayOrder: 2 },
    { id: 'SIM-QR-A-003', tenantId: 'SIM-TENANT-A', title: 'Solicitação administrativa', content: 'Sua solicitação administrativa fictícia foi registrada para conferência.', category: 'administrativo', status: 'active', displayOrder: 3 },
    { id: 'SIM-QR-A-004', tenantId: 'SIM-TENANT-A', title: 'Horário de atendimento', content: 'O horário de atendimento simulado é de segunda a sexta, das 08h às 17h.', category: 'atendimento', status: 'inactive', displayOrder: 4 },
  ],
  'SIM-TENANT-B': [
    { id: 'SIM-QR-B-001', tenantId: 'SIM-TENANT-B', title: 'Recebimento no laboratório', content: 'A mensagem foi recebida pelo laboratório fictício.', category: 'atendimento', status: 'active', displayOrder: 1 },
    { id: 'SIM-QR-B-002', tenantId: 'SIM-TENANT-B', title: 'Retorno da equipe B', content: 'Olá. A equipe B enviará um retorno simulado.', category: 'retorno', status: 'active', displayOrder: 2 },
    { id: 'SIM-QR-B-003', tenantId: 'SIM-TENANT-B', title: 'Dados administrativos', content: 'A solicitação administrativa sintética foi encaminhada para revisão.', category: 'administrativo', status: 'active', displayOrder: 3 },
    { id: 'SIM-QR-B-004', tenantId: 'SIM-TENANT-B', title: 'Janela de atendimento B', content: 'A janela de atendimento fictícia ocorre das 09h às 18h.', category: 'atendimento', status: 'inactive', displayOrder: 4 },
  ],
};

export const SIMULATION_TEMPLATES: Record<SimulationTenantId, SimulationTemplate[]> = {
  'SIM-TENANT-A': [
    { id: 'SIM-TPL-A-001', tenantId: 'SIM-TENANT-A', name: 'Confirmação de contato', description: 'Modelo sintético para confirmar o recebimento.', category: 'confirmação', version: 1, content: 'Olá, {{contato_nome}}. Confirmamos o recebimento da sua mensagem fictícia.', allowedVariables: ['contato_nome'], status: 'active', createdBy: 'Administrador sintético A', createdAt: '2026-01-10 09:00', updatedAt: '2026-01-10 09:00', usedInSimulation: false },
    { id: 'SIM-TPL-A-002', tenantId: 'SIM-TENANT-A', name: 'Retorno programado fictício', description: 'Modelo para informar uma janela de retorno simulada.', category: 'retorno', version: 1, content: '{{contato_nome}}, {{profissional_nome}} retornará em {{data_ficticia}} às {{horario_ficticio}}.', allowedVariables: ['contato_nome', 'profissional_nome', 'data_ficticia', 'horario_ficticio'], status: 'active', createdBy: 'Administrador sintético A', createdAt: '2026-01-11 10:00', updatedAt: '2026-01-11 10:00', usedInSimulation: false },
    { id: 'SIM-TPL-A-003', tenantId: 'SIM-TENANT-A', name: 'Orientação administrativa', description: 'Modelo fictício de apoio administrativo.', category: 'administrativo', version: 2, content: 'Olá, {{contato_nome}}. A equipe de {{tenant_nome}} registrou sua solicitação administrativa.', allowedVariables: ['contato_nome', 'tenant_nome'], status: 'draft', createdBy: 'Administrador sintético A', createdAt: '2026-01-12 11:00', updatedAt: '2026-01-13 11:30', usedInSimulation: false },
    { id: 'SIM-TPL-A-004', tenantId: 'SIM-TENANT-A', name: 'Modelo antigo de atendimento', description: 'Modelo inativo preservado para demonstração.', category: 'atendimento', version: 1, content: 'A equipe fictícia recebeu sua mensagem e fará uma conferência.', allowedVariables: [], status: 'inactive', createdBy: 'Administrador sintético A', createdAt: '2026-01-09 08:00', updatedAt: '2026-01-14 08:00', usedInSimulation: true },
  ],
  'SIM-TENANT-B': [
    { id: 'SIM-TPL-B-001', tenantId: 'SIM-TENANT-B', name: 'Confirmação do laboratório', description: 'Modelo sintético de confirmação do tenant B.', category: 'confirmação', version: 1, content: 'Olá, {{contato_nome}}. O laboratório fictício {{tenant_nome}} recebeu sua mensagem.', allowedVariables: ['contato_nome', 'tenant_nome'], status: 'active', createdBy: 'Administrador sintético B', createdAt: '2026-02-10 09:00', updatedAt: '2026-02-10 09:00', usedInSimulation: false },
    { id: 'SIM-TPL-B-002', tenantId: 'SIM-TENANT-B', name: 'Retorno da equipe B', description: 'Modelo de retorno sintético do segundo tenant.', category: 'retorno', version: 1, content: '{{profissional_nome}} fará um retorno fictício em {{data_ficticia}} às {{horario_ficticio}}.', allowedVariables: ['profissional_nome', 'data_ficticia', 'horario_ficticio'], status: 'active', createdBy: 'Administrador sintético B', createdAt: '2026-02-11 10:00', updatedAt: '2026-02-11 10:00', usedInSimulation: false },
    { id: 'SIM-TPL-B-003', tenantId: 'SIM-TENANT-B', name: 'Solicitação administrativa B', description: 'Modelo administrativo exclusivamente sintético.', category: 'administrativo', version: 1, content: 'A solicitação de {{contato_nome}} foi registrada no ambiente fictício.', allowedVariables: ['contato_nome'], status: 'draft', createdBy: 'Administrador sintético B', createdAt: '2026-02-12 11:00', updatedAt: '2026-02-12 11:00', usedInSimulation: false },
    { id: 'SIM-TPL-B-004', tenantId: 'SIM-TENANT-B', name: 'Cancelamento demonstrativo', description: 'Modelo inativo para teste de filtros.', category: 'cancelamento', version: 1, content: 'O pedido fictício foi cancelado conforme solicitado.', allowedVariables: [], status: 'inactive', createdBy: 'Administrador sintético B', createdAt: '2026-02-09 08:00', updatedAt: '2026-02-13 08:00', usedInSimulation: false },
  ],
};

export function cloneQuickReplies(tenantId: SimulationTenantId): SimulationQuickReply[] {
  return SIMULATION_QUICK_REPLIES[tenantId].map(item => ({ ...item }));
}

export function cloneTemplates(tenantId: SimulationTenantId): SimulationTemplate[] {
  return SIMULATION_TEMPLATES[tenantId].map(item => ({ ...item, allowedVariables: [...item.allowedVariables] }));
}
