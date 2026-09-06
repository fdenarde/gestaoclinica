export const PSYCHOLOGY_AGENDA_START_MINUTES = 7 * 60;
export const PSYCHOLOGY_AGENDA_END_MINUTES = 21 * 60;
export const PSYCHOLOGY_AGENDA_TOTAL_MINUTES = PSYCHOLOGY_AGENDA_END_MINUTES - PSYCHOLOGY_AGENDA_START_MINUTES;
// The weekly grid needs roughly 1,080px for its time rail and six day columns.
// Keep this aligned with the existing xl breakpoint so narrower tablets and
// small laptops use the continuous vertical presentation instead.
export const PSYCHOLOGY_AGENDA_WEEKLY_MIN_WIDTH = 1280;

export type PsychologyAgendaScale = {
  pixelsPerMinute: number;
  minRowHeight: number;
  minEventHeight: number;
  totalMinutes: number;
  rowHeightForMinutes: (minutes: number) => number;
  eventHeightForMinutes: (minutes: number) => number;
};

export function psychologyAgendaTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export type PsychologyCompactAgendaPeriod = {
  startTime: string;
  endTime: string;
};

export type PsychologyCompactAgendaEvent = {
  time: string;
  durationMinutes: number;
};

export type PsychologyCompactAgendaFreeRange = {
  startTime: string;
  endTime: string;
  slotTimes: string[];
};

function psychologyAgendaMinutesToTime(value: number): string {
  const minutes = Math.max(0, Math.round(value));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function getPsychologyCompactAgendaFreeRanges(
  periods: PsychologyCompactAgendaPeriod[],
  intervalMinutes: number,
  events: PsychologyCompactAgendaEvent[] = [],
): PsychologyCompactAgendaFreeRange[] {
  const interval = Math.max(1, Math.floor(Number(intervalMinutes) || 10));
  const normalizedPeriods = periods
    .map(period => ({
      start: psychologyAgendaTimeToMinutes(period.startTime),
      end: psychologyAgendaTimeToMinutes(period.endTime),
    }))
    .filter(period => period.end > period.start)
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((merged, period) => {
      const previous = merged[merged.length - 1];
      if (previous && period.start <= previous.end) {
        previous.end = Math.max(previous.end, period.end);
      } else {
        merged.push({ ...period });
      }
      return merged;
    }, []);
  const occupied = events
    .map(event => ({
      start: psychologyAgendaTimeToMinutes(event.time),
      end: psychologyAgendaTimeToMinutes(event.time) + Math.max(1, Number(event.durationMinutes) || 1),
    }))
    .filter(event => event.end > event.start);
  const ranges: PsychologyCompactAgendaFreeRange[] = [];

  normalizedPeriods.forEach(period => {
    let slotTimes: string[] = [];
    let rangeEnd = period.start;
    const flush = () => {
      if (slotTimes.length === 0) return;
      ranges.push({
        startTime: slotTimes[0],
        endTime: psychologyAgendaMinutesToTime(rangeEnd),
        slotTimes,
      });
      slotTimes = [];
    };

    for (let slotStart = period.start; slotStart < period.end; slotStart += interval) {
      const slotEnd = Math.min(period.end, slotStart + interval);
      const isOccupied = occupied.some(event => event.start < slotEnd && event.end > slotStart);
      if (isOccupied) {
        flush();
        rangeEnd = slotEnd;
        continue;
      }
      slotTimes.push(psychologyAgendaMinutesToTime(slotStart));
      rangeEnd = slotEnd;
    }
    flush();
  });

  return ranges;
}

export function getPsychologyAgendaScale(viewportHeight: number, viewportWidth: number): PsychologyAgendaScale {
  const height = Math.max(480, Number.isFinite(viewportHeight) ? viewportHeight : 900);
  const width = Math.max(320, Number.isFinite(viewportWidth) ? viewportWidth : 1280);
  const continuous = width < PSYCHOLOGY_AGENDA_WEEKLY_MIN_WIDTH;
  const mobile = continuous;
  const reservedHeight = continuous ? 180 : Math.min(260, Math.max(205, Math.round(height * 0.27)));
  const fittedPixelsPerMinute = (height - reservedHeight) / PSYCHOLOGY_AGENDA_TOTAL_MINUTES;
  // Keep the temporal grid comfortable and let the agenda scroll vertically
  // instead of compressing a full working day into the viewport.
  const pixelsPerMinute = mobile
    ? 1.2
    : Math.min(1.4, Math.max(1.3, fittedPixelsPerMinute));
  const minRowHeight = continuous ? 58 : 22;
  const minEventHeight = continuous ? 26 : 28;

  return {
    pixelsPerMinute,
    minRowHeight,
    minEventHeight,
    totalMinutes: PSYCHOLOGY_AGENDA_TOTAL_MINUTES,
    rowHeightForMinutes: (minutes: number) => Math.max(minRowHeight, Math.round(Math.max(1, minutes) * pixelsPerMinute)),
    eventHeightForMinutes: (minutes: number) => Math.max(minEventHeight, Math.round(Math.max(1, minutes) * pixelsPerMinute)),
  };
}
