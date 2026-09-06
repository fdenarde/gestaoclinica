import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const accessPortalSource = readFileSync(new URL('../src/components/Auth/AccessPortal.tsx', import.meta.url), 'utf8');
const accessApiSource = readFileSync(new URL('../src/lib/accessApi.ts', import.meta.url), 'utf8');
const firebaseSource = readFileSync(new URL('../src/firebase.ts', import.meta.url), 'utf8');

const logoutHandler = appSource.slice(appSource.indexOf('const handleAccessPortalLogout'));
const accessProfileEffect = appSource.slice(
  appSource.indexOf('useEffect(() => {\n    if (!user || logoutInProgressRef.current) return;'),
  appSource.indexOf('const handleRetryAccessProfile'),
);

test('R74 executa logout Firebase real e limpa o estado de sessão', () => {
  assert.match(firebaseSource, /export const logout = async \(\): Promise<void> =>/);
  assert.match(firebaseSource, /await signOut\(auth\)/);
  assert.match(logoutHandler, /logoutInProgressRef\.current = true/);
  assert.match(logoutHandler, /await logout\(\)/);
  assert.match(logoutHandler, /resetSessionScopedData\(\)/);
  assert.match(logoutHandler, /setUser\(null\)/);
  assert.match(logoutHandler, /setAccessProfile\(null\)/);
  assert.match(logoutHandler, /setAccessError\(''\)/);
  assert.match(logoutHandler, /logoutInProgressRef\.current = false/);
});

test('R74 invalida respostas de access profile iniciadas antes do logout', () => {
  assert.match(appSource, /const authTransitionRef = useRef\(0\)/);
  assert.match(appSource, /const logoutInProgressRef = useRef\(false\)/);
  assert.match(appSource, /const transition = authTransitionRef\.current/);
  assert.match(accessProfileEffect, /!logoutInProgressRef\.current/);
  assert.match(accessProfileEffect, /transition === authTransitionRef\.current/);
  assert.match(accessProfileEffect, /auth\.currentUser\?\.uid === userUid/);
  assert.match(logoutHandler, /authTransitionRef\.current \+= 1/);
  assert.match(accessApiSource, /accessProfileRequests\.clear\(\)/);
  assert.match(accessApiSource, /accessProfileBackoffByUid\.clear\(\)/);
});

test('R74 recebe user=null e limpa erro/cache sem apagar localStorage da Psicologia', () => {
  assert.match(appSource, /onAuthStateChanged\(auth, \(currentUser\) => \{/);
  assert.match(appSource, /if \(!currentUser\) \{/);
  assert.match(appSource, /setUser\(currentUser\)/);
  assert.match(appSource, /setAccessProfile\(null\)/);
  assert.match(appSource, /setAccessError\(''\)/);
  assert.match(appSource, /resetSessionScopedData\(\)/);
  assert.doesNotMatch(logoutHandler, /localStorage\.clear\(\)|localStorage\.removeItem\(/);
});

test('R76 mantém /psicologia com Google e e-mail/senha após logout', () => {
  assert.match(appSource, /window\.location\.pathname/);
  assert.doesNotMatch(appSource + accessPortalSource, /window\.location\s*=|location\.href\s*=|location\.replace\(|location\.reload\(\)/);
  assert.match(accessPortalSource, /const psychologyEmailPasswordRoute = psychologyAuthTheme && accessRouteRole === 'professional';/);
  assert.match(accessPortalSource, /if \(!user\) \{[\s\S]*if \(directRoute\) return renderLogin\(\);/);
  assert.match(accessPortalSource, /\{!directRoute && \(/);
  assert.match(accessPortalSource, /loginWithEmail\(normalizedEmail, password\)/);
  assert.match(accessPortalSource, /onClick=\{handleGoogleLogin\}/);
  assert.match(accessPortalSource, /directRoute && !psychologyAuthTheme/);
});

test('R74 não chama o gate/API sem usuário depois do logout', () => {
  assert.match(accessProfileEffect, /if \(!user \|\| logoutInProgressRef\.current\) return/);
  assert.match(accessProfileEffect, /getAccessProfile\(user/);
  assert.match(appSource, /if \(!user \|\| !canAccessInternalSystem\) \{/);
  assert.match(appSource, /if \(psychologyAuthenticatedRoute\) return <PsychologyPilot \/>/);
});

test('R74 não cria fallback para Neuro nem para pilot-local', () => {
  assert.match(appSource, /return configured === 'pilot-local' \? 'pilot-local' : 'authenticated-remote'/);
  assert.match(appSource, /return <AuthenticatedApp psychologyAuthenticatedRoute=\{psychologyRouteMode === 'authenticated-remote'\} \/>/);
  assert.doesNotMatch(appSource, /window\.location\.pathname\s*=\s*['"]\//);
  assert.match(accessPortalSource, /directRoute && !psychologyAuthTheme/);
});

test('R74 modelo sintético: logout bem-sucedido deixa sessão anônima e bloqueia access até novo login', async () => {
  const state = { user: { uid: 'synthetic-user' }, accessProfile: { role: 'professional' }, accessError: 'sessão expirada', accessCalls: 0 };
  let logoutCalls = 0;
  let logoutInProgress = false;

  const readAccessProfile = async () => {
    if (!state.user || logoutInProgress) return null;
    state.accessCalls += 1;
    return state.accessProfile;
  };
  const signOutMock = async () => { logoutCalls += 1; };
  const logout = async () => {
    logoutInProgress = true;
    await signOutMock();
    state.user = null;
    state.accessProfile = null;
    state.accessError = '';
    logoutInProgress = false;
  };

  await logout();
  await readAccessProfile();

  assert.equal(logoutCalls, 1);
  assert.equal(state.user, null);
  assert.equal(state.accessProfile, null);
  assert.equal(state.accessError, '');
  assert.equal(state.accessCalls, 0);
});
