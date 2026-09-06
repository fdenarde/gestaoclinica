import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const firebaseSource = read('src/firebase.ts');
const accessPortalSource = read('src/components/Auth/AccessPortal.tsx');
const appSource = read('src/App.tsx');
const psychologyDomainSource = read('src/features/psychology-pilot/psychologyDomain.ts');

test('R76 usa a mesma instância Firebase Auth para e-mail/senha', () => {
  assert.match(firebaseSource, /export const auth = getAuth\(app\);/);
  assert.match(firebaseSource, /signInWithEmailAndPassword\(auth, email\.trim\(\), password\)/);
  assert.match(accessPortalSource, /await loginWithEmail\(normalizedEmail, password\)/);
  assert.doesNotMatch(accessPortalSource, /createEmailAccount\([^)]*handleEmailLogin/);
});

test('R76 mostra Google primeiro e e-mail/senha como alternativa direta da Psicologia', () => {
  assert.match(accessPortalSource, /const psychologyEmailPasswordRoute = psychologyAuthTheme && accessRouteRole === 'professional';/);
  assert.match(accessPortalSource, /\{psychologyEmailPasswordRoute && \(/);
  assert.match(accessPortalSource, /type=\{psychologyEmailPasswordRoute \? 'email' : 'text'\}/);
  assert.match(accessPortalSource, /autoComplete=\{psychologyEmailPasswordRoute \? 'email' : 'username'\}/);
  assert.ok(accessPortalSource.indexOf('Entrar com Google') < accessPortalSource.indexOf("type={psychologyEmailPasswordRoute ? 'email' : 'text'}"));
  assert.match(accessPortalSource, /directRoute && !psychologyAuthTheme/);
});

test('R76 mantém o gate posterior ao Auth e o isolamento da Psicologia', () => {
  assert.match(appSource, /onAuthStateChanged\(auth/);
  assert.match(appSource, /getAccessProfile\(user, \{ forceRefreshToken, activeRole: selectedAccessRole, signal: abortController\.signal \}\)/);
  assert.match(appSource, /if \(psychologyAuthenticatedRoute\) return <PsychologyPilot \/>;/);
  assert.match(psychologyDomainSource, /if \(psychologyRoute \|\| psychologyLocalPilotRoute\) return 'authenticated-remote';/);
  assert.doesNotMatch(firebaseSource + accessPortalSource + appSource, /leila102030/);
});
