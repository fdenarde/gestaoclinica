import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { buildEffectiveAccessContext } from '../api/_lib/accessPermissions.js';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { hostname: 'localhost', reload() {} },
};
globalThis.document = {
  documentElement: { dataset: {} },
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
  getElementById() { return null; },
  createElement() { return { click() {} }; },
};
globalThis.HTMLElement = class HTMLElement {};

const googleUser = {
  uid: 'synthetic-google-user',
  email: 'professional@example.test',
  displayName: 'Profissional Sintético',
  getIdToken: async () => 'synthetic-id-token',
};
const authState = { currentUser: null };
let googleSignInCalls = 0;

const firebaseModuleUrl = new URL('../src/firebase.ts', import.meta.url).href;
await mock.module(firebaseModuleUrl, {
  namedExports: {
    auth: authState,
    db: {},
    createEmailAccount: async () => ({ user: googleUser }),
    loginWithEmail: async () => ({ user: googleUser }),
    loginWithIdentifier: async () => ({ user: googleUser }),
    loginWithGoogle: async () => {
      googleSignInCalls += 1;
      authState.currentUser = googleUser;
      return { user: googleUser };
    },
    logout: async () => { authState.currentUser = null; },
    requestPasswordReset: async () => undefined,
  },
});

const accessApiModuleUrl = new URL('../src/lib/accessApi.ts', import.meta.url).href;
await mock.module(accessApiModuleUrl, {
  namedExports: {
    respondAdditionalAccessInformation: async () => undefined,
    submitAccessRequest: async () => undefined,
  },
});

const brandLogoModuleUrl = new URL('../src/components/Common/BrandLogo.tsx', import.meta.url).href;
await mock.module(brandLogoModuleUrl, {
  namedExports: { default: () => React.createElement('span', null, 'Logo') },
});

const { default: AccessPortal } = await import('../src/components/Auth/AccessPortal.tsx');
const { createPsychologyRemotePatientClient } = await import('../src/features/psychology-persistence/remotePatientClient.ts');

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

test('R43 end-to-end — clique Google autentica, mantém professional e não solicita acesso', async () => {
  let requestCalls = 0;
  let renderer;
  act(() => {
    renderer = create(React.createElement(AccessPortal, {
      user: null,
      profile: null,
      profileLoading: false,
      profileError: '',
      selectedLoginRole: 'professional',
      onSelectedLoginRoleChange() {},
      onAccessRequestSubmitted() { requestCalls += 1; },
      onRetryProfile() {},
      accessRouteRole: 'professional',
      visualContext: 'PSICOLOGIA',
    }));
  });

  const googleButton = renderer.root.findByProps({ 'data-testid': 'psychology-google-login' });
  assert.equal(textContent(googleButton).trim(), 'GEntrar com Google');
  assert.equal(renderer.root.findAllByType('input').length, 0);
  assert.doesNotMatch(textContent(renderer.root), /E-mail ou nome de usuário|Senha/);

  await act(async () => {
    googleButton.props.onClick();
    await Promise.resolve();
  });
  assert.equal(googleSignInCalls, 1);
  assert.equal(authState.currentUser, googleUser);
  assert.equal(requestCalls, 0);

  const access = buildEffectiveAccessContext({
    decodedToken: { uid: googleUser.uid, email: googleUser.email },
    profile: { role: 'professional', status: 'approved', workspaceId: 'synthetic-workspace' },
    primaryAdminEmail: 'admin@example.test',
    primaryAdminWorkspaceId: 'synthetic-admin-workspace',
    requestedContext: 'professional',
  });
  assert.equal(access.role, 'professional');
  assert.equal(access.status, 'approved');
  assert.equal(access.permissions['patients.list'], true);
  assert.equal(requestCalls, 0);
  renderer.unmount();
});

test('R43 end-to-end — approved remote carrega pacientes pelo repository remoto e adota escopo', async () => {
  const calls = [];
  const serverScope = createPsychologyPersistenceScope('resolved-professional', 'resolved-workspace');
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    const path = String(url);
    const payload = path.endsWith('/patients')
      ? { scope: serverScope, items: [{ id: 'patient-1', name: 'Paciente Sintético', phone: '27999990000', active: true }] }
      : path.endsWith('/sessions')
        ? { scope: serverScope, items: [] }
        : { scope: serverScope, settings: {} };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = createPsychologyRemotePatientClient({
    scope: createPsychologyPersistenceScope('placeholder-professional', 'placeholder-workspace'),
    api: { fetchImpl, getToken: async () => 'synthetic-google-token' },
  });

  const store = await client.load();
  assert.ok(calls.some(call => call.method === 'GET' && call.url.endsWith('/patients')));
  assert.equal(store.patients[0].name, 'Paciente Sintético');
  assert.equal(client.scope.professionalId, 'resolved-professional');
  assert.equal(client.scope.workspaceId, 'resolved-workspace');
  assert.equal(client.scope.context, 'PSICOLOGIA');
  assert.equal(calls.filter(call => call.url.endsWith('/patients')).length, 1);
});
