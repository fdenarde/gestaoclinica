import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestorePublicBookingServerStore } from '../api/_lib/publicBookingFirestoreStore.js';
import { createPublicBookingServerHandler } from '../src/features/psychology-online-booking/publicServerRepository';

class FakeDocument {
  constructor(private readonly database: FakeDb, readonly path: string) {}

  collection(name: string) { return new FakeCollection(this.database, `${this.path}/${name}`); }

  async get() {
    const value = this.database.values.get(this.path);
    return { exists: value !== undefined, id: this.path.split('/').at(-1), data: () => value ? structuredClone(value) : undefined };
  }

  async set(value: unknown) {
    this.database.values.set(this.path, structuredClone(value));
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

  set(document: FakeDocument, value: unknown) {
    this.writes.push({ path: document.path, value });
    return this;
  }

  async commit() {
    this.writes.forEach(write => this.database.values.set(write.path, structuredClone(write.value)));
  }
}

class FakeDb {
  readonly values = new Map<string, unknown>();
  doc(path: string) { return new FakeDocument(this, path); }
  collection(path: string) { return new FakeCollection(this, path); }
  batch() { return new FakeBatch(this); }
}

const now = new Date('2026-08-18T12:00:00-03:00');
const testRunId = 'R2F3G_TEST_20260818';

function stagingHandler(database: FakeDb) {
  process.env.FIREBASE_PROJECT_ID = 'gestao-psicologia-stg-260815';
  process.env.PUBLIC_BOOKING_ENVIRONMENT = 'staging';
  process.env.PUBLIC_BOOKING_SYNTHETIC_FIXTURE = 'true';
  process.env.PUBLIC_BOOKING_TEST_RUN_ID = testRunId;
  process.env.PUBLIC_BOOKING_WORKSPACE_ID = 'workspace-r2f3g-test';
  process.env.PUBLIC_BOOKING_TENANT_ID = 'tenant-r2f3g-test';
  process.env.PUBLIC_BOOKING_PROFESSIONAL_ID = 'professional-r2f3g-test';
  process.env.PUBLIC_BOOKING_PROFESSIONAL_SLUG = 'r2f3g-test';
  const store = createFirestorePublicBookingServerStore({ db: database, now: () => now });
  return { store, handler: createPublicBookingServerHandler({ store: store as never, now: () => now }) };
}

async function settingsAndSlot(handler: ReturnType<typeof createPublicBookingServerHandler>, modality: 'ONLINE' | 'PRESENCIAL') {
  const settingsResponse = await handler({ method: 'GET', query: { resource: 'settings' } });
  if (settingsResponse.status !== 200) throw new Error(`settings ${settingsResponse.status}: ${JSON.stringify(settingsResponse.body)}`);
  const settings = settingsResponse.body.settings as { professionalSlug: string; publishedServices: Array<{ id: string }>; locations: Array<{ id: string }> };
  const slotsResponse = await handler({ method: 'GET', query: { resource: 'slots', professionalSlug: settings.professionalSlug, serviceId: settings.publishedServices[0].id, modality, locationId: modality === 'PRESENCIAL' ? settings.locations[0].id : undefined, fromDate: '2026-08-20', throughDate: '2026-08-20' } });
  if (slotsResponse.status !== 200) throw new Error(`slots ${slotsResponse.status}: ${JSON.stringify(slotsResponse.body)}`);
  const slot = (slotsResponse.body.slots as Array<{ date: string; time: string }>)[0];
  assert.ok(slot);
  return { settings, slot };
}

test('R2F3-G staging reconstrói catálogo canônico e grava Patient + Session atomicamente', async () => {
  const database = new FakeDb();
  const first = stagingHandler(database);
  const { settings, slot } = await settingsAndSlot(first.handler, 'PRESENCIAL');
  const createdResponse = await first.handler({ method: 'POST', query: { resource: 'create-booking' }, body: {
    professionalSlug: settings.professionalSlug,
    serviceId: settings.publishedServices[0].id,
    modality: 'PRESENCIAL',
    locationId: settings.locations[0].id,
    date: slot.date,
    time: slot.time,
    name: 'Adulto R2F3G Sintético',
    dateOfBirth: '1990-01-01',
    phone: '5511999993001',
    email: 'adulto.r2f3g@example.invalid',
  } });
  assert.equal(createdResponse.status, 201);
  const result = createdResponse.body.result as { appointment: { patientId: string; sessionId: string; durationMinutes: number; locationId?: string }; managementToken: string };
  const patientPath = [...database.values.keys()].find(path => path.endsWith(`/patients/${result.appointment.patientId}`));
  const sessionPath = [...database.values.keys()].find(path => path.endsWith(`/sessions/${result.appointment.sessionId}`));
  assert.ok(patientPath);
  assert.ok(sessionPath);
  const patient = database.values.get(patientPath!) as Record<string, unknown>;
  const session = database.values.get(sessionPath!) as Record<string, unknown>;
  assert.equal(patient.dateOfBirth, '1990-01-01');
  assert.equal(session.serviceId, settings.publishedServices[0].id);
  assert.equal(session.durationMinutes, result.appointment.durationMinutes);
  assert.equal(session.locationId, result.appointment.locationId);
  assert.equal(session.bookingOrigin, 'PATIENT_SELF_BOOKING');
  const publicAppointment = [...database.values.entries()].find(([path]) => path.includes('/publicBooking/state/appointments/'))?.[1] as Record<string, unknown>;
  assert.ok(publicAppointment);
  assert.equal('dateOfBirth' in publicAppointment, false);
  assert.equal('administrativeResponsible' in publicAppointment, false);
  const capability = [...database.values.entries()].find(([path]) => path.includes('/publicBooking/state/capabilities/'))?.[1] as Record<string, unknown>;
  assert.equal('dateOfBirth' in capability, false);
  assert.equal('phone' in capability, false);
  assert.equal('email' in capability, false);
  const coldStart = stagingHandler(database);
  const management = await coldStart.handler({ method: 'GET', query: { resource: 'management', token: result.managementToken } });
  assert.equal(management.status, 200);
  assert.equal((management.body.summary as Record<string, unknown>).locationName, 'R2F3-D Local A');
});

test('R2F3-G staging rejeita campos obrigatórios no servidor sem criar Patient parcial', async () => {
  const database = new FakeDb();
  const { handler } = stagingHandler(database);
  const { settings, slot } = await settingsAndSlot(handler, 'ONLINE');
  const beforePatients = [...database.values.keys()].filter(path => path.includes('/contexts/PSICOLOGIA/patients/')).length;
  const response = await handler({ method: 'POST', query: { resource: 'create-booking' }, body: {
    professionalSlug: settings.professionalSlug,
    serviceId: settings.publishedServices[0].id,
    modality: 'ONLINE',
    date: slot.date,
    time: slot.time,
    name: 'Menor R2F3G Sintético',
    phone: '5511999993002',
    email: 'menor.r2f3g@example.invalid',
  } });
  assert.equal(response.status, 409);
  const afterPatients = [...database.values.keys()].filter(path => path.includes('/contexts/PSICOLOGIA/patients/')).length;
  assert.equal(afterPatients, beforePatients);
  assert.equal([...database.values.keys()].some(path => path.includes('/publicBooking/state/capabilities/')), false);
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
