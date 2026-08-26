import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyPsychologyStore, upsertPsychologyPatient } from '../src/features/psychology-pilot/psychologyDomain';
import { formatPsychologyPhoneDisplay, normalizePsychologyPhoneForComparison } from '../src/features/psychology-pilot/psychologyPhone';

test('R2B22 — wrapper da Psicologia apresenta Brasil sem +55 e mantém estrangeiro explícito', () => {
  assert.equal(formatPsychologyPhoneDisplay("'+55 27 99991-3553"), '(27) 99991-3553');
  assert.equal(formatPsychologyPhoneDisplay("'27999913553"), '(27) 99991-3553');
  assert.equal(formatPsychologyPhoneDisplay('+44 7731 970794'), '+44 7731970794');
  assert.equal(normalizePsychologyPhoneForComparison('(27) 99991-3553'), '5527999913553');
});

test('R2B22 — nova persistência local da Psicologia preserva display e semântica', () => {
  const store = upsertPsychologyPatient(createEmptyPsychologyStore(), {
    name: 'Paciente Sintético R2B22',
    dateOfBirth: '1990-01-01',
    phone: "'+55 27 99991-3553",
    email: 'r2b22@example.invalid',
    preferredModality: 'online',
    administrativeNote: '',
    active: true,
  });
  assert.equal(store.patients[0]?.phone, '+55 27 99991-3553');
  assert.equal(normalizePsychologyPhoneForComparison(store.patients[0]?.phone), '5527999913553');
  assert.equal(formatPsychologyPhoneDisplay(store.patients[0]?.phone), '(27) 99991-3553');
});
