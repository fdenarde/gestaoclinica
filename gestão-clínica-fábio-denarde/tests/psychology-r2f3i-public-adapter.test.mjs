import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPublicBookingContext,
  createFirestorePublicBookingServerStore,
  resolvePublicBookingRuntimeConfig,
} from '../api/_lib/publicBookingFirestoreStore.js';

class FakeDocument {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  collection(name) { return new FakeCollection(this.database, `${this.path}/${name}`); }

  async get() {
    const value = this.database.values.get(this.path);
    return { exists: value !== undefined, id: this.path.split('/').at(-1), data: () => value ? structuredClone(value) : undefined };
  }

  async set(value) { this.database.values.set(this.path, structuredClone(value)); }
}

class FakeCollection {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  doc(id) { return new FakeDocument(this.database, `${this.path}/${id}`); }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.database.values.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, value]) => ({ id: path.split('/').at(-1), data: () => structuredClone(value) }));
    return { docs };
  }
}

class FakeBatch {
  constructor(database) {
    this.database = database;
    this.writes = [];
  }

  set(document, value) {
    this.writes.push({ path: document.path, value });
    return this;
  }

  async commit() {
    this.writes.forEach(({ path, value }) => this.database.values.set(path, structuredClone(value)));
  }
}

class FakeDb {
  constructor() { this.values = new Map(); }
  doc(path) { return new FakeDocument(this, path); }
  collection(path) { return new FakeCollection(this, path); }
  batch() { return new FakeBatch(this); }
}

const staging = {
  PUBLIC_BOOKING_ENVIRONMENT: 'staging',
  FIREBASE_PROJECT_ID: 'gestao-psicologia-stg-260815',
  PUBLIC_BOOKING_SYNTHETIC_FIXTURE: 'true',
  PUBLIC_BOOKING_TEST_RUN_ID: 'R2F3I_TEST_20260818',
  PUBLIC_BOOKING_WORKSPACE_ID: 'workspace-r2f3i-test',
  PUBLIC_BOOKING_TENANT_ID: 'tenant-r2f3i-test',
  PUBLIC_BOOKING_PROFESSIONAL_ID: 'professional-r2f3i-test',
  PUBLIC_BOOKING_PROFESSIONAL_SLUG: 'r2f3i-test',
};

const production = {
  PUBLIC_BOOKING_ENVIRONMENT: 'production',
  FIREBASE_PROJECT_ID: 'ai-studio-applet-webapp-e3283',
  PUBLIC_BOOKING_WORKSPACE_ID: 'workspace-production-bound',
  PUBLIC_BOOKING_TENANT_ID: 'tenant-production-bound',
  PUBLIC_BOOKING_PROFESSIONAL_ID: 'professional-leila-bound',
  PUBLIC_BOOKING_PROFESSIONAL_SLUG: 'leila-chaves',
  PUBLIC_BOOKING_PROFESSIONAL_NAME: 'Leila Chaves',
};

async function withEnvironment(values, callback) {
  const keys = new Set([
    'PUBLIC_BOOKING_ENVIRONMENT',
    'FIREBASE_PROJECT_ID',
    'PUBLIC_BOOKING_SYNTHETIC_FIXTURE',
    'PUBLIC_BOOKING_TEST_RUN_ID',
    'PUBLIC_BOOKING_WORKSPACE_ID',
    'PUBLIC_BOOKING_TENANT_ID',
    'PUBLIC_BOOKING_PROFESSIONAL_ID',
    'PUBLIC_BOOKING_PROFESSIONAL_SLUG',
    'PUBLIC_BOOKING_PROFESSIONAL_NAME',
  ]);
  const previous = new Map([...keys].map(key => [key, process.env[key]]));
  try {
    keys.forEach(key => delete process.env[key]);
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) process.env[key] = value;
    });
    return await callback();
  } finally {
    keys.forEach(key => {
      if (previous.get(key) === undefined) delete process.env[key];
      else process.env[key] = previous.get(key);
    });
  }
}

function assertConfigurationFailure(values, pattern) {
  return withEnvironment(values, () => assert.throws(() => resolvePublicBookingRuntimeConfig(), pattern));
}

test('A — staging explícito resolve projeto, escopo e fixture sem defaults ocultos', async () => {
  await withEnvironment(staging, () => {
    const config = resolvePublicBookingRuntimeConfig();
    assert.deepEqual({
      environment: config.environment,
      projectId: config.projectId,
      workspaceId: config.workspaceId,
      tenantId: config.tenantId,
      professionalId: config.professionalId,
      professionalSlug: config.professionalSlug,
      testRunId: config.testRunId,
      syntheticFixture: config.syntheticFixture,
    }, {
      environment: 'staging',
      projectId: 'gestao-psicologia-stg-260815',
      workspaceId: 'workspace-r2f3i-test',
      tenantId: 'tenant-r2f3i-test',
      professionalId: 'professional-r2f3i-test',
      professionalSlug: 'r2f3i-test',
      testRunId: 'R2F3I_TEST_20260818',
      syntheticFixture: true,
    });
    const store = createFirestorePublicBookingServerStore({ db: new FakeDb() });
    assert.equal(store.scope.professionalId, 'professional-r2f3i-test');
    assert.equal(store.environment, 'staging');
    assert.equal(store.projectId, 'gestao-psicologia-stg-260815');
    assert.match(store.rootPath, /workspace-r2f3i-test\/tenants\/tenant-r2f3i-test\/professionals\/professional-r2f3i-test\/contexts\/PSICOLOGIA/);
  });
});

test('B — projeto Firebase ausente ou divergente falha fechado', async () => {
  await assertConfigurationFailure({ ...staging, FIREBASE_PROJECT_ID: undefined }, /FIREBASE_PROJECT_ID/);
  await assertConfigurationFailure({ ...staging, FIREBASE_PROJECT_ID: 'outro-projeto' }, /FIREBASE_PROJECT_ID/);
});

test('C — ambiente não declarado ou não permitido falha fechado', async () => {
  await assertConfigurationFailure({ ...staging, PUBLIC_BOOKING_ENVIRONMENT: undefined }, /ENVIRONMENT/);
  await assertConfigurationFailure({ ...staging, PUBLIC_BOOKING_ENVIRONMENT: 'development' }, /ENVIRONMENT/);
});

test('D/E/F — workspace, tenant e profissional são obrigatórios', async () => {
  await assertConfigurationFailure({ ...staging, PUBLIC_BOOKING_WORKSPACE_ID: undefined }, /WORKSPACE_ID/);
  await assertConfigurationFailure({ ...staging, PUBLIC_BOOKING_TENANT_ID: undefined }, /TENANT_ID/);
  await assertConfigurationFailure({ ...staging, PUBLIC_BOOKING_PROFESSIONAL_ID: undefined }, /PROFESSIONAL_ID/);
});

test('G — contexto diferente de PSICOLOGIA é rejeitado', () => {
  assert.equal(assertPublicBookingContext('PSICOLOGIA'), 'PSICOLOGIA');
  assert.throws(() => assertPublicBookingContext('NEUROPSICOPEDAGOGIA'), /PSICOLOGIA/);
});

test('H — não há defaults staging implícitos nem fixture sem flag explícita', async () => {
  const noFixture = { ...staging, PUBLIC_BOOKING_SYNTHETIC_FIXTURE: undefined, PUBLIC_BOOKING_TEST_RUN_ID: undefined };
  await withEnvironment(noFixture, async () => {
    const config = resolvePublicBookingRuntimeConfig();
    assert.equal(config.syntheticFixture, false);
    assert.equal(config.testRunId, undefined);
    const store = createFirestorePublicBookingServerStore({ db: new FakeDb() });
    await assert.rejects(store.loadState(), error => {
      assert.match(error.message, /catálogo público não está configurado/);
      assert.doesNotMatch(error.message, /workspace-psychology-staging|tenant-psychology-staging|professional-psychology-staging|r2f3-d-staging/);
      return true;
    });
  });
});

test('I — production-like offline aceita somente binding explícito e não exige testRunId', async () => {
  await withEnvironment(production, async () => {
    const config = resolvePublicBookingRuntimeConfig();
    assert.equal(config.environment, 'production');
    assert.equal(config.projectId, 'ai-studio-applet-webapp-e3283');
    assert.equal(config.testRunId, undefined);
    assert.equal(config.syntheticFixture, false);
    const database = new FakeDb();
    const root = 'workspaces/workspace-production-bound/tenants/tenant-production-bound/professionals/professional-leila-bound/contexts/PSICOLOGIA/publicBooking/state';
    database.values.set(root, {
      schemaVersion: 1,
      context: 'PSICOLOGIA',
      settings: {
        professionalId: 'professional-leila-bound',
        professionalSlug: 'leila-chaves',
        professionalName: 'Leila Chaves',
        publishedServices: [],
        locations: [],
      },
    });
    const store = createFirestorePublicBookingServerStore({ db: database });
    const state = await store.loadState();
    assert.equal(state.settings.professionalId, 'professional-leila-bound');
    assert.equal(state.settings.professionalSlug, 'leila-chaves');
    assert.equal(state.settings.professionalName, 'Leila Chaves');
    assert.equal(store.scope.professionalId, 'professional-leila-bound');
  });
});

test('production-like sem catálogo configurado não cai em settings sintético', async () => {
  await withEnvironment(production, async () => {
    const store = createFirestorePublicBookingServerStore({ db: new FakeDb() });
    await assert.rejects(store.loadState(), /catálogo público não está configurado/);
  });
});
