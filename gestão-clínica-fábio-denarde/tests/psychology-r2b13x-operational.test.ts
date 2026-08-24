import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  getPsychologyDayItems,
  upsertPsychologyPatient,
  upsertPsychologyPersonalCommitment,
  upsertPsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  createLocalPsychologyRepositories,
  createMemoryPsychologyRepositories,
  createMemoryStorage,
  createPsychologyMemoryState,
  createPsychologyPersistenceScope,
} from '../src/features/psychology-persistence';

const scope = createPsychologyPersistenceScope('professional-r2b13x', 'workspace-r2b13x');
const now = '2026-08-22T12:00:00.000Z';

function base(id: string) {
  return { id, workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: scope.context, createdAt: now, updatedAt: now } as const;
}

test('R2B13X — matriz de Patients, Sessions, Agenda Pessoal, Services, Locations e Settings usa um escopo único', async () => {
  const repositories = createMemoryPsychologyRepositories(scope, { now: () => now });
  const patient = { ...base('patient-r2b13x'), name: 'Paciente sintético operacional', birthDate: '1990-01-01', phone: '27999990001', email: 'operational@example.test', preferredModality: 'online' as const, administrativeNote: '', active: true };
  const session = { ...base('session-r2b13x'), patientId: patient.id, date: '2026-08-22', time: '09:00', durationMinutes: 50, modality: 'online' as const, status: 'agendada' as const };
  const personal = { ...base('personal-r2b13x'), date: '2026-08-22', time: '12:00', durationMinutes: 30, type: 'Compromisso pessoal' as const, note: 'sintético', recurrence: 'Não repetir' as const, alarmEnabled: false, isDone: false };
  const service = { ...base('service-r2b13x'), name: 'Serviço sintético', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH' as const, active: true };
  const location = { ...base('location-r2b13x'), type: 'PRIMARY_OFFICE' as const, displayName: 'Local sintético', address: '', active: true, isPrimary: true, color: '#6D28D9' };
  const settings = { ...base('settings'), id: 'settings' as const, settings: createEmptyPsychologyStore(createPsychologyScope(scope.professionalId)).settings };

  await repositories.patients.upsert(scope, patient);
  await repositories.sessions.upsert(scope, session);
  await repositories.personalAppointments.upsert(scope, personal);
  await repositories.services.upsert(scope, service);
  await repositories.locations.upsert(scope, location);
  await repositories.settings.upsert(scope, settings);

  assert.equal((await repositories.patients.list(scope)).length, 1);
  assert.equal((await repositories.sessions.list(scope)).length, 1);
  assert.equal((await repositories.personalAppointments.list(scope)).length, 1);
  assert.equal((await repositories.services.list(scope)).length, 1);
  assert.equal((await repositories.locations.list(scope)).length, 1);
  assert.equal((await repositories.settings.get(scope, 'settings'))?.id, 'settings');

  assert.deepEqual(await repositories.patients.delete(scope, patient.id), { id: patient.id });
  assert.deepEqual(await repositories.sessions.delete(scope, session.id), { id: session.id });
  assert.equal(await repositories.patients.get(scope, patient.id), null);
  assert.equal(await repositories.sessions.get(scope, session.id), null);
});

test('R2B13X — persistência após reload, Meu Dia consistente e falha de escopo não grava', async () => {
  const storage = createMemoryStorage();
  const local = createLocalPsychologyRepositories({ scope, storage, now: () => now });
  const patient = { ...base('patient-reload'), name: 'Paciente reload sintético', birthDate: '1990-01-01', phone: '27999990002', email: 'reload@example.test', preferredModality: 'online' as const, administrativeNote: '', active: true };
  await local.patients.upsert(scope, patient);
  const reloaded = createLocalPsychologyRepositories({ scope, storage, now: () => now });
  assert.equal((await reloaded.patients.get(scope, patient.id))?.name, patient.name);

  let store = createEmptyPsychologyStore(createPsychologyScope(scope.professionalId));
  store = upsertPsychologyPatient(store, { name: 'Meu Dia sintético', dateOfBirth: '1990-01-01', phone: '27999990003', email: 'day@example.test', preferredModality: 'online', administrativeNote: '', active: true }, 'patient-day');
  store = upsertPsychologySession(store, { patientId: 'patient-day', date: '2026-08-22', time: '09:00', durationMinutes: 50, modality: 'online', serviceId: store.services[0].id, administrativeNote: '' }, 'session-day');
  store = upsertPsychologyPersonalCommitment(store, { date: '2026-08-22', time: '12:00', durationMinutes: 30, type: 'Compromisso pessoal', title: 'Compromisso sintético', note: '', recurrence: 'Não repetir', alarmEnabled: false, alarmAdvance: 'Na hora' }, 'personal-day');
  const dayItems = getPsychologyDayItems(store, '2026-08-22');
  assert.equal(dayItems.filter(item => item.kind === 'session').length, 1);
  assert.equal(dayItems.filter(item => item.kind === 'personal').length, 1);

  const otherScope = createPsychologyPersistenceScope('professional-r2b13x-other', 'workspace-r2b13x');
  await assert.rejects(() => reloaded.patients.upsert(otherScope, patient as never), /escopo/);
  assert.equal((await reloaded.patients.list(scope)).length, 1);
});

test('R2B13X — contratos de lock e delete estão presentes nas superfícies operacionais', async () => {
  const { readFile } = await import('node:fs/promises');
  const pilot = await readFile('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  const agenda = await readFile('src/components/PersonalAgenda.tsx', 'utf8');
  const api = await readFile('src/features/psychology-persistence/repositories/api.ts', 'utf8');
  assert.match(pilot, /submitLock/);
  assert.match(pilot, /persistedMutationLocks/);
  assert.match(agenda, /mutationLocks/);
  assert.match(api, /async delete\(requestedScope, id\)/);
});
