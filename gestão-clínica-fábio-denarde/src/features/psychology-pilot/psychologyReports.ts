import type {
  PsychologyModality,
  PsychologyPatient,
  PsychologySession,
  PsychologySessionStatus,
  PsychologyStore,
} from './psychologyDomain';
import { PSYCHOLOGY_CONTEXT } from './psychologyDomain';
import {
  createPsychologyPeriod,
  formatPsychologyMoney,
  getPsychologyFinancialLedger,
  getPsychologyFinancialOverview,
  isPsychologyDateInPeriod,
  psychologyCivilDate,
  type PsychologyCanonicalChargeStatus,
  type PsychologyFinancialPeriod,
} from './psychologyFinancialLedger';
import type { PsychologyPaymentMethod } from './psychologyR2a';
import { getPsychologyAvailabilityPeriods, locationForSession } from './psychologyR2a';

export type PsychologyReportKind = 'sessions' | 'finance' | 'agenda' | 'patients';
export type PsychologyPatientStatusFilter = 'all' | 'active' | 'inactive' | 'with-next' | 'without-next' | 'with-package' | 'without-package';

export interface PsychologyReportFilter {
  period: PsychologyFinancialPeriod;
  patientId?: string;
  sessionStatus?: PsychologySessionStatus | 'all';
  modality?: PsychologyModality | 'all';
  locationId?: string;
  serviceId?: string;
  patientStatus?: PsychologyPatientStatusFilter;
}

export type PsychologyAdministrativeSession = Pick<PsychologySession, 'id' | 'professionalId' | 'context' | 'patientId' | 'date' | 'time' | 'durationMinutes' | 'modality' | 'serviceId' | 'locationId' | 'locationType' | 'status'>;

export interface PsychologySessionReportRow {
  session: PsychologyAdministrativeSession;
  patientName: string;
  modalityLabel: string;
  locationLabel: string;
  serviceLabel: string;
  statusLabel: string;
}

export interface PsychologySessionsReport {
  kind: 'sessions';
  rows: PsychologySessionReportRow[];
  total: number;
  realized: number;
  scheduled: number;
  absences: number;
  cancelled: number;
  attendanceRate: number | null;
}

export interface PsychologyFinanceReport {
  kind: 'finance';
  overview: ReturnType<typeof getPsychologyFinancialOverview>;
  chargeRows: ReturnType<typeof getPsychologyFinancialLedger>['chargeEntries'];
  paymentRows: ReturnType<typeof getPsychologyFinancialLedger>['payments'];
  expenseRows: ReturnType<typeof getPsychologyFinancialLedger>['expenses'];
  receivedByMethod: Array<{ method: PsychologyPaymentMethod; label: string; amount: number }>;
}

export interface PsychologyAgendaDistributionRow {
  label: string;
  count: number;
  minutes: number;
}

export interface PsychologyAgendaReport {
  kind: 'agenda';
  rows: PsychologySessionReportRow[];
  scheduledSessions: number;
  scheduledMinutes: number;
  realizedMinutes: number;
  availableMinutes: number | null;
  occupancyRate: number | null;
  availabilityConfigured: boolean;
  byDay: PsychologyAgendaDistributionRow[];
  byModality: PsychologyAgendaDistributionRow[];
  byLocation: PsychologyAgendaDistributionRow[];
}

export interface PsychologyPatientReportRow {
  patient: PsychologyPatient;
  lastSessionDate?: string;
  nextSession?: PsychologySession;
  preferredModalityLabel: string;
  activePackageName?: string;
}

export interface PsychologyPatientsReport {
  kind: 'patients';
  rows: PsychologyPatientReportRow[];
  active: number;
  inactive: number;
  withNext: number;
  withoutNext: number;
  withPackage: number;
}

export type PsychologyReport = PsychologySessionsReport | PsychologyFinanceReport | PsychologyAgendaReport | PsychologyPatientsReport;

export const psychologyReportStatusLabels: Record<PsychologySessionStatus, string> = {
  agendada: 'Agendada',
  realizada: 'Realizada',
  falta: 'Falta',
  cancelada: 'Cancelada',
};

export const psychologyReportChargeStatusLabels: Record<PsychologyCanonicalChargeStatus, string> = {
  PENDING: 'Pendente',
  PARTIALLY_PAID: 'Parcial',
  PAID: 'Pago',
  EXEMPT: 'Isento',
  CANCELLED: 'Cancelada',
};

export const psychologyReportPaymentMethodLabels: Record<PsychologyPaymentMethod, string> = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

export function createPsychologyReportFilter(preset: 'week' | 'month' | 'year' | 'custom' = 'month'): PsychologyReportFilter {
  return { period: createPsychologyPeriod(preset), sessionStatus: 'all', modality: 'all', patientStatus: 'all' };
}

export function formatPsychologyReportDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(date);
}

export function formatPsychologyReportDateTime(date?: string, time?: string): string {
  if (!date) return '—';
  return `${formatPsychologyReportDate(date)}${time ? ` · ${time}` : ''}`;
}

function inScope(item: { professionalId?: string; context?: string }, store: PsychologyStore): boolean {
  return item.professionalId === store.scope.professionalId && item.context === PSYCHOLOGY_CONTEXT;
}

function scopedPatients(store: PsychologyStore): PsychologyPatient[] {
  return store.patients.filter(patient => inScope(patient, store));
}

function scopedSessions(store: PsychologyStore): PsychologySession[] {
  const patientIds = new Set(scopedPatients(store).map(patient => patient.id));
  return store.sessions.filter(session => inScope(session, store) && patientIds.has(session.patientId));
}

function sessionLocationLabel(store: PsychologyStore, session: PsychologySession): string {
  if (session.modality === 'online') return 'Online';
  const exact = store.locations.find(location => location.id === session.locationId && inScope(location, store));
  return exact?.displayName || locationForSession(store.settings, session)?.displayName || 'Presencial';
}

function sessionRow(store: PsychologyStore, session: PsychologySession, patientMap: Map<string, PsychologyPatient>): PsychologySessionReportRow {
  const service = store.services.find(item => item.id === session.serviceId && inScope(item, store));
  return {
    session: {
      id: session.id,
      professionalId: session.professionalId,
      context: session.context,
      patientId: session.patientId,
      date: session.date,
      time: session.time,
      durationMinutes: session.durationMinutes,
      modality: session.modality,
      serviceId: session.serviceId,
      locationId: session.locationId,
      locationType: session.locationType,
      status: session.status,
    },
    patientName: patientMap.get(session.patientId)?.name || 'Paciente não encontrado',
    modalityLabel: session.modality === 'online' ? 'Online' : 'Presencial',
    locationLabel: sessionLocationLabel(store, session),
    serviceLabel: service?.name || '—',
    statusLabel: psychologyReportStatusLabels[session.status],
  };
}

function sortSessions(a: PsychologySession, b: PsychologySession): number {
  return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`) || a.id.localeCompare(b.id);
}

function matchesSession(session: PsychologySession, filter: PsychologyReportFilter): boolean {
  if (!isPsychologyDateInPeriod(session.date, filter.period)) return false;
  if (filter.patientId && filter.patientId !== 'all' && session.patientId !== filter.patientId) return false;
  if (filter.sessionStatus && filter.sessionStatus !== 'all' && session.status !== filter.sessionStatus) return false;
  if (filter.modality && filter.modality !== 'all' && session.modality !== filter.modality) return false;
  if (filter.locationId && filter.locationId !== 'all' && session.locationId !== filter.locationId) return false;
  if (filter.serviceId && filter.serviceId !== 'all' && session.serviceId !== filter.serviceId) return false;
  return true;
}

export function getPsychologySessionsReport(store: PsychologyStore, filter: PsychologyReportFilter): PsychologySessionsReport {
  const patientMap = new Map(scopedPatients(store).map(patient => [patient.id, patient]));
  const rows = scopedSessions(store).filter(session => matchesSession(session, filter)).sort(sortSessions).map(session => sessionRow(store, session, patientMap));
  const realized = rows.filter(row => row.session.status === 'realizada').length;
  const scheduled = rows.filter(row => row.session.status === 'agendada').length;
  const absences = rows.filter(row => row.session.status === 'falta').length;
  const cancelled = rows.filter(row => row.session.status === 'cancelada').length;
  const eligible = realized + absences;
  return { kind: 'sessions', rows, total: rows.length, realized, scheduled, absences, cancelled, attendanceRate: eligible ? (realized / eligible) * 100 : null };
}

function filteredFinanceStore(store: PsychologyStore, filter: PsychologyReportFilter): PsychologyStore {
  if (!filter.patientId || filter.patientId === 'all') return store;
  const patientId = filter.patientId;
  return {
    ...store,
    patients: store.patients.filter(item => item.id === patientId),
    charges: store.charges.filter(item => item.patientId === patientId),
    payments: store.payments.filter(item => item.patientId === patientId),
    sessions: store.sessions.filter(item => item.patientId === patientId),
  };
}

export function getPsychologyFinanceReport(store: PsychologyStore, filter: PsychologyReportFilter): PsychologyFinanceReport {
  const scopedStore = filteredFinanceStore(store, filter);
  const ledger = getPsychologyFinancialLedger(scopedStore);
  const overview = getPsychologyFinancialOverview(scopedStore, filter.period);
  const chargeRows = ledger.chargeEntries.filter(entry => isPsychologyDateInPeriod(entry.charge.dueDate || entry.charge.createdAt, filter.period));
  const paymentRows = ledger.payments.filter(payment => isPsychologyDateInPeriod(payment.date, filter.period));
  const expenseRows = ledger.expenses.filter(expense => isPsychologyDateInPeriod(expense.date, filter.period));
  const receivedByMethod = (Object.keys(psychologyReportPaymentMethodLabels) as PsychologyPaymentMethod[]).map(method => ({
    method,
    label: psychologyReportPaymentMethodLabels[method],
    amount: ledger.activePayments.filter(payment => payment.method === method && isPsychologyDateInPeriod(payment.date, filter.period)).reduce((sum, payment) => sum + payment.amount, 0),
  }));
  return { kind: 'finance', overview, chargeRows, paymentRows, expenseRows, receivedByMethod };
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(new Date(`${date}T12:00:00`)).replace(/^./, value => value.toUpperCase());
}

function distribution(rows: PsychologySessionReportRow[], getLabel: (row: PsychologySessionReportRow) => string): PsychologyAgendaDistributionRow[] {
  const grouped = new Map<string, PsychologyAgendaDistributionRow>();
  rows.filter(row => row.session.status !== 'cancelada').forEach(row => {
    const label = getLabel(row);
    const current = grouped.get(label) || { label, count: 0, minutes: 0 };
    current.count += 1;
    current.minutes += row.session.durationMinutes;
    grouped.set(label, current);
  });
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}

function configuredAvailableMinutes(store: PsychologyStore, period: PsychologyFinancialPeriod): number | null {
  const agenda = store.settings.agenda;
  if (!agenda.weeklyAvailability?.some(day => day.enabled && day.periods.length)) return null;
  const start = new Date(`${period.startDate}T12:00:00`);
  const end = new Date(`${period.endDate}T12:00:00`);
  let minutes = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    minutes += getPsychologyAvailabilityPeriods(agenda, cursor.getDay()).reduce((total, item) => {
      const [startHour, startMinute] = item.startTime.split(':').map(Number);
      const [endHour, endMinute] = item.endTime.split(':').map(Number);
      return total + Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
    }, 0);
  }
  return minutes;
}

export function getPsychologyAgendaReport(store: PsychologyStore, filter: PsychologyReportFilter): PsychologyAgendaReport {
  const sessions = getPsychologySessionsReport(store, filter);
  const scheduledRows = sessions.rows.filter(row => row.session.status !== 'cancelada');
  const scheduledMinutes = scheduledRows.reduce((sum, row) => sum + row.session.durationMinutes, 0);
  const realizedMinutes = scheduledRows.filter(row => row.session.status === 'realizada').reduce((sum, row) => sum + row.session.durationMinutes, 0);
  const availableMinutes = configuredAvailableMinutes(store, filter.period);
  return {
    kind: 'agenda',
    rows: sessions.rows,
    scheduledSessions: scheduledRows.length,
    scheduledMinutes,
    realizedMinutes,
    availableMinutes,
    occupancyRate: availableMinutes && availableMinutes > 0 ? (scheduledMinutes / availableMinutes) * 100 : null,
    availabilityConfigured: availableMinutes !== null,
    byDay: distribution(sessions.rows, row => dayLabel(row.session.date)),
    byModality: distribution(sessions.rows, row => row.modalityLabel),
    byLocation: distribution(sessions.rows, row => row.locationLabel),
  };
}

function nextSessionFor(patientId: string, sessions: PsychologySession[], today: string): PsychologySession | undefined {
  return sessions.filter(session => session.patientId === patientId && session.status === 'agendada' && session.date >= today).sort(sortSessions)[0];
}

function lastSessionDateFor(patientId: string, sessions: PsychologySession[], endDate: string, today: string): string | undefined {
  return sessions.filter(session => session.patientId === patientId && session.status !== 'cancelada' && session.date <= endDate && session.date <= today).sort(sortSessions).at(-1)?.date;
}

export function getPsychologyPatientsReport(store: PsychologyStore, filter: PsychologyReportFilter, today = psychologyCivilDate()): PsychologyPatientsReport {
  const patients = scopedPatients(store);
  const sessions = scopedSessions(store);
  const packages = (store.sessionPackages || []).filter(item => inScope(item, store) && item.active);
  const rows = patients.map(patient => {
    const nextSession = nextSessionFor(patient.id, sessions, today);
    const activePackage = packages.find(item => item.patientId === patient.id);
    return {
      patient,
      lastSessionDate: lastSessionDateFor(patient.id, sessions, filter.period.endDate, today),
      nextSession,
      preferredModalityLabel: patient.preferredModality === 'online' ? 'Online' : 'Presencial',
      activePackageName: activePackage?.name,
    } satisfies PsychologyPatientReportRow;
  }).filter(row => {
    const status = filter.patientStatus || 'all';
    if (status === 'active') return row.patient.active;
    if (status === 'inactive') return !row.patient.active;
    if (status === 'with-next') return Boolean(row.nextSession);
    if (status === 'without-next') return !row.nextSession;
    if (status === 'with-package') return Boolean(row.activePackageName);
    if (status === 'without-package') return !row.activePackageName;
    return true;
  }).sort((a, b) => a.patient.name.localeCompare(b.patient.name, 'pt-BR', { sensitivity: 'base' }));
  const allRows = patients.map(patient => {
    const next = nextSessionFor(patient.id, sessions, today);
    const activePackage = packages.some(item => item.patientId === patient.id);
    return { patient, next, activePackage };
  });
  return {
    kind: 'patients',
    rows,
    active: allRows.filter(row => row.patient.active).length,
    inactive: allRows.filter(row => !row.patient.active).length,
    withNext: allRows.filter(row => row.next).length,
    withoutNext: allRows.filter(row => !row.next).length,
    withPackage: allRows.filter(row => row.activePackage).length,
  };
}

export function getPsychologyReport(store: PsychologyStore, kind: PsychologyReportKind, filter: PsychologyReportFilter): PsychologyReport {
  if (kind === 'sessions') return getPsychologySessionsReport(store, filter);
  if (kind === 'finance') return getPsychologyFinanceReport(store, filter);
  if (kind === 'agenda') return getPsychologyAgendaReport(store, filter);
  return getPsychologyPatientsReport(store, filter);
}

export function formatPsychologyReportMoney(value: number): string {
  return formatPsychologyMoney(value);
}
