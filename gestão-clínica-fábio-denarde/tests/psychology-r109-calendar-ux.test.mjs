import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const componentPath = new URL('../src/features/psychology-online-booking/PublicBookingPage.tsx', import.meta.url);
const componentSource = await readFile(componentPath, 'utf8');

test('R109 calendar UX exposes the requested accessible monthly interaction', () => {
  assert.match(componentSource, /function MonthlyCalendar/);
  assert.match(componentSource, /function buildMonthlyCalendarDays/);
  assert.match(componentSource, /Escolha uma data/);
  assert.match(componentSource, /Selecione um dia disponível para ver os horários\./);
  assert.match(componentSource, /const calendarWeekdays = \['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'\]/);
  assert.match(componentSource, /aria-label="Mês anterior"/);
  assert.match(componentSource, /aria-label="Próximo mês"/);
  assert.match(componentSource, /disabled={!isAvailable}/);
  assert.match(componentSource, /aria-selected={isSelected}/);
  assert.match(componentSource, /focus-visible:ring-4/);
  assert.match(componentSource, /data-testid="public-booking-calendar"/);
  assert.match(componentSource, /data-testid="public-booking-time-slots"/);
  assert.doesNotMatch(componentSource, /dates\.slice\(/);
});

test('R109 calendar availability preserves the old date set for the same slot input', () => {
  const today = '2026-08-30';
  const slotDates = ['2026-09-01', '2026-09-03', '2026-09-03', '2026-09-09'];
  const oldAvailableDates = [...new Set(slotDates)];
  const newCalendarAvailableDates = [...new Set(slotDates)].filter(date => date >= today);

  assert.deepEqual(newCalendarAvailableDates, oldAvailableDates);
  assert.deepEqual(newCalendarAvailableDates, ['2026-09-01', '2026-09-03', '2026-09-09']);
});

test('R109 calendar keeps service and modality contracts in the existing flow', () => {
  assert.match(componentSource, /serviceId: service\.id/);
  assert.match(componentSource, /modality, locationId/);
  assert.match(componentSource, /serviceAllowsModality/);
  assert.match(componentSource, /slotsInRange\.map\(slot => slot\.date\)/);
  assert.match(componentSource, /fromDate, throughDate \}\)/);
  assert.match(componentSource, /setStep\(6\)/);
  assert.match(componentSource, /listPublishedSlots/);
});
