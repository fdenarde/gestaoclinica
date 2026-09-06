import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const pilot = fs.readFileSync(path.join(root, 'src', 'features', 'psychology-pilot', 'PsychologyPilot.tsx'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'src', 'features', 'psychology-import-export', 'PsychologyImportExport.tsx'), 'utf8');
const apiRepository = fs.readFileSync(path.join(root, 'src', 'features', 'psychology-persistence', 'repositories', 'api.ts'), 'utf8');
const psychologyCatchAll = fs.readFileSync(path.join(root, 'api', 'psychology', '[...path].js'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

test('DEV seleciona explicitamente entre Piloto local e Authenticated Remote', () => {
  assert.match(app, /VITE_PSYCHOLOGY_DEV_MODE/);
  assert.match(app, /psychologyRouteMode === 'pilot-local'/);
  assert.match(app, /<AuthenticatedApp psychologyAuthenticatedRoute=\{psychologyRouteMode === 'authenticated-remote'\} \/>/);
  assert.match(app, /function AuthenticatedApp\(\{ psychologyAuthenticatedRoute/);
});

test('Authenticated Remote só entrega PsychologyPilot depois do gate de acesso', () => {
  const accessGate = app.indexOf('if (!user || !canAccessInternalSystem)');
  const remoteRender = app.indexOf('if (psychologyAuthenticatedRoute) return <PsychologyPilot />;');
  assert.notEqual(accessGate, -1);
  assert.notEqual(remoteRender, -1);
  assert.ok(remoteRender > accessGate);
  assert.match(app, /if \(!user \|\| psychologyAuthenticatedRoute \|\| !canAccessInternalSystem\) return;/);
});

test('produção não usa o bypass direto do Piloto', () => {
  assert.match(app, /Boolean\(import\.meta\.env\.DEV\)/);
  assert.match(app, /if \(psychologyRouteMode === 'pilot-local'\) return <PsychologyPilot \/>;/);
  assert.match(app, /return <AuthenticatedApp psychologyAuthenticatedRoute=\{psychologyRouteMode === 'authenticated-remote'\} \/>;/);
});

test('Preview e produção não aceitam persistência pilot-local por variável residual', () => {
  assert.match(
    pilot,
    /const developmentRuntime = Boolean\(import\.meta\.env\.DEV\);\s*const explicitLocalPilot = developmentRuntime\s*&& String\(env\.VITE_PSYCHOLOGY_DEV_MODE \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'pilot-local';/,
  );
  assert.match(pilot, /enabled: !developmentRuntime \|\| isPsychologyRemoteClientEnabled\(/);
  assert.match(pilot, /useState<PsychologyStore>\(\(\) => remoteConfiguration\.enabled\s*\? createEmptyPsychologyStore[\s\S]*: loadLocalStore\(\)\)/);
  assert.match(pilot, /useState<string\[\]>\(\(\) => remoteConfiguration\.enabled \? \[\] : loadHiddenDoctoraliaCancelledEventIds\(\)\)/);
});

test('backup remoto fica indisponível no Piloto local', () => {
  assert.match(pilot, /onGenerateBackup=\{remoteConfiguration\.enabled && remoteCan\('backup', 'view'\) \? generatePsychologyBackup : undefined\}/);
  assert.match(backup, /Backup remoto disponível no modo autenticado\./);
  assert.match(backup, /onGenerateBackup\?/);
});

test('o modo autenticado não inicia listeners legados de Firestore', () => {
  assert.match(app, /if \(!user \|\| psychologyAuthenticatedRoute \|\| !canAccessInternalSystem\) return;/);
  assert.match(app, /\}, \[canAccessInternalSystem, psychologyAuthenticatedRoute, user\]\);/);
});

test('Preview atende a SPA e a API da Psicologia por rotas relativas do mesmo domínio', () => {
  const rewrites = new Map(vercelConfig.rewrites.map(({ source, destination }) => [source, destination]));
  assert.equal(rewrites.get('/psicologia'), '/index.html');
  assert.equal(rewrites.get('/psicologia/'), '/index.html');
  assert.match(psychologyCatchAll, /export \{ default \} from '\.\.\/psychology\.js';/);
  assert.match(apiRepository, /options\.baseUrl \|\| '\/api\/psychology'/);
  assert.doesNotMatch(apiRepository, /https?:\/\/localhost|https?:\/\/127\.0\.0\.1/);
});
