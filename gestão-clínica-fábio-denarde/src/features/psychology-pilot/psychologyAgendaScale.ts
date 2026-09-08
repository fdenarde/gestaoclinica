export const PSYCHOLOGY_AGENDA_START_MINUTES = 7 * 60;
export const PSYCHOLOGY_AGENDA_END_MINUTES = 21 * 60;
export const PSYCHOLOGY_AGENDA_TOTAL_MINUTES = PSYCHOLOGY_AGENDA_END_MINUTES - PSYCHOLOGY_AGENDA_START_MINUTES;

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

export function getPsychologyAgendaScale(viewportHeight: number, viewportWidth: number): PsychologyAgendaScale {
  const height = Math.max(480, Number.isFinite(viewportHeight) ? viewportHeight : 900);
  const width = Math.max(320, Number.isFinite(viewportWidth) ? viewportWidth : 1280);
  const mobile = width < 768;
  const reservedHeight = mobile ? 180 : Math.min(260, Math.max(205, Math.round(height * 0.27)));
  const fittedPixelsPerMinute = (height - reservedHeight) / PSYCHOLOGY_AGENDA_TOTAL_MINUTES;
  // Keep the temporal grid comfortable and let the agenda scroll vertically
  // instead of compressing a full working day into the viewport.
  const pixelsPerMinute = mobile
    ? 1.2
    : Math.min(1.4, Math.max(1.3, fittedPixelsPerMinute));
  const minRowHeight = mobile ? 58 : 22;
  const minEventHeight = mobile ? 26 : 28;

  return {
    pixelsPerMinute,
    minRowHeight,
    minEventHeight,
    totalMinutes: PSYCHOLOGY_AGENDA_TOTAL_MINUTES,
    rowHeightForMinutes: (minutes: number) => Math.max(minRowHeight, Math.round(Math.max(1, minutes) * pixelsPerMinute)),
    eventHeightForMinutes: (minutes: number) => Math.max(minEventHeight, Math.round(Math.max(1, minutes) * pixelsPerMinute)),
  };
}
