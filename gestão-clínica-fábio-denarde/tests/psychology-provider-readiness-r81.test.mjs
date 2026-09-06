import assert from 'node:assert/strict';
import test from 'node:test';
import { createPsychologyProviderReadiness } from '../api/_lib/psychologyProviderReadiness.js';

function baseDependencies(overrides = {}) {
  const calls = { fetch: 0, repositories: 0 };
  const dependencies = {
    calls,
    getDb: () => ({ projectId: 'expected-project', databaseId: 'named-database', collection: () => ({}) }),
    getApp: () => ({
      options: {
        projectId: 'expected-project',
        credential: { getAccessToken: async () => ({ access_token: 'in-memory-only-test-token' }) },
      },
    }),
    fetchImpl: async (url, init) => {
      calls.fetch += 1;
      assert.match(url, /firestore\.googleapis\.com\/v1\/projects\/expected-project\/databases\/named-database$/);
      assert.equal(init.headers.Authorization, 'Bearer in-memory-only-test-token');
      return { ok: true, status: 200, json: async () => ({ name: 'metadata-only' }) };
    },
    createRepositories: () => {
      calls.repositories += 1;
      return { patients: {}, sessions: {}, settings: {} };
    },
    expectedProjectId: 'expected-project',
  };
  return { ...dependencies, ...overrides };
}

test('R81 readiness passes infrastructure layers without repository reads', async () => {
  const dependencies = baseDependencies();
  const result = await createPsychologyProviderReadiness(dependencies)();

  assert.equal(result.ok, true);
  assert.equal(result.cause, 'PROVIDER_INFRASTRUCTURE_READINESS_PASS');
  assert.equal(result.firebaseAdmin, 'ok');
  assert.equal(result.projectConfig, 'ok');
  assert.equal(result.firestoreConfig, 'ok');
  assert.equal(result.databaseConfig, 'ok');
  assert.equal(result.runtimeCredential, 'ok');
  assert.equal(result.databaseMetadata, 'ok');
  assert.equal(result.repositories, 'ok');
  assert.equal(dependencies.calls.fetch, 1);
  assert.equal(dependencies.calls.repositories, 1);
  assert.equal(JSON.stringify(result).includes('in-memory-only-test-token'), false);
});

test('R81 readiness classifies metadata permission failure without exposing response details', async () => {
  const dependencies = baseDependencies({
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'sensitive provider detail' } }),
    }),
  });
  const result = await createPsychologyProviderReadiness(dependencies)();

  assert.equal(result.ok, false);
  assert.equal(result.cause, 'PROVIDER_RUNTIME_PERMISSION_FAILURE');
  assert.equal(result.failureLayer, 'database-metadata');
  assert.equal(result.errorCode, 'METADATA_PERMISSION_DENIED');
  assert.equal(result.httpStatus, 403);
  assert.equal(result.messageSanitized.includes('sensitive'), false);
  assert.equal(dependencies.calls.repositories, 0);
});

test('R81 readiness stops before metadata when the named database is not resolved', async () => {
  const dependencies = baseDependencies({
    getDb: () => ({ projectId: 'expected-project', databaseId: '(default)', collection: () => ({}) }),
  });
  const result = await createPsychologyProviderReadiness(dependencies)();

  assert.equal(result.ok, false);
  assert.equal(result.cause, 'PROVIDER_DATABASE_CONFIG_ERROR');
  assert.equal(result.failureLayer, 'firestore-config');
  assert.equal(dependencies.calls.fetch, 0);
  assert.equal(dependencies.calls.repositories, 0);
});
