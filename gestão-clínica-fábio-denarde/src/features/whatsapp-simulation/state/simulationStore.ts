import { cloneTenantData, SIMULATION_TENANT_DATA } from '../simulationFixtures';
import { createInitialSimulationClock, createInitialSimulationSchedules } from '../scheduleFixtures';
import type {
  SimulationComposerState,
  SimulationFilters,
  SimulationState,
  SimulationTemplateFilters,
  SimulationTenantId,
} from '../simulationTypes';
import type { SimulationQueueFilters, SimulationScheduleFilters } from '../scheduleTypes';

export const EMPTY_SIMULATION_FILTERS: SimulationFilters = {
  category: 'all',
  search: '',
  status: '',
  professionalId: '',
  tagId: '',
};

export const EMPTY_TEMPLATE_FILTERS: SimulationTemplateFilters = {
  search: '',
  category: '',
  status: '',
};

export const EMPTY_SCHEDULE_FILTERS: SimulationScheduleFilters = {
  status: '',
  sourceType: '',
  search: '',
};

export const EMPTY_QUEUE_FILTERS: SimulationQueueFilters = {
  status: '',
  sourceType: '',
  createdBy: '',
  period: 'all',
  search: '',
};

export const EMPTY_SIMULATION_COMPOSER: SimulationComposerState = {
  mode: 'manual',
  draft: '',
  quickReplyId: '',
  templateId: '',
};

export function createInitialSimulationState(): SimulationState {
  const tenantA = cloneTenantData(SIMULATION_TENANT_DATA['SIM-TENANT-A']);
  const tenantB = cloneTenantData(SIMULATION_TENANT_DATA['SIM-TENANT-B']);
  return {
    tenants: {
      'SIM-TENANT-A': tenantA,
      'SIM-TENANT-B': tenantB,
    },
    activeTenantId: 'SIM-TENANT-A',
    selectedConversationId: tenantA.conversations[0]?.id || '',
    profileId: 'platform_admin',
    filters: { ...EMPTY_SIMULATION_FILTERS },
    notice: '',
    activeView: 'new_message',
    templateFilters: { ...EMPTY_TEMPLATE_FILTERS },
    selectedTemplateId: '',
    templateDraft: null,
    templateEditingId: '',
    composer: { ...EMPTY_SIMULATION_COMPOSER },
    preview: null,
    clock: createInitialSimulationClock(),
    schedules: createInitialSimulationSchedules(),
    queueJobs: [],
    selectedScheduleId: 'SIM-SCHEDULE-A-001',
    selectedQueueJobId: '',
    scheduleFilters: { ...EMPTY_SCHEDULE_FILTERS },
    queueFilters: { ...EMPTY_QUEUE_FILTERS },
    scheduleDraft: null,
    scheduleEditingId: '',
    schedulePreview: null,
  };
}

export function resetSimulationState(): SimulationState {
  return createInitialSimulationState();
}

export function updateTenantConversations(
  state: SimulationState,
  tenantId: SimulationTenantId,
  updater: (conversation: SimulationState['tenants'][SimulationTenantId]['conversations'][number]) => SimulationState['tenants'][SimulationTenantId]['conversations'][number],
): SimulationState {
  const tenant = state.tenants[tenantId];
  if (!tenant) throw new Error('Tenant sintético inexistente.');
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [tenantId]: {
        ...tenant,
        conversations: tenant.conversations.map(conversation =>
          updater(conversation),
        ),
      },
    },
  };
}
