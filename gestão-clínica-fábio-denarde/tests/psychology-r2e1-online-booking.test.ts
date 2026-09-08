import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysToDateKey,
  buildAppointmentMessagingContext,
  createDefaultPublicBookingSettings,
  getAppointmentManagementUrl,
  getPublishedSlots,
  hashManagementToken,
  isValidGoogleMapsUrl,
  LOCAL_ONLINE_BOOKING_STORAGE_KEY,
  normalizeProfessionalSlug,
  normalizeSourceChannel,
} from '../src/features/psychology-online-booking/bookingDomain';
import { createLocalPublicBookingRepository, createMemoryOnlineBookingStorage } from '../src/features/psychology-online-booking/repository';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  parsePsychologyStore,
  serializePsychologyStore,
  upsertPsychologyPersonalCommitment,
} from '../src/features/psychology-pilot/psychologyDomain';
import { LOCAL_PSYCHOLOGY_PROFESSIONAL_ID, LOCAL_PSYCHOLOGY_STORAGE_KEY } from '../src/features/psychology-pilot/psychologyDomain';
import type { PublicBookingException, PublicBookingExceptionType } from '../src/features/psychology-online-booking/types';

const now = new Date(2026, 7, 16, 9, 0, 0);
const day = addDaysToDateKey('2026-08-16', 2);

function repositoryWithNow(storage = createMemoryOnlineBookingStorage()) {
  return createLocalPublicBookingRepository({ storage, now: () => new Date(now) });
}

function exception(type: PublicBookingExceptionType, civilDate: string, startTime?: string, endTime?: string, extra: Partial<PublicBookingException> = {}): PublicBookingException {
  return {
    id: `${type.toLocaleLowerCase()}-${civilDate}-${startTime || 'day'}`,
    professionalId: 'psychology-local-professional',
    civilDate,
    type,
    startTime,
    endTime,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra,
  };
}

test('normaliza slug e canais sem aceitar valores arbitrários', () => {
  assert.equal(normalizeProfessionalSlug('Leila Chaves'), 'leila-chaves');
  assert.equal(normalizeSourceChannel('google'), 'google');
  assert.equal(normalizeSourceChannel('WEBHOOK_DESCONHECIDO'), 'direct');
});

test('publica cinco serviços e dois locais fictícios editáveis', () => {
  const settings = createDefaultPublicBookingSettings(now);
  assert.deepEqual(settings.publishedServices.map(item => item.name), ['Psicoterapia Individual', 'Terapia de Casal', 'Mentoria', 'Teste de Eneagrama', 'Psicoterapia Adolescente']);
  assert.deepEqual(settings.locations.map(item => ({ name: item.displayName, city: item.city, state: item.state })), [
    { name: 'Shopping Moxuara', city: 'Cariacica', state: 'ES' },
    { name: 'SPAC — Centro de Saúde e Movimento', city: 'Vila Velha', state: 'ES' },
  ]);
  assert.equal(settings.locations.every(item => item.fullAddress === '' && item.googleMapsUrl === ''), true);
  assert.equal(isValidGoogleMapsUrl('https://maps.google.com/?q=Shopping+Moxuara'), true);
  assert.equal(isValidGoogleMapsUrl('http://example.com/mapa'), false);
});

test('presencial exige locationId canônico e online não exige local', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const withoutLocation = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', date: day, time: '10:00', name: 'Sem Local', dateOfBirth: '1990-01-01', phone: '27999990001', email: 'sem.local@example.test' });
  assert.equal('conflict' in withoutLocation, true);
  const online = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '10:00', name: 'Online Sem Local', dateOfBirth: '1990-01-01', phone: '27999990002', email: 'online.sem.local@example.test' });
  assert.equal('conflict' in online, false);
  if (!('conflict' in online)) assert.equal(online.appointment.locationId, undefined);
});

test('resolve endereço e Google Maps do repository de locais nas leituras posteriores', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  await repo.updateSettings({ locations: (await repo.getSettings())!.locations.map((location, index) => index === 0 ? { ...location, fullAddress: 'Endereço sintético, 100 — Cariacica/ES', googleMapsUrl: 'https://maps.google.com/?q=Shopping+Moxuara' } : location) });
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: 'psychology-location-primary-office', date: day, time: '11:00', name: 'Presencial Sintético', dateOfBirth: '1990-01-01', phone: '27999990003', email: 'presencial@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  const first = await repo.getAppointmentByManagementToken(created.managementToken);
  assert.equal(first?.locationName, 'Shopping Moxuara');
  assert.equal(first?.locationAddress, 'Endereço sintético, 100 — Cariacica/ES');
  assert.equal(first?.googleMapsUrl, 'https://maps.google.com/?q=Shopping+Moxuara');
  const updatedSettings = (await repo.getSettings())!;
  await repo.updateSettings({ locations: updatedSettings.locations.map(location => location.id === 'psychology-location-primary-office' ? { ...location, fullAddress: 'Endereço sintético atualizado, 200 — Cariacica/ES', googleMapsUrl: 'https://www.google.com/maps?q=Shopping+Moxuara' } : location) });
  const later = await repo.getAppointmentByManagementToken(created.managementToken);
  assert.equal(later?.locationAddress, 'Endereço sintético atualizado, 200 — Cariacica/ES');
  assert.equal(later?.googleMapsUrl, 'https://www.google.com/maps?q=Shopping+Moxuara');
  assert.match(later?.mapsNavigationUrl || '', /^\/maps\/maps_/);
  assert.equal(Object.hasOwn(later || {}, 'patientId'), false);
  assert.equal(Object.hasOwn(later || {}, 'clinicalNotes'), false);
  assert.equal(Object.hasOwn(later || {}, 'finance'), false);
  const messagingContext = buildAppointmentMessagingContext(later!);
  assert.deepEqual(messagingContext, {
    appointmentModality: 'PRESENCIAL',
    professionalDisplayName: 'Leila Chaves',
    date: day,
    time: '11:00',
    locationDisplayName: 'Shopping Moxuara',
    locationFullAddress: 'Endereço sintético atualizado, 200 — Cariacica/ES',
    locationGoogleMapsUrl: 'https://www.google.com/maps?q=Shopping+Moxuara',
    mapsNavigationUrl: later?.mapsNavigationUrl,
  });
});

test('separa weeklyAvailability de publicBookingAvailability', () => {
  const settings = createDefaultPublicBookingSettings(now);
  const slots = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day, now });
  assert.deepEqual(slots.map(item => item.time), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  assert.ok(slots.every(item => item.endTime <= '17:00'));
});

test('bloqueia um dia inteiro sem alterar a programação habitual', () => {
  const settings = createDefaultPublicBookingSettings(now);
  const before = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day, now });
  const blocked = { ...settings, publicBookingExceptions: [exception('BLOCK_DAY', day)] };
  const after = getPublishedSlots({ settings: blocked, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day, now });
  assert.ok(before.length > 0);
  assert.equal(after.length, 0);
  assert.equal(settings.publicBookingAvailability.find(item => item.dayOfWeek === 2)?.enabled, true);
});

test('bloqueia somente o período indicado e preserva os demais horários', () => {
  const settings = { ...createDefaultPublicBookingSettings(now), publicBookingExceptions: [exception('BLOCK_PERIOD', day, '15:00', '17:00')] };
  const slots = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day, now });
  assert.equal(slots.some(item => item.time === '14:00'), true);
  assert.equal(slots.some(item => item.time === '15:00'), false);
  assert.equal(slots.some(item => item.time === '16:00'), false);
});

test('libera horário extra em sábado fechado, respeitando duração e intervalo', () => {
  const saturday = '2026-08-22';
  const settings = { ...createDefaultPublicBookingSettings(now), publicBookingExceptions: [exception('OPEN_PERIOD', saturday, '09:00', '12:00')] };
  const slots = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: saturday, throughDate: saturday, now });
  assert.deepEqual(slots.map(item => item.time), ['09:00', '10:00', '11:00']);
});

test('programação extra continua sujeita à antecedência mínima e máxima', () => {
  const settings = {
    ...createDefaultPublicBookingSettings(now),
    minNoticeHours: 48,
    maxAdvanceDays: 5,
    publicBookingExceptions: [
      exception('OPEN_PERIOD', '2026-08-17', '10:00', '12:00'),
      exception('OPEN_PERIOD', '2026-08-24', '10:00', '12:00'),
    ],
  };
  const tooSoon = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-17', throughDate: '2026-08-17', now });
  const tooFar = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-24', throughDate: '2026-08-24', now });
  assert.equal(tooSoon.length, 0);
  assert.equal(tooFar.length, 0);
});

test('exceção pode ser restrita por modalidade e local', () => {
  const settings = {
    ...createDefaultPublicBookingSettings(now),
    publicBookingExceptions: [exception('BLOCK_PERIOD', day, '10:00', '12:00', { modality: 'PRESENCIAL', locationId: 'psychology-location-primary-office' })],
  };
  const online = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day, now });
  const primary = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: 'psychology-location-primary-office', fromDate: day, throughDate: day, now });
  const external = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: 'psychology-location-external-office', fromDate: day, throughDate: day, now });
  assert.equal(online.some(item => item.time === '10:00'), true);
  assert.equal(primary.some(item => item.time === '10:00'), false);
  assert.equal(external.some(item => item.time === '10:00'), true);
});

test('usar programação habitual remove apenas as exceções da data', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const settings = await repo.updateSettings({ publicBookingExceptions: [exception('BLOCK_DAY', day)] });
  assert.equal((await repo.listPublishedSlots({ professionalSlug: settings.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day })).length, 0);
  const restored = await repo.updateSettings({ publicBookingExceptions: settings.publicBookingExceptions.filter(item => item.civilDate !== day) });
  const slots = await repo.listPublishedSlots({ professionalSlug: restored.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day });
  assert.deepEqual(slots.map(item => item.time), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('bloqueio de data não cancela nem move sessão existente e mantém o slot ocupado', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '15:00', name: 'Sessão Protegida', dateOfBirth: '1990-01-01', phone: '27999990111', email: 'sessao.protegida@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  const before = parsePsychologyStore(storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  await repo.updateSettings({ publicBookingExceptions: [exception('BLOCK_PERIOD', day, '14:00', '17:00')] });
  const after = parsePsychologyStore(storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  const session = after.sessions.find(item => item.id === created.appointment.sessionId);
  const original = before.sessions.find(item => item.id === created.appointment.sessionId);
  assert.deepEqual({ date: session?.date, time: session?.time, status: session?.status }, { date: original?.date, time: original?.time, status: original?.status });
  const slots = await repo.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day });
  assert.equal(slots.some(item => item.time === '15:00'), false);
  assert.equal((await repo.getAppointmentByManagementToken(created.managementToken))?.appointmentStatus, 'SCHEDULED');
});

test('horário extra respeita compromisso da Agenda Pessoal e não cria dupla reserva', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const localStore = upsertPsychologyPersonalCommitment(createEmptyPsychologyStore(createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID)), { date: '2026-08-22', time: '09:00', durationMinutes: 50, type: 'Bloqueio de horário', title: 'Compromisso protegido', note: '', recurrence: 'Não repetir', alarmEnabled: false, isDone: false });
  storage.setItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`, serializePsychologyStore(localStore));
  const repo = repositoryWithNow(storage);
  await repo.updateSettings({ publicBookingExceptions: [exception('OPEN_PERIOD', '2026-08-22', '09:00', '12:00')] });
  const slots = await repo.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-22', throughDate: '2026-08-22' });
  assert.equal(slots.some(item => item.time === '09:00'), false);
  assert.equal(slots.some(item => item.time === '10:00'), true);
  const savedStore = parsePsychologyStore(storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  assert.equal(savedStore.personalCommitments.some(item => item.title === 'Compromisso protegido'), true);
});

test('respeita antecedência mínima e máxima', () => {
  const settings = createDefaultPublicBookingSettings(now);
  const tooSoon = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-16', throughDate: '2026-08-16', now });
  const tooFar = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-09-20', throughDate: '2026-09-20', now });
  assert.equal(tooSoon.length, 0);
  assert.equal(tooFar.length, 0);
});

test('filtra modalidade e local publicado', () => {
  const settings = createDefaultPublicBookingSettings(now);
  const online = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day, now });
  const inPerson = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: 'psychology-location-primary-office', fromDate: day, throughDate: day, now });
  const wrongLocation = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: 'unknown', fromDate: day, throughDate: day, now });
  assert.equal(online[0].modality, 'ONLINE');
  assert.equal(inPerson[0].locationId, 'psychology-location-primary-office');
  assert.equal(wrongLocation.length, 0);
});

test('subtrai compromisso pessoal local da disponibilidade pública', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const localStore = upsertPsychologyPersonalCommitment(createEmptyPsychologyStore(createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID)), { date: day, time: '10:00', durationMinutes: 50, type: 'Bloqueio de horário', title: 'Bloqueio sintético', note: '', recurrence: 'Não repetir', alarmEnabled: false, isDone: false });
  storage.setItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`, serializePsychologyStore(localStore));
  const slots = await repositoryWithNow(storage).listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day });
  assert.equal(slots.some(item => item.time === '10:00'), false);
  assert.equal(slots.some(item => item.time === '11:00'), true);
});

test('cria paciente e sessão canônicos locais sem paciente ou sessão remotos', async () => {
  const repo = repositoryWithNow();
  const result = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '10:00', name: 'Paciente Sintético R2E1', dateOfBirth: '1990-01-01', phone: '(27) 99999-1111', email: 'sintetico.r2e1@example.test', source: 'site' });
  assert.equal('conflict' in result, false);
  if ('conflict' in result) return;
  assert.ok(result.appointment.patientId);
  assert.ok(result.appointment.sessionId);
  assert.equal(result.appointment.source, 'site');
});

test('impede dupla reserva no mesmo horário', async () => {
  const repo = repositoryWithNow();
  const input = { professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE' as const, date: day, time: '11:00', name: 'Primeiro Sintético', dateOfBirth: '1990-01-01', phone: '27999991111', email: 'primeiro@example.test' };
  const first = await repo.createBooking(input);
  const second = await repo.createBooking({ ...input, name: 'Segundo Sintético', phone: '27999992222', email: 'segundo@example.test' });
  assert.equal('conflict' in first, false);
  assert.equal('conflict' in second, true);
});

test('armazena somente hash SHA-256 e cria URL privada com token bruto fora do storage', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const result = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '12:00', name: 'Token Sintético', dateOfBirth: '1990-01-01', phone: '27999993333', email: 'token@example.test' });
  assert.equal('conflict' in result, false);
  if ('conflict' in result) return;
  const raw = storage.values['gestao-clinica:psychology-r2e1:online-booking:v1'] || '';
  assert.equal(raw.includes(result.managementToken), false);
  assert.equal(raw.includes(await hashManagementToken(result.managementToken)), true);
  assert.equal(new URL(result.managementUrl, 'http://localhost:3000').pathname.startsWith('/consulta/'), true);
  assert.notEqual(result.managementUrl, `/agendar/leila-chaves`);
});

test('confirmar é idempotente e não expõe dados clínicos/financeiros', async () => {
  const repo = repositoryWithNow();
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '13:00', name: 'Confirmação Sintética', dateOfBirth: '1990-01-01', phone: '27999994444', email: 'confirmacao@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  const first = await repo.confirmByManagementToken(created.managementToken);
  const second = await repo.confirmByManagementToken(created.managementToken);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.equal(Object.hasOwn(first.summary, 'patientId'), false);
});

test('cancelamento respeita cutoff e é idempotente quando já cancelado', async () => {
  const storage = createMemoryOnlineBookingStorage();
  let clock = new Date(2026, 7, 16, 9, 0, 0);
  const repo = createLocalPublicBookingRepository({ storage, now: () => new Date(clock) });
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '14:00', name: 'Cancelamento Sintético', dateOfBirth: '1990-01-01', phone: '27999995555', email: 'cancelamento@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  clock = new Date(2026, 7, 17, 23, 0, 0);
  const cutoff = await repo.cancelByManagementToken(created.managementToken);
  assert.equal(cutoff.ok, false);
  clock = new Date(2026, 7, 16, 10, 0, 0);
  const cancelled = await repo.cancelByManagementToken(created.managementToken);
  assert.equal(cancelled.ok, true);
  assert.equal((await repo.cancelByManagementToken(created.managementToken)).ok, false);
});

test('Solicitar reagendamento abre URL segura, mantém consulta e slot intactos', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '15:00', name: 'Reagendamento Sintético', dateOfBirth: '1990-01-01', phone: '27999996666', email: 'reagendamento@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  const request = await repo.requestRescheduleByManagementToken(created.managementToken);
  assert.equal(request.ok, true);
  if (!request.ok) return;
  assert.equal(request.messagingContext.appointmentModality, 'ONLINE');
  assert.equal('locationFullAddress' in request.messagingContext, false);
  assert.equal(new URL(request.whatsappUrl).hostname, 'wa.me');
  assert.match(new URL(request.whatsappUrl).searchParams.get('text') || '', /Leila Chaves/);
  const current = await repo.getAppointmentByManagementToken(created.managementToken);
  assert.deepEqual({ date: current?.date, time: current?.time }, { date: day, time: '15:00' });
  const slots = await repositoryWithNow(storage).listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: day, throughDate: day });
  assert.equal(slots.some(item => item.time === '15:00'), false);
});

test('mensagem de reagendamento é dinâmica, isolada e usa a consulta atual', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: '2026-08-20', time: '15:00', name: 'Mensagem Dinâmica Sintética', dateOfBirth: '1990-01-01', phone: '27999996667', email: 'mensagem.dinamica@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;

  const firstRequest = await repo.requestRescheduleByManagementToken(created.managementToken);
  assert.equal(firstRequest.ok, true);
  if (!firstRequest.ok) return;
  const firstText = new URL(firstRequest.whatsappUrl).searchParams.get('text') || '';
  assert.match(firstText, /Leila Chaves/);
  assert.match(firstText, /20\/08\/2026 às 15:00/);
  assert.match(firstText, /Olá, preciso reagendar meu atendimento com Leila Chaves/);
  assert.doesNotMatch(firstText, /Gostaria de verificar a possibilidade/);
  assert.match(firstText, /Poderia me informar outros horários disponíveis\?/);
  assert.doesNotMatch(firstText, /managementToken|patientId|appointmentId|workspaceId|diagnóstico|medicação|financeiro|Endereço|maps\.google/i);
  const afterFirstRequest = JSON.parse(storage.getItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY) || '{}') as { appointments: Array<Record<string, unknown>> };
  assert.deepEqual(afterFirstRequest.appointments.find(item => item.id === created.appointment.id), created.appointment);

  const state = JSON.parse(storage.getItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY) || '{}') as { appointments: Array<Record<string, unknown>> };
  const appointmentBeforeUpdate = state.appointments.find(item => item.id === created.appointment.id);
  assert.equal(appointmentBeforeUpdate?.date, '2026-08-20');
  assert.equal(appointmentBeforeUpdate?.time, '15:00');
  state.appointments = state.appointments.map(item => item.id === created.appointment.id ? { ...item, date: '2026-08-21', time: '16:30' } : item);
  storage.setItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY, JSON.stringify(state));

  const current = await repo.getAppointmentByManagementToken(created.managementToken);
  assert.deepEqual({ date: current?.date, time: current?.time, appointmentStatus: current?.appointmentStatus }, { date: '2026-08-21', time: '16:30', appointmentStatus: 'SCHEDULED' });
  const secondRequest = await repo.requestRescheduleByManagementToken(created.managementToken);
  assert.equal(secondRequest.ok, true);
  if (!secondRequest.ok) return;
  const secondText = new URL(secondRequest.whatsappUrl).searchParams.get('text') || '';
  assert.match(secondText, /Leila Chaves/);
  assert.match(secondText, /21\/08\/2026 às 16:30/);
  assert.match(secondText, /Olá, preciso reagendar meu atendimento com Leila Chaves/);
  assert.doesNotMatch(secondText, /Gostaria de verificar a possibilidade/);
  assert.match(secondText, /Poderia me informar outros horários disponíveis\?/);
  assert.doesNotMatch(secondText, /20\/08\/2026 às 15:00/);

  await repo.updateSettings({ professionalName: 'PROFISSIONAL TESTE' });
  const differentProfessionalRequest = await repo.requestRescheduleByManagementToken(created.managementToken);
  assert.equal(differentProfessionalRequest.ok, true);
  if (differentProfessionalRequest.ok) {
    const differentProfessionalText = new URL(differentProfessionalRequest.whatsappUrl).searchParams.get('text') || '';
    assert.match(differentProfessionalText, /PROFISSIONAL TESTE/);
    assert.doesNotMatch(differentProfessionalText, /Leila Chaves/);
    assert.match(differentProfessionalText, /21\/08\/2026 às 16:30/);
    assert.doesNotMatch(differentProfessionalText, /27999996667|Mensagem Dinâmica Sintética/);
  }

  const after = await repo.getAppointmentByManagementToken(created.managementToken);
  assert.deepEqual({ date: after?.date, time: after?.time, status: after?.appointmentStatus }, { date: '2026-08-21', time: '16:30', status: 'SCHEDULED' });
  const slots = await repo.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-21', throughDate: '2026-08-21' });
  assert.equal(slots.some(item => item.time === '16:30'), false);
});

test('número do WhatsApp vem da configuração administrativa de cada profissional', async () => {
  const repo = repositoryWithNow();
  await repo.updateSettings({ whatsappContactPhoneE164: '5511999998888' });
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '16:00', name: 'Contato Configurado', dateOfBirth: '1990-01-01', phone: '27999998888', email: 'contato@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  const request = await repo.requestRescheduleByManagementToken(created.managementToken);
  assert.equal(request.ok, true);
  if (request.ok) assert.equal(new URL(request.whatsappUrl).pathname, '/5511999998888');
});

test('token inválido, expirado ou revogado não cria enumeração de dados', async () => {
  const repo = repositoryWithNow();
  assert.equal(await repo.getAppointmentByManagementToken('token-invalido-que-nao-existe'), null);
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: day, time: '16:00', name: 'Revogação Sintética', dateOfBirth: '1990-01-01', phone: '27999997777', email: 'revogacao@example.test' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  await repo.cancelByManagementToken(created.managementToken);
  assert.equal(await repo.getAppointmentByManagementToken(created.managementToken), null);
});
