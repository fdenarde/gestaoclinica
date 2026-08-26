import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');

test('R2 legado — confirmação captura o alvo, bloqueia reentrada e libera no finally', () => {
  assert.match(source, /const targetPatientId = patientToDelete;/);
  assert.match(source, /if \(!targetPatientId \|\| deleteInFlightRef\.current\) return;/);
  assert.match(source, /deleteInFlightRef\.current = targetPatientId;/);
  assert.match(source, /if \(deleteInFlightRef\.current === targetPatientId\) deleteInFlightRef\.current = null;/);
  assert.match(source, /disabled=\{Boolean\(deletingPatientId\)\}/g);
  assert.match(source, /Excluindo\.\.\./);
});
