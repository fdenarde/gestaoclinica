import type { Patient, Session } from '../types';
import { isSessionRemovedFromAgenda } from '../../shared/sessionRemoval.js';
import { getSaoPauloDateKey } from '../../shared/clinicalDate.js';

function getDateKey(value: string | undefined | null): string {
  if (!value) return '';
  const dateKey = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
}

/**
 * Mantém o histórico visível entre a data de início cadastrada e a data atual.
 * Sessões futuras permanecem preservadas no estado; apenas não são exibidas
 * antecipadamente no histórico nem no vínculo de registros de atividades.
 */
export function getPatientSessionsThroughDate({
  patient,
  sessions,
  throughDate = getSaoPauloDateKey(),
}: {
  patient: Patient;
  sessions: Session[];
  throughDate?: string;
}): Session[] {
  const startDate = getDateKey(patient.startDate);
  const endDate = getDateKey(throughDate) || getSaoPauloDateKey();

  return sessions.filter(session => {
    if (isSessionRemovedFromAgenda(session)) return false;
    if (session.patientId !== patient.id) return false;

    const sessionDate = getDateKey(session.date);
    if (!sessionDate) return false;
    if (startDate && sessionDate < startDate) return false;
    if (sessionDate > endDate) return false;

    return true;
  });
}
