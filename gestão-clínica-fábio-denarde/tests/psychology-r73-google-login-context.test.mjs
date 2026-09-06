import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const accessSource = readFileSync(new URL('../src/components/Auth/AccessPortal.tsx', import.meta.url), 'utf8');
const firebaseSource = readFileSync(new URL('../src/firebase.ts', import.meta.url), 'utf8');
const psychologyAccessSource = readFileSync(new URL('../api/_lib/psychologyAccess.js', import.meta.url), 'utf8');

test('R73 mantém Psicologia em rota direta com perfil profissional e contexto visual', () => {
  assert.match(appSource, /const directAccessRole: AccessRequestRole \| null = psychologyAuthenticatedRoute\s+\? 'professional'/);
  assert.match(appSource, /const visualContext: VisualContext = psychologyAuthenticatedRoute \? 'PSICOLOGIA' : 'DEFAULT'/);
  assert.match(appSource, /accessRouteRole=\{directAccessRole\}/);
  assert.match(appSource, /visualContext=\{visualContext\}/);
});

test('R76 mantém Google como primeira opção e adiciona e-mail/senha na entrada direta da Psicologia', () => {
  assert.match(accessSource, /const psychologyEmailPasswordRoute = psychologyAuthTheme && accessRouteRole === 'professional';/);
  assert.match(accessSource, /\{psychologyEmailPasswordRoute && \(/);
  assert.match(accessSource, /loginWithEmail\(normalizedEmail, password\)/);
  assert.ok(accessSource.indexOf('Entrar com Google') < accessSource.indexOf("type={psychologyEmailPasswordRoute ? 'email' : 'text'}"));
  assert.match(accessSource, /onClick=\{handleGoogleLogin\}/);
  assert.match(accessSource, /directRoute && !psychologyAuthTheme/);
});

test('R73 reutiliza o login Google existente e preserva fail-closed server-side', () => {
  assert.match(firebaseSource, /signInWithPopup\(auth, googleProvider\)/);
  assert.match(firebaseSource, /export const loginWithGoogle/);
  assert.match(psychologyAccessSource, /const PSYCHOLOGY_CONTEXT = 'PSICOLOGIA';/);
  assert.match(psychologyAccessSource, /allowedRoles: \['admin', 'professional'\]/);
  assert.match(psychologyAccessSource, /contextLinks[\s\S]*PSYCHOLOGY_CONTEXT/);
});
