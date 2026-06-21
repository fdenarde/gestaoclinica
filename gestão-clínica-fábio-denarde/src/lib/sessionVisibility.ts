import type { Patient, Session } from '../types';
import { isSessionRemovedFromAgenda } from '../../shared/sessionRemoval.js';

function getDateKey(value: string | undefined | null): string {
  if (!value) return '';
  const dateKey = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Mantém o histórico visível entre a data de início cadastrada e a data atual.
 * Sessões futuras permanecem preservadas no estado; apenas não são exibidas
 * antecipadamente no histórico nem no vínculo de registros de atividades.
 */
export function getPatientSessionsThroughDate({
  patient,
  sessions,
  throughDate = getLocalDateKey(new Date()),
}: {
  patient: Patient;
  sessions: Session[];
  throughDate?: string;
}): Session[] {
  const startDate = getDateKey(patient.startDate);
  const endDate = getDateKey(throughDate) || getLocalDateKey(new Date());

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
