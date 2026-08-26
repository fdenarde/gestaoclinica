export const PSYCHOLOGY_REMOTE_CANARY_ENV = 'PSYCHOLOGY_REMOTE_CANARY_ENABLED' as const;
export const PSYCHOLOGY_REMOTE_BACKEND_ENV = 'VITE_PSYCHOLOGY_PERSISTENCE_BACKEND' as const;

export type PsychologyRuntimeMode = 'pilot-local' | 'authenticated-remote';

export function isPsychologyRemoteCanaryEnabled(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

/**
 * The route mode is the single source of truth for the client provider.
 * Historical backend/canary flags remain available to the provider safety gate,
 * but cannot silently turn an authenticated Psychology route into local storage.
 */
export function isPsychologyRemoteClientEnabled(runtimeMode: PsychologyRuntimeMode): boolean {
  return runtimeMode === 'authenticated-remote';
}
