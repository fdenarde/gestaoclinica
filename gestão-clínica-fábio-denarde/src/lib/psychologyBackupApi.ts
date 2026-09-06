import { auth } from '../firebase';
import type { PsychologyBackupJsonResult } from '../features/psychology-import-export/backup';

interface BackupApiErrorPayload {
  error?: { code?: string; message?: string };
}

export class PsychologyBackupApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'PsychologyBackupApiError';
    this.code = code;
    this.status = status;
  }
}

interface AuthenticatedPsychologyBackupResult extends PsychologyBackupJsonResult {
  scope: { workspaceId: string; professionalId: string; context: 'PSICOLOGIA' };
}

type BackupRequestOptions = {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
};

async function defaultToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new PsychologyBackupApiError('psychology/missing-auth-token', 'Sua sessão não foi identificada.', 401);
  return user.getIdToken();
}

export async function requestAuthenticatedPsychologyBackup(options: BackupRequestOptions = {}): Promise<PsychologyBackupJsonResult> {
  const endpoint = options.endpoint || '/api/psychology/backup';
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const getToken = options.getToken || defaultToken;
  const token = await getToken();
  const response = await fetchImpl(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  let payload: AuthenticatedPsychologyBackupResult & BackupApiErrorPayload;
  try {
    payload = await response.json() as AuthenticatedPsychologyBackupResult & BackupApiErrorPayload;
  } catch {
    throw new PsychologyBackupApiError('psychology/invalid-response', 'A API do backup retornou uma resposta inválida.', response.status || 500);
  }
  if (!response.ok) {
    throw new PsychologyBackupApiError(
      payload.error?.code || 'psychology/backup-failed',
      payload.error?.message || 'Não foi possível gerar o backup autenticado.',
      response.status,
    );
  }
  if (payload.source !== 'psychology-remote' || payload.scope?.context !== 'PSICOLOGIA' || !payload.scope?.professionalId || !payload.scope?.workspaceId) {
    throw new PsychologyBackupApiError('psychology/backup-invalid-scope', 'O provider não confirmou o escopo autenticado do backup.', 502);
  }
  return payload;
}
