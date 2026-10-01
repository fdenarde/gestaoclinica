import { runWithRequestTimeout } from './requestTimeout';

export const ACTIVITY_READ_REQUEST_TIMEOUT_MS = 20_000;
export const READ_ONLY_ACTIVITY_POST_ACTIONS = [
  'listProfessionalGallery',
  'listActivityMediaPresence',
] as const;

export function isReadOnlyActivityPostAction(action: unknown): boolean {
  return READ_ONLY_ACTIVITY_POST_ACTIONS.some(allowed => allowed === action);
}

export function runReadOnlyActivityPost<T>(
  action: unknown,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = ACTIVITY_READ_REQUEST_TIMEOUT_MS,
): Promise<T> {
  if (!isReadOnlyActivityPostAction(action)) {
    throw new Error('A ação não é uma leitura autorizada para timeout.');
  }
  return runWithRequestTimeout(
    operation,
    timeoutMs,
    () => Object.assign(
      new Error('A consulta do estado da mídia excedeu o tempo limite. Tente novamente.'),
      { code: 'activity-records/read-timeout' },
    ),
  );
}
