import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonReminderLedger, buildWhatsappHealthSnapshot, createMemoryReminderLedger, detectMissedRoutineCheckpoints, resolveWhatsappOperationMode } from '../src/lib/whatsappReminderOperations.js';
import { parseAndSanitizePm2Json, readPm2JsonUtf8 } from './read-pm2-whatsapp-state.js';

const PROCESS_NAME = 'RoboClinicaWatchdog';
const CHECK_INTERVAL_MS = Number(process.env.WHATSAPP_WATCHDOG_INTERVAL_MS || 60 * 1000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WHATSAPP_HEARTBEAT_INTERVAL_MS || 5 * 60 * 1000);
const HEARTBEAT_MAX_AGE_MS = Number(process.env.WHATSAPP_HEARTBEAT_MAX_AGE_MS || 10 * 60 * 1000);
const EXPECTED_SCRIPT_PATH = path.resolve('server.js');
const mode = resolveWhatsappOperationMode();
const isSelfCheck = process.argv.includes('--self-check');
const ledger = isSelfCheck ? createMemoryReminderLedger() : new JsonReminderLedger();

function recordHeartbeat(extra = {}) {
  ledger.appendHeartbeat({
    process: PROCESS_NAME,
    pid: process.pid,
    mode,
    schedulerRegistered: false,
    whatsappReady: false,
    scriptPath: path.resolve('scripts/whatsapp-reminder-watchdog.js'),
    ...extra,
  });
}

function latestHeartbeat(processName) {
  const heartbeats = ledger.read().heartbeats || [];
  return heartbeats
    .filter(heartbeat => heartbeat.process === processName)
    .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')))[0] || null;
}

function heartbeatFresh(heartbeat, now = new Date()) {
  if (!heartbeat?.recordedAt) return false;
  return now.getTime() - new Date(heartbeat.recordedAt).getTime() <= HEARTBEAT_MAX_AGE_MS;
}

async function readPm2Process(name) {
  const sanitizedState = parseAndSanitizePm2Json(await readPm2JsonUtf8());
  const processInfo = sanitizedState.processes.find(item => item.name === name) || null;
  if (!processInfo) return null;

  return {
    name: processInfo.name,
    pid: processInfo.pid,
    pm2_env: {
      status: processInfo.status,
      pm_exec_path: processInfo.pm_exec_path,
      pm_cwd: processInfo.pm_cwd,
      restart_time: processInfo.restart_time,
      exec_mode: processInfo.exec_mode,
      instances: processInfo.instances,
    },
  };
}

function getLogFiles() {
  const files = [
    path.resolve('logs/pm2/RoboClinica-out.log'),
    path.resolve('logs/pm2/RoboClinica-error.log'),
  ];
  return files
    .filter(file => fs.existsSync(file))
    .map(file => ({ file, size: fs.statSync(file).size }));
}

async function runWatchdogCheck() {
  const incidents = [];
  const sender = await readPm2Process('RoboClinica');
  const senderHeartbeat = latestHeartbeat('RoboClinica');
  const schedulerHeartbeat = latestHeartbeat('RoboClinicaScheduler');
  const watchdogHeartbeat = latestHeartbeat(PROCESS_NAME);
  const health = buildWhatsappHealthSnapshot({
    expectedScriptPath: EXPECTED_SCRIPT_PATH,
    pm2Process: sender,
    whatsappReady: Boolean(senderHeartbeat?.whatsappReady),
    schedulerRegistered: Boolean(schedulerHeartbeat),
    lastHeartbeat: senderHeartbeat,
    lastRoutineCheckpoints: Object.values(ledger.read().checkpoints || {}).slice(-10),
    logFiles: getLogFiles(),
    restarts: sender?.pm2_env?.restart_time || 0,
  });

  if (!sender) incidents.push({ type: 'pm2-process-missing', severity: 'critical', message: 'RoboClinica não encontrado no PM2.' });
  if (!health.checks.scriptPathMatches) incidents.push({ type: 'script-path-mismatch', severity: 'critical', message: `Script path incorreto: ${health.actualScriptPath}` });
  if (!heartbeatFresh(senderHeartbeat)) incidents.push({ type: 'sender-heartbeat-stale', severity: 'high', message: 'Heartbeat do remetente vencido ou ausente.' });
  if (!heartbeatFresh(schedulerHeartbeat)) incidents.push({ type: 'scheduler-heartbeat-stale', severity: 'high', message: 'Heartbeat do scheduler vencido ou ausente.' });
  if (!heartbeatFresh(watchdogHeartbeat)) incidents.push({ type: 'watchdog-heartbeat-stale', severity: 'medium', message: 'Heartbeat do watchdog ainda não estabilizado.' });

  for (const incident of detectMissedRoutineCheckpoints({ ledger, lookbackDays: 2 })) {
    incidents.push({ ...incident, severity: incident.severity || 'high' });
  }

  const data = ledger.read();
  for (const reminder of Object.values(data.reminders || {})) {
    if (reminder.status === 'attempting' && reminder.updatedAt && Date.now() - new Date(reminder.updatedAt).getTime() > HEARTBEAT_MAX_AGE_MS) {
      incidents.push({
        type: 'ledger-attempting-stale',
        severity: 'high',
        message: `Lembrete ${reminder.id} preso em attempting.`,
      });
    }
  }

  const technicalAlertResult = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: incidents.map(incident => ({
      ...incident,
      process: PROCESS_NAME,
    })),
    now: new Date(),
  });

  for (const queued of technicalAlertResult.queued) {
    ledger.appendIncident({
      ...queued.incident,
      process: PROCESS_NAME,
      host: os.hostname(),
      technicalAlertKey: queued.key,
    });
    console.error(`[${PROCESS_NAME}] ${queued.incident.type}: ${queued.incident.message}`);
  }

  for (const resolved of technicalAlertResult.resolved) {
    console.log(`[${PROCESS_NAME}] alerta técnico resolvido: ${resolved.state.type}.`);
  }

  ledger.upsertCheckpoint(`watchdog:last-check:${process.pid}`, {
    routine: 'WATCHDOG',
    status: incidents.length > 0 ? 'attention' : 'healthy',
    checkedAt: new Date().toISOString(),
    incidentCount: incidents.length,
  });

  return { health, incidents };
}

if (isSelfCheck) {
  const now = new Date();
  recordHeartbeat({ event: 'self-check' });
  const health = buildWhatsappHealthSnapshot({
    expectedScriptPath: EXPECTED_SCRIPT_PATH,
    pm2Process: {
      pid: process.pid,
      pm2_env: {
        status: 'online',
        pm_exec_path: EXPECTED_SCRIPT_PATH,
        restart_time: 0,
      },
    },
    whatsappReady: true,
    schedulerRegistered: true,
    lastHeartbeat: {
      process: 'RoboClinica',
      recordedAt: now.toISOString(),
      whatsappReady: true,
    },
    lastRoutineCheckpoints: [],
    logFiles: [],
    restarts: 0,
  });
  const checkpointId = `watchdog:self-check:${process.pid}`;
  ledger.upsertCheckpoint(checkpointId, {
    routine: 'WATCHDOG_SELF_CHECK',
    status: health.status === 'healthy' ? 'healthy' : 'attention',
    checkedAt: now.toISOString(),
    incidentCount: 0,
  });

  const snapshot = ledger.read();
  const isolatedHeartbeat = snapshot.heartbeats.some(item => item.process === PROCESS_NAME && item.event === 'self-check');
  const isolatedCheckpoint = snapshot.checkpoints[checkpointId]?.status === 'healthy';
  const noOperationalNotifications = Object.keys(snapshot.adminNotifications || {}).length === 0;
  if (!isolatedHeartbeat || !isolatedCheckpoint || !noOperationalNotifications) {
    throw new Error('Self-check isolado do watchdog não produziu as evidências seguras esperadas em memória.');
  }

  console.log(`[${PROCESS_NAME}] self-check concluído em ambiente isolado; PM2, ledger operacional e fila administrativa preservados.`);
  process.exit(0);
}

recordHeartbeat({ event: 'startup' });
runWatchdogCheck().catch(error => {
  ledger.appendIncident({
    type: 'watchdog-check-error',
    severity: 'high',
    process: PROCESS_NAME,
    message: error?.message || String(error),
  });
  ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-runtime',
    incidents: [{
      type: 'watchdog-check-error',
      severity: 'high',
      process: PROCESS_NAME,
      stateCode: 'startup-check-error',
      message: 'Falha na verificação do watchdog.',
    }],
  });
});
setInterval(recordHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
setInterval(() => {
  runWatchdogCheck().catch(error => {
    ledger.appendIncident({
      type: 'watchdog-check-error',
      severity: 'high',
      process: PROCESS_NAME,
      message: error?.message || String(error),
    });
    ledger.reconcileTechnicalAlerts({
      scope: 'watchdog-runtime',
      incidents: [{
        type: 'watchdog-check-error',
        severity: 'high',
        process: PROCESS_NAME,
        stateCode: 'periodic-check-error',
        message: 'Falha na verificação periódica do watchdog.',
      }],
    });
    console.error(`[${PROCESS_NAME}] erro na verificação:`, error);
  });
}, CHECK_INTERVAL_MS);
