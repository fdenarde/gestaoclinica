import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isPsychologyPilotRoute } from '../src/features/psychology-pilot/psychologyDomain';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const domain = await readFile(new URL('../src/features/psychology-pilot/psychologyDomain.ts', import.meta.url), 'utf8');

test('production-like /psicologia is recognized independently of DEV hostname', () => {
  assert.equal(isPsychologyPilotRoute('/psicologia', ''), true);
  assert.equal(isPsychologyPilotRoute('/psicologia/', ''), true);
  assert.equal(isPsychologyPilotRoute('/', '?psicologia=1'), true);
});

test('route recognition does not bypass authentication or authorization', () => {
  const guardIndex = app.indexOf('if (!user || !canAccessInternalSystem)');
  const pilotIndex = app.indexOf('if (psychologyPilotRoute) return <PsychologyPilot />;');
  assert.ok(guardIndex >= 0);
  assert.ok(pilotIndex > guardIndex);
  assert.match(app, /<AccessPortal/);
  assert.doesNotMatch(app, /if \(psychologyPilotRoute\) return <PsychologyPilot \/>;\s*return <AuthenticatedApp/);
  assert.doesNotMatch(domain, /Review Mode|reviewMode|synthetic identity|syntheticIdentity/i);
});
