import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultPublicBookingSettings, hashMapsNavigationRef } from '../src/features/psychology-online-booking/bookingDomain';
import { createMemoryPublicBookingServerStore, createPublicBookingServerHandler, createServerPublicBookingRepository } from '../src/features/psychology-online-booking/publicServerRepository';

const now = new Date('2026-08-18T08:00:00-03:00');

function serverRepository() {
  const settings = createDefaultPublicBookingSettings(now);
  const store = createMemoryPublicBookingServerStore(settings, now);
  return { settings, store, repository: createServerPublicBookingRepository({ state: store.getState(settings.professionalId), now: () => now }) };
}

async function createPresential(repository: ReturnType<typeof serverRepository>['repository'], settings: ReturnType<typeof createDefaultPublicBookingSettings>) {
  const slots = await repository.listPublishedSlots({ professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: settings.locations[0].id, fromDate: '2026-08-20', throughDate: '2026-08-20', now });
  assert.ok(slots.length > 0);
  const result = await repository.createBooking({ professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: settings.locations[0].id, date: slots[0].date, time: slots[0].time, name: 'Paciente Sintético R2F3C', dateOfBirth: '1990-01-01', phone: '5511999988888', email: 'r2f3c@example.invalid', source: 'site' }, now);
  assert.equal('conflict' in result, false);
  if ('conflict' in result) throw new Error(result.message);
  return result;
}

test('server-side capability storage resolve em cliente independente e não persiste tokens brutos', async () => {
  const { settings, store, repository: clientA } = serverRepository();
  await clientA.updateSettings({ locations: settings.locations.map((location, index) => ({ ...location, fullAddress: `Endereço sintético ${index + 1}`, googleMapsUrl: `https://maps.google.com/?q=r2f3c-${index + 1}` })) });
  const created = await createPresential(clientA, settings);
  const clientB = createServerPublicBookingRepository({ state: store.getState(settings.professionalId), now: () => now });
  assert.notEqual(created.managementToken, created.mapsNavigationRef);
  assert.equal((await clientB.getAppointmentByManagementToken(created.managementToken, now))?.locationName, settings.locations[0].displayName);
  assert.equal((await clientB.getMapsNavigationDestination(created.mapsNavigationRef!, now)).ok, true);
  const state = store.getState(settings.professionalId);
  const persistedAppointment = [...state.appointments.values()][0];
  assert.equal('mapsNavigationRef' in persistedAppointment, false);
  assert.equal('managementToken' in persistedAppointment, false);
  assert.equal(state.capabilities.size, 2);
  assert.equal(state.capabilities.get(await hashMapsNavigationRef(created.managementToken))?.capabilityType, 'MANAGEMENT');
});

test('nova instância server-side resolve a mesma capability e acompanha alteração do Local A para B', async () => {
  const { settings, store, repository: first } = serverRepository();
  const configured = await first.updateSettings({ locations: settings.locations.map((location, index) => ({ ...location, fullAddress: `Local ${index + 1}`, googleMapsUrl: `https://maps.google.com/?q=local-${index + 1}` })) });
  const created = await createPresential(first, configured);
  const coldStartRepository = createServerPublicBookingRepository({ state: store.getState(settings.professionalId), now: () => now });
  await coldStartRepository.updateSettings({ locations: [{ ...configured.locations[0], displayName: 'Local B', fullAddress: 'Endereço B atualizado', googleMapsUrl: 'https://maps.google.com/?q=local-b' }, configured.locations[1]] });
  const resolved = await coldStartRepository.getMapsNavigationDestination(created.mapsNavigationRef!, now);
  assert.deepEqual(resolved, { ok: true, destinationUrl: 'https://maps.google.com/?q=local-b', locationName: 'Local B', locationAddress: 'Endereço B atualizado' });
});

test('modalidade Online remove a capacidade Maps sem expor localização', async () => {
  const { settings, store, repository } = serverRepository();
  const created = await createPresential(repository, settings);
  const state = store.getState(settings.professionalId);
  const appointment = state.appointments.get(created.appointment.id)!;
  appointment.modality = 'ONLINE';
  appointment.locationId = undefined;
  assert.equal((await repository.getMapsNavigationDestination(created.mapsNavigationRef!, now)).ok, false);
  const summary = await repository.getAppointmentByManagementToken(created.managementToken, now);
  assert.equal(summary?.modality, 'ONLINE');
  assert.equal(summary?.locationName, undefined);
});

test('cancelamento, token adulterado e open redirect falham fechado', async () => {
  const { settings, repository } = serverRepository();
  const created = await createPresential(repository, settings);
  assert.equal((await repository.getAppointmentByManagementToken(`${created.managementToken}x`, now)), null);
  await repository.updateSettings({ locations: [{ ...settings.locations[0], googleMapsUrl: 'https://evil.example/redirect?to=https://maps.google.com' }, settings.locations[1]] });
  const invalid = await repository.getMapsNavigationDestination(created.mapsNavigationRef!, now);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'invalid');
  const cancelled = await repository.cancelByManagementToken(created.managementToken, now);
  assert.equal(cancelled.ok, true);
  assert.equal((await repository.getMapsNavigationDestination(created.mapsNavigationRef!, now)).ok, false);
});

test('BFF local usa contrato server-side para criar e resolver as duas capacidades', async () => {
  const { settings, store } = serverRepository();
  const handler = createPublicBookingServerHandler({ store, now: () => now, allowSettingsWrite: true });
  const slotsResponse = await handler({ method: 'GET', query: { resource: 'slots', professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: settings.locations[0].id, fromDate: '2026-08-20', throughDate: '2026-08-20' } });
  assert.equal(slotsResponse.status, 200);
  const slots = slotsResponse.body.slots as Array<{ date: string; time: string }>;
  const createResponse = await handler({ method: 'POST', query: { resource: 'create-booking' }, body: { professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: settings.locations[0].id, date: slots[0].date, time: slots[0].time, name: 'Paciente BFF Sintético', dateOfBirth: '1990-01-01', phone: '5511999977777', email: 'bff-r2f3c@example.invalid', source: 'site' } });
  assert.equal(createResponse.status, 201);
  const result = createResponse.body.result as { managementToken: string; mapsNavigationRef: string };
  const management = await handler({ method: 'GET', query: { resource: 'management', token: result.managementToken } });
  const maps = await handler({ method: 'GET', query: { resource: 'maps', navigationRef: result.mapsNavigationRef } });
  const invalidAction = await handler({ method: 'POST', query: { resource: 'management-action' }, body: { action: 'rebook', token: result.managementToken } });
  assert.equal(management.status, 200);
  assert.equal(maps.status, 404); // endereço inicial não está configurado; resolução continua fechada.
  assert.equal(invalidAction.status, 422);
});

test('rotas públicas não instanciam localStorage como autoridade', async () => {
  const { readFile } = await import('node:fs/promises');
  const files = ['PublicBookingPage.tsx', 'AppointmentManagementPage.tsx', 'MapsNavigationPage.tsx'];
  for (const file of files) {
    const source = await readFile(`src/features/psychology-online-booking/${file}`, 'utf8');
    assert.doesNotMatch(source, /window\.localStorage|createLocalPublicBookingRepository/);
    assert.match(source, /createPublicBookingApiClient/);
  }
});
