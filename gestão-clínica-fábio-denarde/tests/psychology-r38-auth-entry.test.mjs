import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const accessSource = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const passwordSource = fs.readFileSync('src/components/Auth/PasswordSecurityPanel.tsx', 'utf8');
const themeSource = fs.readFileSync('src/lib/theme.ts', 'utf8');
const cssSource = fs.readFileSync('src/index.css', 'utf8');

test('R38 propaga Psicologia ao fluxo autenticado sem bypass', () => {
  assert.match(appSource, /const visualContext: VisualContext = psychologyAuthenticatedRoute \? 'PSICOLOGIA' : 'DEFAULT'/);
  assert.match(appSource, /<AccessPortal[\s\S]*visualContext=\{visualContext\}/);
  assert.match(appSource, /data-auth-visual-context=\{visualContext\}/);
  assert.match(themeSource, /export type VisualContext = 'DEFAULT' \| 'PSICOLOGIA'/);

  const accessGate = appSource.indexOf('if (!user || !canAccessInternalSystem)');
  const psychologyRender = appSource.indexOf('if (psychologyAuthenticatedRoute) return <PsychologyPilot />;');
  assert.ok(accessGate >= 0 && psychologyRender > accessGate);
});

test('R38 não apresenta solicitação antes de concluir a validação do perfil', () => {
  const loading = accessSource.indexOf('if (profileLoading)');
  const requestView = accessSource.indexOf("if (view === 'request' && !directRoute)");
  assert.ok(loading >= 0 && requestView > loading);
  assert.match(accessSource, /data-auth-visual-context=\{visualContext\}/);
  assert.match(accessSource, /auth-psychology-theme/);
});

test('R38 mantém a identidade visual geral fora da rota Psicologia', () => {
  assert.match(accessSource, /applyTheme\(psychologyAuthTheme \? 'current' : 'health-balance'\)/);
  assert.match(cssSource, /\.auth-psychology-theme\s*\{/);
  assert.match(passwordSource, /visualContext\?: VisualContext/);
  assert.match(passwordSource, /data-auth-visual-context=\{visualContext\}/);
});

test('R38 mantém a solicitação como ação explícita, sem criação automática', () => {
  assert.match(accessSource, /submitAccessRequest\(/);
  assert.match(accessSource, /onAccessRequestSubmitted\(/);
  assert.doesNotMatch(appSource, /submitAccessRequest\(/);
});
