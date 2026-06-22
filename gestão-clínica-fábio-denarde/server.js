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
import { JsonReminderLedger, createReminderDeliveryService, isGlobalActivationLocked, resolveWhatsappOperationMode, shouldInitializeWhatsappClient, WHATSAPP_OPERATION_MODES } from './src/lib/whatsappReminderOperations.js';
import { buildReminderPlanContexts, initializeFirebaseAdmin } from './src/lib/whatsappReminderRuntime.js';
import { loadWhatsappReminderSuppressions } from './src/lib/whatsappReminderSuppressionStore.js';
import { saveDailyWhatsappOperationalReport } from './src/lib/whatsappOperationalReportRepository.js';

const SENDER_NAME = 'RoboClinica';
const POLL_INTERVAL_MS = Number(process.env.WHATSAPP_SENDER_POLL_INTERVAL_MS || 15000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WHATSAPP_HEARTBEAT_INTERVAL_MS || 5 * 60 * 1000);
const mode = resolveWhatsappOperationMode();
const shouldInitializeWhatsapp = shouldInitializeWhatsappClient(mode);
const ledger = new JsonReminderLedger();
const db = initializeFirebaseAdmin();
const suppressions = loadWhatsappReminderSuppressions();

let whatsappReady = false;
let whatsappQrBlocked = false;
let client = null;
let processing = false;
let processingAdmin = false;

console.log(`[${SENDER_NAME}] modo operacional: ${mode}.`);
console.log(`[${SENDER_NAME}] scheduler externo obrigatório; este processo não registra cron.`);

function recordHeartbeat(extra = {}) {
  ledger.appendHeartbeat({
    process: SENDER_NAME,
    pid: process.pid,
    mode,
    whatsappReady,
    qrBlocked: whatsappQrBlocked,
    schedulerRegistered: false,
    scriptPath: path.resolve('./server.js'),
    ...extra,
  });
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

function isCriticalBrowserError(error) {
  const message = error?.message || String(error || '');
  return message.includes('detached') ||
    message.includes('Protocol error') ||
    message.includes('closed') ||
    message.includes('session') ||
    message.includes('frame');
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
    whatsappReady = false;
    whatsappQrBlocked = true;
    ledger.appendIncident({
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
    process.exit(1);
  });

  whatsappClient.on('ready', () => {
    whatsappReady = true;
    whatsappQrBlocked = false;
    console.log(`[${SENDER_NAME}] WhatsApp ready recebido.`);
    resolveSenderTechnicalAlert('sender-connectivity');
    recordHeartbeat({ event: 'ready' });
  });

  whatsappClient.on('authenticated', () => {
    whatsappReady = true;
    whatsappQrBlocked = false;
    console.log(`[${SENDER_NAME}] sessão autenticada existente confirmada.`);
    resolveSenderTechnicalAlert('sender-connectivity');
    recordHeartbeat({ event: 'authenticated' });
  });

  whatsappClient.on('auth_failure', message => {
    whatsappReady = false;
    ledger.appendIncident({
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
  });

  whatsappClient.on('disconnected', reason => {
    whatsappReady = false;
    ledger.appendIncident({
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
    process.exit(1);
  });

  return whatsappClient;
}

async function sendAdminReport(message, metadata = {}) {
  if (mode !== WHATSAPP_OPERATION_MODES.LIVE) {
    ledger.appendIncident({
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

async function processClaimedRoutine(routineJob) {
  const startedAt = new Date();
  const routine = routineJob.routine;
  const checkpointId = routineJob.id;
  let plannedCount = 0;
  let confirmedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;

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
      now: new Date(`${routineJob.date}T12:00:00`),
      suppressions,
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
        ledger.appendIncident({
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
          const persisted = await saveDailyWhatsappOperationalReport({
            db,
            execution: executionReport,
            deliveryStatus: adminDeliveryStatus,
            recipient: adminRecipientDigits,
            message: executionMessage,
            updatedAt: new Date(),
          });
          console.log(`[ADMIN REPORT] resumo sanitizado persistido em ${persisted.path}.`);
        } catch (persistenceError) {
          ledger.appendIncident({
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

    ledger.upsertCheckpoint(checkpointId, {
      status: failedCount > 0 ? 'completed-with-failures' : 'completed',
      completedAt: new Date().toISOString(),
      plannedCount,
      confirmedCount,
      blockedCount,
      failedCount,
    });
  } catch (error) {
    ledger.appendIncident({
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
    ledger.upsertCheckpoint(checkpointId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      failedCount: failedCount + 1,
      error: error?.message || String(error),
    });
    if (isCriticalBrowserError(error)) process.exit(1);
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
        now: new Date(`${notification.date}T12:00:00`),
        suppressions,
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
    ledger.updateAdminNotification(notification.id, {
      status: 'failed',
      error: error?.message || String(error),
    });
    ledger.appendIncident({
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
  if (mode === WHATSAPP_OPERATION_MODES.DISABLED) return;
  if (mode === WHATSAPP_OPERATION_MODES.LIVE && !whatsappReady) return;
  const notification = ledger.claimNextQueuedAdminNotification({ ownerId: `${SENDER_NAME}:${process.pid}` });
  if (!notification) return;
  processingAdmin = true;
  try {
    await processClaimedAdminNotification(notification);
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
  ledger.appendIncident({
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
  if (isCriticalBrowserError(reason)) process.exit(1);
});

if (shouldInitializeWhatsapp) {
  client = createWhatsappClient();
  client.initialize().catch(error => {
    ledger.appendIncident({
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
    process.exit(1);
  });
} else {
  console.log(`[${SENDER_NAME}] WhatsApp não inicializado em modo ${mode}.`);
}

recordHeartbeat({ event: 'startup' });
setInterval(recordHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
setInterval(() => {
  pollRoutineQueue().catch(error => {
    ledger.appendIncident({
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
    ledger.appendIncident({
      type: 'sender-admin-poll-error',
      severity: 'high',
      process: SENDER_NAME,
      message: error?.message || String(error),
    });
    console.error('[ADMIN POLL ERROR]', error);
  });
}, POLL_INTERVAL_MS);
