import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultPublicBookingSettings,
  createPublicBookingException,
  getPublicBookingAgendaMarker,
  getPublishedSlots,
} from '../src/features/psychology-online-booking/bookingDomain';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
  upsertPsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  PSYCHOLOGY_AGENDA_DAYPART_DEFAULTS,
  getPsychologyAgendaDaypart,
  normalizePsychologySettings,
} from '../src/features/psychology-pilot/psychologyR2a';
import { createLocalPublicBookingRepository, createMemoryOnlineBookingStorage } from '../src/features/psychology-online-booking/repository';

const now = new Date(2026, 7, 16, 9, 0, 0);
const date = '2026-08-18';

test('dayparts operacionais são administrativos, normalizados e reutilizáveis', () => {
  const settings = normalizePsychologySettings({ agenda: { dayParts: { morningStart: '07:30', morningEnd: '11:30', afternoonStart: '13:00', afternoonEnd: '17:00', eveningStart: '18:00', eveningEnd: '22:00' } } }, createPsychologyScope('professional-a'));
  assert.deepEqual(getPsychologyAgendaDaypart(settings.agenda, 'morning'), { startTime: '07:30', endTime: '11:30' });
  assert.deepEqual(getPsychologyAgendaDaypart(settings.agenda, 'evening'), { startTime: '18:00', endTime: '22:00' });
  const fallback = normalizePsychologySettings({ agenda: { dayParts: { morningStart: '18:00', morningEnd: '08:00' } } }, createPsychologyScope('professional-a'));
  assert.deepEqual(fallback.agenda.dayParts, PSYCHOLOGY_AGENDA_DAYPART_DEFAULTS);
});

test('marcador público distingue bloqueio parcial, dia inteiro e liberação extra', () => {
  const base = createDefaultPublicBookingSettings(now);
  const partial = createPublicBookingException({ professionalId: base.professionalId, civilDate: date, type: 'BLOCK_PERIOD', startTime: '10:00', endTime: '12:00', now });
  const day = createPublicBookingException({ professionalId: base.professionalId, civilDate: '2026-08-19', type: 'BLOCK_DAY', now });
  const open = createPublicBookingException({ professionalId: base.professionalId, civilDate: '2026-08-22', type: 'OPEN_PERIOD', startTime: '09:00', endTime: '12:00', now });
  const settings = { ...base, publicBookingExceptions: [partial, day, open] };
  assert.equal(getPublicBookingAgendaMarker(settings, date, '10:00', '10:50').kind, 'BLOCK_PERIOD');
  assert.equal(getPublicBookingAgendaMarker(settings, date, '12:00', '12:50').kind, 'NONE');
  assert.equal(getPublicBookingAgendaMarker(settings, '2026-08-19', '16:00', '16:50').kind, 'BLOCK_DAY');
  assert.equal(getPublicBookingAgendaMarker(settings, '2026-08-22', '09:00', '09:50').kind, 'OPEN_PERIOD');
});

test('bloqueio rápido impede somente novos slots públicos', () => {
  const base = createDefaultPublicBookingSettings(now);
  const blocked = { ...base, publicBookingExceptions: [createPublicBookingException({ professionalId: base.professionalId, civilDate: date, type: 'BLOCK_PERIOD', startTime: '10:00', endTime: '12:00', now })] };
  const slots = getPublishedSlots({ settings: blocked, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: date, throughDate: date, now });
  assert.equal(slots.some(slot => slot.time === '10:00'), false);
  assert.equal(slots.some(slot => slot.time === '12:00'), true);
});

test('Session e Agenda Pessoal continuam vencendo liberação pública', () => {
  const base = createDefaultPublicBookingSettings(now);
  const saturday = '2026-08-22';
  const settings = { ...base, publicBookingExceptions: [createPublicBookingException({ professionalId: base.professionalId, civilDate: saturday, type: 'OPEN_PERIOD', startTime: '09:00', endTime: '12:00', now })] };
  const sessionBlocked = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: saturday, throughDate: saturday, now, existingBlocks: [{ date: saturday, startTime: '09:00', durationMinutes: 50, source: 'session' }] });
  const personalBlocked = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: saturday, throughDate: saturday, now, existingBlocks: [{ date: saturday, startTime: '09:00', durationMinutes: 50, source: 'personal' }] });
  assert.equal(sessionBlocked.some(slot => slot.time === '09:00'), false);
  assert.equal(personalBlocked.some(slot => slot.time === '09:00'), false);
});

test('agendamento manual continua permitido quando o slot está bloqueado online', () => {
  const scope = createPsychologyScope('professional-a');
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, { name: 'Paciente sintético', birthDate: '1990-01-01', phone: '27999990000', email: '', preferredModality: 'online', administrativeNote: '', active: true }, 'patient-a');
  store = upsertPsychologySession(store, { patientId: 'patient-a', date, time: '10:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-a');
  assert.equal(store.sessions.some(session => session.id === 'session-a' && session.date === date && session.time === '10:00'), true);
});

test('exceção pública não contém paciente, clínico, financeiro ou WhatsApp', () => {
  const exception = createPublicBookingException({ professionalId: 'professional-a', civilDate: date, type: 'BLOCK_DAY', now });
  for (const forbidden of ['patientId', 'sessionId', 'clinicalNotes', 'finance', 'whatsapp', 'phone']) assert.equal(Object.hasOwn(exception, forbidden), false);
  assert.equal(exception.type, 'BLOCK_DAY');
});

test('auditoria R2E1G: bloqueio, dia inteiro e OPEN_PERIOD persistem após refresh local', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const firstRepository = createLocalPublicBookingRepository({ storage, now: () => new Date(now) });
  const base = await firstRepository.getSettings();
  assert.ok(base);
  if (!base) return;
  const blocked = createPublicBookingException({ professionalId: base.professionalId, civilDate: date, type: 'BLOCK_PERIOD', startTime: '13:00', endTime: '16:30', now });
  await firstRepository.updateSettings({ publicBookingExceptions: [blocked] });

  const refreshedRepository = createLocalPublicBookingRepository({ storage, now: () => new Date(now) });
  const refreshed = await refreshedRepository.getSettings();
  assert.equal(refreshed?.publicBookingExceptions[0]?.type, 'BLOCK_PERIOD');
  assert.deepEqual({ civilDate: refreshed?.publicBookingExceptions[0]?.civilDate, startTime: refreshed?.publicBookingExceptions[0]?.startTime, endTime: refreshed?.publicBookingExceptions[0]?.endTime }, { civilDate: date, startTime: '13:00', endTime: '16:30' });
  const blockedSlots = await refreshedRepository.listPublishedSlots({ professionalSlug: base.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: date, throughDate: date });
  assert.equal(blockedSlots.some(slot => slot.time === '13:00' || slot.time === '14:00' || slot.time === '15:00' || slot.time === '16:00'), false);
  assert.equal(blockedSlots.some(slot => slot.time === '10:00'), true);

  const dayBlocked = createPublicBookingException({ professionalId: base.professionalId, civilDate: '2026-08-19', type: 'BLOCK_DAY', now });
  const open = createPublicBookingException({ professionalId: base.professionalId, civilDate: '2026-08-22', type: 'OPEN_PERIOD', startTime: '09:00', endTime: '12:00', now });
  await refreshedRepository.updateSettings({ publicBookingExceptions: [blocked, dayBlocked, open] });
  const afterSecondRefresh = createLocalPublicBookingRepository({ storage, now: () => new Date(now) });
  const daySlots = await afterSecondRefresh.listPublishedSlots({ professionalSlug: base.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-19', throughDate: '2026-08-19' });
  const openSlots = await afterSecondRefresh.listPublishedSlots({ professionalSlug: base.professionalSlug, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: '2026-08-22', throughDate: '2026-08-22' });
  assert.equal(daySlots.length, 0);
  assert.deepEqual(openSlots.map(slot => slot.time), ['09:00', '09:30', '10:00', '10:30', '11:00']);

  await afterSecondRefresh.updateSettings({ publicBookingExceptions: [] });
  const restored = await createLocalPublicBookingRepository({ storage, now: () => new Date(now) }).getSettings();
  assert.deepEqual(restored?.publicBookingExceptions, []);
});
