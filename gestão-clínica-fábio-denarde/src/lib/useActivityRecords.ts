import { useCallback, useEffect, useState } from 'react';
import type { ActivityRecord } from '../types/activityRecords';
import { ACTIVITY_RECORDS_CHANGED_EVENT, listActivityRecords } from './activityRecordsApi';

export function useActivityRecords(ownerUserId: string, patientId: string) {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async (showLoading = true) => {
    if (!ownerUserId || !patientId) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      setRecords(await listActivityRecords(patientId));
      setError(null);
    } catch (err) {
      console.error('Falha ao carregar registros de atividades:', err);
      setError('Não foi possível carregar os registros de atividades.');
    } finally {
      setLoading(false);
    }
  }, [ownerUserId, patientId]);

  useEffect(() => {
    void loadRecords();

    const handleChange = (event: Event) => {
      const changedPatientId = (event as CustomEvent<{ patientId?: string }>).detail?.patientId;
      if (!changedPatientId || changedPatientId === patientId) void loadRecords(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadRecords(false);
    };

    window.addEventListener(ACTIVITY_RECORDS_CHANGED_EVENT, handleChange);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener(ACTIVITY_RECORDS_CHANGED_EVENT, handleChange);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadRecords, patientId]);

  return { records, loading, error, refresh: loadRecords };
}
