import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const pilot = fs.readFileSync(path.join(root, 'src', 'features', 'psychology-pilot', 'PsychologyPilot.tsx'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'src', 'features', 'psychology-import-export', 'PsychologyImportExport.tsx'), 'utf8');

test('DEV seleciona explicitamente entre Piloto local e Authenticated Remote', () => {
  assert.match(app, /VITE_PSYCHOLOGY_DEV_MODE/);
  assert.match(app, /psychologyPilotRoute && !psychologyAuthenticatedRoute/);
  assert.match(app, /<AuthenticatedApp psychologyAuthenticatedRoute=\{psychologyAuthenticatedRoute\} \/>/);
  assert.match(app, /function AuthenticatedApp\(\{ psychologyAuthenticatedRoute/);
});
test('Authenticated Remote só entrega PsychologyPilot depois do gate de acesso', () => {
  const accessGate = app.indexOf('if (!user || !canAccessInternalSystem)');
  const remoteRender = app.indexOf('if (psychologyAuthenticatedRoute) return <PsychologyPilot runtimeMode="authenticated-remote" />;');
  assert.notEqual(accessGate, -1);
  assert.notEqual(remoteRender, -1);
  assert.ok(remoteRender > accessGate);
  assert.match(app, /if \(!user \|\| psychologyAuthenticatedRoute \|\| !canAccessInternalSystem\) return;/);
});

test('produção não usa o bypass direto do Piloto', () => {
  assert.match(app, /Boolean\(import\.meta\.env\.DEV\)/);
  assert.match(app, /if \(psychologyPilotRoute && !psychologyAuthenticatedRoute\) return <PsychologyPilot runtimeMode="pilot-local" \/>;/);
  assert.match(app, /return <AuthenticatedApp psychologyAuthenticatedRoute=\{psychologyAuthenticatedRoute\} \/>;/);
});

test('backup remoto fica indisponível no Piloto local', () => {
  assert.match(pilot, /onGenerateBackup=\{remoteConfiguration\.enabled \? generatePsychologyBackup : undefined\}/);
  assert.match(backup, /Backup remoto disponível no modo autenticado\./);
  assert.match(backup, /onGenerateBackup\?/);
});

test('o modo autenticado não inicia listeners legados de Firestore', () => {
  assert.match(app, /if \(!user \|\| psychologyAuthenticatedRoute \|\| !canAccessInternalSystem\) return;/);
  assert.match(app, /\}, \[canAccessInternalSystem, psychologyAuthenticatedRoute, user\]\);/);
});
