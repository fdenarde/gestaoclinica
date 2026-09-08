import { auth } from '../firebase';

export interface PsychologyOperationalMonitoringData {
  generatedAt: string;
  scope: { workspaceId: string; professionalId: string; context: 'PSICOLOGIA' };
  environment: {
    professionalName: string;
    professionalPhone: string;
    provider: string;
    status: string;
  };
  persistence: { status: string; mode: string; lastSyncAt: string | null };
  counts: {
    patients: number;
    sessions: number;
    patientsInReview: number;
    activeServices: number;
    activeLocations: number;
    packages: number;
    personalAppointments: number;
    documentManifests: number;
    attachmentManifests: number;
  };
  backup: { status: string; scope: string };
  onlineBooking: { status: string; lastUpdatedAt: string | null };
  integrations: { status: string };
  clinicalContent: { loaded: false; status: string };
  alerts: string[];
}
export async function getPsychologyOperationalMonitoring(professionalId = ''): Promise<PsychologyOperationalMonitoringData> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão administrativa não foi identificada.');
  const token = await user.getIdToken();
  const query = professionalId.trim() ? `?professionalId=${encodeURIComponent(professionalId.trim())}` : '';
  const response = await fetch(`/api/psychology/monitoring${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('A API do monitoramento retornou uma resposta inválida.');
  }
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in payload
      ? (payload as { error?: { message?: string } }).error
      : undefined;
    throw new Error(error?.message || 'Não foi possível carregar o monitoramento da Psicologia.');
  }
  return payload as PsychologyOperationalMonitoringData;
}
