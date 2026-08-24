import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pilot = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');

test('R2E1H usa um diálogo móvel reutilizável com posição inicial superior e clamp', () => {
  assert.match(pilot, /function useMovableDialog\(\)/);
  assert.match(pilot, /y: Math\.min\(window\.innerHeight \* 0\.16/);
  assert.match(pilot, /clampPosition/);
  assert.match(pilot, /onPointerDown/);
  assert.match(pilot, /setPointerCapture/);
  assert.match(pilot, /data-testid="psychology-agenda-dialog-drag-handle"/);
  assert.match(pilot, /data-testid="psychology-event-dialog-drag-handle"/);
  assert.match(pilot, /max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(pilot, /data-no-dialog-drag/);
});

test('R2E1H separa estado da Agenda de estado do Agendamento Online', () => {
  assert.match(pilot, /Estado da Agenda/);
  assert.match(pilot, /Horário livre \(FREE\)/);
  assert.match(pilot, /Agendamento online:/);
  assert.match(pilot, /Disponível para Agendamento Online/);
  assert.match(pilot, /Fora da programação/);
  assert.match(pilot, /Este horário já não é oferecido no Agendamento Online\./);
});

test('R2E1H mantém ações contextuais de bloquear, liberar e disponibilizar', () => {
  assert.match(pilot, /psychology-agenda-block-slot/);
  assert.match(pilot, /psychology-agenda-block-interval/);
  assert.match(pilot, /psychology-agenda-block-day/);
  assert.match(pilot, /psychology-agenda-unblock-online/);
  assert.match(pilot, /psychology-agenda-open-slot/);
  assert.match(pilot, /Use a aba Bloquear para retirar este horário da disponibilidade/);
  assert.match(pilot, /Use Disponibilidade para liberar/);
  assert.match(pilot, /publicState === 'OUTSIDE'/);
});

test('R2E1H preserva o bloqueio canônico e as entidades ocupadas', () => {
  assert.match(pilot, /BLOCK_PERIOD/);
  assert.match(pilot, /BLOCK_DAY/);
  assert.match(pilot, /OPEN_PERIOD/);
  assert.match(pilot, /publicBookingExceptions/);
  assert.match(pilot, /const occupied =/);
  assert.match(pilot, /WeeklySessionTile/);
  assert.match(pilot, /WeeklyPersonalTile/);
});
