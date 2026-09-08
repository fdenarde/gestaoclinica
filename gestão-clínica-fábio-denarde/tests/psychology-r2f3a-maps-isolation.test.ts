import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildMetaTemplateCollisionChecks, filterMetaTemplatesForContext } from '../src/features/psychology-messaging/metaContextIsolation';
import { buildSubmissionCandidate } from '../src/features/psychology-messaging/r2f3RuntimeContract';
import { createDefaultPublicBookingSettings, isLocationReadyForReminder, LOCATION_REMINDER_INCOMPLETE_MESSAGE } from '../src/features/psychology-online-booking/bookingDomain';
import { createLocalPublicBookingRepository, createMemoryOnlineBookingStorage } from '../src/features/psychology-online-booking/repository';

const syntheticNow = new Date('2026-08-18T08:00:00-03:00');

test('isolamento contextual mantém inventário institucional fora do browser', () => {
  const institutional = [
    { id: 'neuro-1', name: 'neuro_lembrete', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
    { id: 'psych-1', name: 'psicologia_outro', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
    { id: 'unassigned-1', name: 'lembrete_geral', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
  ] as const;
  const visible = filterMetaTemplatesForContext(institutional, { contextId: 'PSICOLOGIA', bindings: [{ metaTemplateId: 'psych-1', contextId: 'PSICOLOGIA' }] });
  assert.deepEqual(visible.map(item => item.id), ['psych-1']);
  assert.equal(institutional.length, 3);
  assert.equal(buildMetaTemplateCollisionChecks([...institutional, { id: 'hidden', name: 'psicologia_lembrete_vespera_online', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }], ['psicologia_lembrete_vespera_online'])[0].collision, true);
});

test('capability Maps é separada, persiste e acompanha o local canônico atual', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repository = createLocalPublicBookingRepository({ storage, now: () => syntheticNow });
  const defaults = createDefaultPublicBookingSettings(syntheticNow);
  const [locationA, locationB] = defaults.locations;
  const configured = await repository.updateSettings({ locations: [
    { ...locationA, fullAddress: 'Endereço sintético A, 100', googleMapsUrl: 'https://maps.google.com/?q=local-sintetico-a' },
    { ...locationB, fullAddress: 'Endereço sintético B, 200', googleMapsUrl: 'https://maps.google.com/?q=local-sintetico-b' },
  ] });
  const configuredLocationA = configured.locations[0];
  const configuredLocationB = configured.locations[1];
  const slots = await repository.listPublishedSlots({ professionalSlug: defaults.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: configuredLocationA.id, fromDate: '2026-08-20', throughDate: '2026-08-20', now: syntheticNow });
  assert.ok(slots.length > 0);
  const created = await repository.createBooking({ professionalSlug: defaults.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: configuredLocationA.id, date: slots[0].date, time: slots[0].time, name: 'Paciente Sintético R2F3A', dateOfBirth: '1990-01-01', phone: '5511999998888', email: 'r2f3a.sintetico@example.invalid', source: 'site' }, syntheticNow);
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  assert.ok(created.mapsNavigationRef);
  assert.notEqual(created.mapsNavigationRef, created.managementToken);
  assert.equal(created.mapsNavigationUrl?.includes('/maps/'), true);
  const first = await repository.getMapsNavigationDestination(created.mapsNavigationRef!, syntheticNow);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.destinationUrl, 'https://maps.google.com/?q=local-sintetico-a');

  await repository.updateSettings({ locations: [
    { ...configuredLocationA, fullAddress: 'Endereço sintético A atualizado, 101', googleMapsUrl: 'https://maps.google.com/?q=local-sintetico-a-atualizado', active: false },
    { ...configuredLocationB, fullAddress: 'Endereço sintético B, 200', googleMapsUrl: 'https://maps.google.com/?q=local-sintetico-b' },
  ] });
  const current = await repository.getMapsNavigationDestination(created.mapsNavigationRef!, syntheticNow);
  assert.equal(current.ok, true);
  if (!current.ok) return;
  assert.equal(current.destinationUrl, 'https://maps.google.com/?q=local-sintetico-a-atualizado');
  assert.equal(current.locationAddress, 'Endereço sintético A atualizado, 101');
  assert.equal((await repository.getAppointmentByManagementToken(created.managementToken, syntheticNow))?.locationAddress, 'Endereço sintético A atualizado, 101');
  assert.equal((await repository.getMapsNavigationDestination(created.managementToken, syntheticNow)).ok, false);

  const onlineSlots = await repository.listPublishedSlots({ professionalSlug: defaults.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-21', throughDate: '2026-08-21', now: syntheticNow });
  const online = await repository.createBooking({ professionalSlug: defaults.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: onlineSlots[0].date, time: onlineSlots[0].time, name: 'Paciente Online Sintético', dateOfBirth: '1990-01-01', phone: '5511999997777', email: 'r2f3a.online@example.invalid', source: 'site' }, syntheticNow);
  assert.equal('conflict' in online, false);
  if ('conflict' in online) return;
  assert.equal(online.appointment.locationId, undefined);
  assert.equal(online.mapsNavigationRef, undefined);

  await repository.updateSettings({ locations: [
    { ...configuredLocationA, fullAddress: 'Endereço sintético A atualizado, 101', googleMapsUrl: 'https://evil.example/redirect?to=https://maps.google.com', active: true },
    { ...configuredLocationB, fullAddress: 'Endereço sintético B, 200', googleMapsUrl: 'https://maps.google.com/?q=local-sintetico-b' },
  ] });
  const unsafe = await repository.getMapsNavigationDestination(created.mapsNavigationRef!, syntheticNow);
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.code, 'invalid');
  const cancelled = await repository.cancelByManagementToken(created.managementToken, syntheticNow);
  assert.equal(cancelled.ok, true);
  assert.equal((await repository.getMapsNavigationDestination(created.mapsNavigationRef!, syntheticNow)).ok, false);
});

test('candidate e rota pública permanecem preparados sem liberar submissão Meta', () => {
  const candidate = buildSubmissionCandidate({ id: 'local-presencial', technicalName: 'psicologia_lembrete_vespera_presencial', language: 'pt_BR', requestedCategory: 'UTILITY', draftVersion: 2, contentHash: 'a'.repeat(64), preflightStatus: 'READY', metaNameCollisionStatus: 'NO_COLLISION', publicRouteStatus: 'DEPLOYMENT_PENDING', contextBindingStatus: 'BOUND_LOCAL' }, true);
  assert.equal(candidate.payloadDryRunValidated, true);
  assert.equal(candidate.submissionState, 'DEPLOYMENT_GATE_PENDING');
  assert.match(readFileSync('src/main.tsx', 'utf8'), /MapsNavigationPage/);
  assert.match(readFileSync('vite.config.ts', 'utf8'), /no-store/);
});

test('prontidão do local para lembrete exige endereço e Google Maps válidos sem bloquear cadastro', () => {
  assert.equal(isLocationReadyForReminder({ displayName: 'Local sintético', fullAddress: 'Rua Sintética, 10', googleMapsUrl: 'https://maps.google.com/?q=sintetico' }), true);
  assert.equal(isLocationReadyForReminder({ displayName: 'Local sintético', fullAddress: '', googleMapsUrl: '' }), false);
  assert.equal(LOCATION_REMINDER_INCOMPLETE_MESSAGE, 'Complete o endereço e o Google Maps para utilizar este local nos lembretes.');
});

test('repository local de preview falha fechado quando consultado em outro storage/dispositivo', async () => {
  const professionalStorage = createMemoryOnlineBookingStorage();
  const otherDeviceStorage = createMemoryOnlineBookingStorage();
  const professionalRepository = createLocalPublicBookingRepository({ storage: professionalStorage, now: () => syntheticNow });
  const otherDeviceRepository = createLocalPublicBookingRepository({ storage: otherDeviceStorage, now: () => syntheticNow });
  const settings = await professionalRepository.getSettings();
  const slots = await professionalRepository.listPublishedSlots({ professionalSlug: settings!.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: settings!.locations[0].id, fromDate: '2026-08-20', throughDate: '2026-08-20', now: syntheticNow });
  const booking = await professionalRepository.createBooking({ professionalSlug: settings!.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: settings!.locations[0].id, date: slots[0].date, time: slots[0].time, name: 'Paciente Cross Device Sintético', dateOfBirth: '1990-01-01', phone: '5511999966666', email: 'cross-device@example.invalid', source: 'site' }, syntheticNow);
  assert.equal('conflict' in booking, false);
  if ('conflict' in booking) return;
  assert.equal((await otherDeviceRepository.getMapsNavigationDestination(booking.mapsNavigationRef!, syntheticNow)).ok, false);
  assert.equal(await otherDeviceRepository.getAppointmentByManagementToken(booking.managementToken, syntheticNow), null);
});
