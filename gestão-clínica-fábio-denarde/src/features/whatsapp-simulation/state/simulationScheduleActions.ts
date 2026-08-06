import { createSyntheticHistoryEntry } from '../domain/conversationStateMachine';
import { assertSimulationPermission, getSimulationProfile } from '../domain/permissionPolicy';
import { assertActiveTenant, assertConversationInTenant, assertNonEmptySyntheticText, getTenantData } from '../domain/simulationValidation';
import { assertTemplateContentIsAllowed } from '../domain/templateValidation';
import { cloneConversation } from '../simulationFixtures';
import { SIMULATION_TIMEZONE } from '../scheduleFixtures';
import { EMPTY_QUEUE_FILTERS, EMPTY_SCHEDULE_FILTERS } from './simulationStore';
import type {
  SimulationCompositionSource,
  SimulationMessage,
  SimulationProfileId,
  SimulationState,
  SimulationTenantId,
} from '../simulationTypes';
import type {
  SimulationClockEvent,
  SimulationFailureReason,
  SimulationQueueJob,
  SimulationQueueOutcome,
  SimulationSchedule,
  SimulationScheduleHistoryEntry,
  SimulationScheduleEdit,
  SimulationScheduleInput,
  SimulationSchedulePreview,
} from '../scheduleTypes';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FAILURE_REASONS: SimulationFailureReason[] = [
  'falha temporária simulada',
  'canal fictício indisponível',
  'conteúdo rejeitado pela simulação',
  'trabalho expirado',
  'bloqueio de consentimento',
  'erro técnico fictício',
];

function actorName(state: SimulationState): string {
  return `Usuário simulado — ${getSimulationProfile(state.profileId).label}`;
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function parseDateTime(value: string, field: string): Date {
  const raw = value.trim();
  if (!raw) throw new Error(`${field} é obrigatório.`);
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (local) {
    const [, year, month, day, hour, minute, second = '00'] = local;
    const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    const check = new Date(utc);
    if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day) || check.getUTCHours() !== Number(hour) || check.getUTCMinutes() !== Number(minute) || check.getUTCSeconds() !== Number(second)) {
      throw new Error(`${field} inválido.`);
    }
    return new Date(utc + 3 * HOUR_MS);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} inválido.`);
  return parsed;
}

function isoDateTime(value: string, field: string): string {
  return parseDateTime(value, field).toISOString();
}

export function formatSimulationDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: SIMULATION_TIMEZONE,
  }).format(new Date(value));
}

export function simulationDateTimeInputValue(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SIMULATION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function addSimulationHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * HOUR_MS).toISOString();
}

function sourceLabel(source: SimulationCompositionSource): string {
  if (source === 'quick_reply') return 'Resposta rápida';
  if (source === 'template') return 'Template';
  return 'Mensagem manual';
}

function idempotencyKey(input: SimulationScheduleInput, attempt = 0): string {
  const sourceId = input.sourceId || 'manual';
  return `SIM-IDEM-${input.tenantId}-${input.conversationId}-${input.sourceType}-${sourceId}-${normalizeText(input.contentSnapshot)}-${isoDateTime(input.scheduledAt, 'scheduledAt')}-A${attempt}`;
}

function historyEntry(
  schedule: Pick<SimulationSchedule, 'id' | 'tenantId'>,
  kind: SimulationScheduleHistoryEntry['kind'],
  label: string,
  actor: string,
  time: string,
  sequence: number,
): SimulationScheduleHistoryEntry {
  return { id: `${schedule.id}-HISTORY-${String(sequence).padStart(3, '0')}`, scheduleId: schedule.id, tenantId: schedule.tenantId, kind, label, actor, time };
}

function withNotice(state: SimulationState, notice: string): SimulationState {
  return { ...state, notice };
}

function assertProfileCanManageOwn(state: SimulationState, schedule: SimulationSchedule, permission: 'edit_schedule' | 'cancel_schedule'): void {
  assertSimulationPermission(state.profileId, permission);
  if ((state.profileId === 'professional' || state.profileId === 'attendant') && schedule.createdByProfileId !== state.profileId) {
    throw new Error('O perfil simulado só pode alterar agendamentos criados por ele.');
  }
}

function getSchedule(state: SimulationState, tenantId: SimulationTenantId, scheduleId: string): SimulationSchedule {
  assertActiveTenant(state, tenantId);
  const schedule = state.schedules.find(item => item.id === scheduleId && item.tenantId === tenantId);
  if (!schedule) throw new Error('Agendamento não pertence ao tenant sintético ativo.');
  return schedule;
}

function assertSource(
  state: SimulationState,
  input: SimulationScheduleInput,
): void {
  const tenant = getTenantData(state, input.tenantId);
  if (input.sourceType === 'manual') {
    if (input.sourceId || input.templateVersion !== undefined) throw new Error('Mensagem manual não pode possuir metadados de template.');
    return;
  }
  if (!input.sourceId) throw new Error('A origem do agendamento é obrigatória.');
  if (input.sourceType === 'quick_reply') {
    const reply = tenant.quickReplies.find(item => item.id === input.sourceId && item.tenantId === input.tenantId);
    if (!reply) throw new Error('Resposta rápida não pertence ao tenant sintético.');
    if (reply.status !== 'active') throw new Error('Resposta rápida inativa não pode ser agendada.');
    if (input.templateVersion !== undefined) throw new Error('Resposta rápida não pode possuir versão de template.');
    return;
  }
  const template = tenant.templates.find(item => item.id === input.sourceId && item.tenantId === input.tenantId);
  if (!template) throw new Error('Template não pertence ao tenant sintético.');
  if (template.status !== 'active') throw new Error('Somente templates ativos podem ser agendados.');
  if (input.templateVersion !== template.version) throw new Error('A versão do template não corresponde ao template ativo.');
  assertTemplateContentIsAllowed(template);
  if (/{{\s*[a-zA-Z0-9_]+\s*}}/.test(input.contentSnapshot)) throw new Error('Todas as variáveis do template precisam ser resolvidas antes do agendamento.');
}

function validateInput(state: SimulationState, input: SimulationScheduleInput): SimulationScheduleInput & { scheduledAt: string; expiresAt: string } {
  assertSimulationPermission(state.profileId, 'create_schedule');
  assertActiveTenant(state, input.tenantId);
  const conversation = assertConversationInTenant(state, input.tenantId, input.conversationId);
  if (conversation.state === 'finalizada') throw new Error('Conversa finalizada não permite agendamento.');
  if (conversation.contact.optOut) throw new Error('Contato com opt-out simulado não permite agendamento.');
  if (/revogad|revoked/i.test(conversation.contact.consentStatus)) throw new Error('Consentimento revogado não permite agendamento.');
  const contentSnapshot = assertNonEmptySyntheticText(input.contentSnapshot, 'O conteúdo do agendamento');
  assertSource(state, input);
  const scheduledAt = isoDateTime(input.scheduledAt, 'scheduledAt');
  const expiresAt = isoDateTime(input.expiresAt || addSimulationHours(scheduledAt, 24), 'expiresAt');
  if (new Date(scheduledAt).getTime() <= new Date(state.clock.now).getTime()) throw new Error('scheduledAt deve ser posterior ao relógio simulado atual.');
  if (new Date(expiresAt).getTime() <= new Date(scheduledAt).getTime()) throw new Error('expiresAt deve ser posterior a scheduledAt.');
  return { ...input, contentSnapshot, scheduledAt, expiresAt };
}

export function createSimulationSchedulePreview(state: SimulationState, input: SimulationScheduleInput): SimulationSchedulePreview {
  const valid = validateInput(state, input);
  const tenant = getTenantData(state, valid.tenantId);
  const conversation = assertConversationInTenant(state, valid.tenantId, valid.conversationId);
  return {
    ...valid,
    id: `SIM-SCHEDULE-PREVIEW-${state.schedules.length + 1}`,
    contactName: conversation.contact.displayName,
    tenantName: tenant.tenant.label,
    sourceLabel: sourceLabel(valid.sourceType),
    timezone: SIMULATION_TIMEZONE,
    resolvedExpiresAt: valid.expiresAt,
    idempotencyKey: idempotencyKey(valid),
  };
}

export function setSimulationSchedulePreview(state: SimulationState, preview: SimulationSchedulePreview): SimulationState {
  assertActiveTenant(state, preview.tenantId);
  assertConversationInTenant(state, preview.tenantId, preview.conversationId);
  return { ...state, schedulePreview: preview };
}

export function clearSimulationSchedulePreview(state: SimulationState): SimulationState {
  return { ...state, schedulePreview: null };
}

export function createSimulationSchedule(state: SimulationState, input: SimulationScheduleInput): SimulationState {
  const valid = validateInput(state, input);
  const key = idempotencyKey(valid);
  const existing = state.schedules.find(item => item.tenantId === valid.tenantId && item.idempotencyKey === key);
  if (existing) return { ...state, selectedScheduleId: existing.id, schedulePreview: null, notice: 'Confirmação repetida: o mesmo agendamento simulado foi preservado.' };
  const tenant = getTenantData(state, valid.tenantId);
  const conversation = assertConversationInTenant(state, valid.tenantId, valid.conversationId);
  const sequence = state.schedules.filter(item => item.tenantId === valid.tenantId).length + 1;
  const id = `SIM-SCHEDULE-${valid.tenantId.slice(-1)}-${String(sequence).padStart(3, '0')}`;
  const now = state.clock.now;
  const actor = actorName(state);
  const schedule: SimulationSchedule = {
    id,
    tenantId: valid.tenantId,
    conversationId: conversation.id,
    contactId: conversation.contact.id,
    sourceType: valid.sourceType,
    sourceId: valid.sourceId,
    templateVersion: valid.templateVersion,
    contentSnapshot: valid.contentSnapshot,
    scheduledAt: valid.scheduledAt,
    timezone: SIMULATION_TIMEZONE,
    expiresAt: valid.expiresAt,
    status: 'scheduled',
    idempotencyKey: key,
    createdBy: actor,
    createdByProfileId: state.profileId,
    createdAt: now,
    updatedAt: now,
    messageLogicalId: `SIM-MESSAGE-${id}`,
    history: [],
  };
  schedule.history.push(historyEntry(schedule, 'created', 'Programado na simulação', actor, now, 1));
  return {
    ...state,
    schedules: [...state.schedules, schedule],
    selectedScheduleId: id,
    schedulePreview: null,
    notice: `Agendamento ${id} criado somente na simulação para ${tenant.tenant.label}.`,
  };
}

export function confirmSimulationSchedulePreview(state: SimulationState): SimulationState {
  if (!state.schedulePreview) throw new Error('Não há pré-visualização de agendamento pendente.');
  return createSimulationSchedule(state, state.schedulePreview);
}

export function editSimulationSchedule(state: SimulationState, tenantId: SimulationTenantId, scheduleId: string, edit: SimulationScheduleEdit): SimulationState {
  const current = getSchedule(state, tenantId, scheduleId);
  assertProfileCanManageOwn(state, current, 'edit_schedule');
  if (current.status !== 'scheduled') throw new Error('Somente agendamentos scheduled podem ser editados.');
  const nextInput: SimulationScheduleInput = {
    tenantId,
    conversationId: current.conversationId,
    sourceType: edit.sourceType || current.sourceType,
    sourceId: edit.sourceId !== undefined ? edit.sourceId || undefined : current.sourceId,
    templateVersion: edit.templateVersion !== undefined ? edit.templateVersion : current.templateVersion,
    contentSnapshot: edit.contentSnapshot !== undefined ? edit.contentSnapshot : current.contentSnapshot,
    scheduledAt: edit.scheduledAt || current.scheduledAt,
    expiresAt: edit.expiresAt || current.expiresAt,
  };
  const valid = validateInput({ ...state, profileId: state.profileId }, nextInput);
  const key = idempotencyKey(valid);
  const duplicate = state.schedules.find(item => item.id !== scheduleId && item.tenantId === tenantId && item.idempotencyKey === key);
  if (duplicate) throw new Error('A edição produziria uma chave idempotente já utilizada.');
  const actor = actorName(state);
  const updated: SimulationSchedule = {
    ...current,
    sourceType: valid.sourceType,
    sourceId: valid.sourceId,
    templateVersion: valid.templateVersion,
    contentSnapshot: valid.contentSnapshot,
    scheduledAt: valid.scheduledAt,
    expiresAt: valid.expiresAt,
    idempotencyKey: key,
    updatedAt: state.clock.now,
    history: [...current.history, historyEntry(current, 'edited', 'Agendamento editado na simulação', actor, state.clock.now, current.history.length + 1)],
  };
  return withNotice({ ...state, schedules: state.schedules.map(item => item.id === scheduleId ? updated : item), schedulePreview: null }, `Agendamento ${scheduleId} editado na memória local.`);
}

export function cancelSimulationSchedule(state: SimulationState, tenantId: SimulationTenantId, scheduleId: string, reason = 'Cancelamento fictício solicitado'): SimulationState {
  const current = getSchedule(state, tenantId, scheduleId);
  assertProfileCanManageOwn(state, current, 'cancel_schedule');
  if (current.status === 'cancelled') return withNotice(state, 'Cancelamento repetido: o agendamento já estava cancelado.');
  if (current.status === 'completed' || current.status === 'expired' || current.status === 'failed') throw new Error('Este agendamento não pode mais ser cancelado.');
  const job = current.queueJobId ? state.queueJobs.find(item => item.id === current.queueJobId) : undefined;
  if (job?.status === 'processing' || job?.status === 'completed' || job?.status === 'failed') throw new Error('O trabalho da fila já iniciou ou terminou o processamento.');
  const actor = actorName(state);
  const updated = { ...current, status: 'cancelled' as const, cancelledAt: state.clock.now, cancelledBy: actor, cancellationReason: reason.trim() || 'Cancelamento fictício', updatedAt: state.clock.now, history: [...current.history, historyEntry(current, 'cancelled', 'Cancelado na simulação', actor, state.clock.now, current.history.length + 1)] };
  return withNotice({ ...state, schedules: state.schedules.map(item => item.id === scheduleId ? updated : item), queueJobs: state.queueJobs.map(item => item.id === current.queueJobId ? { ...item, status: 'cancelled' as const, cancelledAt: state.clock.now, updatedAt: state.clock.now } : item) }, `Agendamento ${scheduleId} cancelado na simulação.`);
}

function appendClockEvent(state: SimulationState, kind: SimulationClockEvent['kind'], from: string, to: string, label: string): SimulationState {
  const event: SimulationClockEvent = { id: `SIM-CLOCK-${state.clock.history.length + 1}`, kind, from, to, actor: actorName(state), label };
  return { ...state, clock: { ...state.clock, now: to, history: [...state.clock.history, event] } };
}

function evaluateStatesInternal(state: SimulationState): SimulationState {
  const now = new Date(state.clock.now).getTime();
  let schedules = state.schedules.map(schedule => {
    if (!['scheduled', 'queued'].includes(schedule.status)) return schedule;
    if (now > new Date(schedule.expiresAt).getTime()) {
      const history = schedule.status === 'expired' ? schedule.history : [...schedule.history, historyEntry(schedule, 'expired', 'Expirado na simulação', actorName(state), state.clock.now, schedule.history.length + 1)];
      return { ...schedule, status: 'expired' as const, updatedAt: state.clock.now, history };
    }
    return schedule;
  });
  let queueJobs = state.queueJobs.map(job => {
    const schedule = schedules.find(item => item.id === job.scheduleId);
    if (schedule?.status === 'expired' && ['pending', 'scheduled'].includes(job.status)) return { ...job, status: 'expired' as const, updatedAt: state.clock.now, failureReason: 'trabalho expirado' as const };
    return job;
  });
  schedules = schedules.map(schedule => {
    if (schedule.status !== 'scheduled' || now < new Date(schedule.scheduledAt).getTime() || now > new Date(schedule.expiresAt).getTime()) return schedule;
    const existing = queueJobs.find(job => job.scheduleId === schedule.id && ['pending', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'].includes(job.status));
    if (existing) return { ...schedule, status: 'queued' as const, queueJobId: existing.id, updatedAt: state.clock.now };
    const jobId = `SIM-JOB-${schedule.id}-A1`;
    const job: SimulationQueueJob = { id: jobId, tenantId: schedule.tenantId, scheduleId: schedule.id, conversationId: schedule.conversationId, messageLogicalId: schedule.messageLogicalId, status: 'pending', attempt: 1, idempotencyKey: `SIM-IDEM-JOB-${schedule.id}-A1`, scheduledAt: schedule.scheduledAt, availableAt: schedule.scheduledAt, expiresAt: schedule.expiresAt, createdBy: schedule.createdBy, createdAt: state.clock.now, updatedAt: state.clock.now };
    queueJobs = [...queueJobs, job];
    return { ...schedule, status: 'queued' as const, queueJobId: jobId, updatedAt: state.clock.now, history: [...schedule.history, historyEntry(schedule, 'queued', 'Enfileirado na simulação', actorName(state), state.clock.now, schedule.history.length + 1)] };
  });
  return { ...state, schedules, queueJobs };
}

export function updateSimulationStates(state: SimulationState): SimulationState {
  assertSimulationPermission(state.profileId, 'update_schedule_states');
  return withNotice(evaluateStatesInternal(state), 'Estados da simulação atualizados pelo relógio fictício.');
}

export function advanceSimulationClock(state: SimulationState, minutes: number): SimulationState {
  assertSimulationPermission(state.profileId, 'advance_clock');
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('O avanço do relógio deve ser um número inteiro positivo de minutos.');
  const from = state.clock.now;
  const to = new Date(new Date(from).getTime() + minutes * 60 * 1000).toISOString();
  return withNotice(evaluateStatesInternal(appendClockEvent(state, 'advanced', from, to, `Relógio avançado em ${minutes} minuto(s).`)), `Relógio fictício: ${formatSimulationDateTime(to)}.`);
}

export function setSimulationClock(state: SimulationState, value: string): SimulationState {
  assertSimulationPermission(state.profileId, 'advance_clock');
  const to = isoDateTime(value, 'Relógio simulado');
  const from = state.clock.now;
  if (to === from) return withNotice(state, 'O relógio fictício já está nesse horário.');
  return withNotice(evaluateStatesInternal(appendClockEvent(state, 'set', from, to, 'Relógio definido manualmente na simulação.')), `Relógio fictício: ${formatSimulationDateTime(to)}.`);
}

export function restoreSimulationClock(state: SimulationState): SimulationState {
  assertSimulationPermission(state.profileId, 'advance_clock');
  const from = state.clock.now;
  return withNotice(evaluateStatesInternal(appendClockEvent(state, 'restored', from, state.clock.initialAt, 'Relógio inicial restaurado na simulação.')), 'Relógio fictício restaurado ao horário inicial.');
}

function updateConversationForJob(state: SimulationState, schedule: SimulationSchedule): SimulationState {
  const tenant = getTenantData(state, schedule.tenantId);
  const conversation = assertConversationInTenant(state, schedule.tenantId, schedule.conversationId);
  if (conversation.messages.some(message => message.id === schedule.messageLogicalId)) return state;
  const message: SimulationMessage = {
    id: schedule.messageLogicalId,
    tenantId: schedule.tenantId,
    conversationId: schedule.conversationId,
    operationKey: `SIM-OP-SCHEDULE-${schedule.id}`,
    direction: 'outbound',
    body: schedule.contentSnapshot,
    status: 'simulated_processed',
    time: formatSimulationDateTime(state.clock.now),
    source: schedule.sourceType,
    quickReplyId: schedule.sourceType === 'quick_reply' ? schedule.sourceId : undefined,
    templateId: schedule.sourceType === 'template' ? schedule.sourceId : undefined,
    templateVersion: schedule.sourceType === 'template' ? schedule.templateVersion : undefined,
  };
  const nextConversation = {
    ...cloneConversation(conversation),
    preview: message.body,
    messages: [...conversation.messages, message],
    state: 'aguardando_contato' as const,
    scheduled: false,
    lastActivity: formatSimulationDateTime(state.clock.now),
    lastActivityOrder: conversation.lastActivityOrder + 1,
    history: [...conversation.history, createSyntheticHistoryEntry(conversation, schedule.tenantId, 'message_registered', 'Processado na simulação', actorName(state), formatSimulationDateTime(state.clock.now))],
  };
  return { ...state, tenants: { ...state.tenants, [schedule.tenantId]: { ...tenant, conversations: tenant.conversations.map(item => item.id === conversation.id ? nextConversation : item) } } };
}

export function processSimulationJob(state: SimulationState, tenantId: SimulationTenantId, jobId: string, outcome: SimulationQueueOutcome, failureReason: SimulationFailureReason = FAILURE_REASONS[0]): SimulationState {
  assertSimulationPermission(state.profileId, 'process_queue');
  assertActiveTenant(state, tenantId);
  if (!FAILURE_REASONS.includes(failureReason)) throw new Error('Motivo de falha fictício inválido.');
  const job = state.queueJobs.find(item => item.id === jobId && item.tenantId === tenantId);
  if (!job) throw new Error('Trabalho não pertence ao tenant sintético ativo.');
  if (job.status === 'completed') return withNotice(state, 'Processamento repetido: trabalho já concluído na simulação.');
  if (job.status === 'failed') return withNotice(state, 'Falha já encerrada; use Reprocessar falha na simulação.');
  if (!['pending', 'scheduled', 'processing'].includes(job.status)) throw new Error('Somente trabalhos pendentes ou processing podem ser processados.');
  const stateReady = evaluateStatesInternal(state);
  const readyJob = stateReady.queueJobs.find(item => item.id === jobId);
  const schedule = stateReady.schedules.find(item => item.id === readyJob?.scheduleId);
  if (!readyJob || !schedule) throw new Error('Agendamento ou trabalho não encontrado.');
  if (schedule.status === 'cancelled' || readyJob.status === 'cancelled') throw new Error('Trabalho cancelado não pode ser processado.');
  if (schedule.status === 'expired' || readyJob.status === 'expired') throw new Error('Trabalho expirado não pode ser processado.');
  const processing = readyJob.status === 'processing' ? readyJob : { ...readyJob, status: 'processing' as const, claimedAt: state.clock.now, processingAt: state.clock.now, updatedAt: state.clock.now };
  let next: SimulationState = { ...stateReady, queueJobs: stateReady.queueJobs.map(item => item.id === readyJob.id ? processing : item) };
  if (outcome === 'failure') {
    const failed = { ...processing, status: 'failed' as const, failedAt: state.clock.now, failureReason, updatedAt: state.clock.now };
    const failedSchedule = { ...schedule, status: 'failed' as const, updatedAt: state.clock.now, history: [...schedule.history, historyEntry(schedule, 'failed', 'Falhou na simulação', actorName(state), state.clock.now, schedule.history.length + 1)] };
    return withNotice({ ...next, queueJobs: next.queueJobs.map(item => item.id === readyJob.id ? failed : item), schedules: next.schedules.map(item => item.id === schedule.id ? failedSchedule : item) }, `Trabalho ${readyJob.id} falhou na simulação: ${failureReason}.`);
  }
  const completed = { ...processing, status: 'completed' as const, completedAt: state.clock.now, updatedAt: state.clock.now };
  const completedSchedule = { ...schedule, status: 'completed' as const, updatedAt: state.clock.now, history: [...schedule.history, historyEntry(schedule, 'completed', 'Processado na simulação', actorName(state), state.clock.now, schedule.history.length + 1)] };
  next = { ...next, queueJobs: next.queueJobs.map(item => item.id === readyJob.id ? completed : item), schedules: next.schedules.map(item => item.id === schedule.id ? completedSchedule : item) };
  next = updateConversationForJob(next, completedSchedule);
  return withNotice(next, `Trabalho ${readyJob.id} processado com sucesso na simulação.`);
}

export function claimSimulationJob(state: SimulationState, tenantId: SimulationTenantId, jobId: string): SimulationState {
  assertSimulationPermission(state.profileId, 'process_queue');
  assertActiveTenant(state, tenantId);
  const job = state.queueJobs.find(item => item.id === jobId && item.tenantId === tenantId);
  if (!job) throw new Error('Trabalho não pertence ao tenant sintético ativo.');
  if (job.status === 'processing') return withNotice(state, 'Trabalho já está processing na simulação.');
  if (!['pending', 'scheduled'].includes(job.status)) throw new Error('Somente trabalhos pendentes podem entrar em processing.');
  const schedule = state.schedules.find(item => item.id === job.scheduleId && item.tenantId === tenantId);
  if (!schedule || schedule.status === 'cancelled' || schedule.status === 'expired') throw new Error('Agendamento não é elegível para processing.');
  const processing = { ...job, status: 'processing' as const, claimedAt: state.clock.now, processingAt: state.clock.now, updatedAt: state.clock.now };
  return withNotice({ ...state, queueJobs: state.queueJobs.map(item => item.id === job.id ? processing : item) }, `Trabalho ${job.id} está processing na simulação.`);
}

export function processNextSimulationJob(state: SimulationState, tenantId: SimulationTenantId, outcome: SimulationQueueOutcome = 'success', failureReason: SimulationFailureReason = FAILURE_REASONS[0]): SimulationState {
  assertSimulationPermission(state.profileId, 'process_queue');
  const next = evaluateStatesInternal(state);
  const job = next.queueJobs.filter(item => item.tenantId === tenantId && ['pending', 'scheduled'].includes(item.status)).sort((a, b) => a.availableAt.localeCompare(b.availableAt))[0];
  if (!job) return withNotice(next, 'Não há trabalho elegível na fila da simulação.');
  return processSimulationJob(next, tenantId, job.id, outcome, failureReason);
}

export function reprocessSimulationJob(state: SimulationState, tenantId: SimulationTenantId, jobId: string): SimulationState {
  assertSimulationPermission(state.profileId, 'reprocess_queue');
  assertActiveTenant(state, tenantId);
  const job = state.queueJobs.find(item => item.id === jobId && item.tenantId === tenantId);
  if (!job) throw new Error('Trabalho não pertence ao tenant sintético ativo.');
  if (job.status !== 'failed') throw new Error('Somente trabalhos failed podem ser reprocessados.');
  const schedule = state.schedules.find(item => item.id === job.scheduleId && item.tenantId === tenantId);
  const existing = state.queueJobs.find(item => item.previousJobId === job.id);
  if (existing) return { ...state, selectedQueueJobId: existing.id, notice: 'Reprocessamento repetido: a nova tentativa já existe na simulação.' };
  if (!schedule || schedule.status !== 'failed') throw new Error('O agendamento precisa estar failed para reprocessar.');
  if (new Date(state.clock.now).getTime() > new Date(schedule.expiresAt).getTime()) throw new Error('Trabalho expirado não pode ser reprocessado.');
  const attempt = job.attempt + 1;
  const newJob: SimulationQueueJob = { ...job, id: `SIM-JOB-${schedule.id}-A${attempt}`, status: 'pending', attempt, idempotencyKey: `SIM-IDEM-JOB-${schedule.id}-A${attempt}`, previousJobId: job.id, claimedAt: undefined, processingAt: undefined, completedAt: undefined, failedAt: undefined, cancelledAt: undefined, failureReason: undefined, createdAt: state.clock.now, updatedAt: state.clock.now };
  const updatedSchedule = { ...schedule, status: 'queued' as const, queueJobId: newJob.id, updatedAt: state.clock.now, history: [...schedule.history, historyEntry(schedule, 'reprocessed', 'Reprocessado na simulação', actorName(state), state.clock.now, schedule.history.length + 1)] };
  return withNotice({ ...state, queueJobs: [...state.queueJobs, newJob], schedules: state.schedules.map(item => item.id === schedule.id ? updatedSchedule : item), selectedQueueJobId: newJob.id }, `Nova tentativa ${newJob.id} criada na simulação.`);
}

export function validateSimulationFailureReason(reason: string): SimulationFailureReason {
  if (!FAILURE_REASONS.includes(reason as SimulationFailureReason)) throw new Error('Motivo de falha fictício inválido.');
  return reason as SimulationFailureReason;
}

export function selectSimulationSchedule(state: SimulationState, tenantId: SimulationTenantId, scheduleId: string): SimulationState {
  assertSimulationPermission(state.profileId, 'view_schedules');
  const schedule = getSchedule(state, tenantId, scheduleId);
  return { ...state, selectedScheduleId: schedule.id };
}

export function selectSimulationQueueJob(state: SimulationState, tenantId: SimulationTenantId, jobId: string): SimulationState {
  assertSimulationPermission(state.profileId, 'view_queue');
  assertActiveTenant(state, tenantId);
  const job = state.queueJobs.find(item => item.id === jobId && item.tenantId === tenantId);
  if (!job) throw new Error('Trabalho não pertence ao tenant sintético ativo.');
  return { ...state, selectedQueueJobId: job.id };
}

export function setSimulationScheduleFilters(state: SimulationState, tenantId: SimulationTenantId, filters: Partial<SimulationState['scheduleFilters']>): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, scheduleFilters: { ...state.scheduleFilters, ...filters } };
}

export function clearSimulationScheduleFilters(state: SimulationState, tenantId: SimulationTenantId): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, scheduleFilters: { ...EMPTY_SCHEDULE_FILTERS } };
}

export function setSimulationQueueFilters(state: SimulationState, tenantId: SimulationTenantId, filters: Partial<SimulationState['queueFilters']>): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, queueFilters: { ...state.queueFilters, ...filters } };
}

export function clearSimulationQueueFilters(state: SimulationState, tenantId: SimulationTenantId): SimulationState {
  assertActiveTenant(state, tenantId);
  return { ...state, queueFilters: { ...EMPTY_QUEUE_FILTERS } };
}

export function setSimulationScheduleDraft(state: SimulationState, draft: SimulationState['scheduleDraft'], editingId = ''): SimulationState {
  if (draft) assertSimulationPermission(state.profileId, editingId ? 'edit_schedule' : 'create_schedule');
  return { ...state, scheduleDraft: draft, scheduleEditingId: draft ? editingId : '', schedulePreview: null };
}

export { FAILURE_REASONS };
