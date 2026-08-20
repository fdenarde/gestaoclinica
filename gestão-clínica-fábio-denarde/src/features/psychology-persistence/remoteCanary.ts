export const PSYCHOLOGY_REMOTE_CANARY_ENV = 'PSYCHOLOGY_REMOTE_CANARY_ENABLED' as const;

export function isPsychologyRemoteCanaryEnabled(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}
