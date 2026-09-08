import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestorePublicBookingServerStore } from '../api/_lib/publicBookingFirestoreStore.js';
import { createPublicBookingServerHandler } from '../src/features/psychology-online-booking/publicServerRepository';

class FakeDocument {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  collection(name) { return new FakeCollection(this.database, `${this.path}/${name}`); }

  async get() {
    const value = this.database.values.get(this.path);
    return { exists: value !== undefined, id: this.path.split('/').at(-1), data: () => value === undefined ? undefined : structuredClone(value) };
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

const runtime = {
  PUBLIC_BOOKING_ENVIRONMENT: 'production',
  FIREBASE_PROJECT_ID: 'ai-studio-applet-webapp-e3283',
  PUBLIC_BOOKING_WORKSPACE_ID: 'workspace-r109',
  PUBLIC_BOOKING_TENANT_ID: 'tenant-r109',
  PUBLIC_BOOKING_PROFESSIONAL_ID: 'professional-leila-r109',
  PUBLIC_BOOKING_PROFESSIONAL_SLUG: 'leila-chaves',
  PUBLIC_BOOKING_PROFESSIONAL_NAME: 'Leila Chaves',
};

const rootPath = 'workspaces/workspace-r109/tenants/tenant-r109/professionals/professional-leila-r109/contexts/PSICOLOGIA/publicBooking/state';
const canonicalPath = 'workspaces/workspace-r109/professionals/professional-leila-r109/contexts/PSICOLOGIA';
const locations = [
  { id: 'location-r109-primary', workspaceId: 'workspace-r109', tenantId: 'tenant-r109', professionalId: 'professional-leila-r109', context: 'PSICOLOGIA', type: 'PRIMARY_OFFICE', displayName: 'Local principal sintético', fullAddress: '', city: 'Cariacica', state: 'ES', googleMapsUrl: '', active: true, isPrimary: true, sortOrder: 1 },
  { id: 'location-r109-external', workspaceId: 'workspace-r109', tenantId: 'tenant-r109', professionalId: 'professional-leila-r109', context: 'PSICOLOGIA', type: 'EXTERNAL_OFFICE', displayName: 'Local externo sintético', fullAddress: '', city: 'Vila Velha', state: 'ES', googleMapsUrl: '', active: true, isPrimary: false, sortOrder: 2 },
];

function canonicalService(id, name, durationMinutes, sortOrder, overrides = {}) {
  return {
    id,
    workspaceId: 'workspace-r109',
    tenantId: 'tenant-r109',
    professionalId: 'professional-leila-r109',
    context: 'PSICOLOGIA',
    name,
    defaultDurationMinutes: durationMinutes,
    defaultPrice: 0,
    modality: 'BOTH',
    active: true,
    publicBooking: {
      active: true,
      onlineEnabled: true,
      inPersonEnabled: true,
      allowedLocationIds: locations.map(location => location.id),
      sortOrder,
    },
    ...overrides,
  };
}

const allServiceIds = [
  'psychotherapy-individual',
  'therapy-couple',
  'mentoring',
  'eneagram-test',
  'psychotherapy-adolescent',
];

function seedDatabase({ remoteServiceIds = ['psychotherapy-individual', 'therapy-couple'], inactiveId, unpublishedId } = {}) {
  const database = new FakeDb();
  database.values.set(rootPath, {
    schemaVersion: 1,
    context: 'PSICOLOGIA',
    settings: {
      professionalId: runtime.PUBLIC_BOOKING_PROFESSIONAL_ID,
      professionalSlug: runtime.PUBLIC_BOOKING_PROFESSIONAL_SLUG,
      professionalName: runtime.PUBLIC_BOOKING_PROFESSIONAL_NAME,
      publishedServices: [
        { id: 'psychotherapy-individual', active: true, onlineEnabled: true, inPersonEnabled: true, allowedLocationIds: locations.map(location => location.id), sortOrder: 1 },
        { id: 'therapy-couple', active: true, onlineEnabled: true, inPersonEnabled: true, allowedLocationIds: locations.map(location => location.id), sortOrder: 2 },
      ],
      locations,
    },
  });
  const services = [
    canonicalService('psychotherapy-individual', 'Psicoterapia Individual', 50, 1),
    canonicalService('therapy-couple', 'Terapia de Casal', 50, 2),
    canonicalService('mentoring', 'Mentoria', 50, 3),
    canonicalService('eneagram-test', 'Teste de Eneagrama', 50, 4),
    canonicalService('psychotherapy-adolescent', 'Psicoterapia Adolescente', 50, 5),
  ];
  services
    .filter(service => remoteServiceIds.includes(service.id))
    .forEach(service => {
      if (service.id === inactiveId) service.active = false;
      if (service.id === unpublishedId) service.publicBooking = { ...service.publicBooking, active: false };
      database.values.set(`${canonicalPath}/services/${service.id}`, service);
    });
  locations.forEach(location => database.values.set(`${canonicalPath}/locations/${location.id}`, location));
  return database;
}

async function withRuntime(callback) {
  const keys = Object.keys(runtime);
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    keys.forEach(key => { delete process.env[key]; process.env[key] = runtime[key]; });
    return await callback();
  } finally {
    keys.forEach(key => {
      if (previous.get(key) === undefined) delete process.env[key];
      else process.env[key] = previous.get(key);
    });
  }
}

test('R109 reconcilia configuração pública parcial com o inventário canônico sem duplicar', async () => {
  await withRuntime(async () => {
    const database = seedDatabase();
    const store = createFirestorePublicBookingServerStore({ db: database });
    const state = await store.loadState();
    assert.equal([...state.settings.publishedServices].length, 5);
    assert.equal(state.settings.publishedServices.some(service => service.id === 'mentoring' && service.active), true);
    assert.equal(database.values.has(`${canonicalPath}/services/mentoring`), false);
    assert.deepEqual(state.settings.publishedServices.map(service => service.id), [
      'psychotherapy-individual',
      'therapy-couple',
      'mentoring',
      'eneagram-test',
      'psychotherapy-adolescent',
    ]);
    assert.equal(new Set(state.settings.publishedServices.map(service => service.id)).size, 5);
    assert.deepEqual(state.settings.publishedServices.map(service => service.durationMinutes), [50, 50, 50, 50, 50]);
    assert.deepEqual(state.settings.publishedServices.map(service => service.name), [
      'Psicoterapia Individual',
      'Terapia de Casal',
      'Mentoria',
      'Teste de Eneagrama',
      'Psicoterapia Adolescente',
    ]);

    const handler = createPublicBookingServerHandler({ store });
    const response = await handler({ method: 'GET', query: { resource: 'settings', slug: 'leila-chaves' } });
    assert.equal(response.status, 200);
    assert.equal(response.body.settings.publishedServices.length, 5);
  });
});

test('R109 preserva serviço canônico explicitamente inativo', async () => {
  await withRuntime(async () => {
    const store = createFirestorePublicBookingServerStore({ db: seedDatabase({ remoteServiceIds: allServiceIds, inactiveId: 'mentoring' }) });
    const state = await store.loadState();
    assert.equal(state.settings.publishedServices.find(service => service.id === 'mentoring')?.active, false);
    assert.deepEqual(state.settings.publishedServices.filter(service => service.active).map(service => service.id), [
      'psychotherapy-individual',
      'therapy-couple',
      'eneagram-test',
      'psychotherapy-adolescent',
    ]);
  });
});

test('R109 preserva serviço explicitamente não publicável por publicBooking.active', async () => {
  await withRuntime(async () => {
    const store = createFirestorePublicBookingServerStore({ db: seedDatabase({ remoteServiceIds: allServiceIds, unpublishedId: 'eneagram-test' }) });
    const state = await store.loadState();
    assert.equal(state.settings.publishedServices.find(service => service.id === 'eneagram-test')?.active, false);
    assert.equal(state.settings.publishedServices.find(service => service.id === 'eneagram-test')?.onlineEnabled, true);
  });
});
