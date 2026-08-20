import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  createEmptyPsychologyStore,
  createPsychologyLocation,
  createPsychologyScope,
  getPsychologyPersonalOccurrences,
  setPsychologyLocationActive,
  setPsychologyLocationColor,
  setPsychologyPrimaryLocation,
  toPsychologyPersonalAppointment,
  updatePsychologyLocation,
  upsertPsychologyPersonalCommitment,
  validatePsychologySession,
  type PsychologyPersonalCommitment,
} from '../src/features/psychology-pilot/psychologyDomain';
import { getNextPersonalAppointmentOccurrence } from '../src/lib/personalAgendaTemporal';
import { getAlarmTimingForNow } from '../src/lib/useAlarms';

const scope = createPsychologyScope('r2a2-professional');
const day = (value: string) => new Date(`${value}T12:00:00`);

function personal(overrides: Partial<PsychologyPersonalCommitment> = {}): PsychologyPersonalCommitment {
  return {
    id: 'personal-r2a2',
    professionalId: scope.professionalId,
    context: scope.context,
    date: '2026-09-03',
    time: '11:00',
    durationMinutes: 60,
    type: 'Compromisso pessoal',
    title: 'Rotina sintética',
    note: '',
    recurrence: 'Todo mês',
    alarmEnabled: true,
    alarmAdvance: 'Na hora',
    alarmVolume: 80,
    alarmFadeIn: false,
    isDone: false,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function personalInput(overrides: Partial<PsychologyPersonalCommitment> = {}) {
  const item = personal(overrides);
  return { date: item.date, time: item.time, durationMinutes: item.durationMinutes, type: item.type === 'Reunião' ? 'Outro' : item.type, title: item.title, note: item.note || '', recurrence: item.recurrence, alarmEnabled: item.alarmEnabled, alarmAdvance: item.alarmAdvance, alarmSound: item.alarmSound, alarmVolume: item.alarmVolume, alarmFadeIn: item.alarmFadeIn, isDone: item.isDone };
}

test('locais suportam lista extensível, endereço, cor e principal sem usar nome como ID', () => {
  let store = createEmptyPsychologyStore(scope);
  const originalId = store.locations[0].id;
  store = createPsychologyLocation(store, { displayName: 'Clínica Praia da Costa', address: 'Sala sintética', color: '#0891B2' });
  const added = store.locations.find(location => location.displayName === 'Clínica Praia da Costa');
  assert.ok(added);
  assert.notEqual(added.id, originalId);
  assert.equal(added.type, 'OTHER');
  assert.equal(added.address, 'Sala sintética');
  assert.equal(added.color, '#0891B2');
});

test('editar, desativar e definir principal preserva locationId', () => {
  let store = createEmptyPsychologyStore(scope);
  store = createPsychologyLocation(store, { displayName: 'Local Sintético' });
  const added = store.locations.find(location => location.displayName === 'Local Sintético');
  assert.ok(added);
  const stableId = added.id;
  store = updatePsychologyLocation(store, stableId, { displayName: 'Local Renomeado', address: 'Novo endereço' });
  assert.equal(store.locations.find(location => location.id === stableId)?.displayName, 'Local Renomeado');
  store = setPsychologyPrimaryLocation(store, stableId);
  assert.equal(store.locations.find(location => location.id === stableId)?.isPrimary, true);
  store = setPsychologyLocationColor(store, stableId, '#7C3AED');
  assert.equal(store.locations.find(location => location.id === stableId)?.color, '#7C3AED');
  store = setPsychologyLocationActive(store, stableId, false);
  assert.equal(store.locations.find(location => location.id === stableId)?.active, false);
  assert.equal(store.locations.find(location => location.id === stableId)?.id, stableId);
});

test('sessão presencial exige local ativo e sessão online não exige local', () => {
  let store = createEmptyPsychologyStore(scope);
  store = { ...store, patients: [{ id: 'patient', professionalId: scope.professionalId, context: scope.context, name: 'Paciente sintético', birthDate: '2000-01-01', phone: '000', preferredModality: 'presencial', active: true, createdAt: '', updatedAt: '' }] };
  const base = { patientId: 'patient', date: '2026-09-03', time: '11:00', durationMinutes: 50, modality: 'presencial' as const, administrativeNote: '' };
  assert.match(validatePsychologySession(base, store) || '', /local ativo/);
  assert.equal(validatePsychologySession({ ...base, modality: 'online' }, store), null);
  assert.equal(validatePsychologySession({ ...base, locationId: store.locations[0].id }, store), null);
});

test('Agenda Pessoal Psicologia usa o projetor compartilhado para semanal, mensal, lista e alarme', () => {
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPersonalCommitment(store, personalInput());
  const august = getPsychologyPersonalOccurrences(store, day('2026-08-31'), day('2026-09-06'));
  const september = getPsychologyPersonalOccurrences(store, day('2026-09-01'), day('2026-09-30'));
  const october = getPsychologyPersonalOccurrences(store, day('2026-10-01'), day('2026-10-31'));
  assert.deepEqual(august.map(item => item.date), ['2026-09-03']);
  assert.deepEqual(september.map(item => item.date), ['2026-09-03']);
  assert.deepEqual(october.map(item => item.date), ['2026-10-03']);
  assert.equal(august[0].occurrenceId, september[0].occurrenceId);
  assert.equal(new Set([...august, ...september, ...october].map(item => item.occurrenceId)).size, 2);
  const appointment = toPsychologyPersonalAppointment(store.personalCommitments[0]);
  assert.equal(getNextPersonalAppointmentOccurrence(appointment, day('2026-08-07'))?.date, '2026-09-03');
  assert.equal(getAlarmTimingForNow(appointment, new Date('2026-08-07T12:00:00')), null);
  assert.equal(getAlarmTimingForNow(appointment, new Date('2026-09-03T11:00:00'))?.occurrenceTime.getDate(), 3);
});

test('compromisso pessoal permanece sem paciente, sessão, registro clínico ou financeiro', () => {
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPersonalCommitment(store, personalInput({ alarmEnabled: false }));
  const saved = store.personalCommitments[0];
  assert.equal('patientId' in saved, false);
  assert.equal(store.sessions.length, 0);
  assert.equal(store.sessionRecords.length, 0);
  assert.equal(store.charges.length, 0);
  assert.equal(store.payments.length, 0);
});

test('fontes preservam reutilização do motor, layout natural e identidade roxa', () => {
  const pilot = fs.readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  const adapter = fs.readFileSync('src/features/psychology-pilot/PsychologyPersonalAgenda.tsx', 'utf8');
  const personalAgenda = fs.readFileSync('src/components/PersonalAgenda.tsx', 'utf8');
  assert.match(adapter, /import PersonalAgenda/);
  assert.match(adapter, /useAlarms/);
  assert.match(adapter, /fromPsychologyPersonalAppointment/);
  assert.match(personalAgenda, /getPersonalAppointmentOccurrences/);
  assert.match(personalAgenda, /getNextPersonalAppointmentOccurrence/);
  assert.match(pilot, /w-full flex-col/);
  assert.doesNotMatch(pilot, /max-w-\[1600px\]/);
  assert.match(pilot, /text-(?:2xl|xl) font-black tracking-tight/);
  assert.doesNotMatch(pilot, /workspace[^\n]*(overflow-y-auto|overflow-hidden)/i);
});
