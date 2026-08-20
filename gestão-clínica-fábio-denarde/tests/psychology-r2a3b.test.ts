import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  getPsychologyAgendaRowProgress,
  getPsychologyAgendaTimeProgress,
  isPsychologyAgendaToday,
} from '../src/features/psychology-pilot/psychologyAgendaTemporal.ts';

const localTime = (hour: number, minute: number) => new Date(2026, 7, 13, hour, minute, 0);

test('indicador fica visível somente entre 07:00 e 20:59', () => {
  assert.equal(getPsychologyAgendaTimeProgress(localTime(6, 59)).visible, false);
  assert.equal(getPsychologyAgendaTimeProgress(localTime(7, 0)).visible, true);
  assert.equal(getPsychologyAgendaTimeProgress(localTime(20, 59)).visible, true);
  assert.equal(getPsychologyAgendaTimeProgress(localTime(21, 0)).visible, false);
});

test('indicador preserva HH:mm e proporção exata dentro da hora', () => {
  assert.equal(getPsychologyAgendaTimeProgress(localTime(8, 0)).label, '08:00');
  assert.equal(getPsychologyAgendaTimeProgress(localTime(12, 22)).label, '12:22');
  assert.equal(getPsychologyAgendaTimeProgress(localTime(8, 15)).minuteProgress, 0.25);
  assert.equal(getPsychologyAgendaTimeProgress(localTime(8, 30)).minuteProgress, 0.5);
  assert.equal(getPsychologyAgendaTimeProgress(localTime(8, 45)).minuteProgress, 0.75);
  assert.equal(getPsychologyAgendaRowProgress(8 * 60 + 15, 8 * 60, 9 * 60), 0.25);
  assert.equal(getPsychologyAgendaRowProgress(8 * 60 + 30, 8 * 60, 9 * 60), 0.5);
  assert.equal(getPsychologyAgendaRowProgress(8 * 60 + 45, 8 * 60, 9 * 60), 0.75);
});

test('indicador aparece apenas na coluna do dia atual', () => {
  const now = localTime(12, 22);
  assert.equal(isPsychologyAgendaToday('2026-08-13', now), true);
  assert.equal(isPsychologyAgendaToday('2026-08-12', now), false);
  assert.equal(isPsychologyAgendaToday('2026-08-14', now), false);
  assert.equal(getPsychologyAgendaRowProgress(12 * 60 + 22, 12 * 60, 13 * 60), 22 / 60);
});

test('Agenda usa atualização com limpeza, pointer-events none e scrollbar temporal interno', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const agendaView = source.slice(source.indexOf('function AgendaView'), source.indexOf('function WeeklySessionTile'));
  assert.match(agendaView, /setInterval\(updateAgendaNow, 60_000\)/);
  assert.match(agendaView, /clearInterval\(timer\)/);
  assert.match(agendaView, /pointer-events-none/);
  assert.match(agendaView, /data-testid="psychology-current-time-indicator"/);
  assert.match(agendaView, /overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm/);
  assert.match(agendaView, /overflow-y-auto scroll-smooth/);
});
