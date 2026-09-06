// @ts-nocheck
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { StrictMode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createPsychologyPersistenceScope,
  createPsychologyRemotePatientClient,
  usePsychologyRemoteBootstrap,
} from '../src/features/psychology-persistence/index';
import { createClosedPsychologyCapabilities } from '../src/features/psychology-persistence/capabilities';
import { createEmptyPsychologyStore, createPsychologyScope } from '../src/features/psychology-pilot/psychologyDomain';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const scope = createPsychologyPersistenceScope('professional-lifecycle-fixture', 'workspace-lifecycle-fixture');

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function Harness({ client, authRevision = 0, observe }: { client: unknown; authRevision?: number; observe: (state: unknown) => void }) {
  const state = usePsychologyRemoteBootstrap(client, true);
  observe(state);
  const terminalState = state.remoteLoading ? 'loading' : state.remoteError ? 'error' : 'success';
  return React.createElement('section', { 'data-auth-revision': authRevision, 'data-provider-state': terminalState },
    React.createElement('span', { 'data-page': 'patients', 'data-provider-state': terminalState }),
    React.createElement('span', { 'data-page': 'agenda', 'data-provider-state': terminalState }),
  );
}

test('global provider lifecycle reaches timeout once and remains terminal across StrictMode and stable-auth renders', async () => {
  let loadCalls = 0;
  let latest;
  const remoteClient = createPsychologyRemotePatientClient({
    scope: { ...scope },
    api: {
      getToken: async () => 'synthetic-token',
      requestTimeoutMs: 10,
      fetchImpl: (() => new Promise<Response>(() => {})) as typeof fetch,
    },
  });
  const client = {
    load: () => { loadCalls += 1; return remoteClient.load(); },
    getCapabilities: remoteClient.getCapabilities,
  };
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(StrictMode, null,
      React.createElement(Harness, { client, observe: state => { latest = state; } }),
    ));
  });
  assert.equal(latest.remoteLoading, true);
  await act(async () => { await wait(40); });

  assert.equal(loadCalls, 1, 'StrictMode must share the same in-flight bootstrap');
  assert.equal(latest.remoteLoading, false);
  assert.match(latest.remoteError, /demorou além do limite/i);
  assert.equal(renderer.root.findByProps({ 'data-page': 'patients' }).props['data-provider-state'], 'error');
  assert.equal(renderer.root.findByProps({ 'data-page': 'agenda' }).props['data-provider-state'], 'error');

  await act(async () => {
    renderer.update(React.createElement(StrictMode, null,
      React.createElement(Harness, { client, authRevision: 1, observe: state => { latest = state; } }),
    ));
    renderer.update(React.createElement(StrictMode, null,
      React.createElement(Harness, { client, authRevision: 2, observe: state => { latest = state; } }),
    ));
    await wait(20);
  });

  assert.equal(loadCalls, 1, 'stable client/auth renders must not restart the bootstrap');
  assert.equal(latest.remoteLoading, false);
  assert.match(latest.remoteError, /demorou além do limite/i);
  await act(async () => renderer.unmount());
});

test('newer bootstrap wins races and a late result cannot overwrite it', async () => {
  const first = deferred();
  const second = deferred();
  let latest;
  const firstClient = { load: () => first.promise, getCapabilities: createClosedPsychologyCapabilities };
  const secondClient = { load: () => second.promise, getCapabilities: createClosedPsychologyCapabilities };
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness, { client: firstClient, observe: state => { latest = state; } }));
  });
  await act(async () => {
    renderer.update(React.createElement(Harness, { client: secondClient, observe: state => { latest = state; } }));
    const winningStore = createEmptyPsychologyStore(createPsychologyScope(scope.professionalId));
    winningStore.patients.push({ id: 'newer', professionalId: scope.professionalId, context: 'PSICOLOGIA', name: 'Fixture mais nova', phone: '', preferredModality: 'online', active: true, createdAt: '', updatedAt: '' });
    second.resolve(winningStore);
    await wait(0);
  });
  assert.equal(latest.remoteLoading, false);
  assert.equal(latest.remoteStore?.patients[0]?.id, 'newer');

  await act(async () => {
    first.resolve(createEmptyPsychologyStore(createPsychologyScope(scope.professionalId)));
    await wait(0);
  });
  assert.equal(latest.remoteStore?.patients[0]?.id, 'newer');
  await act(async () => renderer.unmount());
});

test('unmount ignores a late bootstrap result', async () => {
  const pending = deferred();
  let renderCount = 0;
  const client = { load: () => pending.promise, getCapabilities: createClosedPsychologyCapabilities };
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness, { client, observe: () => { renderCount += 1; } }));
  });
  await act(async () => renderer.unmount());
  const countAtUnmount = renderCount;
  pending.resolve(createEmptyPsychologyStore(createPsychologyScope(scope.professionalId)));
  await act(async () => wait(0));
  assert.equal(renderCount, countAtUnmount);
});

test('successful bootstrap reaches a shared terminal success state', async () => {
  let latest;
  const store = createEmptyPsychologyStore(createPsychologyScope(scope.professionalId));
  const client = { load: async () => store, getCapabilities: createClosedPsychologyCapabilities };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness, { client, observe: state => { latest = state; } }));
    await wait(0);
  });
  assert.equal(latest.remoteLoading, false);
  assert.equal(latest.remoteError, '');
  assert.equal(latest.remoteStore, store);
  assert.equal(renderer.root.findByProps({ 'data-page': 'patients' }).props['data-provider-state'], 'success');
  assert.equal(renderer.root.findByProps({ 'data-page': 'agenda' }).props['data-provider-state'], 'success');
  await act(async () => renderer.unmount());
});

test('Pacientes and Agenda distinguish provider error from a valid empty result', () => {
  const source = readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  assert.match(source, /page === 'patients' && \(remoteError \? <RemoteCapabilityNotice title="Pacientes indisponíveis"/);
  assert.match(source, /page === 'agenda' && \(remoteError \? <RemoteCapabilityNotice title="Agenda indisponível"/);
});
