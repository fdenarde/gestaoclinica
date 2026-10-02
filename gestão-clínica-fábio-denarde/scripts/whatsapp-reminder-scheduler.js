import cron from 'node-cron';
import path from 'node:path';
import { DEFAULT_SCHEDULER_RECOVERY_DELAY_MS, JsonReminderLedger, ROUTINE_DEFINITIONS, createMemoryReminderLedger, createRoutineCheckpointId, createRoutineWindow, detectMissedRoutineCheckpoints, findRecoverableRoutineCheckpoints, formatLocalDateStr, isGlobalActivationLocked, resolveWhatsappOperationMode, WHATSAPP_OPERATION_MODES } from '../src/lib/whatsappReminderOperations.js';
import { initializeFirebaseAdmin } from '../src/lib/whatsappReminderRuntime.js';
import { addReminderCalendarDays, collectDueCustomReminderSlots, getSaoPauloReminderClock } from '../src/lib/whatsappCustomSchedule.js';

const PROCESS_NAME = 'RoboClinicaScheduler';
const TIMEZONE = 'America/Sao_Paulo';
const HEARTBEAT_INTERVAL_MS = Number(process.env.WHATSAPP_HEARTBEAT_INTERVAL_MS || 5 * 60 * 1000);
const RECOVERY_INTERVAL_MS = Number(process.env.WHATSAPP_SCHEDULER_RECOVERY_INTERVAL_MS || 60 * 1000);
const RECOVERY_DELAY_MS = Number(process.env.WHATSAPP_SCHEDULER_RECOVERY_DELAY_MS || DEFAULT_SCHEDULER_RECOVERY_DELAY_MS);
const mode = resolveWhatsappOperationMode();
const isSelfCheck = process.argv.includes('--self-check');
const ledger = isSelfCheck ? createMemoryReminderLedger() : new JsonReminderLedger();

function safeLedgerCall(label, operation, fallback = null) {
  try {
    return operation();
  } catch (error) {
    console.error(`[${PROCESS_NAME}] falha não fatal no ledger (${label}):`, error?.message || error);
    return fallback;
  }
}

function recordIncident(incident) {
  return safeLedgerCall('append-incident', () => ledger.appendIncident(incident));
}

function reconcileSchedulerAlert(scope, incidents = []) {
  return safeLedgerCall('reconcile-technical-alerts', () => ledger.reconcileTechnicalAlerts({
    scope,
    incidents: incidents.map(incident => ({
      ...incident,
      process: PROCESS_NAME,
    })),
    now: new Date(),
  }), { queued: [], suppressed: [], resolved: [] });
}

function recordHeartbeat(extra = {}) {
  return safeLedgerCall('heartbeat', () => ledger.appendHeartbeat({
    process: PROCESS_NAME,
    pid: process.pid,
    mode,
    schedulerRegistered: true,
    whatsappReady: false,
    scriptPath: path.resolve('scripts/whatsapp-reminder-scheduler.js'),
    ...extra,
  }));
}

function queueRoutine(routine, now = new Date(), { source = 'scheduler', recoveredAt = '', scheduledTime = '', customOnly = false, accountIds = [] } = {}) {
  if (customOnly && (accountIds.length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(accountIds[0]))) {
    throw new Error('Conta do horário personalizado inválida.');
  }
  if (isGlobalActivationLocked()) {
    console.log(`[${PROCESS_NAME}] trava global ativa; rotina ${routine} não será enfileirada.`);
    return null;
  }
  const dateStr = customOnly ? getSaoPauloReminderClock(now).date : formatLocalDateStr(now);
  const definition = ROUTINE_DEFINITIONS[routine];
  if (!definition) throw new Error(`Rotina desconhecida: ${routine}`);
  const weekday = customOnly ? new Date(`${dateStr}T12:00:00Z`).getUTCDay() : now.getDay();
  if (definition.skipWeekdays.includes(weekday)) {
    console.log(`[${PROCESS_NAME}] rotina ${routine} pulada pela regra semanal em ${dateStr}.`);
    return null;
  }

  const window = createRoutineWindow({ dateStr, routine, scheduledTime });
  const checkpointId = createRoutineCheckpointId({ dateStr, routine,
    accountId: customOnly ? accountIds[0] : 'all', scheduledTime: customOnly ? scheduledTime : '' });

  if (mode === WHATSAPP_OPERATION_MODES.DISABLED || mode === WHATSAPP_OPERATION_MODES.DRY_RUN) {
    return ledger.upsertCheckpoint(checkpointId, {
      date: dateStr,
      routine,
      customOnly,
      accountIds: customOnly ? accountIds : undefined,
      scheduledTime: window.scheduledTime,
      expectedWindowStart: window.start,
      expectedWindowEnd: window.end,
      status: 'skipped',
      blockedReason: `modo operacional ${mode}: enfileiramento real bloqueado`,
      source,
      recoveredAt: recoveredAt || undefined,
    });
  }

  const queued = ledger.queueRoutine(checkpointId, {
    date: dateStr,
    routine,
    customOnly,
    accountIds: customOnly ? accountIds : undefined,
    scheduledTime: window.scheduledTime,
    expectedWindowStart: window.start,
    expectedWindowEnd: window.end,
    plannedCount: 0,
    confirmedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    source,
  });
  const suffix = source === 'scheduler-safe-window-recovery'
    ? ' por recuperação dentro da janela segura'
    : '';
  console.log(`[${PROCESS_NAME}] rotina ${routine} enfileirada para ${dateStr} ${window.scheduledTime}${suffix}.`);
  return queued;
}

// The existing scheduler keeps one minute cron. Firestore listeners update a
// small in-memory schedule; there is no per-patient timer or per-minute read.
function startCustomScheduleWatch() {
  const db = initializeFirebaseAdmin();
  const accounts = new Map();
  const stopAccount = account => {
    account.patientUnsubscribe?.();
    for (const item of account.sessions.values()) item.unsubscribe();
  };
  const watchDates = (account, dateKey) => {
    const required = [0, 1, 2].map(offset => addReminderCalendarDays(dateKey, offset));
    for (const [date, item] of account.sessions) {
      if (!required.includes(date)) { item.unsubscribe(); account.sessions.delete(date); }
    }
    for (const date of required) {
      if (account.sessions.has(date)) continue;
      const item = { ready: false, rows: [], unsubscribe: () => {} };
      account.sessions.set(date, item);
      item.unsubscribe = db.collection(`users/${account.id}/sessions`).where('date', '==', date).onSnapshot(
        snapshot => { item.rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); item.ready = true; },
        () => { item.rows = []; item.ready = false; console.error(`[${PROCESS_NAME}] observação de sessões personalizadas indisponível; horários customizados bloqueados.`); },
      );
    }
  };
  const watchAccount = id => {
    const account = { id, patients: [], patientReady: false, patientUnsubscribe: null, sessions: new Map() };
    accounts.set(id, account);
    account.patientUnsubscribe = db.collection(`users/${id}/patients`).onSnapshot(
      snapshot => { account.patients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); account.patientReady = true; },
      () => { account.patients = []; account.patientReady = false; console.error(`[${PROCESS_NAME}] observação de preferências indisponível; horários customizados bloqueados.`); },
    );
    watchDates(account, getSaoPauloReminderClock().date);
  };
  db.collectionGroup('settings').onSnapshot(
    snapshot => {
      const ids = new Set(snapshot.docs.map(doc => doc.ref.parent.parent?.id).filter(Boolean));
      for (const [id, account] of accounts) {
        if (!ids.has(id)) { stopAccount(account); accounts.delete(id); }
      }
      for (const id of ids) if (!accounts.has(id)) {
        try { watchAccount(id); }
        catch { const account = accounts.get(id); if (account) stopAccount(account); accounts.delete(id);
          console.error(`[${PROCESS_NAME}] configuração de horário personalizado indisponível para uma conta.`); }
      }
    },
    () => { for (const account of accounts.values()) stopAccount(account); accounts.clear();
      console.error(`[${PROCESS_NAME}] lista de contas indisponível; horários customizados bloqueados.`); },
  );
  cron.schedule('* * * * *', () => {
    const now = new Date();
    const clock = getSaoPauloReminderClock(now);
    const due = new Map();
    // The small in-memory lookback covers listener startup or a brief reconnect.
    // A slot is never queued after its safe window and never requeues a checkpoint.
    for (let minutesBack = 0; minutesBack < 5; minutesBack += 1) {
      const candidateTime = new Date(now.getTime() - minutesBack * 60_000);
      const candidateClock = getSaoPauloReminderClock(candidateTime);
      for (const account of accounts.values()) {
        const tomorrow = addReminderCalendarDays(candidateClock.date, 1);
        const todayRows = account.sessions.get(candidateClock.date);
        const tomorrowRows = account.sessions.get(tomorrow);
        if (!account.patientReady || !todayRows?.ready || !tomorrowRows?.ready) continue;
        const sessions = [...todayRows.rows, ...tomorrowRows.rows];
        try {
          for (const slot of collectDueCustomReminderSlots({ patients: account.patients, sessions, now: candidateTime })) {
            const window = createRoutineWindow({ dateStr: candidateClock.date, routine: slot.routine, scheduledTime: slot.scheduledTime });
            if (new Date(window.end).getTime() <= now.getTime()) continue;
            const key = `${account.id}:${candidateClock.date}:${slot.routine}:${slot.scheduledTime}`;
            due.set(key, { ...slot, candidateTime, date: candidateClock.date, accountIds: [account.id] });
          }
        } catch { console.error(`[${PROCESS_NAME}] leitura em memória de horários personalizados indisponível.`); }
      }
    }
    for (const slot of due.values()) {
      const checkpointId = createRoutineCheckpointId({ dateStr: slot.date, routine: slot.routine,
        accountId: slot.accountIds[0], scheduledTime: slot.scheduledTime });
      if (ledger.getCheckpoint(checkpointId)) continue;
      try { queueRoutine(slot.routine, slot.candidateTime, { source: 'scheduler-custom', scheduledTime: slot.scheduledTime,
        customOnly: true, accountIds: slot.accountIds }); }
      catch (error) { console.error(`[${PROCESS_NAME}] falha ao enfileirar horário personalizado:`, error); }
    }
    for (const account of accounts.values()) {
      try { watchDates(account, clock.date); }
      catch { account.patientReady = false; console.error(`[${PROCESS_NAME}] atualização de horários personalizados indisponível.`); }
    }
  }, { timezone: TIMEZONE });
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
      expectedWindowEnd: window.end,
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
    expectedWindowEnd: window.end,
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
      recordIncident({
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
      recordIncident({
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
    recordIncident({
      ...incident,
      process: PROCESS_NAME,
      message: `${incident.message} Catch-up automático bloqueado.`,
    });
    console.error(`[${PROCESS_NAME}] ${incident.message} Catch-up automático bloqueado.`);
  }
}

function recoverRoutinesWithinSafeWindow(now = new Date()) {
  if (isGlobalActivationLocked()) return [];

  const candidates = safeLedgerCall(
    'safe-window-recovery-scan',
    () => findRecoverableRoutineCheckpoints({
      ledger,
      now,
      recoveryDelayMs: RECOVERY_DELAY_MS,
    }),
    [],
  ) || [];

  const recovered = [];
  for (const candidate of candidates) {
    try {
      const queued = queueRoutine(candidate.routine, now, {
        source: 'scheduler-safe-window-recovery',
        recoveredAt: now.toISOString(),
      });
      if (queued?.status === 'queued') recovered.push(queued);
    } catch (error) {
      recordIncident({
        type: 'scheduler-recovery-error',
        severity: 'high',
        process: PROCESS_NAME,
        routine: candidate.routine,
        date: candidate.date,
        message: error?.message || String(error),
      });
      reconcileSchedulerAlert(`scheduler-recovery:${candidate.routine}`, [{
        type: 'scheduler-runtime-error',
        severity: 'high',
        routine: candidate.routine,
        date: candidate.date,
        stateCode: 'safe-window-recovery-error',
        message: 'Falha ao recuperar uma rotina dentro da janela segura.',
      }]);
      console.error(`[${PROCESS_NAME}] erro na recuperação segura de ${candidate.routine}:`, error);
    }
  }

  return recovered;
}

if (isSelfCheck) {
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

  const snapshot = ledger.read();
  const isolatedHeartbeat = snapshot.heartbeats.some(item => item.process === PROCESS_NAME && item.event === 'self-check');
  const isolatedCheckpoint = snapshot.checkpoints[id]?.status === 'completed';
  if (!isolatedHeartbeat || !isolatedCheckpoint) {
    throw new Error('Self-check isolado do scheduler não produziu as evidências esperadas em memória.');
  }

  console.log(`[${PROCESS_NAME}] self-check concluído em ambiente isolado; ledger operacional preservado.`);
  process.exit(0);
}

recordStartupMissedRoutines();
for (const routine of Object.keys(ROUTINE_DEFINITIONS)) registerRoutineCron(routine);
if (mode === WHATSAPP_OPERATION_MODES.LIVE) {
  try { startCustomScheduleWatch(); }
  catch { console.error(`[${PROCESS_NAME}] horários personalizados indisponíveis; rotinas padrão preservadas.`); }
}
recordHeartbeat({ event: 'startup' });
recoverRoutinesWithinSafeWindow(new Date());
setInterval(recordHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
setInterval(() => recoverRoutinesWithinSafeWindow(new Date()), RECOVERY_INTERVAL_MS).unref();
