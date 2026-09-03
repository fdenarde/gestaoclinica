import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  getPsychologyAgendaSessionsForSlot,
  parsePsychologyStore,
  serializePsychologyStore,
  synchronizePsychologyServiceForPatient,
  updatePsychologySessionStatus,
  upsertPsychologyPatient,
  upsertPsychologySession,
  validatePsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain';
import { validatePsychologyPatientAdministrativeInput } from '../src/lib/psychologyPatientAdministrative';

const referenceDate = '2026-08-25';
const patientInput = {
  name: 'Paciente sintético R32',
  dateOfBirth: '',
  phone: '27999990001',
  email: '',
  preferredModality: 'presencial' as const,
  administrativeNote: '',
  active: true,
};

test('R32 campos opcionais vazios passam e formatos preenchidos continuam validados', () => {
  assert.deepEqual(validatePsychologyPatientAdministrativeInput({ ...patientInput }, referenceDate), {});
  assert.deepEqual(validatePsychologyPatientAdministrativeInput({
    ...patientInput,
    dateOfBirth: '2012-08-25',
    administrativeResponsible: { fullName: 'Responsável sintético', relationship: 'Mãe', phone: '', email: '' },
  }, referenceDate), {});
  assert.match(validatePsychologyPatientAdministrativeInput({
    ...patientInput,
    administrativeResponsible: { fullName: 'Responsável sintético', relationship: 'Mãe', phone: '123', email: '' },
  }, referenceDate)['administrativeResponsible.phone'], /telefone válido/);
  assert.match(validatePsychologyPatientAdministrativeInput({
    ...patientInput,
    administrativeResponsible: { fullName: 'Responsável sintético', relationship: 'Mãe', phone: '', email: 'invalido' },
  }, referenceDate)['administrativeResponsible.email'], /e-mail válido/);
});

test('R32 menor sincroniza Psicoterapia Adolescente e adulto/data removida deixam de forçar o serviço', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r32-service'));
  store = upsertPsychologyPatient(store, { ...patientInput, name: 'Menor sintético', dateOfBirth: '2012-08-25' }, 'r32-minor');
  assert.equal(synchronizePsychologyServiceForPatient(store, 'r32-minor', 'psychotherapy-individual', referenceDate), 'psychotherapy-adolescent');

  store = upsertPsychologyPatient(store, { ...patientInput, name: 'Adulto sintético', dateOfBirth: '1990-08-25' }, 'r32-adult');
  assert.notEqual(synchronizePsychologyServiceForPatient(store, 'r32-adult', 'psychotherapy-adolescent', referenceDate), 'psychotherapy-adolescent');

  store = upsertPsychologyPatient(store, { ...patientInput, name: 'Menor sem data', dateOfBirth: '' }, 'r32-minor');
  assert.notEqual(synchronizePsychologyServiceForPatient(store, 'r32-minor', 'psychotherapy-adolescent', referenceDate), 'psychotherapy-adolescent');
  const reloaded = parsePsychologyStore(serializePsychologyStore(store), createPsychologyScope('r32-service'));
  assert.equal(reloaded.patients.find(patient => patient.id === 'r32-minor')?.dateOfBirth, '');
  const persistedMinor = upsertPsychologyPatient(reloaded, { ...patientInput, name: 'Menor persistido', dateOfBirth: '2012-08-25' }, 'r32-minor');
  const persistedReload = parsePsychologyStore(serializePsychologyStore(persistedMinor), createPsychologyScope('r32-service'));
  assert.equal(synchronizePsychologyServiceForPatient(persistedReload, 'r32-minor', 'psychotherapy-individual', referenceDate), 'psychotherapy-adolescent');
});

test('R32 cancelamento preserva histórico, libera o slot e não bloqueia novo agendamento', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r32-cancel'));
  store = upsertPsychologyPatient(store, { ...patientInput, dateOfBirth: '1990-08-25' }, 'r32-cancel-patient');
  const input = { patientId: 'r32-cancel-patient', date: '2026-08-27', time: '15:00', durationMinutes: 50, modality: 'presencial' as const, serviceId: 'psychotherapy-individual', locationId: store.locations[0].id, locationType: store.locations[0].type, administrativeNote: '' };
  store = upsertPsychologySession(store, input, 'r32-cancel-session');
  const cancelled = updatePsychologySessionStatus(store, 'r32-cancel-session', 'cancelada');
  assert.equal(cancelled.sessions.find(session => session.id === 'r32-cancel-session')?.status, 'cancelada');
  assert.deepEqual(getPsychologyAgendaSessionsForSlot(cancelled.sessions, input.date, input.time), []);
  assert.equal(validatePsychologySession(input, cancelled, { requireService: true, checkConflicts: true }), null);
  assert.equal(validatePsychologySession(input, store, { requireService: true, checkConflicts: true }), 'Este horário já está ocupado por outra sessão.');
});

test('R32 lista e exclusão múltipla preservam colunas, alinhamento e confirmação contextual', async () => {
  const source = await readFile('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  assert.match(source, /Nome completo \*/);
  assert.match(source, /Telefone \*/);
  assert.match(source, /Modalidade preferencial \*/);
  assert.match(source, /Excluir selecionados \(\{selectedVisibleIds\.length\}\)/);
  assert.doesNotMatch(source, /reviewArea && <button[^>]*Excluir selecionados/s);
  assert.match(source, /Excluir definitivamente os \{selectedVisibleIds\.length\} pacientes selecionados\?/);
  const gridDefinition = source.match(/PATIENT_LIST_GRID = '([^']+)'/)?.[1] || '';
  assert.match(gridDefinition, /md:grid-cols-\[auto_minmax\(220px,340px\)/);
  assert.doesNotMatch(gridDefinition.split('md:grid-cols-')[1] || '', /fr/);
  assert.match(source, /data-testid="psychology-patient-list-header"/);
  assert.match(source, /Abrir ficha/);
  assert.match(source, /Editar/);
  assert.match(source, /Excluir/);
  assert.match(source, /data-testid="psychology-patient-secondary-actions"/);
  assert.match(source, /allSettledWithConcurrency\(uniquePatientIds, PSYCHOLOGY_BULK_DELETE_CONCURRENCY/);
  assert.match(source, /getPsychologyAgendaSessionsForSlot\(sessions, date, time\)/);
});
