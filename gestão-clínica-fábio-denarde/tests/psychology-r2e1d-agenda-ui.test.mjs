import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const pilot = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
const domain = await readFile(resolve(root, 'src/features/psychology-online-booking/bookingDomain.ts'), 'utf8');
const r2a = await readFile(resolve(root, 'src/features/psychology-pilot/psychologyR2a.ts'), 'utf8');

test('Agenda oferece menu compacto no horário vazio e mantém o fluxo manual', () => {
  for (const label of ['Agendar paciente', 'Criar compromisso pessoal', 'Bloquear horário', 'Bloquear intervalo', 'Dia inteiro', 'Disponibilizar este horário online', 'Agendar', 'Bloquear', 'Disponibilidade']) assert.match(pilot, new RegExp(label));
  assert.match(pilot, /PSYCHOLOGY_AGENDA_DAYPART_LABELS/);
  assert.match(pilot, /onNew\(slotMenu\.date, slotMenu\.time\)/);
  assert.match(pilot, /psychology-agenda-block-slot/);
  assert.match(pilot, /psychology-agenda-personal-booking/);
  assert.match(pilot, /psychology-agenda-block-interval/);
  assert.match(pilot, /psychology-agenda-open-slot/);
  assert.match(pilot, /psychology-agenda-manual-booking/);
  assert.match(pilot, /psychology-agenda-menu-tab-schedule/);
  assert.match(pilot, /psychology-agenda-menu-tab-block/);
  assert.match(pilot, /psychology-agenda-menu-tab-availability/);
  assert.match(pilot, /Criar uma consulta neste horário/);
  assert.match(pilot, /Reservar este horário para outra atividade/);
});

test('Agenda reutiliza exceções públicas e oferece liberação sem novo estado de bloqueio', () => {
  for (const label of ['publicBookingExceptions', 'BLOCK_PERIOD', 'BLOCK_DAY', 'Liberar para agendamento online', 'psychology-public-blocked-slot', 'Disponível online']) assert.match(pilot + domain, new RegExp(label));
  assert.match(pilot, /createLocalPublicBookingRepository/);
  assert.match(pilot, /onPublicBookingAction/);
  assert.match(r2a, /dayParts/);
});

test('A Agenda preserva entidades ocupadas fora do menu de bloqueio', () => {
  assert.match(pilot, /const occupied =/);
  assert.match(pilot, /WeeklySessionTile/);
  assert.match(pilot, /WeeklyPersonalTile/);
  assert.doesNotMatch(pilot, /setLocalStore\([^)]*publicBookingExceptions/);
});

test('o modo local não reativa a prévia somente leitura após refresh', () => {
  assert.match(pilot, /psychology-doctoralia-preview-opt-out/);
  assert.match(pilot, /DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY/);
  assert.match(pilot, /alterações de disponibilidade estão desabilitadas/);
});
