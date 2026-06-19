import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityRecord } from '../types/activityRecords';
import { ACTIVITY_RECORDS_CHANGED_EVENT, listActivityRecords } from './activityRecordsApi';

const ACTIVITY_RECORDS_VISIBILITY_REFRESH_INTERVAL_MS = 2 * 60_000;

export function useActivityRecords(
  ownerUserId: string,
  patientId: string,
  sessionId?: string | null,
  enabled = true,
) {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastLoadedAtRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const loadRecords = useCallback(async (showLoading = true, force = false) => {
    if (!enabled || !ownerUserId || !patientId) {
      setRecords([]);
      setLoading(false);
      setError(null);
      lastLoadedAtRef.current = 0;
      return;
    }
    if (inFlightRef.current) return inFlightRef.current;

    const request = (async () => {
      if (showLoading) setLoading(true);
      try {
        setRecords(await listActivityRecords(patientId, sessionId || undefined, { force }));
        setError(null);
        lastLoadedAtRef.current = Date.now();
      } catch (err) {
        console.error('Falha ao carregar registros de atividades:', err);
        setError('Não foi possível carregar os registros de atividades.');
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    return request;
  }, [enabled, ownerUserId, patientId, sessionId]);

  useEffect(() => {
    if (enabled) void loadRecords();

    const handleChange = (event: Event) => {
      const changedPatientId = (event as CustomEvent<{ patientId?: string }>).detail?.patientId;
      if (enabled && (!changedPatientId || changedPatientId === patientId)) void loadRecords(false, true);
    };
    const handleVisibility = () => {
      const stale = Date.now() - lastLoadedAtRef.current >= ACTIVITY_RECORDS_VISIBILITY_REFRESH_INTERVAL_MS;
      if (enabled && stale && document.visibilityState === 'visible') void loadRecords(false);
    };

    window.addEventListener(ACTIVITY_RECORDS_CHANGED_EVENT, handleChange);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener(ACTIVITY_RECORDS_CHANGED_EVENT, handleChange);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, loadRecords, patientId]);

  return {
    records,
    loading,
    error,
    refresh: () => loadRecords(true, true),
  };
}
