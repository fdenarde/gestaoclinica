import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isPsychologyPilotRoute } from '../src/features/psychology-pilot/psychologyDomain';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const domain = await readFile(new URL('../src/features/psychology-pilot/psychologyDomain.ts', import.meta.url), 'utf8');

test('Pilot local /psicologia is recognized only in DEV on localhost', () => {
  assert.equal(isPsychologyPilotRoute('/psicologia', '', true, 'localhost'), true);
  assert.equal(isPsychologyPilotRoute('/psicologia/', '', true, 'localhost'), true);
  assert.equal(isPsychologyPilotRoute('/', '?psicologia=1', true, '127.0.0.1'), true);
  assert.equal(isPsychologyPilotRoute('/psicologia', '', false, 'localhost'), false);
  assert.equal(isPsychologyPilotRoute('/psicologia', '', true, 'production.example'), false);
});

test('Pilot local is separated from authenticated remote and production remains gated', () => {
  const pilotIndex = app.indexOf('if (psychologyPilotRoute && !psychologyAuthenticatedRoute) return <PsychologyPilot runtimeMode="pilot-local" />;');
  const authenticatedIndex = app.indexOf('return <AuthenticatedApp psychologyAuthenticatedRoute={psychologyAuthenticatedRoute} />;');
  assert.ok(pilotIndex >= 0);
  assert.ok(authenticatedIndex > pilotIndex);
  assert.match(app, /VITE_PSYCHOLOGY_DEV_MODE/);
  assert.match(app, /<AccessPortal/);
  assert.doesNotMatch(app, /if \(psychologyPilotRoute\) return <PsychologyPilot \/>;\s*return <AuthenticatedApp/);
  assert.doesNotMatch(domain, /Review Mode|reviewMode|synthetic identity|syntheticIdentity/i);
});
