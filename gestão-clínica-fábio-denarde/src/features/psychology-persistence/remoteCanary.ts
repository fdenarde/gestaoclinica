export const PSYCHOLOGY_REMOTE_CANARY_ENV = 'PSYCHOLOGY_REMOTE_CANARY_ENABLED' as const;
export const PSYCHOLOGY_REMOTE_BACKEND_ENV = 'VITE_PSYCHOLOGY_PERSISTENCE_BACKEND' as const;

export function isPsychologyRemoteCanaryEnabled(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function isPsychologyRemoteClientEnabled(input: { backend?: unknown; remoteCanaryEnabled?: unknown }): boolean {
  const backend = String(input.backend || '').trim().toLowerCase();
  return backend === 'remote' && isPsychologyRemoteCanaryEnabled(input.remoteCanaryEnabled);
}
