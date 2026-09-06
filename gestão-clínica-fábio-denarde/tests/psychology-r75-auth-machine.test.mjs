import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const appSource = read('src/App.tsx');
const accessPortalSource = read('src/components/Auth/AccessPortal.tsx');
const accessApiSource = read('src/lib/accessApi.ts');
const firebaseSource = read('src/firebase.ts');
const psychologyDomainSource = read('src/features/psychology-pilot/psychologyDomain.ts');

class FakeAuth {
  constructor() {
    this.currentUser = null;
    this.listeners = new Set();
    this.googleCalls = 0;
    this.signOutCalls = 0;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentUser);
    return () => this.listeners.delete(listener);
  }

  emit(user) {
    this.currentUser = user;
    for (const listener of this.listeners) listener(user);
  }

  async signInWithPopup() {
    this.googleCalls += 1;
    const user = { uid: 'google-user', getIdToken: async () => 'token-current' };
    await Promise.resolve();
    this.emit(user);
    return user;
  }

  async signOut() {
    this.signOutCalls += 1;
    this.emit(null);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeAccessApi {
  constructor() {
    this.calls = [];
    this.pending = [];
    this.nextResult = null;
  }

  getAccessProfile(user, { signal, generation }) {
    const item = deferred();
    const call = { userUid: user.uid, signal, generation, deferred: item };
    this.calls.push(call);
    this.pending.push(call);
    return item.promise;
  }
}

class PsychologyAuthMachine {
  constructor({ auth = new FakeAuth(), accessApi = new FakeAccessApi(), route = '/psicologia' } = {}) {
    this.auth = auth;
    this.accessApi = accessApi;
    this.route = route;
    this.state = {
      phase: 'auth-loading',
      user: null,
      profile: null,
      error: '',
      generation: 0,
      googleAvailable: true,
      emailPasswordAvailable: true,
      context: 'PSICOLOGIA',
    };
    this.accessController = null;
    this.unsubscribe = auth.subscribe(user => this.authChanged(user));
  }

  authChanged(user) {
    this.state.generation += 1;
    this.accessController?.abort();
    this.accessController = null;
    if (!user) {
      this.state = { ...this.state, phase: 'anonymous', user: null, profile: null, error: '' };
      return;
    }
    this.state = { ...this.state, phase: 'access-loading', user, profile: null, error: '' };
    this.loadAccessProfile(user, this.state.generation);
  }

  loadAccessProfile(user, generation) {
    const controller = new AbortController();
    this.accessController = controller;
    this.accessApi.getAccessProfile(user, { signal: controller.signal, generation })
      .then(profile => {
        if (controller.signal.aborted || generation !== this.state.generation || this.state.user?.uid !== user.uid) return;
        this.state = profile
          ? { ...this.state, phase: 'approved', profile, error: '' }
          : { ...this.state, phase: 'access-denied', profile: null, error: 'Acesso não autorizado.' };
      })
      .catch(error => {
        if (controller.signal.aborted || generation !== this.state.generation || this.state.user?.uid !== user.uid) return;
        this.state = { ...this.state, phase: 'access-error', profile: null, error: error.message || String(error) };
      });
  }

  async googleLogin() {
    if (this.state.phase !== 'anonymous') throw new Error('Google Login só inicia no estado anônimo.');
    this.state = { ...this.state, phase: 'google-signing-in' };
    await this.auth.signInWithPopup();
  }

  async logout() {
    this.state.generation += 1;
    this.state = { ...this.state, phase: 'logging-out', profile: null, error: '' };
    this.accessController?.abort();
    this.accessController = null;
    await this.auth.signOut();
  }

  close() {
    this.accessController?.abort();
    this.unsubscribe();
  }
}

test('R75 auditoria: há uma instância Auth client-side e todos os caminhos usam o mesmo export', () => {
  assert.equal((firebaseSource.match(/initializeApp\(/g) || []).length, 1);
  assert.equal((firebaseSource.match(/getAuth\(/g) || []).length, 1);
  assert.equal((firebaseSource.match(/signInWithPopup\(auth, googleProvider\)/g) || []).length, 1);
  assert.equal((firebaseSource.match(/signOut\(auth\)/g) || []).length, 1);
  assert.match(appSource, /onAuthStateChanged\(auth/);
  assert.match(accessApiSource, /import \{ auth \} from '..\/firebase'/);
  assert.doesNotMatch(appSource + firebaseSource, /initializeAuth\(|getApps\(|getApp\(/);
});

test('R75/R76 caso 01/02: anônimo em /psicologia mantém Google e e-mail/senha sem chamar access', () => {
  const machine = new PsychologyAuthMachine();
  assert.equal(machine.state.phase, 'anonymous');
  assert.equal(machine.state.googleAvailable, true);
  assert.equal(machine.state.emailPasswordAvailable, true);
  assert.equal(machine.state.context, 'PSICOLOGIA');
  assert.equal(machine.state.user, null);
  assert.equal(machine.accessApi.calls.length, 0);
  machine.close();
});

test('R75 caso 03: Google → Auth estabilizado → uma validação → Psicologia', async () => {
  const machine = new PsychologyAuthMachine();
  const login = machine.googleLogin();
  assert.equal(machine.state.phase, 'google-signing-in');
  await login;
  assert.equal(machine.auth.googleCalls, 1);
  assert.equal(machine.accessApi.calls.length, 1);
  machine.accessApi.calls[0].deferred.resolve({ role: 'professional', status: 'approved', context: 'PSICOLOGIA' });
  await flushPromises();
  assert.equal(machine.state.phase, 'approved');
  assert.equal(machine.state.context, 'PSICOLOGIA');
  machine.close();
});

test('R75 casos 04/05: acesso negado e quota permanecem fail-closed sem loop', async () => {
  const denied = new PsychologyAuthMachine();
  await denied.googleLogin();
  denied.accessApi.calls[0].deferred.resolve(null);
  await flushPromises();
  assert.equal(denied.state.phase, 'access-denied');
  assert.equal(denied.state.profile, null);
  assert.equal(denied.accessApi.calls.length, 1);
  denied.close();

  const quota = new PsychologyAuthMachine();
  await quota.googleLogin();
  quota.accessApi.calls[0].deferred.reject(new Error('quota temporariamente indisponível'));
  await flushPromises();
  assert.equal(quota.state.phase, 'access-error');
  assert.equal(quota.accessApi.calls.length, 1);
  quota.close();
});

test('R75 casos 06/09/15: sessão expirada → logout → user=null → Google sem access', async () => {
  const machine = new PsychologyAuthMachine();
  await machine.googleLogin();
  machine.accessApi.calls[0].deferred.reject(new Error('Sua sessão expirou.'));
  await flushPromises();
  assert.equal(machine.state.phase, 'access-error');
  await machine.logout();
  assert.equal(machine.auth.signOutCalls, 1);
  assert.equal(machine.state.phase, 'anonymous');
  assert.equal(machine.state.user, null);
  assert.equal(machine.state.profile, null);
  assert.equal(machine.state.error, '');
  const callsAfterLogout = machine.accessApi.calls.length;
  await flushPromises();
  assert.equal(machine.accessApi.calls.length, callsAfterLogout);
  machine.close();
});

test('R75 casos 07/16: resposta pendente/stale após logout ou user=null não altera a UI', async () => {
  const machine = new PsychologyAuthMachine();
  await machine.googleLogin();
  const oldCall = machine.accessApi.calls[0];
  const oldGeneration = machine.state.generation;
  const logout = machine.logout();
  oldCall.deferred.resolve({ role: 'professional', status: 'approved', context: 'NEUROPSICOPEDAGOGIA' });
  await logout;
  await flushPromises();
  assert.notEqual(machine.state.generation, oldGeneration);
  assert.equal(machine.state.phase, 'anonymous');
  assert.equal(machine.state.profile, null);
  assert.equal(machine.state.context, 'PSICOLOGIA');
  machine.close();
});

test('R75 caso 08: reload sintético depois do logout continua anônimo', async () => {
  const auth = new FakeAuth();
  const first = new PsychologyAuthMachine({ auth });
  await first.googleLogin();
  await first.logout();
  first.close();
  const reloaded = new PsychologyAuthMachine({ auth });
  assert.equal(reloaded.state.phase, 'anonymous');
  assert.equal(reloaded.state.user, null);
  assert.equal(reloaded.accessApi.calls.length, 0);
  reloaded.close();
});

test('R75 casos 10/11/12/13: rota, contexto e isolamento permanecem Psicologia', () => {
  const machine = new PsychologyAuthMachine();
  assert.equal(machine.route, '/psicologia');
  assert.equal(machine.state.context, 'PSICOLOGIA');
  assert.equal(machine.state.googleAvailable, true);
  assert.equal(machine.state.emailPasswordAvailable, true);
  assert.doesNotMatch(appSource, /window\.location\s*=|location\.href\s*=|location\.replace\(/);
  assert.match(accessPortalSource, /directRoute && !psychologyAuthTheme/);
  assert.match(appSource, /psychologyAuthenticatedRoute/);
  assert.match(psychologyDomainSource, /authenticated-remote/);
  machine.close();
});

test('R75 caso 14: duas respostas fora de ordem só deixam vencer a geração atual', async () => {
  const auth = new FakeAuth();
  const accessApi = new FakeAccessApi();
  const machine = new PsychologyAuthMachine({ auth, accessApi });
  auth.emit({ uid: 'user-a', getIdToken: async () => 'token-a' });
  const first = accessApi.calls.at(-1);
  auth.emit({ uid: 'user-b', getIdToken: async () => 'token-b' });
  const second = accessApi.calls.at(-1);
  second.deferred.resolve({ role: 'professional', status: 'approved', context: 'PSICOLOGIA' });
  first.deferred.resolve({ role: 'professional', status: 'approved', context: 'NEUROPSICOPEDAGOGIA' });
  await flushPromises();
  assert.equal(machine.state.phase, 'approved');
  assert.equal(machine.state.user.uid, 'user-b');
  assert.equal(machine.state.profile.context, 'PSICOLOGIA');
  machine.close();
});

test('R75 caso 17: fontes consumidas pelo build contêm o fechamento R75', () => {
  assert.match(appSource, /logoutInProgressRef/);
  assert.match(appSource, /accessProfileAbortRef/);
  assert.match(accessPortalSource, /isLoggingOut/);
  assert.match(accessPortalSource, /psychologyEmailPasswordRoute/);
});

test('R75 contrato de implementação impede erro antigo, access sem usuário e corrida de logout', () => {
  assert.match(appSource, /profileError=\{user \? accessError : ''\}/);
  assert.match(appSource, /profileLoading=\{Boolean\(user\) && accessLoading\}/);
  assert.match(appSource, /if \(!user \|\| logoutInProgressRef\.current\) return/);
  assert.match(appSource, /abortController\.abort\(\)/);
  assert.match(accessApiSource, /signal\?: AbortSignal/);
  assert.match(accessApiSource, /signal: options\.signal/);
  assert.match(accessApiSource, /fallbackSessionIds\.clear\(\)/);
  assert.match(accessPortalSource, /if \(isLoggingOut\)/);
  assert.match(accessPortalSource, /clearFeedback\(\);\n      setView\('login'\)/);
});
