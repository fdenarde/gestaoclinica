import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEffectiveAccessContext } from '../api/_lib/accessPermissions.js';
import { isPsychologyRemoteClientEnabled } from '../src/features/psychology-persistence/remoteCanary.ts';
import { resolvePsychologyRouteMode } from '../src/features/psychology-pilot/psychologyDomain.ts';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const portal = await readFile(new URL('../src/components/Auth/AccessPortal.tsx', import.meta.url), 'utf8');
const firebase = await readFile(new URL('../src/firebase.ts', import.meta.url), 'utf8');
const pilot = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');

function approvedProfessionalContext() {
  return buildEffectiveAccessContext({
    decodedToken: { uid: 'synthetic-google-user', email: 'professional@example.test' },
    profile: { role: 'professional', status: 'approved', workspaceId: 'synthetic-workspace' },
    primaryAdminEmail: 'admin@example.test',
    primaryAdminWorkspaceId: 'synthetic-admin-workspace',
    requestedContext: 'professional',
  });
}

test('R43 — /psicologia sem autenticação exibe Google como entrada principal', () => {
  assert.match(portal, /const psychologyGoogleOnly = psychologyAuthTheme && effectiveLoginRole === 'professional'/);
  assert.match(portal, /data-testid=\{psychologyGoogleOnly \? 'psychology-google-login' : undefined\}/);
  assert.match(portal, /Entrar com Google/);
  assert.match(portal, /await loginWithGoogle\(\)/);
  assert.match(app, /visualContext: VisualContext = psychologyAuthenticatedRoute \? 'PSICOLOGIA' : 'DEFAULT'/);
  assert.match(app, /visualContext=\{visualContext\}/);
});

test('R43 — Psicologia não exige usuário/senha e preserva senha nas demais entradas', () => {
  const passwordFields = portal.slice(portal.indexOf('{!psychologyGoogleOnly && ('), portal.indexOf('{!directRoute && (', portal.indexOf('{!psychologyGoogleOnly && (') + 1));
  assert.match(passwordFields, /E-mail ou nome de usuário/);
  assert.match(passwordFields, /Senha/);
  assert.match(portal, /\{!psychologyGoogleOnly && \(\s*<button[\s\S]*Entrar/);
  assert.match(portal, /\{\(psychologyGoogleOnly \|\| !directRoute\) && \(/);
  assert.match(portal, /directRoute && !psychologyGoogleOnly/);
});

test('R43 — Google aprovado reutiliza o profissional legado e chega à Psychology UI', () => {
  const context = approvedProfessionalContext();
  assert.equal(context.role, 'professional');
  assert.equal(context.status, 'approved');
  assert.equal(context.activeContext, 'professional');
  assert.equal(context.permissions['patients.list'], true);
  assert.match(app, /psychologyAuthenticatedRoute\s*\?\s*'professional'/);
  assert.match(app, /getAccessProfile\(user, \{ forceRefreshToken, activeRole: selectedAccessRole \}\)/);
  assert.match(app, /if \(psychologyAuthenticatedRoute\) return <PsychologyPilot runtimeMode="authenticated-remote" \/>;/);
});

test('R43 — Google não cria solicitação, não usa piloto e ativa o provider remoto', () => {
  const googleHandler = portal.slice(portal.indexOf('const handleGoogleLogin'), portal.indexOf('const handleResetPassword'));
  assert.match(googleHandler, /await loginWithGoogle\(\)/);
  assert.doesNotMatch(googleHandler, /submitAccessRequest|createEmailAccount|setView\('request'\)/);
  assert.equal(isPsychologyRemoteClientEnabled('authenticated-remote'), true);
  assert.equal(isPsychologyRemoteClientEnabled('pilot-local'), false);
  assert.match(pilot, /enabled: isPsychologyRemoteClientEnabled\(runtimeMode\)/);
  assert.match(app, /if \(psychologyPilotRoute && !psychologyAuthenticatedRoute\) return <PsychologyPilot runtimeMode="pilot-local" \/>;/);
  assert.match(app, /if \(psychologyAuthenticatedRoute\) return <PsychologyPilot runtimeMode="authenticated-remote" \/>;/);
});

test('R43 — modo autenticado mantém a rota Psicologia, sem Neuro ou bypass global', () => {
  assert.equal(resolvePsychologyRouteMode('/psicologia', '', false, 'app.example.test', 'pilot-local'), 'authenticated-remote');
  assert.equal(resolvePsychologyRouteMode('/profissional', '', false, 'app.example.test', 'pilot-local'), 'normal');
  assert.equal(resolvePsychologyRouteMode('/responsavel', '', false, 'app.example.test', 'pilot-local'), 'normal');
  assert.equal(resolvePsychologyRouteMode('/monitoramento', '', false, 'app.example.test', 'pilot-local'), 'normal');
  for (const route of ["normalizedPath === '/profissional'", "normalizedPath === '/responsavel'", "normalizedPath === '/monitoramento'"]) {
    assert.ok(app.includes(route));
  }
  assert.match(app, /Neuro/);
  assert.match(app, /if \(!user \|\| !canAccessInternalSystem\)/);
  assert.match(firebase, /GoogleAuthProvider/);
  assert.match(firebase, /signInWithPopup/);
});

test('R43 — gates funcionais R42 permanecem no mesmo fluxo', () => {
  for (const label of ['Nome completo *', 'Telefone *', 'Modalidade preferencial *', 'Data de nascimento (opcional)', 'E-mail (opcional)']) {
    assert.ok(pilot.includes(label));
  }
  assert.match(pilot, /Todos os campos são opcionais/);
  assert.match(pilot, /Excluir selecionados \(\{selectedVisibleIds\.length\}\)/);
  assert.match(pilot, /session\.status !== 'cancelada'/);
});
