import type { PsychologyPatient, PsychologySession, PsychologyStore } from './psychologyDomain';
import { getPsychologyFinancialLedger, psychologyCivilDate, PSYCHOLOGY_FINANCE_TIMEZONE } from './psychologyFinancialLedger';

export const SESSION_PENDING_ALERT_LOOKBACK_DAYS = 30;
export const OPERATIONAL_ALERT_INITIAL_LIMIT = 10;

export interface PsychologyOperationalAlert {
  key: `session:${string}` | `charge:${string}`;
  kind: 'SESSION_PAST_UNFINISHED' | 'CHARGE_OPEN_BALANCE';
  text: string;
  tone: 'violet' | 'amber';
  patientId: string;
  sessionId?: string;
  chargeId?: string;
}

export interface PsychologyOperationalPendencies {
  sessionAlerts: PsychologyOperationalAlert[];
  financialAlerts: PsychologyOperationalAlert[];
  alerts: PsychologyOperationalAlert[];
  sessionPendingCount: number;
  financialPendingCount: number;
}

function scopedActivePatient(patient: PsychologyPatient | undefined, store: PsychologyStore): patient is PsychologyPatient {
  return patient?.active === true
    && patient.professionalId === store.scope.professionalId
    && patient.context === store.scope.context;
}

function civilMinute(year: number, month: number, day: number, hour: number, minute: number): number | null {
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  const value = new Date(timestamp);
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day
    && value.getUTCHours() === hour
    && value.getUTCMinutes() === minute
    ? Math.floor(timestamp / 60_000)
    : null;
}

function referenceCivilMinute(reference: Date): number | null {
  if (!Number.isFinite(reference.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PSYCHOLOGY_FINANCE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(reference);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return civilMinute(values.year, values.month, values.day, values.hour, values.minute);
}

function sessionStartCivilMinute(session: PsychologySession): number | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(session.date);
  const time = /^(\d{2}):(\d{2})$/.exec(session.time);
  if (!date || !time) return null;
  return civilMinute(Number(date[1]), Number(date[2]), Number(date[3]), Number(time[1]), Number(time[2]));
}

function chargeRelevantDate(entry: ReturnType<typeof getPsychologyFinancialLedger>['chargeEntries'][number]): string {
  return String(entry.charge.dueDate || entry.charge.createdAt || '').slice(0, 10) || '9999-12-31';
}

export function deriveOperationalPendencies(store: PsychologyStore, reference = new Date()): PsychologyOperationalPendencies {
  const activePatients = new Map(
    store.patients
      .filter(patient => scopedActivePatient(patient, store))
      .map(patient => [patient.id, patient]),
  );
  const referenceMinute = referenceCivilMinute(reference);
  const oldestEligibleMinute = referenceMinute === null
    ? null
    : referenceMinute - SESSION_PENDING_ALERT_LOOKBACK_DAYS * 24 * 60;

  const sessionAlertsByKey = new Map<PsychologyOperationalAlert['key'], PsychologyOperationalAlert>();
  if (referenceMinute !== null && oldestEligibleMinute !== null) {
    store.sessions
      .map(session => ({ session, startMinute: sessionStartCivilMinute(session) }))
      .filter(({ session, startMinute }) => session.professionalId === store.scope.professionalId
        && session.context === store.scope.context
        && session.status === 'agendada'
        && startMinute !== null
        && startMinute < referenceMinute
        && startMinute >= oldestEligibleMinute
        && activePatients.has(session.patientId))
      .sort((left, right) => (right.startMinute ?? 0) - (left.startMinute ?? 0) || left.session.id.localeCompare(right.session.id))
      .forEach(({ session }) => {
        const patient = activePatients.get(session.patientId);
        if (!patient) return;
        const key = `session:${session.id}` as const;
        if (sessionAlertsByKey.has(key)) return;
        sessionAlertsByKey.set(key, {
          key,
          kind: 'SESSION_PAST_UNFINISHED',
          patientId: patient.id,
          sessionId: session.id,
          text: `Sessão passada de ${patient.name} ainda não foi concluída.`,
          tone: 'violet',
        });
      });
  }

  const financialAlertsByKey = new Map<PsychologyOperationalAlert['key'], PsychologyOperationalAlert>();
  getPsychologyFinancialLedger(store, psychologyCivilDate(reference)).chargeEntries
    .filter(entry => entry.balance > 0
      && entry.status !== 'PAID'
      && entry.status !== 'EXEMPT'
      && entry.status !== 'CANCELLED'
      && typeof entry.charge.patientId === 'string'
      && activePatients.has(entry.charge.patientId))
    .sort((left, right) => Number(right.overdue) - Number(left.overdue)
      || chargeRelevantDate(left).localeCompare(chargeRelevantDate(right))
      || left.charge.id.localeCompare(right.charge.id))
    .forEach(entry => {
      const patientId = entry.charge.patientId;
      if (!patientId) return;
      const patient = activePatients.get(patientId);
      if (!patient) return;
      const key = `charge:${entry.charge.id}` as const;
      if (financialAlertsByKey.has(key)) return;
      financialAlertsByKey.set(key, {
        key,
        kind: 'CHARGE_OPEN_BALANCE',
        patientId,
        chargeId: entry.charge.id,
        text: `Saldo financeiro de ${patient.name} continua em aberto.`,
        tone: 'amber',
      });
    });

  const sessionAlerts = [...sessionAlertsByKey.values()];
  const financialAlerts = [...financialAlertsByKey.values()];
  return {
    sessionAlerts,
    financialAlerts,
    alerts: [...sessionAlerts, ...financialAlerts],
    sessionPendingCount: sessionAlerts.length,
    financialPendingCount: financialAlerts.length,
  };
}

export function buildPsychologyOperationalAlerts(store: PsychologyStore, reference = new Date()): PsychologyOperationalAlert[] {
  return deriveOperationalPendencies(store, reference).alerts;
}
