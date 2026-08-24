import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOCAL_ONLINE_BOOKING_STORAGE_KEY } from '../src/features/psychology-online-booking/bookingDomain';
import { createLocalPublicBookingRepository, createMemoryOnlineBookingStorage } from '../src/features/psychology-online-booking/repository';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  normalizePsychologyStore,
  parsePsychologyStore,
  serializePsychologyStore,
  upsertPsychologyPatient,
  upsertPsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';
import { LOCAL_PSYCHOLOGY_PROFESSIONAL_ID, LOCAL_PSYCHOLOGY_STORAGE_KEY } from '../src/features/psychology-pilot/psychologyDomain';

const now = new Date(2026, 7, 16, 9, 0, 0);

function repositoryWithNow(storage = createMemoryOnlineBookingStorage()) {
  return createLocalPublicBookingRepository({ storage, now: () => new Date(now) });
}

test('agendamento online persiste PATIENT_SELF_BOOKING, separa source channel e sobrevive ao reload', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repo = repositoryWithNow(storage);
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: '2026-08-20', time: '15:00', name: 'Origem Paciente Sintética', dateOfBirth: '1990-01-01', phone: '27999993333', email: 'origem.paciente@example.test', source: 'google' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;

  const state = JSON.parse(storage.getItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY) || '{}') as { appointments: Array<Record<string, unknown>> };
  const appointment = state.appointments.find(item => item.id === created.appointment.id);
  assert.equal(appointment?.bookingOrigin, 'PATIENT_SELF_BOOKING');
  assert.equal(appointment?.source, 'google');

  const canonical = parsePsychologyStore(storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  assert.equal(canonical.sessions.find(item => item.id === created.appointment.sessionId)?.bookingOrigin, 'PATIENT_SELF_BOOKING');
  assert.equal(canonical.charges.length, 0);
  assert.equal(canonical.payments.length, 0);
  assert.equal(canonical.expenses.length, 0);

  const reloaded = repositoryWithNow(storage);
  assert.equal((await reloaded.getAppointmentByManagementToken(created.managementToken))?.appointmentStatus, 'SCHEDULED');
  const persistedAgain = JSON.parse(storage.getItem(LOCAL_ONLINE_BOOKING_STORAGE_KEY) || '{}') as { appointments: Array<Record<string, unknown>> };
  assert.equal(persistedAgain.appointments.find(item => item.id === created.appointment.id)?.bookingOrigin, 'PATIENT_SELF_BOOKING');
});

test('agendamento manual novo recebe PROFESSIONAL e edição/status não mudam a origem', () => {
  const scope = createPsychologyScope('professional-origin-test');
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, { name: 'Paciente Manual Sintético', birthDate: '', phone: '27999994444', email: '', preferredModality: 'online', administrativeNote: '', active: true }, 'patient-manual-origin');
  store = upsertPsychologySession(store, { patientId: 'patient-manual-origin', date: '2026-08-20', time: '10:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-manual-origin');
  assert.equal(store.sessions[0]?.bookingOrigin, 'PROFESSIONAL');

  store = upsertPsychologySession(store, { patientId: 'patient-manual-origin', date: '2026-08-21', time: '11:00', durationMinutes: 60, modality: 'online', administrativeNote: 'Edição administrativa sintética' }, 'session-manual-origin');
  assert.deepEqual({ date: store.sessions[0]?.date, time: store.sessions[0]?.time, status: store.sessions[0]?.status, bookingOrigin: store.sessions[0]?.bookingOrigin }, { date: '2026-08-21', time: '11:00', status: 'agendada', bookingOrigin: 'PROFESSIONAL' });
});

test('registro legacy sem evidência permanece sem origem após refresh e edição', () => {
  const scope = createPsychologyScope('professional-legacy-test');
  let source = createEmptyPsychologyStore(scope);
  source = upsertPsychologyPatient(source, { name: 'Paciente Legacy Sintético', birthDate: '', phone: '27999995555', email: '', preferredModality: 'online', administrativeNote: '', active: true }, 'patient-legacy-origin');
  source = upsertPsychologySession(source, { patientId: 'patient-legacy-origin', date: '2026-08-20', time: '12:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-legacy-origin');
  const legacy = JSON.parse(serializePsychologyStore(source)) as { sessions: Array<Record<string, unknown>> };
  delete legacy.sessions[0].bookingOrigin;
  const normalized = normalizePsychologyStore(legacy, scope);
  assert.equal(normalized.sessions[0]?.bookingOrigin, undefined);
  const edited = upsertPsychologySession(normalized, { patientId: 'patient-legacy-origin', date: '2026-08-21', time: '13:00', durationMinutes: 50, modality: 'online', administrativeNote: 'Edição legacy' }, 'session-legacy-origin');
  assert.equal(edited.sessions[0]?.bookingOrigin, undefined);
});

test('Agenda traduz a origem canônica sem transformá-la em status', async () => {
  const root = resolve(process.cwd());
  const agenda = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(agenda, /sessionBookingOriginLabel/);
  assert.match(agenda, /PATIENT_SELF_BOOKING/);
  assert.match(agenda, /PROFESSIONAL/);
  assert.match(agenda, /Agendado pelo Paciente/);
  assert.match(agenda, /Agendada/);
  assert.match(agenda, /data-agenda-booking-origin/);
  assert.match(agenda, /bookingOrigin \|\| 'UNKNOWN'/);
  assert.doesNotMatch(agenda, /bookingOrigin.*SessionStatus/);
});
