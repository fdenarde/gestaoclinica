import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
  upsertPsychologySession,
  type PsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  countPsychologyPatientList,
  filterPsychologyPatientList,
  getPsychologyPatientListViewModels,
  sortPsychologyPatientList,
} from '../src/features/psychology-pilot/psychologyPatientList';

const referenceDate = new Date('2026-08-24T12:00:00.000Z');
const scope = createPsychologyScope('patient-organization-fixture');

function fixture(): PsychologyStore {
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, { name: 'Alice Sintética', birthDate: '1990-01-01', phone: '27999990001', email: 'alice@example.test', preferredModality: 'online', administrativeNote: '', active: true }, 'alice', '2026-01-10T12:00:00.000Z');
  store = upsertPsychologyPatient(store, { name: 'Bruna Inativa', birthDate: '1991-01-01', phone: '27999990002', email: 'bruna@example.test', preferredModality: 'presencial', administrativeNote: '', active: false }, 'bruna', '2026-02-10T12:00:00.000Z');
  store = upsertPsychologyPatient(store, { name: 'Carlos Sem Sessão', birthDate: '1992-01-01', phone: '27999990003', email: 'carlos@example.test', preferredModality: 'online', administrativeNote: '', active: true }, 'carlos', '2026-03-10T12:00:00.000Z');
  store = upsertPsychologyPatient(store, { name: 'Diana Antiga', birthDate: '1993-01-01', phone: '27999990004', email: '', preferredModality: 'presencial', administrativeNote: '', active: false }, 'diana', '2026-04-10T12:00:00.000Z');
  store = { ...store, patients: store.patients.map(patient => patient.id === 'alice' ? { ...patient, inReview: true, reviewMarkedAt: '2026-08-20T12:00:00.000Z' } : patient) };
  store = upsertPsychologySession(store, { patientId: 'alice', date: '2026-05-20', time: '09:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'alice-last');
  store = { ...store, sessions: store.sessions.map(session => session.id === 'alice-last' ? { ...session, status: 'realizada' as const } : session) };
  store = upsertPsychologySession(store, { patientId: 'alice', date: '2026-09-01', time: '10:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'alice-next');
  store = upsertPsychologySession(store, { patientId: 'bruna', date: '2025-08-01', time: '10:00', durationMinutes: 50, modality: 'presencial', locationId: store.locations[0]?.id, locationType: store.locations[0]?.type, administrativeNote: '' }, 'bruna-last');
  store = { ...store, sessions: store.sessions.map(session => session.id === 'bruna-last' ? { ...session, status: 'realizada' as const } : session) };
  store = upsertPsychologySession(store, { patientId: 'diana', date: '2024-01-01', time: '10:00', durationMinutes: 50, modality: 'presencial', locationId: store.locations[0]?.id, locationType: store.locations[0]?.type, administrativeNote: '' }, 'diana-last');
  return { ...store, sessions: store.sessions.map(session => session.id === 'diana-last' ? { ...session, status: 'realizada' as const } : session) };
}

function rows() {
  return getPsychologyPatientListViewModels(fixture(), fixture().patients, referenceDate);
}

test('contadores Total, Ativos, Inativos e Em revisão são calculados em memória', () => {
  assert.deepEqual(countPsychologyPatientList(rows()), { total: 4, active: 2, inactive: 2, review: 1 });
});

test('filtros de status e revisão isolam os conjuntos corretos', () => {
  const all = rows();
  assert.deepEqual(filterPsychologyPatientList(all, { status: 'active' }).map(row => row.patient.id), ['alice', 'carlos']);
  assert.deepEqual(filterPsychologyPatientList(all, { status: 'inactive' }).map(row => row.patient.id), ['bruna', 'diana']);
  assert.deepEqual(filterPsychologyPatientList(all, { status: 'review' }).map(row => row.patient.id), ['alice']);
  assert.deepEqual(filterPsychologyPatientList(all, { review: 'out-of-review' }).map(row => row.patient.id), ['bruna', 'carlos', 'diana']);
});

test('busca local funciona por nome, telefone e e-mail', () => {
  const all = rows();
  assert.equal(filterPsychologyPatientList(all, { query: 'alice sintética' }).length, 1);
  assert.equal(filterPsychologyPatientList(all, { query: '99990003' })[0]?.patient.id, 'carlos');
  assert.equal(filterPsychologyPatientList(all, { query: 'bruna@example.test' })[0]?.patient.id, 'bruna');
});

test('filtros de sessão distinguem sem sessão de atendimento antigo', () => {
  const all = rows();
  assert.deepEqual(filterPsychologyPatientList(all, { lastSession: 'none' }).map(row => row.patient.id), ['carlos']);
  assert.deepEqual(filterPsychologyPatientList(all, { lastSession: '3m' }, referenceDate).map(row => row.patient.id), ['alice', 'bruna', 'diana']);
  assert.deepEqual(filterPsychologyPatientList(all, { lastSession: '12m' }, referenceDate).map(row => row.patient.id), ['bruna', 'diana']);
});

test('filtros de próxima sessão funcionam sem nova fonte de dados', () => {
  const all = rows();
  assert.deepEqual(filterPsychologyPatientList(all, { nextSession: 'with' }).map(row => row.patient.id), ['alice']);
  assert.deepEqual(filterPsychologyPatientList(all, { nextSession: 'without' }).map(row => row.patient.id), ['bruna', 'carlos', 'diana']);
});

test('createdAt válido aparece no formato brasileiro e ausência de data vira marcador neutro', () => {
  const store = fixture();
  const withMissing = { ...store, patients: store.patients.map(patient => patient.id === 'carlos' ? { ...patient, createdAt: '' } : patient) };
  const result = getPsychologyPatientListViewModels(withMissing, withMissing.patients, referenceDate);
  assert.equal(result.find(row => row.patient.id === 'alice')?.createdAt, '10/01/2026');
  assert.equal(result.find(row => row.patient.id === 'carlos')?.createdAt, '—');
});

test('ordenação de nome, datas e status é local e determinística', () => {
  const all = rows();
  assert.deepEqual(sortPsychologyPatientList(all, 'name', 'asc').map(row => row.patient.name), ['Alice Sintética', 'Bruna Inativa', 'Carlos Sem Sessão', 'Diana Antiga']);
  assert.deepEqual(sortPsychologyPatientList(all, 'name', 'desc').map(row => row.patient.name), ['Diana Antiga', 'Carlos Sem Sessão', 'Bruna Inativa', 'Alice Sintética']);
  assert.deepEqual(sortPsychologyPatientList(all, 'createdAt', 'asc').map(row => row.patient.id), ['alice', 'bruna', 'carlos', 'diana']);
  assert.deepEqual(sortPsychologyPatientList(all, 'lastSession', 'desc').map(row => row.patient.id), ['alice', 'bruna', 'diana', 'carlos']);
  assert.deepEqual(sortPsychologyPatientList(all, 'nextSession', 'desc').map(row => row.patient.id), ['alice', 'bruna', 'carlos', 'diana']);
  assert.deepEqual(sortPsychologyPatientList(all, 'status', 'asc').map(row => row.patient.id), ['alice', 'carlos', 'bruna', 'diana']);
});

test('upsert de paciente preserva a marca Em revisão e createdAt existente', () => {
  const store = fixture();
  const updated = upsertPsychologyPatient(store, { name: 'Alice Atualizada', birthDate: '1990-01-01', phone: '27999990001', email: 'alice@example.test', preferredModality: 'online', administrativeNote: '', active: true }, 'alice', '2026-08-24T12:00:00.000Z');
  const alice = updated.patients.find(patient => patient.id === 'alice');
  assert.equal(alice?.createdAt, '2026-01-10T12:00:00.000Z');
  assert.equal(alice?.inReview, true);
  assert.equal(alice?.reviewMarkedAt, '2026-08-20T12:00:00.000Z');
});

test('interface mantém seleção visível, confirmação forte, revisão e ausência de leituras por filtro', async () => {
  const source = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  assert.match(source, /Selecionar todos os pacientes visíveis/);
  assert.match(source, /filteredRows\.forEach/);
  assert.match(source, /Mover para revisão/);
  assert.match(source, /Retirar da revisão/);
  assert.match(source, /Digite <span className="text-rose-700">EXCLUIR<\/span>/);
  assert.match(source, /Reutilize a mesma regra|Reutiliza a mesma regra|Reuse the exact individual deletion rule/);
  assert.doesNotMatch(source.slice(source.indexOf('function PatientsView'), source.indexOf('const sessionTone')), /onSnapshot|fetch\(|getDocs\(|query\(/);
});
