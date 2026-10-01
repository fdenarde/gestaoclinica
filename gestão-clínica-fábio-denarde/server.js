import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import path from 'node:path';
import {
  buildExecutionReportData,
  formatExecutionReportMessage,
  buildPreventiveAlertMessage,
  buildPlanSnapshot,
  comparePlanSnapshots,
  createExecutionAudit,
  finishExecutionAudit,
  getAdminReportConfig,
  registerAgendaChanges,
  registerPlanDiagnostics,
  registerRuntimeSkip,
  registerSendFailure,
  registerSuccessfulSend,
} from './src/lib/whatsappAdminMonitor.js';
import { JsonReminderLedger, buildRoutineDeliveryAccounting, createReminderDeliveryService, isGlobalActivationLocked, resolveWhatsappOperationMode, shouldInitializeWhatsappClient, WHATSAPP_OPERATION_MODES } from './src/lib/whatsappReminderOperations.js';
import { buildReminderPlanContexts, initializeFirebaseAdmin } from './src/lib/whatsappReminderRuntime.js';
import { loadWhatsappReminderSuppressions } from './src/lib/whatsappReminderSuppressionStore.js';
import { isWhatsappAutomationBlocked } from './shared/whatsappSessionAutomation.js';
import { emitFirestoreMetric } from './api/_lib/firestoreDiagnostics.js';
import {
  buildSanitizedTechnicalAlertSnapshot,
  buildTechnicalAlertSnapshotHash,
  saveDailyWhatsappOperationalReport,
  saveDailyWhatsappTechnicalAlertSnapshot,
} from './src/lib/whatsappOperationalReportRepository.js';
import {
  WHATSAPP_OPERATIONAL_STATES,
  WHATSAPP_ROBOT_NAME,
  WHATSAPP_ROBOT_VERSION,
  WHATSAPP_RUNTIME_PATHS,
  WhatsappOperationalController,
  acquireSingleInstanceLock,
  checkNetworkReadiness,
  computeProgressiveBackoff,
  getDiskHealth,
  inspectSessionDirectory,
  isSessionInvalidReason,
} from './src/lib/whatsappOperationalRuntime.js';

const SENDER_NAME = 'RoboClinica';
const POLL_INTERVAL_MS = Number(process.env.WHATSAPP_SENDER_POLL_INTERVAL_MS || 15000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WHATSAPP_HEARTBEAT_INTERVAL_MS || 5 * 60 * 1000);
const READY_TIMEOUT_MS = Number(process.env.WHATSAPP_SENDER_READY_TIMEOUT_MS || 60 * 1000);
const mode = resolveWhatsappOperationMode();
const shouldInitializeWhatsapp = shouldInitializeWhatsappClient(mode);
const ledger = new JsonReminderLedger();
const db = initializeFirebaseAdmin();
const suppressions = loadWhatsappReminderSuppressions();
const operationalController = new WhatsappOperationalController();

let whatsappReady = false;
let whatsappQrBlocked = false;
let client = null;
let instanceLock = null;
let recoveryTimer = null;
let readyTimer = null;
let recoveryInProgress = false;
let shuttingDown = false;
let processing = false;
let processingAdmin = false;
let syncingTechnicalAlerts = false;
let lastTechnicalAlertSnapshotHash = '';
const TECHNICAL_ALERT_SYNC_INTERVAL_MS = Number(process.env.WHATSAPP_TECHNICAL_ALERT_SYNC_INTERVAL_MS || 60 * 1000);

console.log(`[${SENDER_NAME}] ${WHATSAPP_ROBOT_NAME}; modo operacional: ${mode}.`);
console.log(`[${SENDER_NAME}] scheduler externo obrigatório; este processo não registra cron.`);

function safeLedgerCall(label, operation, fallback = null) {
  try {
    return operation();
  } catch (error) {
    console.error(`[${SENDER_NAME}] falha não fatal no ledger (${label}):`, error?.message || error);
    return fallback;
  }
}

function recordIncident(incident) {
  return safeLedgerCall('append-incident', () => ledger.appendIncident(incident));
}

function recordHeartbeat(extra = {}) {
  const runtime = operationalController.snapshot();
  return safeLedgerCall('heartbeat', () => ledger.appendHeartbeat({
    process: SENDER_NAME,
    pid: process.pid,
    mode,
    robotVersion: WHATSAPP_ROBOT_VERSION,
    operationalState: runtime.operationalState,
    operationalStateSince: runtime.updatedAt,
    circuitBreaker: runtime.circuitBreaker,
    whatsappReady,
    qrBlocked: whatsappQrBlocked,
    schedulerRegistered: false,
    scriptPath: path.resolve('./server.js'),
    ...extra,
  }));
}

function reconcileTechnicalIncidents(scope, incidents = []) {
  try {
    return ledger.reconcileTechnicalAlerts({
      scope,
      incidents: incidents.map(incident => ({
        ...incident,
        process: incident.process || SENDER_NAME,
      })),
      now: new Date(),
    });
  } catch (error) {
    console.error(`[${SENDER_NAME}] falha ao reconciliar alerta técnico:`, error?.message || error);
    return { queued: [], suppressed: [], resolved: [] };
  }
}

function queueSenderTechnicalAlert(scope, incident) {
  return reconcileTechnicalIncidents(scope, [incident]);
}

function resolveSenderTechnicalAlert(scope) {
  return reconcileTechnicalIncidents(scope, []);
}

async function syncTechnicalAlertsToOperationalReport() {
  if (syncingTechnicalAlerts) return null;

  const ledgerData = safeLedgerCall('read-technical-alert-snapshot', () => ledger.read(), null);
  if (!ledgerData) return null;

  const technicalAlerts = buildSanitizedTechnicalAlertSnapshot(ledgerData, {
    updatedAt: new Date(),
  });
  const snapshotHash = buildTechnicalAlertSnapshotHash(technicalAlerts);
  if (technicalAlerts.length === 0 && !lastTechnicalAlertSnapshotHash) {
    emitFirestoreMetric({ source: 'whatsapp-write', operation: 'technicalSnapshot', event: 'skipped', attempted: false, persisted: false, skippedSameHash: true, reason: 'empty' });
    return null;
  }
  if (snapshotHash === lastTechnicalAlertSnapshotHash) {
    emitFirestoreMetric({ source: 'whatsapp-write', operation: 'technicalSnapshot', event: 'skipped', attempted: false, persisted: false, skippedSameHash: true, reason: 'same-hash' });
    return null;
  }

  syncingTechnicalAlerts = true;
  try {
    emitFirestoreMetric({ source: 'whatsapp-write', operation: 'technicalSnapshot', event: 'attempt', attempted: true, persisted: false, skippedSameHash: false });
    const persisted = await saveDailyWhatsappTechnicalAlertSnapshot({
      db,
      ledgerData,
      updatedAt: new Date(),
    });
    lastTechnicalAlertSnapshotHash = persisted.snapshotHash;
    emitFirestoreMetric({ source: 'whatsapp-write', operation: 'technicalSnapshot', event: 'completed', attempted: true, persisted: true, skippedSameHash: false });
    console.log(`[ADMIN REPORT] alertas técnicos sanitizados sincronizados em ${persisted.path}.`);
    return persisted;
  } catch (error) {
    emitFirestoreMetric({ source: 'whatsapp-write', operation: 'technicalSnapshot', event: 'failed', attempted: true, persisted: false, skippedSameHash: false });
    recordIncident({
      type: 'technical-alert-report-persistence-error',
      severity: 'medium',
      process: SENDER_NAME,
      message: error?.message || String(error),
    });
    console.error(`[${SENDER_NAME}] falha ao persistir alertas técnicos sanitizados:`, error?.message || error);
    return null;
  } finally {
    syncingTechnicalAlerts = false;
  }
}

function isCriticalBrowserError(error) {
  const message = error?.message || String(error || '');
  return message.includes('detached') ||
    message.includes('Protocol error') ||
    message.includes('closed') ||
    message.includes('session') ||
    message.includes('frame');
}

function clearReadyTimer() {
  if (!readyTimer) return;
  clearTimeout(readyTimer);
  readyTimer = null;
}

function armReadyTimer(targetClient, cause) {
  clearReadyTimer();
  readyTimer = setTimeout(() => {
    readyTimer = null;
    if (shuttingDown || client !== targetClient || whatsappReady) return;
    recordIncident({
      type: 'whatsapp-ready-timeout',
      severity: 'critical',
      process: SENDER_NAME,
      message: 'Cliente autenticado não alcançou ready dentro da tolerância.',
    });
    queueSenderTechnicalAlert('sender-connectivity', {
      type: 'whatsapp-connectivity-failure',
      severity: 'critical',
      stateCode: 'authenticated-without-ready',
      message: 'Cliente autenticado sem confirmação ready.',
    });
    void destroyClientSafely(targetClient).finally(() => {
      recoveryInProgress = false;
      scheduleRecovery(`ready-timeout:${cause}`, null);
    });
  }, READY_TIMEOUT_MS);
  readyTimer.unref();
}

function createWhatsappClient() {
  const whatsappClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: './.wwebjs_auth',
    }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  whatsappClient.on('qr', () => {
    if (client !== whatsappClient) return;
    whatsappReady = false;
    clearReadyTimer();
    whatsappQrBlocked = true;
    recordIncident({
      type: 'qr-blocked',
      severity: 'critical',
      process: SENDER_NAME,
      message: 'QR Code solicitado em modo live. Reautenticação automática bloqueada.',
    });
    queueSenderTechnicalAlert('sender-connectivity', {
      type: 'whatsapp-connectivity-failure',
      severity: 'critical',
      stateCode: 'authentication-required',
      message: 'A sessão do WhatsApp exige nova autenticação.',
    });
    console.error('[QR BLOQUEADO] Sessão inválida ou expirada. Nenhum QR Code será exibido.');
    enterStoppedSafe('authentication-required', whatsappClient);
  });

  whatsappClient.on('ready', () => {
    if (client !== whatsappClient) return;
    whatsappReady = true;
    clearReadyTimer();
    whatsappQrBlocked = false;
    operationalController.recordReady('whatsapp-ready');
    console.log(`[${SENDER_NAME}] WhatsApp ready recebido.`);
    resolveSenderTechnicalAlert('sender-connectivity');
    recordHeartbeat({ event: 'ready' });
    syncTechnicalAlertsToOperationalReport();
  });

  whatsappClient.on('authenticated', () => {
    if (client !== whatsappClient) return;
    whatsappReady = false;
    whatsappQrBlocked = false;
    operationalController.transition(WHATSAPP_OPERATIONAL_STATES.RECOVERING, 'session-authenticated');
    console.log(`[${SENDER_NAME}] sessão autenticada existente confirmada.`);
    resolveSenderTechnicalAlert('sender-connectivity');
    recordHeartbeat({ event: 'authenticated' });
    syncTechnicalAlertsToOperationalReport();
  });

  whatsappClient.on('auth_failure', message => {
    if (client !== whatsappClient) return;
    whatsappReady = false;
    clearReadyTimer();
    whatsappQrBlocked = true;
    recordIncident({
      type: 'auth-failure',
      severity: 'critical',
      process: SENDER_NAME,
      message: String(message || 'Falha de autenticação do WhatsApp.'),
    });
    queueSenderTechnicalAlert('sender-connectivity', {
      type: 'whatsapp-connectivity-failure',
      severity: 'critical',
      stateCode: 'auth-failure',
      message: 'Falha de autenticação do WhatsApp.',
    });
    console.error('[AUTH FAILURE]', message);
    enterStoppedSafe('auth-failure', whatsappClient);
  });

  whatsappClient.on('disconnected', reason => {
    if (client !== whatsappClient) return;
    whatsappReady = false;
    clearReadyTimer();
    recordIncident({
      type: 'whatsapp-disconnected',
      severity: 'critical',
      process: SENDER_NAME,
      message: String(reason || 'Cliente WhatsApp desconectado.'),
    });
    queueSenderTechnicalAlert('sender-connectivity', {
      type: 'whatsapp-connectivity-failure',
      severity: 'critical',
      stateCode: 'disconnected',
      message: 'Cliente WhatsApp desconectado.',
    });
    console.error('[DESCONECTADO]', reason);
    if (isSessionInvalidReason(reason)) {
      whatsappQrBlocked = true;
      enterStoppedSafe('session-invalid-disconnected', whatsappClient);
      return;
    }
    scheduleRecovery('temporary-disconnection', whatsappClient);
  });

  return whatsappClient;
}

async function destroyClientSafely(targetClient = client) {
  if (!targetClient || typeof targetClient.destroy !== 'function') return;
  try {
    await targetClient.destroy();
  } catch (error) {
    console.warn(`[${SENDER_NAME}] falha não fatal ao encerrar cliente degradado:`, error?.message || error);
  } finally {
    if (client === targetClient) client = null;
  }
}

function enterStoppedSafe(cause, targetClient = client) {
  operationalController.recordFailure(cause, { retryable: false });
  whatsappReady = false;
  recordHeartbeat({ event: 'stopped-safe', stopCause: cause });
  destroyClientSafely(targetClient);
}

function scheduleRecovery(cause, targetClient = client) {
  if (shuttingDown || operationalController.state === WHATSAPP_OPERATIONAL_STATES.STOPPED_SAFE) return;
  const current = operationalController.snapshot();
  const snapshot = current.circuitBreaker.state === 'OPEN'
    ? current
    : operationalController.recordFailure(cause, { retryable: true });
  whatsappReady = false;
  const circuitDelay = snapshot.circuitBreaker.nextAttemptAt
    ? Math.max(0, new Date(snapshot.circuitBreaker.nextAttemptAt).getTime() - Date.now())
    : 0;
  const delay = Math.max(
    circuitDelay,
    computeProgressiveBackoff(snapshot.circuitBreaker.consecutiveFailures, {
      baseDelayMs: Number(process.env.WHATSAPP_RECOVERY_BASE_DELAY_MS || 5_000),
      maxDelayMs: Number(process.env.WHATSAPP_RECOVERY_MAX_DELAY_MS || 5 * 60_000),
    }),
  );
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null;
    if (recoveryInProgress || shuttingDown) return;
    const network = await checkNetworkReadiness();
    if (!network.ready) {
      operationalController.recordNetworkWait(`dns-unavailable:${network.errorCode}`);
      recordHeartbeat({ event: 'network-wait', networkReady: false });
      scheduleRecovery('network-unavailable', targetClient);
      return;
    }
    const recovery = operationalController.beginRecovery(cause);
    if (!recovery.allowed) {
      scheduleRecovery('circuit-cooldown', targetClient);
      return;
    }
    recoveryInProgress = true;
    try {
      await destroyClientSafely(targetClient);
      await initializeWhatsappClient({ cause: 'automatic-recovery', requireExistingSession: true });
    } catch (error) {
      recordIncident({
        type: 'whatsapp-recovery-error',
        severity: 'high',
        process: SENDER_NAME,
        message: error?.message || String(error),
      });
      scheduleRecovery('recovery-initialize-error');
    } finally {
      recoveryInProgress = false;
    }
  }, delay);
  recoveryTimer.unref();
  console.warn(`[${SENDER_NAME}] recuperação controlada agendada em ${delay}ms; causa=${cause}.`);
}

async function initializeWhatsappClient({ cause = 'startup', requireExistingSession = true } = {}) {
  const disk = getDiskHealth(process.cwd());
  if (!disk.canStartCriticalComponents) {
    operationalController.stopSafe(`disk-${disk.status}`);
    recordHeartbeat({ event: 'disk-blocked', diskStatus: disk.status });
    return false;
  }

  const session = inspectSessionDirectory({ dataPath: WHATSAPP_RUNTIME_PATHS.session });
  if (requireExistingSession && !session.valid) {
    whatsappQrBlocked = true;
    operationalController.stopSafe('session-directory-missing');
    recordHeartbeat({ event: 'session-missing' });
    return false;
  }

  if (!instanceLock) {
    instanceLock = acquireSingleInstanceLock({ lockPath: WHATSAPP_RUNTIME_PATHS.processLock });
    if (!instanceLock.acquired) {
      operationalController.stopSafe('concurrent-client-blocked');
      recordHeartbeat({ event: 'concurrent-client-blocked' });
      return false;
    }
  }

  const network = await checkNetworkReadiness();
  if (!network.ready) {
    operationalController.recordNetworkWait(`dns-unavailable:${network.errorCode}`);
    recordHeartbeat({ event: 'network-wait', networkReady: false });
    scheduleRecovery('startup-network-unavailable');
    return false;
  }

  operationalController.transition(WHATSAPP_OPERATIONAL_STATES.RECOVERING, cause);
  const nextClient = createWhatsappClient();
  client = nextClient;
  armReadyTimer(nextClient, cause);
  try {
    await nextClient.initialize();
    return true;
  } catch (error) {
    clearReadyTimer();
    if (client === nextClient) client = null;
    throw error;
  }
}

async function sendAdminReport(message, metadata = {}) {
  if (mode !== WHATSAPP_OPERATION_MODES.LIVE) {
    recordIncident({
      type: 'admin-report-skipped',
      severity: 'info',
      process: SENDER_NAME,
      reason: `modo operacional ${mode}`,
      ...metadata,
    });
    return { status: 'skipped' };
  }
  if (!client || typeof client.sendMessage !== 'function' || !whatsappReady) {
    throw new Error('Sender WhatsApp não está ready para relatório administrativo.');
  }
  const config = getAdminReportConfig();
  await client.sendMessage(config.phone, message);
  console.log(`[ADMIN REPORT] relatório enviado para ${config.phoneMasked}.`);
  return { status: 'sent', phoneMasked: config.phoneMasked, phoneDigits: config.phoneDigits };
}

async function resolveSessionAutomationBlock({ accountId, reminder, routine, phase }) {
  const sessionId = String(reminder?.id || '').trim();
  if (!accountId || !sessionId) return { blocked: true, reason: 'contexto de segurança do lembrete incompleto' };
  try {
    const snapshot = await db.doc(`users/${accountId}/sessions/${sessionId}`).get();
    const session = snapshot.exists
      ? { id: snapshot.id, ...(snapshot.data() || {}) }
      : { id: sessionId, patientId: reminder?.patientId || '' };
    const patientId = session.patientId || reminder?.patientId || '';
    const patientSnapshot = patientId
      ? await db.doc(`users/${accountId}/patients/${patientId}`).get()
      : null;
    const patient = patientSnapshot?.exists
      ? { id: patientSnapshot.id, ...(patientSnapshot.data() || {}) }
      : null;
    if (!patient || patient.status !== 'Ativo' || (!snapshot.exists && reminder?.isVirtual !== true)) {
      return { blocked: true, reason: 'atendimento removido ou paciente indisponível na rechecagem' };
    }
    const blocked = isWhatsappAutomationBlocked(session, {
      patient,
      reminderType: routine || reminder?.reminderType,
      phase,
      now: new Date(),
    });
    return blocked
      ? { blocked: true, reason: 'mensagem automática bloqueada na Agenda antes do envio' }
      : { blocked: false };
  } catch (error) {
    console.error(`[${SENDER_NAME}] falha ao confirmar segurança do lembrete; envio bloqueado.`);
    return { blocked: true, reason: 'envio bloqueado por falha na confirmação de segurança da sessão' };
  }
}

async function processClaimedRoutine(routineJob) {
  const startedAt = new Date();
  const routine = routineJob.routine;
  const checkpointId = routineJob.id;
  let plannedCount = 0;
  let confirmedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let manualCount = 0;
  let skippedCount = 0;

  ledger.upsertCheckpoint(checkpointId, {
    status: 'started',
    startedAt: startedAt.toISOString(),
    senderPid: process.pid,
  });

  try {
    const audit = createExecutionAudit({ tipo: routine, startedAt, planContexts: [] });
    const planContexts = await buildReminderPlanContexts({
      db,
      tipo: routine,
      now: new Date(),
      suppressions,
      invocationReason: 'routine',
    });
    audit.planContexts = planContexts;
    const previewNotificationId = `admin-preview:${routineJob.date}:${routine}`;
    const previewNotification = ledger.getAdminNotification(previewNotificationId);
    const executionSnapshot = buildPlanSnapshot({
      tipo: routine,
      planContexts,
      capturedAt: new Date(),
    });
    const previewSnapshot = previewNotification?.status === 'sent'
      ? previewNotification.previewSnapshot
      : null;
    registerAgendaChanges(
      audit,
      comparePlanSnapshots(previewSnapshot, executionSnapshot)
    );

    const delivery = createReminderDeliveryService({
      mode,
      ledger,
      sender: client,
      maxAttempts: 2,
      retryDelayMs: 15000,
      logger: console,
      shouldBlockReminder: resolveSessionAutomationBlock,
    });

    for (const context of planContexts) {
      plannedCount += context.plan.reminders.length;
      registerPlanDiagnostics(audit, context.plan);
      blockedCount += (context.plan.diagnostics || []).length;
      const results = await delivery.processPlan({
        accountId: context.userId,
        plan: context.plan,
        routine,
        routineDate: context.plan.dateStr,
        window: {
          start: routineJob.expectedWindowStart,
          end: routineJob.expectedWindowEnd,
        },
      });
      for (const result of results) {
        const reminder = (context.plan.reminders || []).find(item => item.id === result.id);
        if (result.status === 'confirmed') {
          confirmedCount += 1;
          registerSuccessfulSend(audit, reminder || result, result);
        } else if (result.status === 'failed') {
          failedCount += 1;
          registerSendFailure(audit, reminder || result, new Error(result.error || 'Falha no envio'));
        } else if (['manual', 'suppressed', 'expired', 'skipped'].includes(result.status)) {
          if (result.status === 'manual') manualCount += 1;
          else skippedCount += 1;
          registerRuntimeSkip(audit, reminder || result, result.skippedReason || result.blockedReason);
        }
      }
    }

    finishExecutionAudit(audit, new Date());
    const executionReport = buildExecutionReportData(audit);
    const executionMessage = formatExecutionReportMessage(executionReport);
    let adminDeliveryStatus = 'not-required';
    let adminRecipientDigits = '';

    if (executionMessage) {
      try {
        const deliveryResult = await sendAdminReport(
          executionMessage,
          { type: 'execution-report', routine, date: routineJob.date },
        );
        adminDeliveryStatus = deliveryResult.status;
        adminRecipientDigits = deliveryResult.phoneDigits || '';
      } catch (adminError) {
        adminDeliveryStatus = 'failed';
        try {
          adminRecipientDigits = getAdminReportConfig().phoneDigits;
        } catch {
          adminRecipientDigits = '';
        }
        recordIncident({
          type: 'admin-execution-report-error',
          severity: 'high',
          process: SENDER_NAME,
          routine,
          date: routineJob.date,
          message: adminError?.message || String(adminError),
        });
      }

      if (adminDeliveryStatus === 'sent' || mode === WHATSAPP_OPERATION_MODES.LIVE) {
        try {
          emitFirestoreMetric({ source: 'whatsapp-write', operation: 'dailyOperationalReport', event: 'attempt', attempted: true, persisted: false });
          const persisted = await saveDailyWhatsappOperationalReport({
            db,
            execution: executionReport,
            deliveryStatus: adminDeliveryStatus,
            recipient: adminRecipientDigits,
            message: executionMessage,
            updatedAt: new Date(),
          });
          emitFirestoreMetric({ source: 'whatsapp-write', operation: 'dailyOperationalReport', event: 'completed', attempted: true, persisted: true });
          console.log(`[ADMIN REPORT] resumo sanitizado persistido em ${persisted.path}.`);
        } catch (persistenceError) {
          emitFirestoreMetric({ source: 'whatsapp-write', operation: 'dailyOperationalReport', event: 'failed', attempted: true, persisted: false });
          recordIncident({
            type: 'admin-execution-report-persistence-error',
            severity: 'high',
            process: SENDER_NAME,
            routine,
            date: routineJob.date,
            message: persistenceError?.message || String(persistenceError),
          });
        }
      }
    } else {
      console.log(`[ADMIN REPORT] rotina ${routine} sem atividade administrativa relevante; nenhum relatório enviado.`);
    }

    const accounting = buildRoutineDeliveryAccounting({
      expectedCount: plannedCount,
      createdCount: plannedCount,
      enqueuedCount: plannedCount,
      confirmedCount,
      manualCount,
      skippedCount,
      failedCount,
    });
    ledger.upsertCheckpoint(checkpointId, {
      status: accounting.deliveryComplete ? 'completed' : 'completed-with-failures',
      completedAt: new Date().toISOString(),
      deliveryAccountingVersion: 1,
      plannedCount,
      ...accounting,
      blockedCount,
    });
  } catch (error) {
    recordIncident({
      type: 'sender-routine-error',
      severity: isCriticalBrowserError(error) ? 'critical' : 'high',
      process: SENDER_NAME,
      routine,
      date: routineJob.date,
      message: error?.message || String(error),
    });
    queueSenderTechnicalAlert(`sender-routine:${routine}:${routineJob.date}`, {
      type: 'sender-routine-error',
      severity: isCriticalBrowserError(error) ? 'critical' : 'high',
      routine,
      date: routineJob.date,
      stateCode: isCriticalBrowserError(error) ? 'critical-runtime-error' : 'runtime-error',
      message: 'Falha durante a execução da rotina de lembretes.',
    });
    safeLedgerCall('routine-failed-checkpoint', () => ledger.upsertCheckpoint(checkpointId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      failedCount: failedCount + 1,
      error: error?.message || String(error),
    }));
    if (isCriticalBrowserError(error)) scheduleRecovery('critical-routine-browser-error');
  }
}

async function processClaimedAdminNotification(notification) {
  try {
    let message = notification.message || '';
    let previewSnapshot = null;
    if (notification.type === 'preventive-preview') {
      const planContexts = await buildReminderPlanContexts({
        db,
        tipo: notification.routine,
        now: new Date(),
        suppressions,
        invocationReason: 'admin-preview',
      });
      previewSnapshot = buildPlanSnapshot({
        tipo: notification.routine,
        planContexts,
        capturedAt: new Date(),
      });
      message = buildPreventiveAlertMessage({
        tipo: notification.routine,
        scheduledAt: new Date(notification.scheduledAt),
        planContexts,
      });
    }
    if (!message) {
      ledger.updateAdminNotification(notification.id, {
        status: 'skipped',
        skippedAt: new Date().toISOString(),
        blockedReason: 'nenhuma mensagem elegível; prévia administrativa suprimida',
      });
      return;
    }
    const result = await sendAdminReport(message, {
      type: notification.type,
      routine: notification.routine,
      date: notification.date,
    });
    ledger.updateAdminNotification(notification.id, {
      status: result.status === 'sent' ? 'sent' : 'skipped',
      sentAt: result.status === 'sent' ? new Date().toISOString() : undefined,
      phoneMasked: result.phoneMasked,
      previewSnapshot: result.status === 'sent' ? previewSnapshot : undefined,
    });
  } catch (error) {
    safeLedgerCall('admin-notification-failed', () => ledger.updateAdminNotification(notification.id, {
      status: 'failed',
      error: error?.message || String(error),
    }));
    recordIncident({
      type: 'admin-notification-error',
      severity: 'high',
      process: SENDER_NAME,
      message: error?.message || String(error),
    });
  }
}

async function pollAdminNotificationQueue() {
  if (processingAdmin) return;
  if (isGlobalActivationLocked()) return;
  ledger.expireOverdueQueuedAdminNotifications();
  if (mode === WHATSAPP_OPERATION_MODES.DISABLED) return;
  if (mode === WHATSAPP_OPERATION_MODES.LIVE && !whatsappReady) return;
  const notification = ledger.claimNextQueuedAdminNotification({ ownerId: `${SENDER_NAME}:${process.pid}` });
  if (!notification) return;
  processingAdmin = true;
  try {
    await processClaimedAdminNotification(notification);
    await syncTechnicalAlertsToOperationalReport();
  } finally {
    processingAdmin = false;
  }
}

async function pollRoutineQueue() {
  if (processing) return;
  if (isGlobalActivationLocked()) return;
  ledger.expireOverdueQueuedRoutines();
  ledger.expireOverdueQueuedReminders();

  if (mode === WHATSAPP_OPERATION_MODES.DISABLED) return;
  if (mode === WHATSAPP_OPERATION_MODES.LIVE && !whatsappReady) return;

  const routineJob = ledger.claimNextQueuedRoutine({ ownerId: `${SENDER_NAME}:${process.pid}` });
  if (!routineJob) return;

  processing = true;
  try {
    await processClaimedRoutine(routineJob);
  } finally {
    processing = false;
  }
}

process.on('unhandledRejection', reason => {
  recordIncident({
    type: 'unhandled-rejection',
    severity: isCriticalBrowserError(reason) ? 'critical' : 'high',
    process: SENDER_NAME,
    message: reason?.message || String(reason),
  });
  queueSenderTechnicalAlert('sender-runtime', {
    type: 'sender-runtime-error',
    severity: isCriticalBrowserError(reason) ? 'critical' : 'high',
    stateCode: isCriticalBrowserError(reason) ? 'critical-unhandled-rejection' : 'unhandled-rejection',
    message: 'Falha não tratada no processo remetente.',
  });
  console.error('[UNHANDLED REJECTION]', reason);
  if (isCriticalBrowserError(reason)) scheduleRecovery('critical-unhandled-rejection');
});

async function startSenderRuntime() {
  if (shouldInitializeWhatsapp) {
    try {
      await initializeWhatsappClient({ cause: 'startup', requireExistingSession: true });
    } catch (error) {
      recordIncident({
        type: 'whatsapp-initialize-error',
        severity: 'critical',
        process: SENDER_NAME,
        message: error?.message || String(error),
      });
      queueSenderTechnicalAlert('sender-connectivity', {
        type: 'whatsapp-connectivity-failure',
        severity: 'critical',
        stateCode: 'initialize-error',
        message: 'Falha ao inicializar a sessão do WhatsApp.',
      });
      console.error('[WHATSAPP INIT ERROR]', error?.message || error);
      scheduleRecovery('initialize-error');
    }
  } else {
    operationalController.transition(WHATSAPP_OPERATIONAL_STATES.STOPPED_SAFE, `mode-${mode}`);
    console.log(`[${SENDER_NAME}] WhatsApp não inicializado em modo ${mode}.`);
  }
}

async function shutdownSafely(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  clearReadyTimer();
  operationalController.transition(WHATSAPP_OPERATIONAL_STATES.STOPPED_SAFE, `shutdown-${signal}`);
  recordHeartbeat({ event: 'shutdown', signal });
  await destroyClientSafely();
  if (instanceLock?.acquired) instanceLock.release();
  process.exit(0);
}

process.once('SIGINT', () => { shutdownSafely('SIGINT'); });
process.once('SIGTERM', () => { shutdownSafely('SIGTERM'); });
process.once('exit', () => {
  if (instanceLock?.acquired) {
    try { instanceLock.release(); } catch { /* limpeza de lock é best effort */ }
  }
});

startSenderRuntime().catch(error => {
    recordIncident({
      type: 'whatsapp-initialize-error',
      severity: 'critical',
      process: SENDER_NAME,
      message: error?.message || String(error),
    });
    queueSenderTechnicalAlert('sender-connectivity', {
      type: 'whatsapp-connectivity-failure',
      severity: 'critical',
      stateCode: 'initialize-error',
      message: 'Falha ao inicializar a sessão do WhatsApp.',
    });
    console.error('[WHATSAPP INIT ERROR]', error?.message || error);
    scheduleRecovery('startup-runtime-error');
  });

recordHeartbeat({ event: 'startup' });
setInterval(recordHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
setInterval(() => {
  syncTechnicalAlertsToOperationalReport().catch(error => {
    console.error('[TECHNICAL ALERT SYNC ERROR]', error);
  });
}, TECHNICAL_ALERT_SYNC_INTERVAL_MS).unref();
setInterval(() => {
  pollRoutineQueue().catch(error => {
    recordIncident({
      type: 'sender-poll-error',
      severity: 'high',
      process: SENDER_NAME,
      message: error?.message || String(error),
    });
    queueSenderTechnicalAlert('sender-runtime', {
      type: 'sender-runtime-error',
      severity: 'high',
      stateCode: 'routine-poll-error',
      message: 'Falha ao consultar a fila de rotinas.',
    });
    console.error('[POLL ERROR]', error);
  });
  pollAdminNotificationQueue().catch(error => {
    recordIncident({
      type: 'sender-admin-poll-error',
      severity: 'high',
      process: SENDER_NAME,
      message: error?.message || String(error),
    });
    console.error('[ADMIN POLL ERROR]', error);
  });
}, POLL_INTERVAL_MS);
