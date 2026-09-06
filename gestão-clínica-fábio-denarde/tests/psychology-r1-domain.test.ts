import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  getPsychologyDayItems,
  normalizePsychologyStore,
  PSYCHOLOGY_CONTEXT,
  savePsychologySessionRecord,
  type PsychologyPatientInput,
  type PsychologySessionInput,
  upsertPsychologyPatient,
  upsertPsychologyPersonalCommitment,
  upsertPsychologySession,
  updatePsychologySessionStatus,
  validatePsychologyPatient,
  validatePsychologySession,
} from '../src/features/psychology-pilot/psychologyDomain.ts';

const patientInput: PsychologyPatientInput = {
  name: 'Paciente Sintético',
  birthDate: '1990-01-01',
  phone: '(27) 99999-0000',
  email: '',
  preferredModality: 'online',
  administrativeNote: '',
  active: true,
};

const sessionInput = (patientId: string): PsychologySessionInput => ({
  patientId,
  date: '2026-08-12',
  time: '09:00',
  durationMinutes: 50,
  modality: 'online',
  administrativeNote: '',
});

test('Psicologia mantém o contexto e o profissional no escopo de todos os itens', () => {
  const scope = createPsychologyScope('professional-a');
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, patientInput, 'patient-a', '2026-08-12T10:00:00.000Z');
  store = upsertPsychologySession(store, sessionInput('patient-a'), 'session-a', '2026-08-12T10:00:00.000Z');

  assert.equal(store.scope.context, PSYCHOLOGY_CONTEXT);
  assert.equal(store.patients[0].professionalId, 'professional-a');
  assert.equal(store.sessions[0].professionalId, 'professional-a');
  assert.equal(store.sessions[0].context, PSYCHOLOGY_CONTEXT);
});

test('um profissional diferente não recebe pacientes ou sessões de outro escopo', () => {
  const sourceScope = createPsychologyScope('professional-a');
  let source = createEmptyPsychologyStore(sourceScope);
  source = upsertPsychologyPatient(source, patientInput, 'patient-a');
  source = upsertPsychologySession(source, sessionInput('patient-a'), 'session-a');
  const other = createEmptyPsychologyStore(createPsychologyScope('professional-b'));
  const contaminated = { ...other, patients: source.patients, sessions: source.sessions };
  const isolated = normalizePsychologyStore(contaminated, other.scope);
  assert.equal(isolated.patients.length, 0);
  assert.equal(isolated.sessions.length, 0);
});

test('cadastro valida os campos obrigatórios do contrato administrativo canônico', () => {
  const errors = validatePsychologyPatient({ ...patientInput, name: '', birthDate: '', phone: '' });
  assert.deepEqual(errors, {
    name: 'Informe o nome completo do paciente.',
    phone: 'Informe um telefone válido.',
  });
});

test('agenda diária reúne sessão e compromisso pessoal em ordem cronológica', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('professional-a'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-a');
  store = upsertPsychologySession(store, { ...sessionInput('patient-a'), time: '10:00' }, 'session-a');
  store = upsertPsychologyPersonalCommitment(store, {
    date: '2026-08-12', time: '08:00', durationMinutes: 30, type: 'Médico', note: '',
  }, 'personal-a');
  const items = getPsychologyDayItems(store, '2026-08-12');
  assert.deepEqual(items.map(item => `${item.kind}:${item.item.time}`), ['personal:08:00', 'session:10:00']);
  assert.equal(items.find(item => item.kind === 'personal')?.item && 'patientId' in items.find(item => item.kind === 'personal')!.item, false);
});

test('sessão pode ser reagendada, concluída, marcada como falta e cancelada', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('professional-a'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-a');
  store = upsertPsychologySession(store, sessionInput('patient-a'), 'session-a');
  assert.equal(validatePsychologySession(sessionInput('patient-a'), store), null);
  store = upsertPsychologySession(store, { ...sessionInput('patient-a'), date: '2026-08-13', time: '11:00' }, 'session-a');
  assert.equal(store.sessions[0].patientId, 'patient-a');
  store = updatePsychologySessionStatus(store, 'session-a', 'realizada');
  assert.equal(store.sessions[0].status, 'realizada');
  store = updatePsychologySessionStatus(store, 'session-a', 'falta');
  assert.equal(store.sessions[0].status, 'falta');
  store = updatePsychologySessionStatus(store, 'session-a', 'cancelada');
  assert.equal(store.sessions[0].status, 'cancelada');
});

test('registro sensível fica vinculado à sessão e não altera os itens da agenda', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('professional-a'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-a');
  store = upsertPsychologySession(store, sessionInput('patient-a'), 'session-a');
  store = savePsychologySessionRecord(store, 'session-a', 'Conteúdo clínico sintético para teste.');
  assert.equal(store.sessionRecords.length, 1);
  assert.equal(store.sessionRecords[0].patientId, 'patient-a');
  assert.equal(getPsychologyDayItems(store, '2026-08-12')[0].kind, 'session');
  assert.equal('text' in getPsychologyDayItems(store, '2026-08-12')[0].item, false);
});
