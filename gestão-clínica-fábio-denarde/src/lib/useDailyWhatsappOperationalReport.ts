import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  getMsUntilNextSaoPauloMidnight,
  getSaoPauloDateKey,
  normalizeWhatsappOperationalReport,
  WHATSAPP_OPERATIONAL_REPORT_COLLECTION,
  type WhatsappOperationalReportState,
} from './whatsappOperationalReport';

export function useDailyWhatsappOperationalReport(enabled: boolean): WhatsappOperationalReportState {
  const [dateKey, setDateKey] = useState(() => getSaoPauloDateKey());
  const [reportState, setReportState] = useState<Omit<WhatsappOperationalReportState, 'dateKey'>>({
    report: null,
    loading: enabled,
    error: null,
  });

  useEffect(() => {
    let timeoutId: number | undefined;
    const scheduleNextDay = () => {
      timeoutId = window.setTimeout(() => {
        setDateKey(getSaoPauloDateKey());
        scheduleNextDay();
      }, getMsUntilNextSaoPauloMidnight());
    };
    scheduleNextDay();
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setReportState({ report: null, loading: false, error: null });
      return undefined;
    }

    setReportState(current => ({ ...current, report: null, loading: true, error: null }));
    const reportRef = doc(db, WHATSAPP_OPERATIONAL_REPORT_COLLECTION, dateKey);
    return onSnapshot(
      reportRef,
      snapshot => {
        const report = snapshot.exists()
          ? normalizeWhatsappOperationalReport(snapshot.data(), dateKey)
          : null;
        setReportState({ report, loading: false, error: null });
      },
      error => {
        console.error('Falha ao acompanhar relatório operacional do WhatsApp:', error);
        setReportState({
          report: null,
          loading: false,
          error: 'Não foi possível carregar o relatório operacional de hoje.',
        });
      },
    );
  }, [dateKey, enabled]);

  return { ...reportState, dateKey };
}
