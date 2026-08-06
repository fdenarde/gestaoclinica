import type { SimulationClockState, SimulationSchedule } from './scheduleTypes';

export const SIMULATION_TIMEZONE = 'America/Sao_Paulo' as const;
export const SIMULATION_INITIAL_CLOCK = '2026-03-20T12:00:00.000Z';

export function createInitialSimulationClock(): SimulationClockState {
  return {
    initialAt: SIMULATION_INITIAL_CLOCK,
    now: SIMULATION_INITIAL_CLOCK,
    timezone: SIMULATION_TIMEZONE,
    history: [],
  };
}

function scheduleFixture(
  tenantId: 'SIM-TENANT-A' | 'SIM-TENANT-B',
  sequence: number,
  conversationId: string,
  contactId: string,
  scheduledAt: string,
  contentSnapshot: string,
): SimulationSchedule {
  const id = `SIM-SCHEDULE-${tenantId.slice(-1)}-${String(sequence).padStart(3, '0')}`;
  const expiresAt = new Date(new Date(scheduledAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const now = SIMULATION_INITIAL_CLOCK;
  const actor = 'Administrador da plataforma';
  return {
    id,
    tenantId,
    conversationId,
    contactId,
    sourceType: 'manual',
    contentSnapshot,
    scheduledAt,
    timezone: SIMULATION_TIMEZONE,
    expiresAt,
    status: 'scheduled',
    idempotencyKey: `SIM-SCHEDULE-KEY-${tenantId}-${conversationId}-${scheduledAt}`,
    createdBy: actor,
    createdByProfileId: 'platform_admin',
    createdAt: now,
    updatedAt: now,
    messageLogicalId: `SIM-MESSAGE-${id}`,
    history: [{
      id: `${id}-HISTORY-001`,
      scheduleId: id,
      tenantId,
      kind: 'created',
      label: 'Programado na simulação',
      actor,
      time: now,
    }],
  };
}

export function createInitialSimulationSchedules(): SimulationSchedule[] {
  return [
    scheduleFixture('SIM-TENANT-A', 1, 'SIM-CONVERSA-001', 'SIM-CONTATO-001', '2026-03-20T13:30:00.000Z', 'Lembrete fictício da confirmação de contato.'),
    scheduleFixture('SIM-TENANT-B', 1, 'SIM-CONVERSA-B-001', 'SIM-CONTATO-B-001', '2026-03-20T14:00:00.000Z', 'Retorno sintético do laboratório fictício.'),
  ];
}
