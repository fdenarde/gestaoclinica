import { getTenantData } from '../domain/simulationValidation';
import type { SimulationState, SimulationTenantId } from '../simulationTypes';
import type { SimulationQueueJob, SimulationSchedule, SimulationQueueJobStatus, SimulationScheduleStatus } from '../scheduleTypes';

export function getSelectedSimulationSchedule(state: SimulationState, tenantId: SimulationTenantId): SimulationSchedule | null {
  return state.schedules.find(item => item.id === state.selectedScheduleId && item.tenantId === tenantId) || null;
}

export function getSelectedSimulationQueueJob(state: SimulationState, tenantId: SimulationTenantId): SimulationQueueJob | null {
  return state.queueJobs.find(item => item.id === state.selectedQueueJobId && item.tenantId === tenantId) || null;
}

export function selectVisibleSimulationSchedules(state: SimulationState, tenantId: SimulationTenantId): SimulationSchedule[] {
  const tenant = getTenantData(state, tenantId);
  const search = state.scheduleFilters.search.trim().toLocaleLowerCase();
  return state.schedules.filter(schedule => {
    if (schedule.tenantId !== tenantId) return false;
    if (state.scheduleFilters.status && schedule.status !== state.scheduleFilters.status) return false;
    if (state.scheduleFilters.sourceType && schedule.sourceType !== state.scheduleFilters.sourceType) return false;
    if (!search) return true;
    const conversation = tenant.conversations.find(item => item.id === schedule.conversationId);
    return [schedule.id, schedule.contentSnapshot, conversation?.contact.displayName || ''].some(value => value.toLocaleLowerCase().includes(search));
  }).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export function selectSimulationScheduleCounts(state: SimulationState, tenantId: SimulationTenantId): Record<SimulationScheduleStatus, number> {
  return state.schedules.filter(item => item.tenantId === tenantId).reduce((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { draft: 0, scheduled: 0, queued: 0, completed: 0, failed: 0, cancelled: 0, expired: 0 } as Record<SimulationScheduleStatus, number>);
}

export function selectVisibleSimulationQueueJobs(state: SimulationState, tenantId: SimulationTenantId): SimulationQueueJob[] {
  const tenant = getTenantData(state, tenantId);
  const search = state.queueFilters.search.trim().toLocaleLowerCase();
  return state.queueJobs.filter(job => {
    if (job.tenantId !== tenantId) return false;
    if (state.queueFilters.status && job.status !== state.queueFilters.status) return false;
    if (state.queueFilters.sourceType) {
      const schedule = state.schedules.find(item => item.id === job.scheduleId);
      if (schedule?.sourceType !== state.queueFilters.sourceType) return false;
    }
    if (state.queueFilters.createdBy && job.createdBy !== state.queueFilters.createdBy) return false;
    if (state.queueFilters.period !== 'all') {
      const now = new Date(state.clock.now).getTime();
      const scheduled = new Date(job.scheduledAt).getTime();
      if (state.queueFilters.period === 'past' && scheduled >= now) return false;
      if (state.queueFilters.period === 'future' && scheduled <= now) return false;
      if (state.queueFilters.period === 'today' && Math.abs(scheduled - now) > 24 * 60 * 60 * 1000) return false;
    }
    if (!search) return true;
    const schedule = state.schedules.find(item => item.id === job.scheduleId);
    const conversation = tenant.conversations.find(item => item.id === job.conversationId);
    return [job.id, job.scheduleId, conversation?.contact.displayName || '', schedule?.contentSnapshot || ''].some(value => value.toLocaleLowerCase().includes(search));
  }).sort((a, b) => a.availableAt.localeCompare(b.availableAt));
}

export function selectSimulationQueueCounts(state: SimulationState, tenantId: SimulationTenantId): Record<SimulationQueueJobStatus, number> {
  return state.queueJobs.filter(item => item.tenantId === tenantId).reduce((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { pending: 0, scheduled: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, expired: 0 } as Record<SimulationQueueJobStatus, number>);
}
