export const PSYCHOLOGY_AGENDA_START_MINUTES = 7 * 60;
export const PSYCHOLOGY_AGENDA_END_MINUTES = 21 * 60;

export type PsychologyAgendaTimeProgress = {
  visible: boolean;
  minutes: number;
  label: string;
  minuteProgress: number;
  dayProgress: number;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function civilDate(value: Date | string) {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function getPsychologyAgendaTimeProgress(now: Date): PsychologyAgendaTimeProgress {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const visible = minutes >= PSYCHOLOGY_AGENDA_START_MINUTES && minutes < PSYCHOLOGY_AGENDA_END_MINUTES;
  const minuteProgress = now.getMinutes() / 60;
  const dayProgress = (minutes - PSYCHOLOGY_AGENDA_START_MINUTES) / (PSYCHOLOGY_AGENDA_END_MINUTES - PSYCHOLOGY_AGENDA_START_MINUTES);

  return {
    visible,
    minutes,
    label: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    minuteProgress: visible ? minuteProgress : 0,
    dayProgress: visible ? Math.max(0, Math.min(1, dayProgress)) : 0,
  };
}

export function getPsychologyAgendaRowProgress(currentMinutes: number, rowStartMinutes: number, rowEndMinutes: number) {
  if (currentMinutes < rowStartMinutes || currentMinutes >= rowEndMinutes || rowEndMinutes <= rowStartMinutes) return null;
  return Math.max(0, Math.min(1, (currentMinutes - rowStartMinutes) / (rowEndMinutes - rowStartMinutes)));
}

export function isPsychologyAgendaToday(displayedDate: Date | string, now: Date) {
  return civilDate(displayedDate) === civilDate(now);
}
