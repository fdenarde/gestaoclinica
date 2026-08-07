import { PersonalAppointment } from '../types';

export type PersonalAppointmentOccurrence = PersonalAppointment & {
  occDate: Date;
  occurrenceDateTime: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateDifference(later: Date, earlier: Date): number {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / DAY_MS);
}

function localMonthDifference(later: Date, earlier: Date): number {
  return (later.getFullYear() - earlier.getFullYear()) * 12 + later.getMonth() - earlier.getMonth();
}

export function parsePersonalAppointmentDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;

  return date;
}

export function parsePersonalAppointmentDateTime(app: PersonalAppointment): Date | null {
  const date = parsePersonalAppointmentDate(app.date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(app.time || '');
  if (!date || !timeMatch) return null;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
}

function getMonthlyOccurrenceDate(anchor: Date, monthOffset: number): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth() + monthOffset;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(anchor.getDate(), lastDay));
}

function getOccurrenceDateAtIndex(
  firstDate: Date,
  recurrence: PersonalAppointment['recurrence'],
  index: number,
): Date {
  if (recurrence === 'Toda semana') return addLocalDays(firstDate, index * 7);
  if (recurrence === 'Todo mês') return getMonthlyOccurrenceDate(firstDate, index);
  return firstDate;
}

function getInitialIndex(firstDate: Date, recurrence: PersonalAppointment['recurrence'], rangeStart: Date): number {
  if (recurrence === 'Toda semana') {
    return Math.max(0, Math.ceil(localDateDifference(rangeStart, firstDate) / 7));
  }
  if (recurrence === 'Todo mês') {
    return Math.max(0, localMonthDifference(rangeStart, firstDate));
  }
  return 0;
}

function buildOccurrence(app: PersonalAppointment, occDate: Date): PersonalAppointmentOccurrence {
  const occurrenceDateTime = parsePersonalAppointmentDateTime({ ...app, date: [
    occDate.getFullYear(),
    String(occDate.getMonth() + 1).padStart(2, '0'),
    String(occDate.getDate()).padStart(2, '0'),
  ].join('-') }) || occDate;
  return { ...app, occDate, occurrenceDateTime };
}

export function getPersonalAppointmentOccurrences(
  appointments: PersonalAppointment[],
  start: Date,
  end: Date,
): PersonalAppointmentOccurrence[] {
  const rangeStart = startOfLocalDay(start);
  const rangeEnd = startOfLocalDay(end);
  if (rangeStart > rangeEnd) return [];

  const occurrences: PersonalAppointmentOccurrence[] = [];
  for (const app of appointments) {
    const firstDate = parsePersonalAppointmentDate(app.date);
    if (!firstDate) continue;

    const recurrence = app.recurrence || 'Não repetir';
    const index = getInitialIndex(firstDate, recurrence, rangeStart);
    let occurrenceIndex = index;

    while (true) {
      const occDate = getOccurrenceDateAtIndex(firstDate, recurrence, occurrenceIndex);
      if (occDate > rangeEnd) break;
      if (occDate >= rangeStart && occDate >= firstDate) {
        occurrences.push(buildOccurrence(app, occDate));
      }
      if (recurrence === 'Não repetir') break;
      occurrenceIndex += 1;
    }
  }

  return occurrences;
}

export function getNextPersonalAppointmentOccurrence(
  app: PersonalAppointment,
  from: Date,
): PersonalAppointmentOccurrence | null {
  const firstDate = parsePersonalAppointmentDate(app.date);
  const firstDateTime = parsePersonalAppointmentDateTime(app);
  if (!firstDate || !firstDateTime) return null;

  const recurrence = app.recurrence || 'Não repetir';
  let index = getInitialIndex(firstDate, recurrence, startOfLocalDay(from));
  while (true) {
    const occDate = getOccurrenceDateAtIndex(firstDate, recurrence, index);
    const occurrence = buildOccurrence(app, occDate);
    if (occurrence.occurrenceDateTime >= from && occurrence.occurrenceDateTime >= firstDateTime) {
      return occurrence;
    }
    if (recurrence === 'Não repetir') return null;
    index += 1;
  }
}

export function getPendingPersonalAppointmentOccurrences(
  appointments: PersonalAppointment[],
  start: Date,
  end: Date,
): PersonalAppointmentOccurrence[] {
  return getPersonalAppointmentOccurrences(appointments, start, end)
    .filter(occurrence => !occurrence.isDone);
}
