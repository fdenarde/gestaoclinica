import { getPsychologyPatientSummary } from './psychologyPatientProfile';
import { locationForSession, type PsychologyLocation } from './psychologyR2a';
import type { PsychologyPatient, PsychologyStore } from './psychologyDomain';
import { formatPsychologyPhoneDisplay } from './psychologyPhone';

export interface PsychologyPatientListItem {
  patient: PsychologyPatient;
  phone: string;
  email: string;
  lastSession: string;
  nextSession: string;
  modalityLocation: string;
}

function dateLabel(value: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

export function formatPsychologyPatientPhone(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  try {
    return formatPsychologyPhoneDisplay(raw);
  } catch {
    return raw;
  }
}

function cleanLabel(value?: string | null): string {
  const label = String(value ?? '').trim();
  return label || '—';
}

function primaryLocation(store: PsychologyStore): PsychologyLocation | undefined {
  return store.settings.locations.find(location => location.active && location.type === 'PRIMARY_OFFICE')
    || store.settings.locations.find(location => location.active);
}

function modalityLocationLabel(store: PsychologyStore, patient: PsychologyPatient, nextSession?: ReturnType<typeof getPsychologyPatientSummary> extends infer Summary ? Summary extends { nextSession?: infer Session } ? Session : never : never, location?: PsychologyLocation): string {
  const modality = nextSession?.modality || patient.preferredModality;
  if (modality === 'online') return 'Online';
  const resolvedLocation = location
    || (nextSession ? locationForSession(store.settings, nextSession) : undefined)
    || primaryLocation(store);
  return resolvedLocation?.displayName ? `Presencial · ${resolvedLocation.displayName}` : 'Presencial';
}

export function getPsychologyPatientListViewModels(store: PsychologyStore, patients: PsychologyPatient[], referenceDate = new Date()): PsychologyPatientListItem[] {
  const rows = patients.map((patient, index) => {
    const summary = getPsychologyPatientSummary(store, patient.id, referenceDate);
    const nextSession = summary?.nextSession;
    return {
      index,
      patient,
      phone: formatPsychologyPatientPhone(patient.phone),
      email: cleanLabel(patient.email),
      lastSession: summary?.lastSession ? dateLabel(summary.lastSession.date) : '—',
      nextSession: nextSession ? `${dateLabel(nextSession.date)} · ${cleanLabel(nextSession.time)}` : 'Sem agendamento',
      modalityLocation: modalityLocationLabel(store, patient, nextSession, summary?.location),
    };
  });

  return rows
    .sort((a, b) => a.patient.name.localeCompare(b.patient.name, 'pt-BR', { sensitivity: 'base' }) || a.index - b.index)
    .map(({ index: _index, ...row }) => row);
}
