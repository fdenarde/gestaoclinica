import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isPsychologyLocalPilotRoute,
  isPsychologyRoute,
  resolvePsychologyRouteMode,
} from '../src/features/psychology-pilot/psychologyDomain';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('produção reconhece /psicologia como rota autenticada da Psicologia', () => {
  assert.equal(isPsychologyRoute('/psicologia'), true);
  assert.equal(
    resolvePsychologyRouteMode(
      '/psicologia',
      '',
      false,
      'gestaoclinica-solucoes.vercel.app',
      'pilot-local',
    ),
    'authenticated-remote',
  );
  assert.equal(isPsychologyLocalPilotRoute('/psicologia', '', false, 'gestaoclinica-solucoes.vercel.app'), false);
});

test('DEV em localhost mantém /psicologia no Piloto local quando configurado', () => {
  assert.equal(isPsychologyLocalPilotRoute('/psicologia', '', true, 'localhost'), true);
  assert.equal(resolvePsychologyRouteMode('/psicologia', '', true, 'localhost', 'pilot-local'), 'pilot-local');
});

test('DEV em localhost com authenticated-remote usa o fluxo autenticado', () => {
  assert.equal(resolvePsychologyRouteMode('/psicologia', '', true, 'localhost', 'authenticated-remote'), 'authenticated-remote');
});

test('rotas gerais preservam o fluxo normal', () => {
  assert.equal(resolvePsychologyRouteMode('/', '', false, 'gestaoclinica-solucoes.vercel.app', 'pilot-local'), 'normal');
  assert.equal(resolvePsychologyRouteMode('/profissional', '', false, 'gestaoclinica-solucoes.vercel.app', 'pilot-local'), 'normal');
});

test('Piloto local fictício permanece proibido fora de DEV/local', () => {
  const routeMode = resolvePsychologyRouteMode(
    '/psicologia',
    '',
    false,
    'gestaoclinica-solucoes.vercel.app',
    'pilot-local',
  );
  assert.notEqual(routeMode, 'pilot-local');
  assert.match(appSource, /if \(psychologyRouteMode === 'pilot-local'\) return <PsychologyPilot \/>;/);
  assert.match(appSource, /<AuthenticatedApp psychologyAuthenticatedRoute=\{psychologyRouteMode === 'authenticated-remote'\} \/>/);
});
