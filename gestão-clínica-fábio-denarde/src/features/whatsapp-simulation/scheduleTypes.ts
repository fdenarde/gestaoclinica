import type {
  SimulationCompositionSource,
  SimulationProfileId,
  SimulationTenantId,
} from './simulationTypes';

export type SimulationScheduleStatus =
  | 'draft'
  | 'scheduled'
  | 'queued'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type SimulationQueueJobStatus =
  | 'pending'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type SimulationQueueOutcome = 'success' | 'failure';

export type SimulationFailureReason =
  | 'falha temporária simulada'
  | 'canal fictício indisponível'
  | 'conteúdo rejeitado pela simulação'
  | 'trabalho expirado'
  | 'bloqueio de consentimento'
  | 'erro técnico fictício';

export type SimulationSchedulePeriod = 'all' | 'past' | 'today' | 'future';

export interface SimulationClockEvent {
  id: string;
  kind: 'advanced' | 'set' | 'restored' | 'states_evaluated';
  from: string;
  to: string;
  actor: string;
  label: string;
}

export interface SimulationClockState {
  initialAt: string;
  now: string;
  timezone: 'America/Sao_Paulo';
  history: SimulationClockEvent[];
}

export interface SimulationScheduleHistoryEntry {
  id: string;
  scheduleId: string;
  tenantId: SimulationTenantId;
  kind: 'created' | 'edited' | 'cancelled' | 'queued' | 'completed' | 'failed' | 'expired' | 'reprocessed';
  label: string;
  actor: string;
  time: string;
}

export interface SimulationSchedule {
  id: string;
  tenantId: SimulationTenantId;
  conversationId: string;
  contactId: string;
  sourceType: SimulationCompositionSource;
  sourceId?: string;
  templateVersion?: number;
  contentSnapshot: string;
  scheduledAt: string;
  timezone: 'America/Sao_Paulo';
  expiresAt: string;
  status: SimulationScheduleStatus;
  idempotencyKey: string;
  createdBy: string;
  createdByProfileId: SimulationProfileId;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  queueJobId?: string;
  messageLogicalId: string;
  history: SimulationScheduleHistoryEntry[];
}

export interface SimulationQueueJob {
  id: string;
  tenantId: SimulationTenantId;
  scheduleId: string;
  conversationId: string;
  messageLogicalId: string;
  status: SimulationQueueJobStatus;
  attempt: number;
  idempotencyKey: string;
  scheduledAt: string;
  availableAt: string;
  expiresAt: string;
  claimedAt?: string;
  processingAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  failureReason?: SimulationFailureReason;
  previousJobId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationScheduleInput {
  tenantId: SimulationTenantId;
  conversationId: string;
  sourceType: SimulationCompositionSource;
  sourceId?: string;
  templateVersion?: number;
  contentSnapshot: string;
  scheduledAt: string;
  expiresAt?: string;
}

export interface SimulationScheduleEdit {
  contentSnapshot?: string;
  sourceType?: SimulationCompositionSource;
  sourceId?: string;
  templateVersion?: number;
  scheduledAt?: string;
  expiresAt?: string;
}

export interface SimulationSchedulePreview extends SimulationScheduleInput {
  id: string;
  contactName: string;
  tenantName: string;
  sourceLabel: string;
  timezone: 'America/Sao_Paulo';
  resolvedExpiresAt: string;
  idempotencyKey: string;
}

export interface SimulationScheduleDraft {
  conversationId: string;
  sourceType: SimulationCompositionSource;
  sourceId: string;
  templateVersion?: number;
  contentSnapshot: string;
  scheduledAt: string;
  expiresAt: string;
}

export interface SimulationScheduleFilters {
  status: SimulationScheduleStatus | '';
  sourceType: SimulationCompositionSource | '';
  search: string;
}

export interface SimulationQueueFilters {
  status: SimulationQueueJobStatus | '';
  sourceType: SimulationCompositionSource | '';
  createdBy: string;
  period: SimulationSchedulePeriod;
  search: string;
}
