import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { formatPhoneDisplay, normalizePhone, normalizePhoneForIntegration } from '../shared/phoneNormalization.js';

test('R2B22 — Psicologia oculta o country code brasileiro, sem alterar o formatter compartilhado padrão', () => {
  assert.equal(formatPhoneDisplay("'+55 27 99991-3553", { includeCountryCode: false }), '(27) 99991-3553');
  assert.equal(formatPhoneDisplay('27999913553', { defaultCountryCode: '55', includeCountryCode: false }), '(27) 99991-3553');
  assert.equal(formatPhoneDisplay('5527999913553', { includeCountryCode: false }), '(27) 99991-3553');
  assert.equal(formatPhoneDisplay('27999913553'), '+55 (27) 99991-3553');
});

test('R2B22 — canonical interno preserva +55 e telefone internacional', () => {
  assert.equal(normalizePhone("'+55 27 99991-3553", { defaultCountryCode: '55' }).canonicalPhone, '5527999913553');
  assert.equal(normalizePhone('27999913553', { defaultCountryCode: '55' }).canonicalPhone, '5527999913553');
  assert.equal(normalizePhoneForIntegration('+44 7731 970794').canonicalPhone, '447731970794');
});

test('R2B22 — pontos da Psicologia usam wrapper de display e API preserva a representação', async () => {
  const list = await readFile(new URL('../src/features/psychology-pilot/psychologyPatientList.ts', import.meta.url), 'utf8');
  const chart = await readFile(new URL('../src/features/psychology-pilot/PsychologyPatientChart.tsx', import.meta.url), 'utf8');
  const pilot = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  const api = await readFile(new URL('../api/psychology.js', import.meta.url), 'utf8');
  assert.match(list, /formatPsychologyPhoneDisplay/);
  assert.match(chart, /formatPsychologyPhoneDisplay/);
  assert.match(pilot, /normalizePsychologyPhoneForSearch/);
  assert.match(api, /normalizePhone\(input\)\.displayPhone/);
});
