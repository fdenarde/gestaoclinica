import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const weeklyTile = source.slice(source.indexOf('function WeeklySessionTile'), source.indexOf('function WeeklyPersonalTile'));

test('R2E1K-A usa um único StatusPill para origem pública e remove o rótulo duplicado', () => {
  assert.match(weeklyTile, /labelOverride=\{session\.status === 'agendada' \? originLabel \|\| undefined : undefined\}/);
  assert.doesNotMatch(weeklyTile, /data-testid="psychology-booking-origin"/);
  assert.match(weeklyTile, /<StatusPill status=\{session\.status\} previewStatus=\{session\.previewStatus\} compact labelOverride=/);
});

test('R2E1K-A mantém os rótulos canônicos e legacy neutro', () => {
  assert.match(source, /session\.bookingOrigin === 'PATIENT_SELF_BOOKING'\) return 'Agendado pelo Paciente'/);
  assert.match(source, /session\.bookingOrigin === 'PROFESSIONAL'\) return 'Agendada'/);
  assert.match(source, /return '';/);
  assert.match(weeklyTile, /data-agenda-booking-origin=\{session\.bookingOrigin \|\| 'UNKNOWN'\}/);
});

test('R2E1K-A badge longo não usa truncate e não quebra em múltiplas linhas', () => {
  assert.match(source, /rounded-full whitespace-nowrap/);
  assert.match(weeklyTile, /<span className="shrink-0"><StatusPill/);
});
