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

function seedDatabase({ hiddenId } = {}) {
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
    canonicalService('psychotherapy-individual', 'Nome canônico individual', 50, 1),
    canonicalService('therapy-couple', 'Nome canônico casal', 60, 2),
    canonicalService('mentoring', 'Mentoria', 45, 3),
    canonicalService('eneagram-test', 'Teste de Eneagrama', 30, 4),
    canonicalService('psychotherapy-adolescent', 'Psicoterapia Adolescente', 55, 5),
  ];
  if (hiddenId) {
    const hidden = services.find(service => service.id === hiddenId);
    hidden.publicBooking = { ...hidden.publicBooking, active: false };
  }
  services.forEach(service => database.values.set(`${canonicalPath}/services/${service.id}`, service));
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
    const store = createFirestorePublicBookingServerStore({ db: seedDatabase() });
    const state = await store.loadState();
    assert.deepEqual(state.settings.publishedServices.map(service => service.id), [
      'psychotherapy-individual',
      'therapy-couple',
      'mentoring',
      'eneagram-test',
      'psychotherapy-adolescent',
    ]);
    assert.equal(new Set(state.settings.publishedServices.map(service => service.id)).size, 5);
    assert.deepEqual(state.settings.publishedServices.map(service => service.durationMinutes), [50, 60, 45, 30, 55]);
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

test('R109 mantém serviços inativos/não publicáveis fora do catálogo elegível', async () => {
  await withRuntime(async () => {
    const store = createFirestorePublicBookingServerStore({ db: seedDatabase({ hiddenId: 'mentoring' }) });
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
