import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const WHATSAPP_ROBOT_VERSION = '2.0.0';
export const WHATSAPP_ROBOT_NAME = 'Robô WhatsApp 2.0 — Estabilidade e Autorreparo';

export const WHATSAPP_OPERATIONAL_STATES = Object.freeze({
  STARTING: 'STARTING',
  ONLINE_READY: 'ONLINE_READY',
  DEGRADED: 'DEGRADED',
  NETWORK_WAIT: 'NETWORK_WAIT',
  SESSION_INVALID: 'SESSION_INVALID',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  RECOVERING: 'RECOVERING',
  STOPPED_SAFE: 'STOPPED_SAFE',
});

export const CIRCUIT_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

const VALID_OPERATIONAL_STATES = new Set(Object.values(WHATSAPP_OPERATIONAL_STATES));
const DEFAULT_RUNTIME_STATE_PATH = path.resolve('logs', 'runtime', 'whatsapp-operational-state.json');
const DEFAULT_PROCESS_LOCK_PATH = path.resolve('logs', 'runtime', 'RoboClinica.instance.lock');
const DEFAULT_SESSION_PATH = path.resolve('.wwebjs_auth');
const DEFAULT_DISK_WARNING_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_DISK_BLOCK_BYTES = 512 * 1024 * 1024;

function atomicWriteJson(filePath, value) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const tempPath = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, absolute);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* evidência temporária não substituiu o destino */ }
    }
  }
}

function readJsonSafely(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function normalizeOperationalState(value, fallback = WHATSAPP_OPERATIONAL_STATES.STARTING) {
  return VALID_OPERATIONAL_STATES.has(value) ? value : fallback;
}

export function computeProgressiveBackoff(attempt, {
  baseDelayMs = 5_000,
  maxDelayMs = 5 * 60_000,
  jitterRatio = 0,
  random = Math.random,
} = {}) {
  const normalizedAttempt = Math.max(1, Number(attempt) || 1);
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (normalizedAttempt - 1)));
  const jitter = exponential * Math.max(0, Number(jitterRatio) || 0) * Math.max(0, Math.min(1, random()));
  return Math.round(Math.min(maxDelayMs, exponential + jitter));
}

export function isSessionInvalidReason(reason) {
  return /logout|logged\s*out|unpaired|session\s*(?:invalid|expired)|authentication|required|auth_failure/i
    .test(String(reason || ''));
}

export function inspectSessionDirectory({
  dataPath = DEFAULT_SESSION_PATH,
  sessionDirectoryName = 'session',
  fsImpl = fs,
} = {}) {
  const rootPath = path.resolve(dataPath);
  const sessionPath = path.join(rootPath, sessionDirectoryName);
  try {
    const rootExists = fsImpl.existsSync(rootPath);
    const sessionExists = fsImpl.existsSync(sessionPath) && fsImpl.statSync(sessionPath).isDirectory();
    return {
      rootPath,
      sessionPath,
      rootExists,
      sessionExists,
      valid: rootExists && sessionExists,
      reason: rootExists && sessionExists ? 'session-directory-present' : 'session-directory-missing',
    };
  } catch (error) {
    return {
      rootPath,
      sessionPath,
      rootExists: false,
      sessionExists: false,
      valid: false,
      reason: `session-metadata-error:${error?.code || 'unknown'}`,
    };
  }
}

export function getDiskHealth(targetPath = process.cwd(), {
  warningBytes = Number(process.env.WHATSAPP_DISK_WARNING_BYTES || DEFAULT_DISK_WARNING_BYTES),
  blockBytes = Number(process.env.WHATSAPP_DISK_BLOCK_BYTES || DEFAULT_DISK_BLOCK_BYTES),
  statfs = fs.statfsSync,
} = {}) {
  try {
    const stats = statfs(path.resolve(targetPath));
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const status = freeBytes <= blockBytes ? 'blocked' : freeBytes <= warningBytes ? 'warning' : 'healthy';
    return {
      status,
      freeBytes,
      warningBytes,
      blockBytes,
      canStartCriticalComponents: status !== 'blocked',
    };
  } catch (error) {
    return {
      status: 'unknown',
      freeBytes: null,
      warningBytes,
      blockBytes,
      canStartCriticalComponents: false,
      errorCode: error?.code || 'disk-check-error',
    };
  }
}

export async function checkNetworkReadiness({
  hostname = 'web.whatsapp.com',
  lookup = dns.lookup,
} = {}) {
  try {
    const result = await lookup(hostname);
    return { ready: Boolean(result), hostname, errorCode: '' };
  } catch (error) {
    return { ready: false, hostname, errorCode: error?.code || 'dns-unavailable' };
  }
}

function processExists(pid, kill = process.kill) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function acquireSingleInstanceLock({
  lockPath = DEFAULT_PROCESS_LOCK_PATH,
  pid = process.pid,
  now = new Date(),
  kill = process.kill,
} = {}) {
  const absolute = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const token = crypto.randomUUID();
  const payload = { pid, token, createdAt: now.toISOString() };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const fd = fs.openSync(absolute, 'wx');
      fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`, 'utf8');
      fs.closeSync(fd);
      return {
        acquired: true,
        lockPath: absolute,
        pid,
        token,
        release() {
          const current = readJsonSafely(absolute, {});
          if (current?.token === token) fs.rmSync(absolute, { force: true });
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = readJsonSafely(absolute, {});
      if (processExists(current?.pid, kill)) {
        return { acquired: false, lockPath: absolute, ownerPid: Number(current.pid), reason: 'live-owner' };
      }
      fs.rmSync(absolute, { force: true });
    }
  }

  return { acquired: false, lockPath: absolute, reason: 'lock-unavailable' };
}

export function createIdempotentRegistry() {
  const keys = new Set();
  return {
    register(key, factory) {
      if (keys.has(key)) return { registered: false, key, reason: 'duplicate' };
      const value = factory();
      keys.add(key);
      return { registered: true, key, value };
    },
    has: key => keys.has(key),
    size: () => keys.size,
    keys: () => [...keys],
  };
}

export function assessManagedProcess(processInfo, { restartLoopThreshold = 3 } = {}) {
  const status = String(processInfo?.status || processInfo?.pm2_env?.status || 'missing');
  const restarts = Number(processInfo?.restart_time ?? processInfo?.pm2_env?.restart_time ?? 0);
  const unstableRestarts = Number(processInfo?.unstable_restarts ?? processInfo?.pm2_env?.unstable_restarts ?? 0);
  const pid = Number(processInfo?.pid || 0);
  const online = status === 'online' && pid > 0;
  const restartLoop = unstableRestarts >= Math.max(1, Number(restartLoopThreshold) || 3);
  return { status, pid: pid || null, restarts, unstableRestarts, online, restartLoop, healthy: online && !restartLoop };
}

export function assessHeartbeat(heartbeat, {
  now = new Date(),
  maxAgeMs = 10 * 60_000,
  requireReady = false,
  requireScheduler = false,
} = {}) {
  const recordedAtMs = Date.parse(heartbeat?.recordedAt || '');
  const fresh = Number.isFinite(recordedAtMs) && now.getTime() - recordedAtMs <= maxAgeMs;
  const ready = !requireReady || heartbeat?.whatsappReady === true;
  const scheduler = !requireScheduler || heartbeat?.schedulerRegistered === true;
  return { present: Boolean(heartbeat), fresh, ready, scheduler, healthy: Boolean(heartbeat) && fresh && ready && scheduler };
}

export function rotateLogFileSafely(filePath, {
  maxBytes = Number(process.env.WHATSAPP_LOG_MAX_BYTES || 20 * 1024 * 1024),
  retention = Number(process.env.WHATSAPP_LOG_RETENTION || 10),
  now = new Date(),
} = {}) {
  const absolute = path.resolve(filePath);
  try {
    if (!fs.existsSync(absolute)) return { status: 'missing', filePath: absolute };
    const size = fs.statSync(absolute).size;
    if (size < maxBytes) return { status: 'within-limit', filePath: absolute, size };
    const archiveDirectory = path.join(path.dirname(absolute), 'archive');
    fs.mkdirSync(archiveDirectory, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(archiveDirectory, `${path.basename(absolute)}.${stamp}.gz`);
    const tempPath = `${archivePath}.${process.pid}.tmp`;
    const compressed = zlib.gzipSync(fs.readFileSync(absolute), { level: zlib.constants.Z_BEST_SPEED });
    fs.writeFileSync(tempPath, compressed);
    fs.renameSync(tempPath, archivePath);
    if (fs.statSync(archivePath).size <= 0) throw new Error('Arquivo de rotação vazio; truncamento recusado.');
    fs.truncateSync(absolute, 0);

    const prefix = `${path.basename(absolute)}.`;
    const archives = fs.readdirSync(archiveDirectory)
      .filter(name => name.startsWith(prefix) && name.endsWith('.gz'))
      .sort()
      .reverse();
    for (const obsolete of archives.slice(Math.max(1, retention))) {
      fs.rmSync(path.join(archiveDirectory, obsolete), { force: true });
    }
    return { status: 'rotated', filePath: absolute, previousSize: size, archivePath, retained: Math.min(archives.length, retention) };
  } catch (error) {
    return { status: 'deferred', filePath: absolute, errorCode: error?.code || 'log-rotation-error' };
  }
}

export class WhatsappOperationalController {
  constructor({
    statePath = DEFAULT_RUNTIME_STATE_PATH,
    failureThreshold = Number(process.env.WHATSAPP_CIRCUIT_FAILURE_THRESHOLD || 3),
    cooldownMs = Number(process.env.WHATSAPP_CIRCUIT_COOLDOWN_MS || 5 * 60_000),
    now = () => new Date(),
    persist = true,
  } = {}) {
    this.statePath = path.resolve(statePath);
    this.failureThreshold = Math.max(1, Number(failureThreshold) || 3);
    this.cooldownMs = Math.max(1_000, Number(cooldownMs) || 5 * 60_000);
    this.now = now;
    this.persistEnabled = persist;
    const previous = persist ? readJsonSafely(this.statePath, {}) : {};
    this.state = WHATSAPP_OPERATIONAL_STATES.STARTING;
    this.circuitState = CIRCUIT_STATES.CLOSED;
    this.consecutiveFailures = 0;
    this.recoveryAttempts = 0;
    this.lastCause = String(previous?.lastCause || 'startup');
    this.openedAt = '';
    this.nextAttemptAt = '';
    this.updatedAt = this.now().toISOString();
    this.history = [];
    this.persist();
  }

  transition(nextState, cause = '') {
    const normalized = normalizeOperationalState(nextState);
    const previous = this.state;
    this.state = normalized;
    this.lastCause = String(cause || this.lastCause || 'state-transition');
    this.updatedAt = this.now().toISOString();
    this.history.push({ from: previous, to: normalized, cause: this.lastCause, at: this.updatedAt });
    this.history = this.history.slice(-20);
    this.persist();
    return this.snapshot();
  }

  recordFailure(cause, { retryable = true } = {}) {
    this.consecutiveFailures += 1;
    this.lastCause = String(cause || 'runtime-failure');
    if (!retryable) {
      this.transition(WHATSAPP_OPERATIONAL_STATES.SESSION_INVALID, this.lastCause);
      return this.openCircuit(this.lastCause, { stopSafe: true });
    }
    if (this.consecutiveFailures >= this.failureThreshold) return this.openCircuit(this.lastCause);
    return this.transition(WHATSAPP_OPERATIONAL_STATES.DEGRADED, this.lastCause);
  }

  openCircuit(cause, { stopSafe = false } = {}) {
    const now = this.now();
    this.circuitState = CIRCUIT_STATES.OPEN;
    this.openedAt = now.toISOString();
    this.nextAttemptAt = new Date(now.getTime() + this.cooldownMs).toISOString();
    this.transition(WHATSAPP_OPERATIONAL_STATES.CIRCUIT_OPEN, cause);
    if (stopSafe) this.transition(WHATSAPP_OPERATIONAL_STATES.STOPPED_SAFE, cause);
    return this.snapshot();
  }

  canAttemptRecovery(at = this.now()) {
    if (this.state === WHATSAPP_OPERATIONAL_STATES.STOPPED_SAFE) return false;
    if (this.circuitState !== CIRCUIT_STATES.OPEN) return true;
    return Boolean(this.nextAttemptAt) && at.getTime() >= new Date(this.nextAttemptAt).getTime();
  }

  beginRecovery(cause = 'automatic-recovery') {
    if (!this.canAttemptRecovery()) return { allowed: false, snapshot: this.snapshot() };
    this.circuitState = this.circuitState === CIRCUIT_STATES.OPEN ? CIRCUIT_STATES.HALF_OPEN : this.circuitState;
    this.recoveryAttempts += 1;
    this.transition(WHATSAPP_OPERATIONAL_STATES.RECOVERING, cause);
    return { allowed: true, snapshot: this.snapshot() };
  }

  recordNetworkWait(cause = 'network-unavailable') {
    return this.transition(WHATSAPP_OPERATIONAL_STATES.NETWORK_WAIT, cause);
  }

  recordReady(cause = 'whatsapp-ready') {
    this.circuitState = CIRCUIT_STATES.CLOSED;
    this.consecutiveFailures = 0;
    this.recoveryAttempts = 0;
    this.openedAt = '';
    this.nextAttemptAt = '';
    return this.transition(WHATSAPP_OPERATIONAL_STATES.ONLINE_READY, cause);
  }

  stopSafe(cause = 'manual-safe-stop') {
    return this.openCircuit(cause, { stopSafe: true });
  }

  snapshot() {
    return {
      robotName: WHATSAPP_ROBOT_NAME,
      robotVersion: WHATSAPP_ROBOT_VERSION,
      operationalState: this.state,
      circuitBreaker: {
        state: this.circuitState,
        consecutiveFailures: this.consecutiveFailures,
        recoveryAttempts: this.recoveryAttempts,
        failureThreshold: this.failureThreshold,
        openedAt: this.openedAt,
        nextAttemptAt: this.nextAttemptAt,
        lastCause: this.lastCause,
      },
      updatedAt: this.updatedAt,
      history: [...this.history],
    };
  }

  persist() {
    if (!this.persistEnabled) return;
    atomicWriteJson(this.statePath, this.snapshot());
  }
}

export function buildSafeRuntimeSummary(snapshot = {}) {
  return {
    robotName: WHATSAPP_ROBOT_NAME,
    robotVersion: WHATSAPP_ROBOT_VERSION,
    operationalState: normalizeOperationalState(snapshot.operationalState, WHATSAPP_OPERATIONAL_STATES.DEGRADED),
    circuitBreaker: {
      state: Object.values(CIRCUIT_STATES).includes(snapshot?.circuitBreaker?.state)
        ? snapshot.circuitBreaker.state
        : CIRCUIT_STATES.OPEN,
      consecutiveFailures: Number(snapshot?.circuitBreaker?.consecutiveFailures || 0),
      recoveryAttempts: Number(snapshot?.circuitBreaker?.recoveryAttempts || 0),
      lastCause: String(snapshot?.circuitBreaker?.lastCause || '').slice(0, 120),
      nextAttemptAt: String(snapshot?.circuitBreaker?.nextAttemptAt || ''),
    },
    updatedAt: String(snapshot.updatedAt || ''),
  };
}

export const WHATSAPP_RUNTIME_PATHS = Object.freeze({
  state: DEFAULT_RUNTIME_STATE_PATH,
  processLock: DEFAULT_PROCESS_LOCK_PATH,
  session: DEFAULT_SESSION_PATH,
});
