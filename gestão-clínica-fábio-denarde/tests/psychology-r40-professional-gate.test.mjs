import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const accessPortalSource = readFileSync(new URL('../src/components/Auth/AccessPortal.tsx', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../src/features/psychology-pilot/psychologyDomain.ts', import.meta.url), 'utf8');

test('rota autenticada da Psicologia seleciona o perfil profissional', () => {
  assert.match(
    appSource,
    /const directAccessRole: AccessRequestRole \| null = psychologyAuthenticatedRoute\s+\? 'professional'/,
  );
  assert.match(appSource, /useState<AccessRole \| null>\(directAccessRole\)/);
  assert.match(appSource, /getAccessProfile\(user, \{ forceRefreshToken, activeRole: selectedAccessRole, signal: abortController\.signal \}\)/);
  assert.match(appSource, /if \(psychologyAuthenticatedRoute\) return <PsychologyPilot \/>;/);
});

test('a rota aprovada chega à Psychology UI somente depois do gate real', () => {
  const gateIndex = appSource.indexOf("if (!user || !canAccessInternalSystem)");
  const psychologyUiIndex = appSource.indexOf("if (psychologyAuthenticatedRoute) return <PsychologyPilot />;");
  assert.ok(gateIndex >= 0 && psychologyUiIndex > gateIndex);
  assert.match(appSource, /visualContext=\{visualContext\}/);
  assert.doesNotMatch(appSource, /submitAccessRequest\(/);
});

test('estados de acesso da Psicologia usam identidade visual contextual', () => {
  assert.match(accessPortalSource, /visualContext\?: AuthVisualContext/);
  assert.match(accessPortalSource, /data-auth-visual-context=\{visualContext\}/);
  assert.match(accessPortalSource, /auth-psychology-theme/);
  assert.match(appSource, /const visualContext: VisualContext = psychologyAuthenticatedRoute \? 'PSICOLOGIA' : 'DEFAULT'/);
});

test('rotas existentes e proteção de produção permanecem preservadas', () => {
  assert.match(appSource, /normalizedPath === '\/responsavel'/);
  assert.match(appSource, /normalizedPath === '\/profissional'/);
  assert.match(appSource, /normalizedPath === '\/monitoramento'/);
  assert.match(routeSource, /if \(!isDev \|\| !\['localhost', '127\.0\.0\.1'\]\.includes\(hostname\)\) return false;/);
  assert.match(routeSource, /if \(psychologyRoute \|\| psychologyLocalPilotRoute\) return 'authenticated-remote';/);
});
