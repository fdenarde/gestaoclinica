import assert from 'node:assert/strict';
import test from 'node:test';
import { hashMapsNavigationRef } from '../src/features/psychology-online-booking/bookingDomain';
import { createFirestorePublicBookingServerStore } from '../api/_lib/publicBookingFirestoreStore.js';
import { createPublicBookingServerHandler } from '../src/features/psychology-online-booking/publicServerRepository';

class FakeDocument {
  constructor(private readonly database: FakeDb, readonly path: string) {}

  collection(name: string) { return new FakeCollection(this.database, `${this.path}/${name}`); }
  async set(value: unknown) { this.database.values.set(this.path, structuredClone(value)); }
  async get() {
    const value = this.database.values.get(this.path);
    return { exists: value !== undefined, id: this.path.split('/').at(-1), data: () => value ? structuredClone(value) : undefined };
  }
}

class FakeCollection {
  constructor(private readonly database: FakeDb, readonly path: string) {}

  doc(id: string) { return new FakeDocument(this.database, `${this.path}/${id}`); }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.database.values.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, value]) => ({ id: path.split('/').at(-1), data: () => structuredClone(value) }));
    return { docs };
  }
}

class FakeBatch {
  private readonly writes: Array<{ path: string; value: unknown }> = [];
  constructor(private readonly database: FakeDb) {}
  set(document: FakeDocument, value: unknown) { this.writes.push({ path: document.path, value }); return this; }
  async commit() { this.writes.forEach(write => this.database.values.set(write.path, structuredClone(write.value))); }
}

class FakeDb {
  readonly values = new Map<string, unknown>();
  doc(path: string) { return new FakeDocument(this, path); }
  collection(path: string) { return new FakeCollection(this, path); }
  batch() { return new FakeBatch(this); }
}

const now = new Date('2026-08-18T08:00:00-03:00');

function stagingHandler(database: FakeDb) {
  process.env.FIREBASE_PROJECT_ID = 'gestao-psicologia-stg-260815';
  process.env.PUBLIC_BOOKING_ENVIRONMENT = 'staging';
  process.env.PUBLIC_BOOKING_SYNTHETIC_FIXTURE = 'true';
  process.env.PUBLIC_BOOKING_TEST_RUN_ID = 'R2F3D_TEST_20260818';
  process.env.PUBLIC_BOOKING_WORKSPACE_ID = 'workspace-r2f3d-test';
  process.env.PUBLIC_BOOKING_TENANT_ID = 'tenant-r2f3d-test';
  process.env.PUBLIC_BOOKING_PROFESSIONAL_ID = 'professional-r2f3d-test';
  process.env.PUBLIC_BOOKING_PROFESSIONAL_SLUG = 'r2f3d-test';
  const store = createFirestorePublicBookingServerStore({ db: database, now: () => now });
  return { store, handler: createPublicBookingServerHandler({ store: store as never, now: () => now }) };
}

test('persistência pública Firestore de staging cruza instâncias sem expor tokens brutos', async () => {
  const database = new FakeDb();
  const first = stagingHandler(database);
  const settingsResponse = await first.handler({ method: 'GET', query: { resource: 'settings', slug: 'r2f3d-test' } });
  assert.equal(settingsResponse.status, 200);
  const settings = settingsResponse.body.settings as { publishedServices: Array<{ id: string }>; locations: Array<{ id: string }> };
  const slotsResponse = await first.handler({ method: 'GET', query: { resource: 'slots', professionalSlug: 'r2f3d-test', serviceId: settings.publishedServices[0].id, modality: 'PRESENCIAL', locationId: settings.locations[0].id, fromDate: '2026-08-20', throughDate: '2026-08-20' } });
  const slots = slotsResponse.body.slots as Array<{ date: string; time: string }>;
  assert.equal(slotsResponse.status, 200);
  assert.ok(slots.length > 0);
  const createResponse = await first.handler({ method: 'POST', query: { resource: 'create-booking' }, body: {
    professionalSlug: 'r2f3d-test', serviceId: settings.publishedServices[0].id, modality: 'PRESENCIAL', locationId: settings.locations[0].id,
    date: slots[0].date, time: slots[0].time, name: 'Paciente Sintético R2F3D', dateOfBirth: '1990-01-01', phone: '5511999990001', email: 'r2f3d@example.invalid', source: 'site',
  } });
  assert.equal(createResponse.status, 201);
  const created = createResponse.body.result as { managementToken: string; mapsNavigationRef: string };
  assert.ok(created.managementToken);
  assert.ok(created.mapsNavigationRef);
  const coldStart = stagingHandler(database);
  const management = await coldStart.handler({ method: 'GET', query: { resource: 'management', token: created.managementToken } });
  const maps = await coldStart.handler({ method: 'GET', query: { resource: 'maps', navigationRef: created.mapsNavigationRef } });
  const mapsWithManagementToken = await coldStart.handler({ method: 'GET', query: { resource: 'maps', navigationRef: created.managementToken } });
  assert.equal(management.status, 200);
  assert.equal(maps.status, 200);
  assert.equal(mapsWithManagementToken.status, 404);
  const appointmentDocument = [...database.values.entries()].find(([path]) => path.includes('/appointments/'))?.[1] as Record<string, unknown>;
  assert.ok(appointmentDocument);
  assert.equal('managementToken' in appointmentDocument, false);
  assert.equal('mapsNavigationRef' in appointmentDocument, false);
  assert.equal(database.values.has(`${[...database.values.keys()].find(path => path.includes('/capabilities/'))?.split('/capabilities/')[0]}/capabilities/${await hashMapsNavigationRef(created.managementToken)}`), true);
});

test('a leitura posterior resolve o Local B atualizado e a modalidade Online não expõe localização', async () => {
  const database = new FakeDb();
  const first = stagingHandler(database);
  const state = await first.store.loadState!();
  const serviceId = state.settings.publishedServices[0].id;
  const locationId = state.settings.locations[0].id;
  state.settings.locations = state.settings.locations.map(location => location.id === locationId
    ? { ...location, displayName: 'R2F3-D Local B', fullAddress: 'Endereço sintético B atualizado', googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=R2F3-D+Local+B' }
    : location);
  await first.store.saveState!(state);
  const next = stagingHandler(database);
  const slotsResponse = await next.handler({ method: 'GET', query: { resource: 'slots', professionalSlug: 'r2f3d-test', serviceId, modality: 'ONLINE', fromDate: '2026-08-20', throughDate: '2026-08-20' } });
  assert.equal(slotsResponse.status, 200);
  const slots = slotsResponse.body.slots as Array<{ date: string; time: string }>;
  const createResponse = await next.handler({ method: 'POST', query: { resource: 'create-booking' }, body: {
    professionalSlug: 'r2f3d-test', serviceId, modality: 'ONLINE', date: slots[0].date, time: slots[0].time,
    name: 'Paciente Online Sintético', dateOfBirth: '1990-01-01', phone: '5511999990002', email: 'online-r2f3d@example.invalid', source: 'site',
  } });
  assert.equal(createResponse.status, 201);
  const created = createResponse.body.result as { managementToken: string };
  const summary = await next.handler({ method: 'GET', query: { resource: 'management', token: created.managementToken } });
  assert.equal(summary.status, 200);
  assert.equal((summary.body.summary as { locationName?: string }).locationName, undefined);
});

test.after(() => {
  delete process.env.PUBLIC_BOOKING_ENVIRONMENT;
  delete process.env.PUBLIC_BOOKING_SYNTHETIC_FIXTURE;
  delete process.env.PUBLIC_BOOKING_TEST_RUN_ID;
  delete process.env.PUBLIC_BOOKING_WORKSPACE_ID;
  delete process.env.PUBLIC_BOOKING_TENANT_ID;
  delete process.env.PUBLIC_BOOKING_PROFESSIONAL_ID;
  delete process.env.PUBLIC_BOOKING_PROFESSIONAL_SLUG;
});
