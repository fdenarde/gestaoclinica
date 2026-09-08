import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pilotSource = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const loadingSource = await readFile(new URL('../src/features/psychology-pilot/PsychologyLoading.tsx', import.meta.url), 'utf8');

test('loading da Psicologia usa ampulheta roxa e linguagem simples', () => {
  assert.match(pilotSource, /import PsychologyLoading from ['"]\.\/PsychologyLoading['"]/);
  assert.match(pilotSource, /return <PsychologyLoading \/>/);
  assert.doesNotMatch(pilotSource, /Carregando Psicologia/);
  assert.match(loadingSource, /Carregando\.\.\./);
  assert.match(loadingSource, /data-testid="psychology-hourglass-loading"/);
  assert.match(loadingSource, /#7C3AED/);
  assert.match(loadingSource, /prefers-reduced-motion/);
  assert.doesNotMatch(loadingSource, /Firestore|Firebase|workspace|tenant|persistência|persistencia|read-only|somente leitura/i);
});

test('ajustes normais não exibem a prévia técnica ou módulos incompletos', () => {
  const systemStart = pilotSource.indexOf("if (activeTab === 'system')");
  const systemEnd = pilotSource.indexOf('const tabItems:', systemStart);
  assert.ok(systemStart >= 0 && systemEnd > systemStart, 'ramo normal de Ajustes não encontrado');
  const normalSystemUi = pilotSource.slice(systemStart, systemEnd);
  assert.doesNotMatch(normalSystemUi, /Doctoralia|prévia|persistência|persistencia|somente leitura|read-only|Firestore|Firebase/i);
  assert.doesNotMatch(pilotSource, /data-testid="doctoralia-preview-banner"/);
});
