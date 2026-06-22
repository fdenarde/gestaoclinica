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

export const ROUTINE_DEFINITIONS = Object.freeze({
  HOJE_MANHA: { scheduledTime: '06:30', preventiveTime: '06:15', skipWeekdays: [0], windowMinutes: 45 },
  AMANHA: { scheduledTime: '09:00', preventiveTime: '08:45', skipWeekdays: [6], windowMinutes: 60 },
  HOJE_TARDE: { scheduledTime: '12:30', preventiveTime: '12:15', skipWeekdays: [0], windowMinutes: 45 },
});

export const DEFAULT_LEDGER_PATH = path.resolve('logs', 'audit', 'whatsapp-reminder-ledger.json');
export const DEFAULT_LOCK_DIRECTORY = path.resolve('logs', 'locks');

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
    data.adminAlertStates[key] = {
      ...state,
      status: 'resolved',
      resolvedAt: timestamp,
      updatedAt: timestamp,
    };
    resolved.push({ key, state: data.adminAlertStates[key] });
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
  constructor(filePath = DEFAULT_LEDGER_PATH) {
    this.filePath = filePath;
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
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmpPath, this.filePath);
  }

  getReminder(id) {
    return this.read().reminders[id] || null;
  }

  upsertReminder(id, patch) {
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
  }

  appendAttempt(id, attempt) {
    const data = this.read();
    const previous = data.reminders[id] || { id, attemptsLog: [] };
    data.reminders[id] = {
      ...previous,
      attemptsLog: [...(previous.attemptsLog || []), attempt],
      updatedAt: attempt.finishedAt || attempt.startedAt || new Date().toISOString(),
    };
    this.write(data);
    return data.reminders[id];
  }

  getCheckpoint(id) {
    return this.read().checkpoints[id] || null;
  }

  upsertCheckpoint(id, patch) {
    const data = this.read();
    data.checkpoints[id] = {
      ...(data.checkpoints[id] || {}),
      ...patch,
      id,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };
    this.write(data);
    return data.checkpoints[id];
  }

  queueRoutine(id, patch) {
    return this.withExclusiveLock('whatsapp-ledger', () => {
      const data = this.read();
      const previous = data.checkpoints[id] || {};
      if (['completed', 'completed-with-failures', 'failed', 'skipped', 'expired'].includes(previous.status)) {
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
    return this.withExclusiveLock('whatsapp-ledger', () => {
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
    return this.withExclusiveLock('whatsapp-ledger', () => {
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
    const data = this.read();
    data.incidents.push({
      ...incident,
      recordedAt: incident.recordedAt || new Date().toISOString(),
    });
    this.write(data);
    return data.incidents[data.incidents.length - 1];
  }

  appendHeartbeat(heartbeat) {
    const data = this.read();
    data.heartbeats.push({
      ...heartbeat,
      recordedAt: heartbeat.recordedAt || new Date().toISOString(),
    });
    data.heartbeats = data.heartbeats.slice(-288);
    this.write(data);
    return data.heartbeats[data.heartbeats.length - 1];
  }

  getAdminNotification(id) {
    return this.read().adminNotifications?.[id] || null;
  }

  reconcileTechnicalAlerts(options = {}) {
    return this.withExclusiveLock('whatsapp-ledger', () => {
      const data = this.read();
      const result = reconcileTechnicalAlertData(data, options);
      if (result.queued.length > 0 || result.resolved.length > 0 || result.suppressed.length > 0) {
        this.write(data);
      }
      return result;
    }) || { queued: [], suppressed: [], resolved: [] };
  }

  queueAdminNotification(id, patch) {
    return this.withExclusiveLock('whatsapp-ledger', () => {
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
    return this.withExclusiveLock('whatsapp-ledger', () => {
      const data = this.read();
      data.adminNotifications = data.adminNotifications || {};
      const candidate = Object.values(data.adminNotifications)
        .filter(notification => notification.status === REMINDER_LEDGER_STATUSES.QUEUED)
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

  updateAdminNotification(id, patch) {
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
  }

  withExclusiveLock(lockName, callback, { staleMs = 10 * 60 * 1000 } = {}) {
    fs.mkdirSync(DEFAULT_LOCK_DIRECTORY, { recursive: true });
    const lockPath = path.join(DEFAULT_LOCK_DIRECTORY, `${lockName}.lock`);
    const now = Date.now();

    try {
      const stats = fs.existsSync(lockPath) ? fs.statSync(lockPath) : null;
      if (stats && now - stats.mtimeMs > staleMs) fs.rmSync(lockPath, { force: true });
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      fs.closeSync(fd);
    } catch (error) {
      if (error?.code === 'EEXIST') return null;
      throw error;
    }

    try {
      return callback();
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  }

  queueReminder(id, patch) {
    return this.withExclusiveLock('whatsapp-ledger', () => {
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
    return this.withExclusiveLock('whatsapp-ledger', () => {
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
    return this.withExclusiveLock('whatsapp-ledger', () => {
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
      return data.incidents[data.incidents.length - 1];
    },
    appendHeartbeat: heartbeat => {
      data.heartbeats.push({ ...heartbeat, recordedAt: heartbeat.recordedAt || new Date().toISOString() });
      data.heartbeats = data.heartbeats.slice(-288);
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
      const candidate = Object.values(data.adminNotifications)
        .filter(notification => notification.status === REMINDER_LEDGER_STATUSES.QUEUED)
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
      if (['completed', 'completed-with-failures', 'failed', 'skipped', 'expired'].includes(previous.status)) return previous;
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

export function createReminderDeliveryService({
  mode = resolveWhatsappOperationMode(),
  ledger = new JsonReminderLedger(),
  sender,
  now = () => new Date(),
  maxAttempts = 2,
  retryDelayMs = 0,
  logger = console,
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

  async function processPlan({ accountId, plan, routine, routineDate, window, source = 'automatic' }) {
    const results = [];
    for (const reminder of plan.reminders || []) {
      try {
        results.push(await processReminder({ accountId, reminder, routine, routineDate, window, source }));
      } catch (error) {
        logger.error(`[LEDGER] Falha isolada em ${reminder?.patientName || 'paciente'}:`, error.message);
        results.push({ status: REMINDER_LEDGER_STATUSES.FAILED, error: error.message });
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
