import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WHATSAPP_OPERATION_MODES = Object.freeze({
  DISABLED: 'disabled',
  DRY_RUN: 'dry-run',
  LIVE: 'live',
});

export const REMINDER_LEDGER_STATUSES = Object.freeze({
  PLANNED: 'planned',
  ELIGIBLE: 'eligible',
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  SUPPRESSED: 'suppressed',
  ATTEMPTING: 'attempting',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  EXPIRED: 'expired',
  MANUAL: 'manual',
  SKIPPED: 'skipped',
});

export const ROUTINE_DELIVERY_OUTCOMES = Object.freeze({
  SENT_CONFIRMED: 'SENT_CONFIRMED',
  MANUAL_HANDLED_BY_ADMIN: 'MANUAL_HANDLED_BY_ADMIN',
  SKIPPED_VALID_REASON: 'SKIPPED_VALID_REASON',
  FAILED_REQUIRES_ACTION: 'FAILED_REQUIRES_ACTION',
});

export const ROUTINE_DEFINITIONS = Object.freeze({
  HOJE_MANHA: { scheduledTime: '06:30', preventiveTime: '06:15', skipWeekdays: [0], windowMinutes: 45 },
  AMANHA: { scheduledTime: '09:00', preventiveTime: '08:45', skipWeekdays: [6], windowMinutes: 60 },
  HOJE_TARDE: { scheduledTime: '12:30', preventiveTime: '12:15', skipWeekdays: [0], windowMinutes: 45 },
});

export const DEFAULT_SCHEDULER_RECOVERY_DELAY_MS = 60 * 1000;
export const DEFAULT_WATCHDOG_STARTUP_GRACE_MS = 10 * 60 * 1000;

export const DEFAULT_LEDGER_PATH = path.resolve('logs', 'audit', 'whatsapp-reminder-ledger.json');
export const DEFAULT_LOCK_DIRECTORY = path.resolve('logs', 'locks');

const DEFAULT_LEDGER_LOCK_NAME = 'whatsapp-ledger';
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 1000;
const DEFAULT_LOCK_ORPHAN_GRACE_MS = 2 * 1000;
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 20 * 1000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 50;
const DEFAULT_WRITE_RETRY_ATTEMPTS = 12;
const DEFAULT_WRITE_RETRY_DELAY_MS = 100;
const MAX_LEDGER_INCIDENTS = 2000;
const MAX_LEDGER_HEARTBEATS = 288;
const DEFAULT_TECHNICAL_ALERT_MAX_AGE_MS = 30 * 60 * 1000;
const RETRYABLE_FILESYSTEM_CODES = new Set(['EACCES', 'EBUSY', 'EMFILE', 'ENFILE', 'EPERM']);
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const PROCESS_STARTED_AT = new Date().toISOString();

function sleepSync(milliseconds) {
  const delay = Math.max(1, Number(milliseconds) || 1);
  if (typeof Atomics?.wait === 'function') {
    Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, delay);
    return;
  }

  const deadline = Date.now() + delay;
  while (Date.now() < deadline) {
    // Fallback síncrono apenas para ambientes sem Atomics.wait.
  }
}

function isProcessAlive(pid) {
  const parsedPid = Number(pid);
  if (!Number.isInteger(parsedPid) || parsedPid <= 0) return false;
  if (parsedPid === process.pid) return true;

  try {
    process.kill(parsedPid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

function inspectLockFile(lockPath) {
  try {
    const stats = fs.statSync(lockPath);
    let metadata = null;
    try {
      metadata = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      metadata = null;
    }
    return { stats, metadata };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function shouldReclaimLock(lockState, {
  staleMs = DEFAULT_LOCK_STALE_MS,
  orphanGraceMs = DEFAULT_LOCK_ORPHAN_GRACE_MS,
  now = Date.now(),
} = {}) {
  if (!lockState?.stats) return false;
  const ageMs = Math.max(0, now - lockState.stats.mtimeMs);
  if (ageMs > staleMs) return true;
  if (ageMs <= orphanGraceMs) return false;
  if (!lockState.metadata) return true;
  return !isProcessAlive(lockState.metadata.pid);
}

function formatLockOwner(lockState) {
  const pid = Number(lockState?.metadata?.pid);
  const createdAt = String(lockState?.metadata?.createdAt || '');
  return `pid=${Number.isInteger(pid) ? pid : 'desconhecido'}, createdAt=${createdAt || 'desconhecido'}`;
}

function isRetryableFilesystemError(error) {
  return RETRYABLE_FILESYSTEM_CODES.has(error?.code);
}

function normalizeLedgerBeforeWrite(data) {
  data.version = 2;
  data.reminders = data.reminders || {};
  data.checkpoints = data.checkpoints || {};
  data.adminNotifications = data.adminNotifications || {};
  data.adminAlertStates = data.adminAlertStates || {};
  data.incidents = (data.incidents || []).slice(-MAX_LEDGER_INCIDENTS);
  data.heartbeats = (data.heartbeats || []).slice(-MAX_LEDGER_HEARTBEATS);
  return data;
}

const SAFE_RETRY_MESSAGES = [
  'timeout',
  'timed out',
  'econnreset',
  'econnrefused',
  'network',
  'temporar',
  'protocol error',
  'detached frame',
  'target closed',
  'session closed',
];

export function resolveWhatsappOperationMode(env = process.env) {
  const role = String(env.WHATSAPP_PROCESS_ROLE || '').trim().toLowerCase();
  const roleMode = role === 'sender'
    ? env.WHATSAPP_SENDER_MODE
    : role === 'scheduler'
      ? env.WHATSAPP_SCHEDULER_MODE
      : role === 'watchdog'
        ? env.WHATSAPP_WATCHDOG_MODE
        : '';
  const rawMode = String(roleMode || env.WHATSAPP_REMINDER_MODE || env.WHATSAPP_OPERATION_MODE || '').trim().toLowerCase();
  if (Object.values(WHATSAPP_OPERATION_MODES).includes(rawMode)) return rawMode;
  if (env.NODE_ENV === 'test') return WHATSAPP_OPERATION_MODES.DRY_RUN;
  return WHATSAPP_OPERATION_MODES.DISABLED;
}

export function shouldInitializeWhatsappClient(mode) {
  return mode === WHATSAPP_OPERATION_MODES.LIVE;
}

export function isGlobalActivationLocked(lockPath = path.resolve('logs', 'locks', 'whatsapp-activation-global.lock')) {
  return fs.existsSync(lockPath);
}

export function formatLocalDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addLocalDays(dateStr, amount) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return formatLocalDateStr(date);
}

export function hashPhone(phone) {
  return crypto.createHash('sha256').update(String(phone || '').replace(/\D/g, '')).digest('hex');
}

export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '(sem telefone)';
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
}

const TECHNICAL_ALERT_LABELS = Object.freeze({
  'whatsapp-connectivity-failure': 'Conexão do WhatsApp indisponível',
  'pm2-process-missing': 'Processo do robô indisponível',
  'script-path-mismatch': 'Configuração do processo divergente',
  'sender-heartbeat-stale': 'Heartbeat do remetente ausente',
  'scheduler-heartbeat-stale': 'Heartbeat do agendador ausente',
  'watchdog-heartbeat-stale': 'Heartbeat do watchdog ausente',
  'missed-routine': 'Rotina não iniciada',
  'routine-demand-unverified': 'Rotina requer conferência',
  'incomplete-routine': 'Rotina interrompida',
  'ledger-attempting-stale': 'Tentativa de envio travada',
  'sender-routine-error': 'Falha durante a rotina',
  'sender-runtime-error': 'Falha no processo remetente',
  'scheduler-runtime-error': 'Falha no agendador do robô',
  'watchdog-check-error': 'Falha na verificação do watchdog',
});

function stableTechnicalHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sanitizeTechnicalField(value, maxLength = 80) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Za-z]:[\\/][^\s]+/g, '[caminho local]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function createTechnicalAlertStateKey({
  scope = 'system',
  type = 'technical-alert',
  process = '',
  routine = '',
  date = '',
  affectedSessionKey = '',
} = {}) {
  return stableTechnicalHash([
    sanitizeTechnicalField(scope),
    sanitizeTechnicalField(type),
    sanitizeTechnicalField(process),
    sanitizeTechnicalField(routine),
    sanitizeTechnicalField(date),
    sanitizeTechnicalField(affectedSessionKey),
  ].join('|'));
}

export function createTechnicalAlertFingerprint(alert = {}) {
  return stableTechnicalHash([
    sanitizeTechnicalField(alert.type),
    sanitizeTechnicalField(alert.severity),
    sanitizeTechnicalField(alert.stateCode),
    sanitizeTechnicalField(alert.message, 240),
  ].join('|'));
}

export function buildTechnicalAlertMessage(alert = {}, now = new Date()) {
  const label = TECHNICAL_ALERT_LABELS[alert.type] || 'Falha técnica do robô';
  const severity = String(alert.severity || 'high').toLowerCase();
  const icon = severity === 'critical' ? '🚨' : '⚠️';
  const lines = [
    `${icon} ALERTA TÉCNICO — ${label}`,
    '',
    `Data/Hora: ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(now)}`,
  ];

  if (alert.routine) lines.push(`Rotina: ${sanitizeTechnicalField(alert.routine)}`);
  if (alert.date) lines.push(`Data da rotina: ${sanitizeTechnicalField(alert.date)}`);
  lines.push('', 'Situação: requer verificação administrativa.');
  return lines.join('\n');
}

export function buildTechnicalRecoveryMessage(alert = {}, now = new Date()) {
  const label = alert.type === 'whatsapp-connectivity-failure'
    ? 'Conexão do WhatsApp restabelecida'
    : 'Condição técnica normalizada';
  const lines = [
    `🟢 RETORNO TÉCNICO — ${label}`,
    '',
    `Data/Hora: ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(now)}`,
  ];

  if (alert.routine) lines.push(`Rotina: ${sanitizeTechnicalField(alert.routine)}`);
  if (alert.date) lines.push(`Data da rotina: ${sanitizeTechnicalField(alert.date)}`);
  lines.push(
    '',
    alert.type === 'whatsapp-connectivity-failure'
      ? 'Situação: conexão restabelecida e robô disponível.'
      : 'Situação: condição técnica normalizada.',
    '',
    'Status final: 🟢 NORMALIZADO',
  );
  return lines.join('\n');
}

function reconcileTechnicalAlertData(data, {
  scope = 'system',
  incidents = [],
  now = new Date(),
} = {}) {
  const timestamp = now.toISOString();
  data.adminNotifications = data.adminNotifications || {};
  data.adminAlertStates = data.adminAlertStates || {};
  const activeKeys = new Set();
  const queued = [];
  const suppressed = [];
  const resolved = [];

  for (const rawIncident of incidents || []) {
    const incident = {
      type: sanitizeTechnicalField(rawIncident?.type) || 'technical-alert',
      severity: sanitizeTechnicalField(rawIncident?.severity) || 'high',
      process: sanitizeTechnicalField(rawIncident?.process),
      routine: sanitizeTechnicalField(rawIncident?.routine),
      date: sanitizeTechnicalField(rawIncident?.date),
      affectedSessionKey: sanitizeTechnicalField(rawIncident?.affectedSessionKey),
      stateCode: sanitizeTechnicalField(rawIncident?.stateCode),
      message: sanitizeTechnicalField(rawIncident?.message, 240),
    };
    const key = createTechnicalAlertStateKey({ scope, ...incident });
    const fingerprint = createTechnicalAlertFingerprint(incident);
    const previous = data.adminAlertStates[key] || null;
    const generation = Number(previous?.generation || 0);
    const shouldQueue = !previous || previous.status === 'resolved' || previous.fingerprint !== fingerprint;
    activeKeys.add(key);

    if (shouldQueue) {
      const nextGeneration = generation + 1;
      const notificationId = `technical-alert:${key.slice(0, 24)}:${nextGeneration}`;
      data.adminNotifications[notificationId] = {
        id: notificationId,
        type: 'technical-alert',
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        message: buildTechnicalAlertMessage(incident, now),
        source: incident.process || scope,
        technicalAlertKey: key,
        technicalAlertFingerprint: fingerprint,
        queuedAt: timestamp,
        updatedAt: timestamp,
      };
      data.adminAlertStates[key] = {
        key,
        scope,
        type: incident.type,
        process: incident.process,
        routine: incident.routine,
        date: incident.date,
        status: 'open',
        fingerprint,
        generation: nextGeneration,
        notificationId,
        firstSeenAt: previous?.firstSeenAt || timestamp,
        lastSeenAt: timestamp,
        occurrenceCount: Number(previous?.occurrenceCount || 0) + 1,
        updatedAt: timestamp,
      };
      queued.push({ key, notificationId, incident });
    } else {
      data.adminAlertStates[key] = {
        ...previous,
        status: 'open',
        lastSeenAt: timestamp,
        occurrenceCount: Number(previous?.occurrenceCount || 0) + 1,
        updatedAt: timestamp,
      };
      suppressed.push({ key, incident });
    }
  }

  for (const [key, state] of Object.entries(data.adminAlertStates)) {
    if (state.scope !== scope || state.status !== 'open' || activeKeys.has(key)) continue;

    const alertNotification = data.adminNotifications[state.notificationId] || null;
    let recoveryNotificationId = state.recoveryNotificationId || '';

    if (
      state.type === 'whatsapp-connectivity-failure' &&
      ['queued', 'sent'].includes(String(alertNotification?.status || '')) &&
      !recoveryNotificationId
    ) {
      recoveryNotificationId = `technical-recovery:${key.slice(0, 24)}:${Number(state.generation || 0)}`;
      data.adminNotifications[recoveryNotificationId] = {
        id: recoveryNotificationId,
        type: 'technical-recovery',
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        message: buildTechnicalRecoveryMessage(state, now),
        source: state.process || scope,
        technicalAlertKey: key,
        queuedAt: timestamp,
        updatedAt: timestamp,
      };
    }

    data.adminAlertStates[key] = {
      ...state,
      status: 'resolved',
      resolvedAt: timestamp,
      recoveryNotificationId: recoveryNotificationId || undefined,
      updatedAt: timestamp,
    };
    resolved.push({
      key,
      state: data.adminAlertStates[key],
      recoveryNotificationId: recoveryNotificationId || null,
    });
  }

  return { queued, suppressed, resolved };
}

export function buildReminderLedgerId({
  accountId,
  patientId,
  guardianName,
  phone,
  sessionDate,
  sessionTime,
  reminderType,
  routine,
}) {
  const raw = [
    accountId || 'unknown-account',
    patientId || 'unknown-patient',
    guardianName || 'unknown-guardian',
    hashPhone(phone),
    sessionDate || '',
    sessionTime || '',
    reminderType || '',
    routine || reminderType || '',
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

export class JsonReminderLedger {
  constructor(filePath = DEFAULT_LEDGER_PATH, { lockDirectory } = {}) {
    this.filePath = path.resolve(filePath);
    const usesOperationalLedger = this.filePath === path.resolve(DEFAULT_LEDGER_PATH);
    this.lockDirectory = path.resolve(
      lockDirectory || (usesOperationalLedger
        ? DEFAULT_LOCK_DIRECTORY
        : path.join(path.dirname(this.filePath), '.locks'))
    );
  }

  read() {
    if (!fs.existsSync(this.filePath)) {
      return { version: 2, reminders: {}, checkpoints: {}, adminNotifications: {}, adminAlertStates: {}, incidents: [], heartbeats: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      return {
        version: 2,
        reminders: {},
        checkpoints: {},
        adminNotifications: {},
        adminAlertStates: {},
        incidents: [{
          type: 'ledger-read-error',
          severity: 'critical',
          filePath: this.filePath,
          message: error?.message || String(error),
          recordedAt: new Date().toISOString(),
        }],
        heartbeats: [],
      };
    }
    return {
      version: 2,
      reminders: parsed.reminders || {},
      checkpoints: parsed.checkpoints || {},
      adminNotifications: parsed.adminNotifications || {},
      adminAlertStates: parsed.adminAlertStates || {},
      incidents: parsed.incidents || [],
      heartbeats: parsed.heartbeats || [],
    };
  }

  write(data) {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    const normalized = normalizeLedgerBeforeWrite(data);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    let moved = false;

    try {
      fs.writeFileSync(tmpPath, serialized, 'utf8');

      for (let attempt = 1; attempt <= DEFAULT_WRITE_RETRY_ATTEMPTS; attempt += 1) {
        try {
          fs.renameSync(tmpPath, this.filePath);
          moved = true;
          break;
        } catch (error) {
          if (!isRetryableFilesystemError(error) || attempt === DEFAULT_WRITE_RETRY_ATTEMPTS) {
            throw error;
          }
          sleepSync(DEFAULT_WRITE_RETRY_DELAY_MS * attempt);
        }
      }
    } finally {
      if (!moved && fs.existsSync(tmpPath)) {
        try {
          fs.rmSync(tmpPath, { force: true });
        } catch {
          // O arquivo temporário não substituiu o ledger e pode ser limpo em auditoria posterior.
        }
      }
    }
  }

  getReminder(id) {
    return this.read().reminders[id] || null;
  }

  upsertReminder(id, patch) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const previous = data.reminders[id] || {};
      data.reminders[id] = {
        ...previous,
        ...patch,
        id,
        updatedAt: patch.updatedAt || new Date().toISOString(),
        attemptsLog: patch.attemptsLog || previous.attemptsLog || [],
      };
      this.write(data);
      return data.reminders[id];
    });
  }

  appendAttempt(id, attempt) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const previous = data.reminders[id] || { id, attemptsLog: [] };
      data.reminders[id] = {
        ...previous,
        attemptsLog: [...(previous.attemptsLog || []), attempt],
        updatedAt: attempt.finishedAt || attempt.startedAt || new Date().toISOString(),
      };
      this.write(data);
      return data.reminders[id];
    });
  }

  getCheckpoint(id) {
    return this.read().checkpoints[id] || null;
  }

  upsertCheckpoint(id, patch) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      data.checkpoints[id] = {
        ...(data.checkpoints[id] || {}),
        ...patch,
        id,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
      this.write(data);
      return data.checkpoints[id];
    });
  }

  queueRoutine(id, patch) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const previous = data.checkpoints[id] || {};
      if (['completed', 'completed-with-failures', 'failed', 'skipped', 'expired', REMINDER_LEDGER_STATUSES.MANUAL].includes(previous.status)) {
        return previous;
      }
      data.checkpoints[id] = {
        ...previous,
        ...patch,
        id,
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        queuedAt: previous.queuedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.write(data);
      return data.checkpoints[id];
    });
  }

  claimNextQueuedRoutine({ ownerId = String(process.pid), now = new Date() } = {}) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const nowMs = now.getTime();
      const candidate = Object.values(data.checkpoints)
        .filter(checkpoint => checkpoint.status === REMINDER_LEDGER_STATUSES.QUEUED)
        .filter(checkpoint => !checkpoint.expectedWindowEnd || new Date(checkpoint.expectedWindowEnd).getTime() >= nowMs)
        .sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')))[0];

      if (!candidate) return null;
      data.checkpoints[candidate.id] = {
        ...candidate,
        status: REMINDER_LEDGER_STATUSES.CLAIMED,
        claimedBy: ownerId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.write(data);
      return data.checkpoints[candidate.id];
    });
  }

  expireOverdueQueuedRoutines(now = new Date()) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const nowMs = now.getTime();
      const expired = [];
      for (const checkpoint of Object.values(data.checkpoints)) {
        if (
          [REMINDER_LEDGER_STATUSES.QUEUED, REMINDER_LEDGER_STATUSES.CLAIMED, 'started'].includes(checkpoint.status) &&
          checkpoint.expectedWindowEnd &&
          new Date(checkpoint.expectedWindowEnd).getTime() < nowMs
        ) {
          data.checkpoints[checkpoint.id] = {
            ...checkpoint,
            status: 'expired',
            expiredAt: now.toISOString(),
            blockedReason: 'janela segura encerrada; envio retroativo bloqueado',
            updatedAt: now.toISOString(),
          };
          expired.push(data.checkpoints[checkpoint.id]);
        }
      }
      if (expired.length > 0) this.write(data);
      return expired;
    }) || [];
  }

  appendIncident(incident) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      data.incidents.push({
        ...incident,
        recordedAt: incident.recordedAt || new Date().toISOString(),
      });
      data.incidents = data.incidents.slice(-MAX_LEDGER_INCIDENTS);
      this.write(data);
      return data.incidents[data.incidents.length - 1];
    });
  }

  appendHeartbeat(heartbeat) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      data.heartbeats.push({
        ...heartbeat,
        recordedAt: heartbeat.recordedAt || new Date().toISOString(),
      });
      data.heartbeats = data.heartbeats.slice(-MAX_LEDGER_HEARTBEATS);
      this.write(data);
      return data.heartbeats[data.heartbeats.length - 1];
    });
  }

  getAdminNotification(id) {
    return this.read().adminNotifications?.[id] || null;
  }

  reconcileTechnicalAlerts(options = {}) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const result = reconcileTechnicalAlertData(data, options);
      if (result.queued.length > 0 || result.resolved.length > 0) {
        this.write(data);
      }
      return result;
    }) || { queued: [], suppressed: [], resolved: [] };
  }

  queueAdminNotification(id, patch) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const previous = data.adminNotifications?.[id] || {};
      if (['sent', 'skipped', 'failed', 'expired'].includes(previous.status)) return previous;
      data.adminNotifications = data.adminNotifications || {};
      data.adminNotifications[id] = {
        ...previous,
        ...patch,
        id,
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        queuedAt: previous.queuedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.write(data);
      return data.adminNotifications[id];
    });
  }

  claimNextQueuedAdminNotification({ ownerId = String(process.pid), now = new Date() } = {}) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      data.adminNotifications = data.adminNotifications || {};
      const nowMs = now.getTime();
      const candidate = Object.values(data.adminNotifications)
        .filter(notification => notification.status === REMINDER_LEDGER_STATUSES.QUEUED)
        .filter(notification => !notification.expectedWindowEnd || new Date(notification.expectedWindowEnd).getTime() >= nowMs)
        .sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')))[0];
      if (!candidate) return null;
      data.adminNotifications[candidate.id] = {
        ...candidate,
        status: REMINDER_LEDGER_STATUSES.CLAIMED,
        claimedBy: ownerId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.write(data);
      return data.adminNotifications[candidate.id];
    });
  }

  expireOverdueQueuedAdminNotifications(now = new Date(), {
    technicalAlertMaxAgeMs = DEFAULT_TECHNICAL_ALERT_MAX_AGE_MS,
  } = {}) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      data.adminNotifications = data.adminNotifications || {};
      const nowMs = now.getTime();
      const expired = [];

      for (const notification of Object.values(data.adminNotifications)) {
        if (![REMINDER_LEDGER_STATUSES.QUEUED, REMINDER_LEDGER_STATUSES.CLAIMED].includes(notification.status)) {
          continue;
        }

        let effectiveWindowEnd = notification.expectedWindowEnd || '';
        if (!effectiveWindowEnd && notification.type === 'preventive-preview' && notification.date && notification.routine) {
          try {
            effectiveWindowEnd = createRoutineWindow({
              dateStr: notification.date,
              routine: notification.routine,
            }).end;
          } catch {
            effectiveWindowEnd = '';
          }
        }
        const windowEndMs = effectiveWindowEnd
          ? new Date(effectiveWindowEnd).getTime()
          : Number.NaN;
        const queuedAtMs = notification.queuedAt
          ? new Date(notification.queuedAt).getTime()
          : Number.NaN;
        const windowExpired = Number.isFinite(windowEndMs) && windowEndMs < nowMs;
        const staleTechnicalAlert = ['technical-alert', 'technical-recovery'].includes(notification.type) &&
          Number.isFinite(queuedAtMs) &&
          nowMs - queuedAtMs > technicalAlertMaxAgeMs;

        if (!windowExpired && !staleTechnicalAlert) continue;

        data.adminNotifications[notification.id] = {
          ...notification,
          status: REMINDER_LEDGER_STATUSES.EXPIRED,
          expiredAt: now.toISOString(),
          blockedReason: windowExpired
            ? 'janela segura encerrada; notificação administrativa retroativa bloqueada'
            : 'alerta técnico antigo; envio retroativo bloqueado',
          updatedAt: now.toISOString(),
        };
        expired.push(data.adminNotifications[notification.id]);
      }

      if (expired.length > 0) this.write(data);
      return expired;
    }) || [];
  }

  updateAdminNotification(id, patch) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      data.adminNotifications = data.adminNotifications || {};
      data.adminNotifications[id] = {
        ...(data.adminNotifications[id] || {}),
        ...patch,
        id,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
      this.write(data);
      return data.adminNotifications[id];
    });
  }

  withExclusiveLock(lockName, callback, {
    staleMs = DEFAULT_LOCK_STALE_MS,
    orphanGraceMs = DEFAULT_LOCK_ORPHAN_GRACE_MS,
    waitTimeoutMs = DEFAULT_LOCK_WAIT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_LOCK_RETRY_DELAY_MS,
  } = {}) {
    fs.mkdirSync(this.lockDirectory, { recursive: true });
    const lockPath = path.join(this.lockDirectory, `${lockName}.lock`);
    const ownerToken = `${process.pid}:${Date.now()}:${crypto.randomUUID()}`;
    const waitDeadline = Date.now() + waitTimeoutMs;
    let lastObservedLock = null;

    while (true) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        try {
          fs.writeFileSync(fd, JSON.stringify({
            pid: process.pid,
            ownerToken,
            createdAt: new Date().toISOString(),
            processStartedAt: PROCESS_STARTED_AT,
            host: os.hostname(),
          }));
        } finally {
          fs.closeSync(fd);
        }
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;

        lastObservedLock = inspectLockFile(lockPath);
        if (shouldReclaimLock(lastObservedLock, { staleMs, orphanGraceMs })) {
          try {
            fs.rmSync(lockPath, { force: true });
          } catch (removeError) {
            if (removeError?.code !== 'ENOENT' && !isRetryableFilesystemError(removeError)) {
              throw removeError;
            }
          }
          continue;
        }

        if (Date.now() >= waitDeadline) {
          throw new Error(
            `Tempo limite ao aguardar lock do ledger: ${lockName} (${formatLockOwner(lastObservedLock)})`
          );
        }
        sleepSync(retryDelayMs);
      }
    }

    try {
      return callback();
    } finally {
      try {
        const currentLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (currentLock?.ownerToken === ownerToken) fs.rmSync(lockPath, { force: true });
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          // A falha de limpeza não invalida a operação concluída.
          // O lock contém PID e expiração e será recuperado de forma segura na próxima tentativa.
        }
      }
    }
  }

  queueReminder(id, patch) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const previous = data.reminders[id] || {};
      if (previous.status && isTerminalLedgerStatus(previous.status)) return previous;
      if (previous.status === REMINDER_LEDGER_STATUSES.CLAIMED || previous.status === REMINDER_LEDGER_STATUSES.ATTEMPTING) {
        return previous;
      }
      data.reminders[id] = {
        ...previous,
        ...patch,
        id,
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        queuedAt: previous.queuedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attemptsLog: previous.attemptsLog || [],
      };
      this.write(data);
      return data.reminders[id];
    });
  }

  claimNextQueuedReminder({ ownerId = String(process.pid), now = new Date() } = {}) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const nowMs = now.getTime();
      const candidate = Object.values(data.reminders)
        .filter(reminder => reminder.status === REMINDER_LEDGER_STATUSES.QUEUED)
        .filter(reminder => !reminder.expectedWindowEnd || new Date(reminder.expectedWindowEnd).getTime() >= nowMs)
        .sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')))[0];

      if (!candidate) return null;
      data.reminders[candidate.id] = {
        ...candidate,
        status: REMINDER_LEDGER_STATUSES.CLAIMED,
        claimedBy: ownerId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.write(data);
      return data.reminders[candidate.id];
    });
  }

  expireOverdueQueuedReminders(now = new Date()) {
    return this.withExclusiveLock(DEFAULT_LEDGER_LOCK_NAME, () => {
      const data = this.read();
      const nowMs = now.getTime();
      const expired = [];
      for (const reminder of Object.values(data.reminders)) {
        if (
          [REMINDER_LEDGER_STATUSES.QUEUED, REMINDER_LEDGER_STATUSES.CLAIMED, REMINDER_LEDGER_STATUSES.ATTEMPTING].includes(reminder.status) &&
          reminder.expectedWindowEnd &&
          new Date(reminder.expectedWindowEnd).getTime() < nowMs
        ) {
          data.reminders[reminder.id] = {
            ...reminder,
            status: REMINDER_LEDGER_STATUSES.EXPIRED,
            expiredAt: now.toISOString(),
            blockedReason: 'janela segura encerrada; envio retroativo bloqueado',
            updatedAt: now.toISOString(),
          };
          expired.push(data.reminders[reminder.id]);
        }
      }
      if (expired.length > 0) this.write(data);
      return expired;
    }) || [];
  }
}

export function createMemoryReminderLedger(initialData = {}) {
  let data = {
    version: 2,
    reminders: {},
    checkpoints: {},
    adminNotifications: {},
    adminAlertStates: {},
    incidents: [],
    heartbeats: [],
    ...initialData,
  };

  return {
    read: () => JSON.parse(JSON.stringify(data)),
    write: next => {
      data = JSON.parse(JSON.stringify(next));
    },
    getReminder: id => data.reminders[id] || null,
    upsertReminder: (id, patch) => {
      data.reminders[id] = {
        ...(data.reminders[id] || {}),
        ...patch,
        id,
        updatedAt: patch.updatedAt || new Date().toISOString(),
        attemptsLog: patch.attemptsLog || data.reminders[id]?.attemptsLog || [],
      };
      return data.reminders[id];
    },
    appendAttempt: (id, attempt) => {
      data.reminders[id] = {
        ...(data.reminders[id] || { id }),
        attemptsLog: [...(data.reminders[id]?.attemptsLog || []), attempt],
        updatedAt: attempt.finishedAt || attempt.startedAt || new Date().toISOString(),
      };
      return data.reminders[id];
    },
    getCheckpoint: id => data.checkpoints[id] || null,
    upsertCheckpoint: (id, patch) => {
      data.checkpoints[id] = {
        ...(data.checkpoints[id] || {}),
        ...patch,
        id,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
      return data.checkpoints[id];
    },
    appendIncident: incident => {
      data.incidents.push({ ...incident, recordedAt: incident.recordedAt || new Date().toISOString() });
      data.incidents = data.incidents.slice(-MAX_LEDGER_INCIDENTS);
      return data.incidents[data.incidents.length - 1];
    },
    appendHeartbeat: heartbeat => {
      data.heartbeats.push({ ...heartbeat, recordedAt: heartbeat.recordedAt || new Date().toISOString() });
      data.heartbeats = data.heartbeats.slice(-MAX_LEDGER_HEARTBEATS);
      return data.heartbeats[data.heartbeats.length - 1];
    },
    getAdminNotification: id => data.adminNotifications[id] || null,
    reconcileTechnicalAlerts: (options = {}) => reconcileTechnicalAlertData(data, options),
    queueAdminNotification: (id, patch) => {
      const previous = data.adminNotifications[id] || {};
      if (['sent', 'skipped', 'failed', 'expired'].includes(previous.status)) return previous;
      data.adminNotifications[id] = {
        ...previous,
        ...patch,
        id,
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        queuedAt: previous.queuedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return data.adminNotifications[id];
    },
    claimNextQueuedAdminNotification: ({ ownerId = 'memory', now = new Date() } = {}) => {
      const nowMs = now.getTime();
      const candidate = Object.values(data.adminNotifications)
        .filter(notification => notification.status === REMINDER_LEDGER_STATUSES.QUEUED)
        .filter(notification => !notification.expectedWindowEnd || new Date(notification.expectedWindowEnd).getTime() >= nowMs)
        .sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')))[0];
      if (!candidate) return null;
      data.adminNotifications[candidate.id] = {
        ...candidate,
        status: REMINDER_LEDGER_STATUSES.CLAIMED,
        claimedBy: ownerId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      return data.adminNotifications[candidate.id];
    },
    expireOverdueQueuedAdminNotifications: (now = new Date(), {
      technicalAlertMaxAgeMs = DEFAULT_TECHNICAL_ALERT_MAX_AGE_MS,
    } = {}) => {
      const nowMs = now.getTime();
      const expired = [];
      for (const notification of Object.values(data.adminNotifications)) {
        if (![REMINDER_LEDGER_STATUSES.QUEUED, REMINDER_LEDGER_STATUSES.CLAIMED].includes(notification.status)) {
          continue;
        }
        let effectiveWindowEnd = notification.expectedWindowEnd || '';
        if (!effectiveWindowEnd && notification.type === 'preventive-preview' && notification.date && notification.routine) {
          try {
            effectiveWindowEnd = createRoutineWindow({
              dateStr: notification.date,
              routine: notification.routine,
            }).end;
          } catch {
            effectiveWindowEnd = '';
          }
        }
        const windowEndMs = effectiveWindowEnd
          ? new Date(effectiveWindowEnd).getTime()
          : Number.NaN;
        const queuedAtMs = notification.queuedAt
          ? new Date(notification.queuedAt).getTime()
          : Number.NaN;
        const windowExpired = Number.isFinite(windowEndMs) && windowEndMs < nowMs;
        const staleTechnicalAlert = ['technical-alert', 'technical-recovery'].includes(notification.type) &&
          Number.isFinite(queuedAtMs) &&
          nowMs - queuedAtMs > technicalAlertMaxAgeMs;
        if (!windowExpired && !staleTechnicalAlert) continue;
        data.adminNotifications[notification.id] = {
          ...notification,
          status: REMINDER_LEDGER_STATUSES.EXPIRED,
          expiredAt: now.toISOString(),
          blockedReason: windowExpired
            ? 'janela segura encerrada; notificação administrativa retroativa bloqueada'
            : 'alerta técnico antigo; envio retroativo bloqueado',
          updatedAt: now.toISOString(),
        };
        expired.push(data.adminNotifications[notification.id]);
      }
      return expired;
    },
    updateAdminNotification: (id, patch) => {
      data.adminNotifications[id] = {
        ...(data.adminNotifications[id] || {}),
        ...patch,
        id,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
      return data.adminNotifications[id];
    },
    withExclusiveLock: (_lockName, callback) => callback(),
    queueReminder: (id, patch) => {
      const previous = data.reminders[id] || {};
      if (previous.status && isTerminalLedgerStatus(previous.status)) return previous;
      if ([REMINDER_LEDGER_STATUSES.CLAIMED, REMINDER_LEDGER_STATUSES.ATTEMPTING].includes(previous.status)) return previous;
      data.reminders[id] = {
        ...previous,
        ...patch,
        id,
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        queuedAt: previous.queuedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attemptsLog: previous.attemptsLog || [],
      };
      return data.reminders[id];
    },
    claimNextQueuedReminder: ({ ownerId = 'memory', now = new Date() } = {}) => {
      const nowMs = now.getTime();
      const candidate = Object.values(data.reminders)
        .filter(reminder => reminder.status === REMINDER_LEDGER_STATUSES.QUEUED)
        .filter(reminder => !reminder.expectedWindowEnd || new Date(reminder.expectedWindowEnd).getTime() >= nowMs)
        .sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')))[0];
      if (!candidate) return null;
      data.reminders[candidate.id] = {
        ...candidate,
        status: REMINDER_LEDGER_STATUSES.CLAIMED,
        claimedBy: ownerId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      return data.reminders[candidate.id];
    },
    expireOverdueQueuedReminders: (now = new Date()) => {
      const nowMs = now.getTime();
      const expired = [];
      for (const reminder of Object.values(data.reminders)) {
        if (
          [REMINDER_LEDGER_STATUSES.QUEUED, REMINDER_LEDGER_STATUSES.CLAIMED, REMINDER_LEDGER_STATUSES.ATTEMPTING].includes(reminder.status) &&
          reminder.expectedWindowEnd &&
          new Date(reminder.expectedWindowEnd).getTime() < nowMs
        ) {
          data.reminders[reminder.id] = {
            ...reminder,
            status: REMINDER_LEDGER_STATUSES.EXPIRED,
            expiredAt: now.toISOString(),
            blockedReason: 'janela segura encerrada; envio retroativo bloqueado',
            updatedAt: now.toISOString(),
          };
          expired.push(data.reminders[reminder.id]);
        }
      }
      return expired;
    },
    queueRoutine: (id, patch) => {
      const previous = data.checkpoints[id] || {};
      if (['completed', 'completed-with-failures', 'failed', 'skipped', 'expired', REMINDER_LEDGER_STATUSES.MANUAL].includes(previous.status)) return previous;
      data.checkpoints[id] = {
        ...previous,
        ...patch,
        id,
        status: REMINDER_LEDGER_STATUSES.QUEUED,
        queuedAt: previous.queuedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return data.checkpoints[id];
    },
    claimNextQueuedRoutine: ({ ownerId = 'memory', now = new Date() } = {}) => {
      const nowMs = now.getTime();
      const candidate = Object.values(data.checkpoints)
        .filter(checkpoint => checkpoint.status === REMINDER_LEDGER_STATUSES.QUEUED)
        .filter(checkpoint => !checkpoint.expectedWindowEnd || new Date(checkpoint.expectedWindowEnd).getTime() >= nowMs)
        .sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')))[0];
      if (!candidate) return null;
      data.checkpoints[candidate.id] = {
        ...candidate,
        status: REMINDER_LEDGER_STATUSES.CLAIMED,
        claimedBy: ownerId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      return data.checkpoints[candidate.id];
    },
    expireOverdueQueuedRoutines: (now = new Date()) => {
      const nowMs = now.getTime();
      const expired = [];
      for (const checkpoint of Object.values(data.checkpoints)) {
        if (
          [REMINDER_LEDGER_STATUSES.QUEUED, REMINDER_LEDGER_STATUSES.CLAIMED, 'started'].includes(checkpoint.status) &&
          checkpoint.expectedWindowEnd &&
          new Date(checkpoint.expectedWindowEnd).getTime() < nowMs
        ) {
          data.checkpoints[checkpoint.id] = {
            ...checkpoint,
            status: 'expired',
            expiredAt: now.toISOString(),
            blockedReason: 'janela segura encerrada; envio retroativo bloqueado',
            updatedAt: now.toISOString(),
          };
          expired.push(data.checkpoints[checkpoint.id]);
        }
      }
      return expired;
    },
  };
}

export function normalizeReminderForLedger({ accountId, reminder, routine, routineDate, window, source = 'automatic' }) {
  const sessionDate = reminder.sessionDate || routineDate;
  const sessionTime = reminder.time || reminder.sessionTime || '';
  const reminderType = reminder.reminderType || routine;
  const id = buildReminderLedgerId({
    accountId,
    patientId: reminder.patientId,
    guardianName: reminder.guardianName,
    phone: reminder.phone || reminder.whatsapp,
    sessionDate,
    sessionTime,
    reminderType,
    routine,
  });

  return {
    id,
    accountId,
    patientId: reminder.patientId || '',
    patientName: reminder.patientName || '',
    guardianName: reminder.guardianName || '',
    responsibleName: reminder.responsibleName || reminder.guardianName || '',
    responsibleRelationship: reminder.responsibleRelationship || 'não informado',
    responsiblePhoneSource: reminder.responsiblePhoneSource || '',
    phoneHash: hashPhone(reminder.phone || reminder.whatsapp),
    phoneMasked: reminder.phoneMasked || maskPhone(reminder.phone || reminder.whatsapp),
    sessionDate,
    sessionTime,
    reminderType,
    routine,
    expectedWindowStart: window?.start || '',
    expectedWindowEnd: window?.end || '',
    source,
    ruleVersion: 'whatsapp-reminder-ledger-v1',
  };
}

function normalizeReminderGroupingText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function createReminderGroupingKey({ accountId, reminder, routine, routineDate }) {
  const responsibleIdentity = reminder?.responsibleId
    || reminder?.guardianId
    || reminder?.responsibleUid
    || reminder?.responsibleName
    || reminder?.guardianName
    || 'unknown-responsible';
  const phoneHash = hashPhone(reminder?.phone || reminder?.whatsapp);
  const sessionDate = reminder?.sessionDate || routineDate || '';
  const batch = routine || reminder?.reminderType || '';

  return [
    accountId || 'unknown-account',
    normalizeReminderGroupingText(responsibleIdentity),
    phoneHash,
    sessionDate,
    batch,
  ].join('|');
}

function formatReminderDayTime(reminder) {
  return reminder?.timeFormatted || reminder?.time || '';
}

function joinReminderParts(parts) {
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length === 2) return `${parts[0]} e ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

export function buildConsolidatedReminderMessage({ reminders, routine }) {
  const ordered = [...(reminders || [])].sort((a, b) => {
    const timeA = String(a?.time || a?.sessionTime || '');
    const timeB = String(b?.time || b?.sessionTime || '');
    return timeA.localeCompare(timeB) || String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  if (ordered.length === 0) return '';
  if (ordered.length === 1) return ordered[0].message || '';

  const greeting = routine === 'HOJE_TARDE' ? 'Boa tarde' : 'Bom dia';
  if (routine === 'AMANHA') {
    const first = ordered[0];
    const guardianName = String(first.responsibleName || first.guardianName || '').trim();
    const firstPart = `das sessões de *${String(first.patientName || '').trim()}* amanhã, às *${String(first.time || first.sessionTime || '').trim()}*`;
    const remainingParts = ordered.slice(1).map(reminder => `de *${String(reminder.patientName || '').trim()}*, às *${String(reminder.time || reminder.sessionTime || '').trim()}*`);
    const remainingText = remainingParts.length === 1
      ? `e ${remainingParts[0]}`
      : `${remainingParts.slice(0, -1).join(', ')}, e ${remainingParts.at(-1)}`;
    return `${greeting}! Olá, ${guardianName}, tudo bem?\n\nPassando para lembrar você ${firstPart}${remainingParts.length ? `, ${remainingText}` : ''}.\n\nAguardo sua confirmação,\nAté logo!`;
  }

  const parts = ordered.map(reminder => `*${String(reminder.patientName || '').trim()} às ${formatReminderDayTime(reminder)}*`);
  return `${greeting}!\nAguardo vocês hoje: ${joinReminderParts(parts)}!\nAté logo! 🙏🏼`;
}

export function isRetryableWhatsappError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return SAFE_RETRY_MESSAGES.some(fragment => message.includes(fragment));
}

export function isTerminalLedgerStatus(status) {
  return [
    REMINDER_LEDGER_STATUSES.CONFIRMED,
    REMINDER_LEDGER_STATUSES.MANUAL,
    REMINDER_LEDGER_STATUSES.SUPPRESSED,
    REMINDER_LEDGER_STATUSES.EXPIRED,
  ].includes(status);
}

export function createRoutineCheckpointId({ dateStr, routine, accountId = 'all' }) {
  return `${dateStr}:${routine}:${accountId}`;
}

export function buildRoutineDeliveryAccounting({
  expectedCount = 0,
  createdCount = 0,
  enqueuedCount = 0,
  confirmedCount = 0,
  manualCount = 0,
  skippedCount = 0,
  failedCount = 0,
} = {}) {
  const counts = Object.fromEntries(Object.entries({
    expectedCount,
    createdCount,
    enqueuedCount,
    confirmedCount,
    manualCount,
    skippedCount,
    failedCount,
  }).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
  const resolvedCount = counts.confirmedCount + counts.manualCount + counts.skippedCount;
  const unresolvedCount = Math.max(0, counts.expectedCount - resolvedCount);
  const effectiveFailedCount = Math.max(counts.failedCount, unresolvedCount);

  let outcome = ROUTINE_DELIVERY_OUTCOMES.FAILED_REQUIRES_ACTION;
  if (counts.expectedCount === 0 || (unresolvedCount === 0 && effectiveFailedCount === 0)) {
    if (counts.manualCount > 0) outcome = ROUTINE_DELIVERY_OUTCOMES.MANUAL_HANDLED_BY_ADMIN;
    else if (counts.skippedCount > 0 || counts.expectedCount === 0) outcome = ROUTINE_DELIVERY_OUTCOMES.SKIPPED_VALID_REASON;
    else outcome = ROUTINE_DELIVERY_OUTCOMES.SENT_CONFIRMED;
  }

  return {
    ...counts,
    failedCount: effectiveFailedCount,
    resolvedCount,
    unresolvedCount,
    deliveryOutcome: outcome,
    deliveryComplete: unresolvedCount === 0 && effectiveFailedCount === 0,
  };
}

export function detectRoutineDeliveryGaps({ ledger, now = new Date() } = {}) {
  const data = typeof ledger?.read === 'function' ? ledger.read() : (ledger || {});
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (!Number.isFinite(nowMs)) return [];

  return Object.values(data.checkpoints || {}).flatMap(checkpoint => {
    if (!checkpoint?.routine || checkpoint.routine === 'WATCHDOG') return [];
    if (checkpoint.deliveryAccountingVersion !== 1) return [];
    const expectedCount = Number(checkpoint.expectedCount ?? checkpoint.plannedCount ?? 0) || 0;
    const windowEndMs = new Date(checkpoint.expectedWindowEnd || 0).getTime();
    if (expectedCount <= 0 || !Number.isFinite(windowEndMs) || windowEndMs >= nowMs) return [];

    const accounting = buildRoutineDeliveryAccounting({
      expectedCount,
      createdCount: checkpoint.createdCount,
      enqueuedCount: checkpoint.enqueuedCount ?? checkpoint.queuedCount,
      confirmedCount: checkpoint.confirmedCount,
      manualCount: checkpoint.manualCount,
      skippedCount: checkpoint.skippedCount ?? checkpoint.blockedCount,
      failedCount: checkpoint.failedCount,
    });
    if (accounting.deliveryComplete || checkpoint.deliveryResolution === ROUTINE_DELIVERY_OUTCOMES.MANUAL_HANDLED_BY_ADMIN) return [];

    return [{
      type: 'routine-delivery-missing',
      severity: 'high',
      stateCode: 'expected-without-confirmation',
      date: checkpoint.date,
      routine: checkpoint.routine,
      expectedCount: accounting.expectedCount,
      confirmedCount: accounting.confirmedCount,
      message: `Rotina ${checkpoint.scheduledTime || checkpoint.routine} executada, mas ${accounting.confirmedCount} de ${accounting.expectedCount} mensagens possuem confirmação de entrega.`,
    }];
  });
}

export function createRoutineWindow({ dateStr, routine }) {
  const definition = ROUTINE_DEFINITIONS[routine];
  if (!definition) throw new Error(`Rotina desconhecida: ${routine}`);
  const start = new Date(`${dateStr}T${definition.scheduledTime}:00`);
  const end = new Date(start.getTime() + definition.windowMinutes * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    scheduledTime: definition.scheduledTime,
    windowMinutes: definition.windowMinutes,
  };
}

export function isWatchdogStartupGraceActive({
  startedAt,
  now = new Date(),
  graceMs = DEFAULT_WATCHDOG_STARTUP_GRACE_MS,
} = {}) {
  const startMs = startedAt instanceof Date
    ? startedAt.getTime()
    : new Date(startedAt || 0).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const effectiveGraceMs = Math.max(0, Number(graceMs) || 0);

  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return false;
  if (nowMs < startMs) return false;
  return nowMs - startMs < effectiveGraceMs;
}

export function findRecoverableRoutineCheckpoints({
  ledger,
  now = new Date(),
  routines = ROUTINE_DEFINITIONS,
  recoveryDelayMs = DEFAULT_SCHEDULER_RECOVERY_DELAY_MS,
} = {}) {
  const data = typeof ledger?.read === 'function'
    ? ledger.read()
    : (ledger || {});
  const checkpoints = data.checkpoints || {};
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const dateStr = formatLocalDateStr(nowDate);
  const weekday = new Date(`${dateStr}T12:00:00`).getDay();
  const delayMs = Math.max(0, Number(recoveryDelayMs) || 0);
  const recoverable = [];

  for (const [routine, definition] of Object.entries(routines || {})) {
    if (definition.skipWeekdays.includes(weekday)) continue;

    const window = createRoutineWindow({ dateStr, routine });
    const startMs = new Date(window.start).getTime();
    const endMs = new Date(window.end).getTime();
    if (nowMs < startMs + delayMs || nowMs > endMs) continue;

    const checkpointId = createRoutineCheckpointId({ dateStr, routine });
    if (checkpoints[checkpointId]) continue;

    recoverable.push({
      id: checkpointId,
      date: dateStr,
      routine,
      scheduledTime: window.scheduledTime,
      expectedWindowStart: window.start,
      expectedWindowEnd: window.end,
      recoveryDelayMs: delayMs,
    });
  }

  return recoverable;
}

export function classifyMissedRoutineForAlert({
  ledger,
  incident,
  now = new Date(),
} = {}) {
  if (!incident || incident.type !== 'missed-routine') {
    return { notifyAdmin: true, reason: 'not-missed-routine', incident };
  }

  const data = typeof ledger?.read === 'function'
    ? ledger.read()
    : (ledger || {});
  const previewId = `admin-preview:${incident.date}:${incident.routine}`;
  const preview = data.adminNotifications?.[previewId] || null;
  const entries = Array.isArray(preview?.previewSnapshot?.entries)
    ? preview.previewSnapshot.entries
    : [];
  const eligibleCount = entries.filter(entry => entry?.state === 'eligible').length;
  const explicitlyNoDemand = (
    preview?.status === REMINDER_LEDGER_STATUSES.SKIPPED &&
    /nenhuma mensagem elegível|sem atividade administrativa relevante/i.test(String(preview?.blockedReason || ''))
  ) || (
    preview?.status === 'sent' &&
    preview?.previewSnapshot &&
    eligibleCount === 0
  );

  if (explicitlyNoDemand) {
    return {
      notifyAdmin: false,
      reason: 'no-eligible-demand',
      incident: {
        ...incident,
        severity: 'info',
        stateCode: 'no-eligible-demand',
        message: `Rotina ${incident.routine} sem checkpoint, mas a prévia confirmou ausência de avisos elegíveis.`,
      },
    };
  }

  if (preview?.status === 'sent' && eligibleCount > 0) {
    return {
      notifyAdmin: true,
      reason: 'eligible-demand-confirmed',
      incident: {
        ...incident,
        severity: 'high',
        stateCode: 'eligible-demand-missed',
        message: `Rotina ${incident.routine} não iniciou apesar de ${eligibleCount} aviso(s) elegível(is) confirmado(s) na prévia.`,
      },
    };
  }

  const today = formatLocalDateStr(now instanceof Date ? now : new Date(now));
  if (incident.date && incident.date < today) {
    return {
      notifyAdmin: true,
      reason: 'historical-alert-preserved',
      incident,
    };
  }

  return {
    notifyAdmin: true,
    reason: 'demand-unverified',
    incident: {
      ...incident,
      type: 'routine-demand-unverified',
      severity: 'medium',
      stateCode: 'preview-unavailable',
      message: `Rotina ${incident.routine} sem checkpoint; a prévia não permitiu confirmar se havia avisos elegíveis.`,
    },
  };
}

export function createReminderDeliveryService({
  mode = resolveWhatsappOperationMode(),
  ledger = new JsonReminderLedger(),
  sender,
  now = () => new Date(),
  maxAttempts = 2,
  retryDelayMs = 0,
  logger = console,
  shouldBlockReminder = null,
} = {}) {
  async function processReminder({ accountId, reminder, routine, routineDate, window, source = 'automatic' }) {
    const ledgerBase = normalizeReminderForLedger({ accountId, reminder, routine, routineDate, window, source });
    const previous = ledger.getReminder(ledgerBase.id);

    if (previous && isTerminalLedgerStatus(previous.status)) {
      return {
        ...previous,
        skippedReason: `status terminal existente: ${previous.status}`,
      };
    }

    ledger.upsertReminder(ledgerBase.id, {
      ...ledgerBase,
      status: REMINDER_LEDGER_STATUSES.ELIGIBLE,
      attempts: previous?.attempts || 0,
      plannedAt: previous?.plannedAt || now().toISOString(),
    });

    if (mode === WHATSAPP_OPERATION_MODES.DISABLED || mode === WHATSAPP_OPERATION_MODES.DRY_RUN) {
      return ledger.upsertReminder(ledgerBase.id, {
        ...ledgerBase,
        status: REMINDER_LEDGER_STATUSES.SKIPPED,
        blockedReason: `modo operacional ${mode}: envio real desativado`,
        attempts: previous?.attempts || 0,
      });
    }

    if (mode !== WHATSAPP_OPERATION_MODES.LIVE) {
      throw new Error(`Modo operacional inválido: ${mode}`);
    }

    if (!sender || typeof sender.sendMessage !== 'function') {
      throw new Error('Sender WhatsApp não configurado para modo live.');
    }

    let lastError = null;
    const attemptsAlreadyUsed = previous?.attempts || 0;

    for (let attempt = attemptsAlreadyUsed + 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof shouldBlockReminder === 'function') {
        const blockResult = await shouldBlockReminder({
          accountId,
          reminder,
          routine,
          routineDate,
          phase: attempt > 1 ? 'retry' : 'send',
          attempt,
        });
        if (blockResult?.blocked) {
          return ledger.upsertReminder(ledgerBase.id, {
            ...ledgerBase,
            status: REMINDER_LEDGER_STATUSES.SKIPPED,
            blockedReason: blockResult.reason || 'mensagem automática bloqueada na Agenda',
            attempts: Math.max(previous?.attempts || 0, attempt - 1),
            blockedAt: now().toISOString(),
          });
        }
      }
      const attemptStartedAt = now().toISOString();
      ledger.upsertReminder(ledgerBase.id, {
        ...ledgerBase,
        status: REMINDER_LEDGER_STATUSES.ATTEMPTING,
        attemptStartedAt,
        attempts: attempt,
      });

      try {
        await sender.sendMessage(reminder.phone, reminder.message);
        const confirmedAt = now().toISOString();
        ledger.appendAttempt(ledgerBase.id, {
          attempt,
          status: REMINDER_LEDGER_STATUSES.CONFIRMED,
          startedAt: attemptStartedAt,
          finishedAt: confirmedAt,
        });
        logger.log(`[ENVIO CONFIRMADO] ${ledgerBase.patientName} (${ledgerBase.phoneMasked})`);
        return ledger.upsertReminder(ledgerBase.id, {
          ...ledgerBase,
          status: REMINDER_LEDGER_STATUSES.CONFIRMED,
          confirmedAt,
          attempts: attempt,
        });
      } catch (error) {
        lastError = error;
        const failedAt = now().toISOString();
        const retryable = isRetryableWhatsappError(error);
        ledger.appendAttempt(ledgerBase.id, {
          attempt,
          status: REMINDER_LEDGER_STATUSES.FAILED,
          startedAt: attemptStartedAt,
          finishedAt: failedAt,
          error: error?.message || String(error),
          retryable,
        });
        ledger.upsertReminder(ledgerBase.id, {
          ...ledgerBase,
          status: REMINDER_LEDGER_STATUSES.FAILED,
          failedAt,
          attempts: attempt,
          error: error?.message || String(error),
        });

        if (!retryable || attempt >= maxAttempts) break;
        if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }

    return ledger.upsertReminder(ledgerBase.id, {
      ...ledgerBase,
      status: REMINDER_LEDGER_STATUSES.FAILED,
      attempts: Math.max(previous?.attempts || 0, maxAttempts),
      error: lastError?.message || String(lastError || 'Falha desconhecida'),
    });
  }

  async function processReminderGroup({ accountId, reminders, routine, routineDate, window, source = 'automatic' }) {
    const entries = (reminders || []).map(reminder => {
      const ledgerBase = normalizeReminderForLedger({ accountId, reminder, routine, routineDate, window, source });
      return { reminder, ledgerBase, previous: ledger.getReminder(ledgerBase.id) };
    });
    const resultById = new Map();

    for (const entry of entries) {
      if (entry.previous && isTerminalLedgerStatus(entry.previous.status)) {
        resultById.set(entry.ledgerBase.id, {
          ...entry.previous,
          skippedReason: `status terminal existente: ${entry.previous.status}`,
        });
        continue;
      }

      ledger.upsertReminder(entry.ledgerBase.id, {
        ...entry.ledgerBase,
        status: REMINDER_LEDGER_STATUSES.ELIGIBLE,
        attempts: entry.previous?.attempts || 0,
        plannedAt: entry.previous?.plannedAt || now().toISOString(),
      });
    }

    const pending = entries.filter(entry => !resultById.has(entry.ledgerBase.id));
    if (pending.length === 0) return entries.map(entry => resultById.get(entry.ledgerBase.id));

    if (mode === WHATSAPP_OPERATION_MODES.DISABLED || mode === WHATSAPP_OPERATION_MODES.DRY_RUN) {
      for (const entry of pending) {
        resultById.set(entry.ledgerBase.id, ledger.upsertReminder(entry.ledgerBase.id, {
          ...entry.ledgerBase,
          status: REMINDER_LEDGER_STATUSES.SKIPPED,
          blockedReason: `modo operacional ${mode}: envio real desativado`,
          attempts: entry.previous?.attempts || 0,
        }));
      }
      return entries.map(entry => resultById.get(entry.ledgerBase.id));
    }

    if (mode !== WHATSAPP_OPERATION_MODES.LIVE) {
      throw new Error(`Modo operacional inválido: ${mode}`);
    }

    if (!sender || typeof sender.sendMessage !== 'function') {
      throw new Error('Sender WhatsApp não configurado para modo live.');
    }

    const sendable = [];
    for (const entry of pending) {
      if (typeof shouldBlockReminder === 'function') {
        const blockResult = await shouldBlockReminder({
          accountId,
          reminder: entry.reminder,
          routine,
          routineDate,
          phase: 'send',
          attempt: (entry.previous?.attempts || 0) + 1,
        });
        if (blockResult?.blocked) {
          resultById.set(entry.ledgerBase.id, ledger.upsertReminder(entry.ledgerBase.id, {
            ...entry.ledgerBase,
            status: REMINDER_LEDGER_STATUSES.SKIPPED,
            blockedReason: blockResult.reason || 'mensagem automática bloqueada na Agenda',
            attempts: entry.previous?.attempts || 0,
            blockedAt: now().toISOString(),
          }));
          continue;
        }
      }
      sendable.push(entry);
    }

    if (sendable.length === 0) return entries.map(entry => resultById.get(entry.ledgerBase.id));

    const message = buildConsolidatedReminderMessage({
      reminders: sendable.map(entry => entry.reminder),
      routine,
    });
    const attemptsAlreadyUsed = Math.max(...sendable.map(entry => entry.previous?.attempts || 0));
    let lastError = null;

    for (let attempt = attemptsAlreadyUsed + 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAt = now().toISOString();
      for (const entry of sendable) {
        ledger.upsertReminder(entry.ledgerBase.id, {
          ...entry.ledgerBase,
          status: REMINDER_LEDGER_STATUSES.ATTEMPTING,
          attemptStartedAt,
          attempts: attempt,
        });
      }

      try {
        await sender.sendMessage(sendable[0].reminder.phone, message);
        const confirmedAt = now().toISOString();
        for (const entry of sendable) {
          ledger.appendAttempt(entry.ledgerBase.id, {
            attempt,
            status: REMINDER_LEDGER_STATUSES.CONFIRMED,
            startedAt: attemptStartedAt,
            finishedAt: confirmedAt,
          });
          resultById.set(entry.ledgerBase.id, {
            ...ledger.upsertReminder(entry.ledgerBase.id, {
              ...entry.ledgerBase,
              status: REMINDER_LEDGER_STATUSES.CONFIRMED,
              confirmedAt,
              attempts: attempt,
            }),
            message,
            groupSize: sendable.length,
          });
        }
        logger.log(`[ENVIO CONFIRMADO] grupo de ${sendable.length} lembrete(s) (${sendable[0].ledgerBase.phoneMasked})`);
        return entries.map(entry => resultById.get(entry.ledgerBase.id));
      } catch (error) {
        lastError = error;
        const failedAt = now().toISOString();
        const retryable = isRetryableWhatsappError(error);
        for (const entry of sendable) {
          ledger.appendAttempt(entry.ledgerBase.id, {
            attempt,
            status: REMINDER_LEDGER_STATUSES.FAILED,
            startedAt: attemptStartedAt,
            finishedAt: failedAt,
            error: error?.message || String(error),
            retryable,
          });
          ledger.upsertReminder(entry.ledgerBase.id, {
            ...entry.ledgerBase,
            status: REMINDER_LEDGER_STATUSES.FAILED,
            failedAt,
            attempts: attempt,
            error: error?.message || String(error),
          });
        }

        if (!retryable || attempt >= maxAttempts) break;
        if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }

    for (const entry of sendable) {
      resultById.set(entry.ledgerBase.id, ledger.upsertReminder(entry.ledgerBase.id, {
        ...entry.ledgerBase,
        status: REMINDER_LEDGER_STATUSES.FAILED,
        attempts: Math.max(entry.previous?.attempts || 0, maxAttempts),
        error: lastError?.message || String(lastError || 'Falha desconhecida'),
      }));
    }

    return entries.map(entry => resultById.get(entry.ledgerBase.id));
  }

  async function processPlan({ accountId, plan, routine, routineDate, window, source = 'automatic' }) {
    const results = [];
    const groups = new Map();
    for (const reminder of plan.reminders || []) {
      const key = createReminderGroupingKey({ accountId, reminder, routine, routineDate });
      const group = groups.get(key) || [];
      group.push(reminder);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      try {
        const groupResults = group.length === 1
          ? [await processReminder({ accountId, reminder: group[0], routine, routineDate, window, source })]
          : await processReminderGroup({ accountId, reminders: group, routine, routineDate, window, source });
        results.push(...groupResults);
      } catch (error) {
        logger.error(`[LEDGER] Falha isolada no grupo de ${group.length} lembrete(s):`, error.message);
        results.push(...group.map(reminder => ({
          id: reminder.id,
          patientId: reminder.patientId,
          patientName: reminder.patientName,
          status: REMINDER_LEDGER_STATUSES.FAILED,
          error: error.message,
        })));
      }
    }
    return results;
  }

  return { processReminder, processPlan };
}

export function detectMissedRoutineCheckpoints({
  ledger,
  now = new Date(),
  lookbackDays = 2,
  routines = ROUTINE_DEFINITIONS,
} = {}) {
  const data = ledger.read();
  const incidents = [];
  const today = formatLocalDateStr(now);

  for (let dayOffset = lookbackDays; dayOffset >= 0; dayOffset -= 1) {
    const dateStr = addLocalDays(today, -dayOffset);
    const weekday = new Date(`${dateStr}T12:00:00`).getDay();

    for (const [routine, definition] of Object.entries(routines)) {
      if (definition.skipWeekdays.includes(weekday)) continue;
      const scheduledAt = new Date(`${dateStr}T${definition.scheduledTime}:00`);
      const safeWindowEnd = new Date(scheduledAt.getTime() + definition.windowMinutes * 60 * 1000);
      if (safeWindowEnd > now) continue;

      const matching = Object.values(data.checkpoints).filter(checkpoint =>
        checkpoint.date === dateStr && checkpoint.routine === routine
      );
      if (matching.length === 0) {
        incidents.push({
          type: 'missed-routine',
          date: dateStr,
          routine,
          scheduledTime: definition.scheduledTime,
          severity: 'high',
          message: `Rotina ${routine} sem checkpoint em ${dateStr} ${definition.scheduledTime}.`,
        });
      } else if (matching.some(checkpoint => checkpoint.status === 'started')) {
        incidents.push({
          type: 'incomplete-routine',
          date: dateStr,
          routine,
          scheduledTime: definition.scheduledTime,
          severity: 'high',
          message: `Rotina ${routine} iniciada e não concluída em ${dateStr}.`,
        });
      }
    }
  }

  return incidents;
}

export function buildWhatsappHealthSnapshot({
  expectedScriptPath,
  pm2Process,
  whatsappReady = false,
  schedulerRegistered = false,
  lastHeartbeat,
  lastRoutineCheckpoints = [],
  logFiles = [],
  restarts = 0,
} = {}) {
  const actualScriptPath = pm2Process?.pm2_env?.pm_exec_path || pm2Process?.scriptPath || '';
  const processPid = pm2Process?.pid || pm2Process?.pm_id || null;
  const scriptPathMatches = expectedScriptPath
    ? path.resolve(actualScriptPath).toLowerCase() === path.resolve(expectedScriptPath).toLowerCase()
    : Boolean(actualScriptPath);

  const checks = {
    processPidPresent: Boolean(processPid),
    scriptPathMatches,
    whatsappReady: Boolean(whatsappReady),
    schedulerRegistered: Boolean(schedulerRegistered),
    heartbeatPresent: Boolean(lastHeartbeat),
    restartsAcceptable: Number(restarts || 0) < 3,
    logsWithinSize: logFiles.every(file => Number(file.size || 0) < 50 * 1024 * 1024),
    diskInfoAvailable: true,
  };

  return {
    status: Object.values(checks).every(Boolean) ? 'healthy' : 'attention',
    checks,
    processPid,
    actualScriptPath,
    expectedScriptPath,
    lastHeartbeat,
    lastRoutineCheckpoints,
    host: os.hostname(),
    checkedAt: new Date().toISOString(),
  };
}
