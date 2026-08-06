import type { SimulationProfile, SimulationProfileId } from '../simulationTypes';

export type SimulationPermission =
  | 'view'
  | 'view_templates'
  | 'use_template'
  | 'test_template'
  | 'manage_templates'
  | 'switch_tenant'
  | 'register_message'
  | 'create_note'
  | 'assign_professional'
  | 'change_priority'
  | 'manage_tags'
  | 'finalize_conversation'
  | 'reopen_conversation'
  | 'view_schedules'
  | 'create_schedule'
  | 'edit_schedule'
  | 'cancel_schedule'
  | 'advance_clock'
  | 'update_schedule_states'
  | 'view_queue'
  | 'process_queue'
  | 'simulate_queue_result'
  | 'reprocess_queue';

export const SIMULATION_PROFILES: SimulationProfile[] = [
  {
    id: 'platform_admin',
    label: 'Administrador da plataforma',
    description: 'Pode alternar tenants e administrar a estrutura fictícia.',
  },
  {
    id: 'clinic_admin',
    label: 'Administrador da clínica',
    description: 'Administra o tenant atual sem trocar de tenant.',
  },
  {
    id: 'professional',
    label: 'Profissional',
    description: 'Atende conversas e ajusta prioridade no tenant atual.',
  },
  {
    id: 'attendant',
    label: 'Atendente',
    description: 'Atende conversas sem administrar estrutura.',
  },
  {
    id: 'read_only',
    label: 'Somente leitura',
    description: 'Visualiza dados fictícios sem alterar o estado.',
  },
];

const permissions: Record<SimulationProfileId, readonly SimulationPermission[]> = {
  platform_admin: [
    'view',
    'view_templates',
    'use_template',
    'test_template',
    'manage_templates',
    'switch_tenant',
    'register_message',
    'create_note',
    'assign_professional',
    'change_priority',
    'manage_tags',
    'finalize_conversation',
    'reopen_conversation',
    'view_schedules',
    'create_schedule',
    'edit_schedule',
    'cancel_schedule',
    'advance_clock',
    'update_schedule_states',
    'view_queue',
    'process_queue',
    'simulate_queue_result',
    'reprocess_queue',
  ],
  clinic_admin: [
    'view',
    'view_templates',
    'use_template',
    'test_template',
    'manage_templates',
    'register_message',
    'create_note',
    'assign_professional',
    'change_priority',
    'manage_tags',
    'finalize_conversation',
    'reopen_conversation',
    'view_schedules',
    'create_schedule',
    'edit_schedule',
    'cancel_schedule',
    'advance_clock',
    'update_schedule_states',
    'view_queue',
    'process_queue',
    'simulate_queue_result',
    'reprocess_queue',
  ],
  professional: [
    'view',
    'view_templates',
    'use_template',
    'test_template',
    'register_message',
    'create_note',
    'change_priority',
    'finalize_conversation',
    'reopen_conversation',
    'view_schedules',
    'create_schedule',
    'edit_schedule',
    'cancel_schedule',
    'view_queue',
  ],
  attendant: ['view', 'view_templates', 'use_template', 'test_template', 'register_message', 'create_note', 'finalize_conversation', 'reopen_conversation', 'view_schedules', 'create_schedule', 'edit_schedule', 'cancel_schedule', 'view_queue'],
  read_only: ['view', 'view_templates', 'view_schedules', 'view_queue'],
};

export function hasSimulationPermission(
  profileId: SimulationProfileId,
  permission: SimulationPermission,
): boolean {
  return permissions[profileId].includes(permission);
}

export function assertSimulationPermission(
  profileId: SimulationProfileId,
  permission: SimulationPermission,
): void {
  if (!hasSimulationPermission(profileId, permission)) {
    const profile = SIMULATION_PROFILES.find(item => item.id === profileId);
    throw new Error(
      `${profile?.label || 'Perfil simulado'} não possui permissão para esta ação.`,
    );
  }
}

export function getSimulationProfile(profileId: SimulationProfileId): SimulationProfile {
  const profile = SIMULATION_PROFILES.find(item => item.id === profileId);
  if (!profile) throw new Error('Perfil simulado inexistente.');
  return profile;
}
