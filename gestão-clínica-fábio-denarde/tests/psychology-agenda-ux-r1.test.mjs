import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getPsychologyAgendaScale,
  getPsychologyCompactAgendaFreeRanges,
  PSYCHOLOGY_AGENDA_WEEKLY_MIN_WIDTH,
} from '../src/features/psychology-pilot/psychologyAgendaScale.ts';

const source = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const agendaSource = source.slice(source.indexOf('function AgendaView('), source.indexOf('function TabbedAgendaSlotMenu'));

test('R1 agenda visual mantém a grade semanal só quando há espaço útil', () => {
  assert.equal(PSYCHOLOGY_AGENDA_WEEKLY_MIN_WIDTH, 1280);
  assert.equal(getPsychologyAgendaScale(768, 1366).minRowHeight, 22);
  assert.ok(getPsychologyAgendaScale(768, 1024).minRowHeight >= 58);
  assert.match(agendaSource, /const isContinuousAgenda = viewport\.width < PSYCHOLOGY_AGENDA_WEEKLY_MIN_WIDTH/);
  assert.match(agendaSource, /data-agenda-layout=\{isContinuousAgenda \? 'continuous' : 'weekly'\}/);
});

test('R1 agenda visualiza horas principais e preserva divisões intermediárias', () => {
  assert.match(agendaSource, /const isMajorHour = time\.endsWith\('\:00'\)/);
  assert.match(agendaSource, /data-agenda-hour-label="major"/);
  assert.match(agendaSource, /data-agenda-hour-label="minor"/);
  assert.match(agendaSource, /rowHeightForMinutes\(Math\.max\(1/);
});

test('R1 agenda informa data e hora no hover/foco sem bloquear o clique', () => {
  assert.match(source, /const formatAgendaCellLabel = \(day: Date, time: string\)/);
  assert.match(agendaSource, /data-agenda-tooltip=\{cellLabel\}/);
  assert.match(agendaSource, /data-testid="psychology-agenda-slot-tooltip"/);
  assert.match(agendaSource, /aria-label=\{`Agendar em \$\{cellLabel\}`\}/);
  assert.match(agendaSource, /group-hover:inline-flex group-focus-visible:inline-flex/);
  assert.match(agendaSource, /onClick=\{\(\) => setSlotMenu\(\{ date, time, endTime: slotEndTime, marker: publicMarker \}\)\}/);
});

test('R1 agenda aplica guia discreto de linha, coluna e interseção', () => {
  assert.match(agendaSource, /const \[hoveredCell, setHoveredCell\]/);
  assert.match(agendaSource, /data-agenda-hovered-row=\{rowHovered \? 'true' : 'false'\}/);
  assert.match(agendaSource, /data-agenda-hovered-cell=\{isIntersection \? 'true' : 'false'\}/);
  assert.match(agendaSource, /ring-2 ring-inset ring-violet-300/);
});

test('R1 agenda responsiva empilha cada dia uma vez e mantém a mesma origem de eventos', () => {
  assert.match(agendaSource, /data-testid="psychology-agenda-mobile-sequence"/);
  assert.match(agendaSource, /weekDays\.map\(renderCompactDay\)/);
  assert.match(agendaSource, /data-testid="psychology-agenda-mobile-day"/);
  assert.match(agendaSource, /getPsychologyAvailabilityPeriods\(settings\.agenda, day\.getDay\(\)\)/);
  assert.match(agendaSource, /getPsychologyCompactAgendaFreeRanges\(/);
  assert.match(agendaSource, /data-testid="psychology-agenda-compact-empty-day"/);
  assert.match(agendaSource, /data-testid="psychology-agenda-compact-free-range"/);
  assert.match(agendaSource, /data-testid="psychology-agenda-compact-slot-list"/);
  assert.match(agendaSource, /data-testid="psychology-agenda-compact-free-slot"/);
  assert.match(agendaSource, /className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"/);
  assert.match(agendaSource, /className="flex min-h-11 min-w-0 items-center justify-between/);
  assert.match(agendaSource, /className="whitespace-nowrap"/);
  assert.doesNotMatch(agendaSource, /grid-cols-1/);
  assert.match(agendaSource, /aria-expanded=\{expanded\}/);
  assert.match(agendaSource, /Ver horários disponíveis/);
  assert.match(agendaSource, /Recolher horários/);
  assert.match(agendaSource, /onOpenSession\(item\.session\)/);
  assert.match(agendaSource, /onOpenPersonal\(item\.commitment\)/);
  assert.doesNotMatch(agendaSource, /renderGrid\(\[day\], 'mobile'\)/);
  assert.doesNotMatch(agendaSource, /mobileDayIndex|aria-label="Dia anterior"|aria-label="Próximo dia"/);
  assert.match(agendaSource, /data-testid="psychology-agenda-weekly-view"/);
});

test('R1 agenda compacta um dia vazio em uma faixa e preserva a granularidade real', () => {
  const ranges = getPsychologyCompactAgendaFreeRanges([{ startTime: '07:00', endTime: '21:00' }], 10);

  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0], {
    startTime: '07:00',
    endTime: '21:00',
    slotTimes: Array.from({ length: 84 }, (_, index) => {
      const minutes = 7 * 60 + index * 10;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }),
  });
});

test('R1 agenda compacta agrupa somente os intervalos livres entre compromissos', () => {
  const ranges = getPsychologyCompactAgendaFreeRanges(
    [{ startTime: '07:00', endTime: '21:00' }],
    10,
    [{ time: '17:00', durationMinutes: 50 }],
  );

  assert.deepEqual(ranges.map(range => [range.startTime, range.endTime]), [
    ['07:00', '17:00'],
    ['17:50', '21:00'],
  ]);
  assert.equal(ranges[0].slotTimes.at(-1), '16:50');
  assert.equal(ranges[1].slotTimes[0], '17:50');
});

test('R1 agenda compacta mantém períodos de disponibilidade separados', () => {
  const ranges = getPsychologyCompactAgendaFreeRanges([
    { startTime: '08:00', endTime: '12:00' },
    { startTime: '13:00', endTime: '18:00' },
  ], 10);

  assert.deepEqual(ranges.map(range => [range.startTime, range.endTime]), [
    ['08:00', '12:00'],
    ['13:00', '18:00'],
  ]);
});
