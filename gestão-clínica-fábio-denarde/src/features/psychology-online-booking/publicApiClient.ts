import type {
  ManagementActionResult,
  MapsNavigationResult,
  PublicAppointmentSummary,
  PublicBookingRepository,
  PublicBookingRequest,
  PublicBookingResult,
  PublicBookingSettings,
  PublicBookingSlot,
  RescheduleRequestResult,
} from './types';

type ApiResponse<T> = { result?: T; settings?: PublicBookingSettings; summary?: PublicAppointmentSummary; slots?: PublicBookingSlot[]; error?: { message?: string } };

function apiError(response: Response, payload: ApiResponse<unknown>): Error {
  const error = new Error(payload.error?.message || `Não foi possível concluir a operação (${response.status}).`) as Error & { status?: number };
  error.status = response.status;
  return error;
}

export interface PublicBookingApiClientOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
}

export function createPublicBookingApiClient(options: PublicBookingApiClientOptions = {}): PublicBookingRepository {
  const fetcher = options.fetcher || fetch;
  const baseUrl = options.baseUrl || '/api/public-booking';

  const request = async <T>(resource: string, init: RequestInit = {}, query: Record<string, string | undefined> = {}): Promise<T> => {
    const params = new URLSearchParams({ resource });
    Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, value); });
    const response = await fetcher(`${baseUrl}?${params.toString()}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const payload = await response.json() as ApiResponse<T>;
    if (!response.ok && payload.result !== undefined && payload.result !== null && typeof payload.result === 'object') return payload.result as T;
    if (!response.ok) throw apiError(response, payload);
    return payload.result !== undefined ? payload.result : payload as T;
  };

  return {
    async getSettings(slug) {
      try {
        const payload = await request<ApiResponse<unknown>>('settings', {}, { slug });
        return payload.settings || null;
      } catch {
        return null;
      }
    },
    async updateSettings(patch) {
      const payload = await request<ApiResponse<unknown>>('settings', { method: 'PUT', body: JSON.stringify({ settings: patch }) });
      if (!payload.settings) throw new Error('A API pública não retornou os ajustes atualizados.');
      return payload.settings;
    },
    async listPublishedSlots(input) {
      const payload = await request<ApiResponse<unknown>>('slots', {}, { professionalSlug: input.professionalSlug, serviceId: input.serviceId, modality: input.modality, locationId: input.locationId, fromDate: input.fromDate, throughDate: input.throughDate });
      return payload.slots || [];
    },
    async createBooking(input: PublicBookingRequest): Promise<PublicBookingResult | { conflict: true; message: string }> {
      try {
        return await request<PublicBookingResult>('create-booking', { method: 'POST', body: JSON.stringify(input) });
      } catch (error) {
        if (error instanceof Error && error.message) return { conflict: true, message: error.message };
        throw error;
      }
    },
    async getAppointmentByManagementToken(token) {
      try {
        const payload = await request<ApiResponse<unknown>>('management', {}, { token });
        return payload.summary || null;
      } catch {
        return null;
      }
    },
    async confirmByManagementToken(token): Promise<ManagementActionResult> {
      return request<ManagementActionResult>('management-action', { method: 'POST', body: JSON.stringify({ action: 'confirm', token }) });
    },
    async cancelByManagementToken(token): Promise<ManagementActionResult> {
      return request<ManagementActionResult>('management-action', { method: 'POST', body: JSON.stringify({ action: 'cancel', token }) });
    },
    async requestRescheduleByManagementToken(token): Promise<RescheduleRequestResult> {
      return request<RescheduleRequestResult>('management-action', { method: 'POST', body: JSON.stringify({ action: 'request-reschedule', token }) });
    },
    async getMapsNavigationDestination(navigationRef): Promise<MapsNavigationResult> {
      try {
        return await request<MapsNavigationResult>('maps', {}, { navigationRef });
      } catch {
        return { ok: false, code: 'unavailable', message: 'Este atendimento não possui localização presencial disponível.' };
      }
    },
  };
}

export async function syncLocalPublicBookingSettings(settings: Partial<PublicBookingSettings>, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (typeof window === 'undefined' || !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return false;
  try {
    const response = await fetcher('/api/public-booking?resource=settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Local-Preview-Seed': 'true' }, body: JSON.stringify({ settings }) });
    return response.ok;
  } catch {
    return false;
  }
}
