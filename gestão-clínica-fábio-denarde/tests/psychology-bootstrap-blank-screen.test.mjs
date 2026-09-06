import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(testDirectory, '..', 'src', 'main.tsx'), 'utf8');

test('bootstrap da Psicologia monta estado visível antes do import do App', () => {
  assert.match(mainSource, /data-bootstrap-state=\{state\}/);
  assert.match(mainSource, /Carregando acesso/);
  assert.match(mainSource, /appRoot\.render\(<BootstrapStatus state="loading" \/>/);
});

test('rejeição do import do App termina em fallback visual recuperável', () => {
  assert.match(mainSource, /\.catch\(/);
  assert.match(mainSource, /appRoot\.render\(<BootstrapStatus state="error" \/>/);
  assert.match(mainSource, /Não foi possível concluir a inicialização/);
  assert.match(mainSource, /Tentar novamente/);
});

test('a entrada autenticada mantém a rota Psicologia sem modo pilot-local', () => {
  const appSource = fs.readFileSync(path.join(testDirectory, '..', 'src', 'App.tsx'), 'utf8');
  assert.match(appSource, /import\('\.\/App\.tsx'\)/.test(mainSource) ? /authenticated-remote/ : /$^/);
  assert.doesNotMatch(mainSource, /VITE_PSYCHOLOGY_DEV_MODE/);
});
