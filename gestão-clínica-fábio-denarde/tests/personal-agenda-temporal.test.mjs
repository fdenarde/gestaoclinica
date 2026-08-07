import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  getNextPersonalAppointmentOccurrence,
  getPendingPersonalAppointmentOccurrences,
  getPersonalAppointmentOccurrences,
  parsePersonalAppointmentDate,
} from '../src/lib/personalAgendaTemporal.ts';
import { getAlarmTimingForNow } from '../src/lib/useAlarms.ts';

const localDate = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const appointment = (overrides = {}) => ({
  id: 'agenda-1',
  type: 'Outro',
  date: '2026-09-03',
  time: '11:00',
  durationMinutes: 60,
  recurrence: 'Todo mês',
  notes: '',
  alarmEnabled: false,
  isDone: false,
  ...overrides,
});

const dates = occurrences => occurrences.map(item => [
  item.occDate.getFullYear(),
  String(item.occDate.getMonth() + 1).padStart(2, '0'),
  String(item.occDate.getDate()).padStart(2, '0'),
].join('-'));

test('preserva a data civil YYYY-MM-DD no fuso America/Sao_Paulo', () => {
  const parsed = parsePersonalAppointmentDate('2026-09-03');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 3);
});

test('mensal usa a data inicial como âncora e não cria ocorrência anterior', () => {
  const app = appointment();
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([app], localDate(2026, 8, 1), localDate(2026, 8, 31))), []);
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([app], localDate(2026, 8, 31), localDate(2026, 9, 6))), ['2026-09-03']);
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([app], localDate(2026, 9, 1), localDate(2026, 9, 30))), ['2026-09-03']);
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([app], localDate(2026, 10, 1), localDate(2026, 10, 31))), ['2026-10-03']);
});

test('semana seguinte não reposiciona a ocorrência no primeiro dia da semana', () => {
  const app = appointment();
  assert.equal(getPersonalAppointmentOccurrences([app], localDate(2026, 9, 7), localDate(2026, 9, 13)).length, 0);
});

test('ocorrência mensal conserva quinta-feira e horário da âncora', () => {
  const [occurrence] = getPersonalAppointmentOccurrences([appointment()], localDate(2026, 8, 31), localDate(2026, 9, 6));
  assert.equal(occurrence.occDate.getDay(), 4);
  assert.equal(occurrence.time, '11:00');
  assert.equal(occurrence.occurrenceDateTime.getHours(), 11);
});

test('próximo lembrete antes da âncora é 03/09/2026 às 11:00, nunca hoje', () => {
  const next = getNextPersonalAppointmentOccurrence(appointment(), localDate(2026, 8, 7, 12));
  assert.equal(next.occurrenceDateTime.getTime(), localDate(2026, 9, 3, 11).getTime());
});

test('próxima ocorrência após 03/09 é 03/10', () => {
  const next = getNextPersonalAppointmentOccurrence(appointment(), localDate(2026, 9, 3, 12));
  assert.equal(next.occurrenceDateTime.getTime(), localDate(2026, 10, 3, 11).getTime());
});

test('compromisso único e recorrência semanal continuam funcionando', () => {
  const single = appointment({ id: 'single', recurrence: 'Não repetir' });
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([single], localDate(2026, 9, 1), localDate(2026, 9, 30))), ['2026-09-03']);

  const weekly = appointment({ id: 'weekly', recurrence: 'Toda semana' });
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([weekly], localDate(2026, 9, 3), localDate(2026, 9, 20))), ['2026-09-03', '2026-09-10', '2026-09-17']);
});

test('contador de pendentes é derivado da mesma projeção temporal', () => {
  const app = appointment();
  assert.equal(getPendingPersonalAppointmentOccurrences([app], localDate(2026, 8, 31), localDate(2026, 9, 6)).length, 1);
  assert.equal(getPendingPersonalAppointmentOccurrences([app], localDate(2026, 9, 7), localDate(2026, 9, 13)).length, 0);
  assert.equal(getPendingPersonalAppointmentOccurrences([appointment({ isDone: true })], localDate(2026, 8, 31), localDate(2026, 9, 6)).length, 0);
});

test('as quatro projeções recebem a mesma ocorrência após recarregar o payload', () => {
  const persisted = JSON.parse(JSON.stringify(appointment()));
  const expected = ['2026-09-03'];
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([persisted], localDate(2026, 8, 31), localDate(2026, 9, 6))), expected);
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([persisted], localDate(2026, 9, 1), localDate(2026, 9, 30))), expected);
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([persisted], localDate(2026, 9, 1), localDate(2026, 9, 30))), expected);
  assert.deepEqual(dates(getPersonalAppointmentOccurrences([persisted], localDate(2026, 8, 31), localDate(2026, 9, 6))), expected);
});

test('alarme mensal também respeita a ocorrência real e não usa hoje', () => {
  const app = appointment({ alarmEnabled: true, alarmAdvance: 'Na hora' });
  assert.equal(getAlarmTimingForNow(app, localDate(2026, 8, 7, 11)), null);
  const timing = getAlarmTimingForNow(app, localDate(2026, 9, 3, 11));
  assert.equal(timing.occurrenceTime.getTime(), localDate(2026, 9, 3, 11).getTime());
  assert.equal(getAlarmTimingForNow(app, localDate(2026, 9, 7, 11)), null);
});

test('alternar as projeções não muta nem desloca a ocorrência', () => {
  const app = appointment();
  const ranges = [
    [localDate(2026, 8, 31), localDate(2026, 9, 6)],
    [localDate(2026, 9, 1), localDate(2026, 9, 30)],
    [localDate(2026, 9, 1), localDate(2026, 9, 30)],
    [localDate(2026, 8, 31), localDate(2026, 9, 6)],
  ];
  assert.deepEqual(ranges.map(([start, end]) => dates(getPersonalAppointmentOccurrences([app], start, end))), [
    ['2026-09-03'], ['2026-09-03'], ['2026-09-03'], ['2026-09-03'],
  ]);
  assert.equal(app.date, '2026-09-03');
});

test('o componente usa o projetor compartilhado e não contém os fallbacks defeituosos', () => {
  const source = fs.readFileSync(new URL('../src/components/PersonalAgenda.tsx', import.meta.url), 'utf8');
  assert.match(source, /getPersonalAppointmentOccurrences/);
  assert.match(source, /getNextPersonalAppointmentOccurrence/);
  assert.doesNotMatch(source, /let curr = new Date\(start\)/);
  assert.doesNotMatch(source, /occurrenceDate \|\| today/);
  assert.doesNotMatch(source, /startDate \|\| weekStart/);
});

test('salvamento da UI aguarda confirmação e mantém o modal em falha', () => {
  const source = fs.readFileSync(new URL('../src/components/PersonalAgenda.tsx', import.meta.url), 'utf8');
  assert.match(source, /const persisted = await onUpdate\(\{ personalAppointments: updatedList \}\)/);
  assert.match(source, /if \(!persisted\)/);
  assert.match(source, /setIsModalOpen\(false\)/);
  assert.match(source, /\+ Novo Compromisso/);
});
