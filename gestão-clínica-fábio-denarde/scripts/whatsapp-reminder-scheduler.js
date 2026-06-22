import cron from 'node-cron';
import path from 'node:path';
import { JsonReminderLedger, ROUTINE_DEFINITIONS, createRoutineCheckpointId, createRoutineWindow, detectMissedRoutineCheckpoints, formatLocalDateStr, isGlobalActivationLocked, resolveWhatsappOperationMode, WHATSAPP_OPERATION_MODES } from '../src/lib/whatsappReminderOperations.js';

const PROCESS_NAME = 'RoboClinicaScheduler';
const TIMEZONE = 'America/Sao_Paulo';
const HEARTBEAT_INTERVAL_MS = Number(process.env.WHATSAPP_HEARTBEAT_INTERVAL_MS || 5 * 60 * 1000);
const mode = resolveWhatsappOperationMode();
const ledger = new JsonReminderLedger();

function reconcileSchedulerAlert(scope, incidents = []) {
  return ledger.reconcileTechnicalAlerts({
    scope,
    incidents: incidents.map(incident => ({
      ...incident,
      process: PROCESS_NAME,
    })),
    now: new Date(),
  });
}

function recordHeartbeat(extra = {}) {
  ledger.appendHeartbeat({
    process: PROCESS_NAME,
    pid: process.pid,
    mode,
    schedulerRegistered: true,
    whatsappReady: false,
    scriptPath: path.resolve('scripts/whatsapp-reminder-scheduler.js'),
    ...extra,
  });
}

function queueRoutine(routine, now = new Date()) {
  if (isGlobalActivationLocked()) {
    console.log(`[${PROCESS_NAME}] trava global ativa; rotina ${routine} não será enfileirada.`);
    return null;
  }
  const dateStr = formatLocalDateStr(now);
  const definition = ROUTINE_DEFINITIONS[routine];
  if (!definition) throw new Error(`Rotina desconhecida: ${routine}`);
  if (definition.skipWeekdays.includes(now.getDay())) {
    console.log(`[${PROCESS_NAME}] rotina ${routine} pulada pela regra semanal em ${dateStr}.`);
    return null;
  }

  const window = createRoutineWindow({ dateStr, routine });
  const checkpointId = createRoutineCheckpointId({ dateStr, routine });

  if (mode === WHATSAPP_OPERATION_MODES.DISABLED || mode === WHATSAPP_OPERATION_MODES.DRY_RUN) {
    return ledger.upsertCheckpoint(checkpointId, {
      date: dateStr,
      routine,
      scheduledTime: window.scheduledTime,
      expectedWindowStart: window.start,
      expectedWindowEnd: window.end,
      status: 'skipped',
      blockedReason: `modo operacional ${mode}: enfileiramento real bloqueado`,
    });
  }

  const queued = ledger.queueRoutine(checkpointId, {
    date: dateStr,
    routine,
    scheduledTime: window.scheduledTime,
    expectedWindowStart: window.start,
    expectedWindowEnd: window.end,
    plannedCount: 0,
    confirmedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    source: 'scheduler',
  });
  console.log(`[${PROCESS_NAME}] rotina ${routine} enfileirada para ${dateStr} ${window.scheduledTime}.`);
  return queued;
}

function queuePreventivePreview(routine, now = new Date()) {
  if (isGlobalActivationLocked()) {
    console.log(`[${PROCESS_NAME}] trava global ativa; prévia ${routine} não será enfileirada.`);
    return null;
  }
  const dateStr = formatLocalDateStr(now);
  const definition = ROUTINE_DEFINITIONS[routine];
  if (!definition) throw new Error(`Rotina desconhecida: ${routine}`);
  if (definition.skipWeekdays.includes(now.getDay())) return null;

  const window = createRoutineWindow({ dateStr, routine });
  const notificationId = `admin-preview:${dateStr}:${routine}`;

  if (mode === WHATSAPP_OPERATION_MODES.DISABLED || mode === WHATSAPP_OPERATION_MODES.DRY_RUN) {
    return ledger.updateAdminNotification(notificationId, {
      type: 'preventive-preview',
      date: dateStr,
      routine,
      scheduledAt: window.start,
      status: 'skipped',
      blockedReason: `modo operacional ${mode}: prévia administrativa real bloqueada`,
      source: PROCESS_NAME,
    });
  }

  return ledger.queueAdminNotification(notificationId, {
    type: 'preventive-preview',
    date: dateStr,
    routine,
    scheduledAt: window.start,
    source: PROCESS_NAME,
  });
}

function registerRoutineCron(routine) {
  const definition = ROUTINE_DEFINITIONS[routine];
  const [hour, minute] = definition.scheduledTime.split(':');
  const expression = `${Number(minute)} ${Number(hour)} * * *`;
  cron.schedule(expression, () => {
    try {
      queueRoutine(routine, new Date());
      reconcileSchedulerAlert(`scheduler-routine:${routine}`, []);
    } catch (error) {
      ledger.appendIncident({
        type: 'scheduler-error',
        severity: 'high',
        process: PROCESS_NAME,
        routine,
        message: error?.message || String(error),
      });
      reconcileSchedulerAlert(`scheduler-routine:${routine}`, [{
        type: 'scheduler-runtime-error',
        severity: 'high',
        routine,
        stateCode: 'routine-queue-error',
        message: 'Falha ao enfileirar uma rotina de lembretes.',
      }]);
      console.error(`[${PROCESS_NAME}] erro ao enfileirar ${routine}:`, error);
    }
  }, { timezone: TIMEZONE });
  console.log(`[${PROCESS_NAME}] cron registrado: ${routine} -> ${expression} (${TIMEZONE}).`);

  const [previewHour, previewMinute] = definition.preventiveTime.split(':');
  const previewExpression = `${Number(previewMinute)} ${Number(previewHour)} * * *`;
  cron.schedule(previewExpression, () => {
    try {
      queuePreventivePreview(routine, new Date());
      reconcileSchedulerAlert(`scheduler-preview:${routine}`, []);
    } catch (error) {
      ledger.appendIncident({
        type: 'scheduler-preview-error',
        severity: 'high',
        process: PROCESS_NAME,
        routine,
        message: error?.message || String(error),
      });
      reconcileSchedulerAlert(`scheduler-preview:${routine}`, [{
        type: 'scheduler-runtime-error',
        severity: 'high',
        routine,
        stateCode: 'preview-queue-error',
        message: 'Falha ao enfileirar a prévia administrativa.',
      }]);
      console.error(`[${PROCESS_NAME}] erro ao enfileirar prévia ${routine}:`, error);
    }
  }, { timezone: TIMEZONE });
  console.log(`[${PROCESS_NAME}] prévia registrada: ${routine} -> ${previewExpression} (${TIMEZONE}).`);
}

function recordStartupMissedRoutines() {
  for (const incident of detectMissedRoutineCheckpoints({ ledger, lookbackDays: 2 })) {
    ledger.appendIncident({
      ...incident,
      process: PROCESS_NAME,
      message: `${incident.message} Catch-up automático bloqueado.`,
    });
    console.error(`[${PROCESS_NAME}] ${incident.message} Catch-up automático bloqueado.`);
  }
}

if (process.argv.includes('--self-check')) {
  recordHeartbeat({ event: 'self-check' });
  const dateStr = formatLocalDateStr(new Date());
  const id = `self-check:${dateStr}:${process.pid}`;
  ledger.upsertCheckpoint(id, {
    date: dateStr,
    routine: 'SELF_CHECK',
    status: 'completed',
    completedAt: new Date().toISOString(),
    source: PROCESS_NAME,
  });
  console.log(`[${PROCESS_NAME}] self-check concluído em modo ${mode}.`);
  process.exit(0);
}

recordStartupMissedRoutines();
for (const routine of Object.keys(ROUTINE_DEFINITIONS)) registerRoutineCron(routine);
recordHeartbeat({ event: 'startup' });
setInterval(recordHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
