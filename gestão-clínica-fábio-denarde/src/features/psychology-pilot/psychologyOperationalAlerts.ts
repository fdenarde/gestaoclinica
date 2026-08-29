import type { PsychologySession, PsychologyStore } from './psychologyDomain';
import { getPsychologyFinancialLedger, psychologyCivilDate } from './psychologyFinancialLedger';

export interface PsychologyOperationalAlert {
  key: `session:${string}` | `charge:${string}`;
  kind: 'SESSION_PAST_UNFINISHED' | 'CHARGE_OPEN_BALANCE';
  text: string;
  tone: 'violet' | 'amber';
  sessionId?: string;
  chargeId?: string;
}

function sessionEndTimestamp(session: PsychologySession): number {
  const start = new Date(`${session.date}T${session.time}:00`).getTime();
  return start + Math.max(0, Number(session.durationMinutes) || 0) * 60_000;
}

export function buildPsychologyOperationalAlerts(store: PsychologyStore, reference = new Date()): PsychologyOperationalAlert[] {
  const patientNames = new Map(store.patients.map(patient => [patient.id, patient.name]));
  const deduplicated = new Map<PsychologyOperationalAlert['key'], PsychologyOperationalAlert>();
  const referenceTimestamp = reference.getTime();

  store.sessions
    .filter(session => session.status === 'agendada' && sessionEndTimestamp(session) < referenceTimestamp)
    .sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`))
    .forEach(session => {
      const key = `session:${session.id}` as const;
      deduplicated.set(key, {
        key,
        kind: 'SESSION_PAST_UNFINISHED',
        sessionId: session.id,
        text: `Sessão passada de ${patientNames.get(session.patientId) || 'Paciente'} ainda não foi concluída.`,
        tone: 'violet',
      });
    });

  getPsychologyFinancialLedger(store, psychologyCivilDate(reference)).chargeEntries
    .filter(entry => entry.balance > 0 && entry.status !== 'PAID' && entry.status !== 'EXEMPT' && entry.status !== 'CANCELLED')
    .sort((left, right) => left.charge.id.localeCompare(right.charge.id))
    .forEach(entry => {
      const key = `charge:${entry.charge.id}` as const;
      deduplicated.set(key, {
        key,
        kind: 'CHARGE_OPEN_BALANCE',
        chargeId: entry.charge.id,
        text: `Saldo financeiro de ${entry.charge.patientId ? patientNames.get(entry.charge.patientId) || 'Paciente' : 'Paciente excluído'} continua em aberto.`,
        tone: 'amber',
      });
    });

  return [...deduplicated.values()];
}
