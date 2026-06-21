import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_PROJECT_DIRECTORY_NAME = 'gestão-clínica-fábio-denarde';
export const CORRUPTED_PATH_PATTERNS = ['Ã', 'Â', '\uFFFD'];
export const ROBOT_PROCESS_NAMES = ['RoboClinica', 'RoboClinicaScheduler', 'RoboClinicaWatchdog'];
export const PROTECTED_WINDOWS = Object.freeze([
  { start: '06:20', end: '06:50', label: '06:20-06:50' },
  { start: '08:20', end: '09:20', label: '08:20-09:20' },
  { start: '11:50', end: '12:50', label: '11:50-12:50' },
]);

function timeToMinutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

export function containsCorruptedUnicode(value) {
  return CORRUPTED_PATH_PATTERNS.some(pattern => String(value || '').includes(pattern));
}

export function resolveProjectRootFromScriptPath(scriptPath, exists = fs.existsSync) {
  if (!scriptPath) throw new Error('PSScriptRoot ausente.');
  const projectRoot = path.resolve(scriptPath, '..');
  if (containsCorruptedUnicode(projectRoot)) {
    throw new Error(`ProjectRoot contém caracteres corrompidos: ${projectRoot}`);
  }
  if (path.basename(projectRoot) !== EXPECTED_PROJECT_DIRECTORY_NAME) {
    throw new Error(`Nome final da pasta inválido: ${path.basename(projectRoot)}`);
  }

  for (const required of ['server.js', 'package.json', 'ecosystem.config.cjs']) {
    const fullPath = path.join(projectRoot, required);
    if (!exists(fullPath)) throw new Error(`Arquivo essencial ausente: ${required}`);
  }

  return projectRoot;
}

export function isInsideProtectedWindow(date = new Date(), windows = PROTECTED_WINDOWS) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return windows.find(window => {
    const start = timeToMinutes(window.start);
    const end = timeToMinutes(window.end);
    return minutes >= start && minutes <= end;
  }) || null;
}

export function hasEnoughMarginBeforeNextProtectedWindow(date = new Date(), transitionMinutes = 20, windows = PROTECTED_WINDOWS) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const next = windows
    .map(window => ({ ...window, startMinutes: timeToMinutes(window.start) }))
    .filter(window => window.startMinutes > minutes)
    .sort((a, b) => a.startMinutes - b.startMinutes)[0];
  if (!next) return true;
  return next.startMinutes - minutes > transitionMinutes;
}

export function capturePm2ProcessState(processes = []) {
  return processes.map(processInfo => ({
    name: processInfo.name,
    pm_id: processInfo.pm_id,
    pid: processInfo.pid || null,
    status: processInfo.pm2_env?.status || processInfo.status || '',
    script: processInfo.pm2_env?.pm_exec_path || '',
    cwd: processInfo.pm2_env?.pm_cwd || '',
    execMode: processInfo.pm2_env?.exec_mode || '',
    restarts: processInfo.pm2_env?.restart_time || 0,
    role: processInfo.pm2_env?.env?.WHATSAPP_PROCESS_ROLE || processInfo.pm2_env?.WHATSAPP_PROCESS_ROLE || '',
  }));
}

export function planRollbackActions({ originalProcesses = [], currentProcesses = [], backupAvailable = true, failureStage = '' } = {}) {
  const originalNames = new Set(originalProcesses.map(processInfo => processInfo.name));
  const currentNames = new Set(currentProcesses.map(processInfo => processInfo.name));
  const actions = [];

  if (backupAvailable) {
    actions.push({ type: 'restore-file', target: 'ecosystem.config.cjs' });
  } else {
    actions.push({ type: 'skip-restore-file', target: 'ecosystem.config.cjs', reason: 'backup ausente' });
  }

  for (const current of currentProcesses) {
    if (ROBOT_PROCESS_NAMES.includes(current.name) && !originalNames.has(current.name)) {
      actions.push({ type: 'delete-process', name: current.name });
    }
  }

  for (const original of originalProcesses) {
    if (original.name === 'ClinicaFrontend') {
      actions.push({ type: 'preserve-process', name: original.name });
      continue;
    }
    if (ROBOT_PROCESS_NAMES.includes(original.name) && currentNames.has(original.name)) {
      actions.push({ type: 'restart-existing-process', name: original.name, pm_id: original.pm_id });
    }
  }

  actions.push({ type: 'skip-pm2-save', failureStage });
  return actions;
}

export function canRecoverActivationLock({ lock, now = new Date(), maxAgeMinutes = 60, isPidRunning = () => false } = {}) {
  if (!lock) return { recover: true, reason: 'lock ausente' };
  if (lock.projectRoot && containsCorruptedUnicode(lock.projectRoot)) {
    return { recover: false, reason: 'lock com ProjectRoot corrompido exige revisão manual' };
  }
  if (lock.pid && isPidRunning(lock.pid)) {
    return { recover: false, reason: 'PID do lock ainda está ativo' };
  }
  const createdAt = lock.createdAt ? new Date(lock.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) {
    return { recover: false, reason: 'timestamp do lock inválido' };
  }
  const ageMinutes = (now.getTime() - createdAt.getTime()) / 60000;
  if (ageMinutes <= maxAgeMinutes) {
    return { recover: false, reason: 'lock recente sem PID ativo exige cautela' };
  }
  return { recover: true, reason: 'lock órfão e vencido' };
}
