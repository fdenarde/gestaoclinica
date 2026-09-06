import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createEmptyPsychologyStore, createPsychologyScope, type PsychologyPatient, type PsychologySession } from '../src/features/psychology-pilot/psychologyDomain';
import { isPsychologyMinorOrAdolescent, upsertPsychologyClinicalRecord } from '../src/features/psychology-pilot/psychologyClinicalRecords';

const scope = createPsychologyScope('professional-prontuario-fixture');
const adult: PsychologyPatient = { id: 'patient-adult', professionalId: scope.professionalId, context: 'PSICOLOGIA', name: 'Adulto Sintético', birthDate: '1990-01-01', phone: '27999990000', preferredModality: 'online', active: true, createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z' };
const minor: PsychologyPatient = { ...adult, id: 'patient-minor', name: 'Menor Sintético', birthDate: '2012-08-10' };
const session: PsychologySession = { id: 'session-adult', patientId: adult.id, professionalId: scope.professionalId, context: 'PSICOLOGIA', date: '2026-08-14', time: '09:00', durationMinutes: 50, modality: 'online', status: 'realizada', createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z' };

test('Prontuário — acompanhamento e SOAP permanecem no paciente/autor do escopo e não alteram a sessão', () => {
  const store = { ...createEmptyPsychologyStore(scope), patients: [adult, minor], sessions: [session] };
  const beforeSession = structuredClone(store.sessions[0]);
  const followUp = upsertPsychologyClinicalRecord(store, { patientId: adult.id, recordType: 'THERAPEUTIC_FOLLOW_UP', date: '2026-08-14', sessionId: session.id, content: 'registro livre sintético' }, '2026-08-14T10:00:00.000Z');
  const soap = upsertPsychologyClinicalRecord(followUp, { patientId: adult.id, recordType: 'SOAP', date: '2026-08-14', content: '', soap: { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' } }, '2026-08-14T11:00:00.000Z');
  assert.equal(soap.sessionRecords.length, 2);
  assert.equal(soap.sessionRecords[0].patientId, adult.id);
  assert.equal(soap.sessionRecords[0].authorProfessionalId, scope.professionalId);
  assert.deepEqual(soap.sessions[0], beforeSession);
  assert.deepEqual(soap.sessionRecords[1].soap, { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' });
  assert.throws(() => upsertPsychologyClinicalRecord(soap, { patientId: minor.id, recordType: 'THERAPEUTIC_FOLLOW_UP', date: '2026-08-14', sessionId: session.id, content: 'tentativa cruzada' }));
});

test('Prontuário — anamnese/devolutiva reutiliza a regra canônica de menor e edição preserva createdAt', () => {
  const store = { ...createEmptyPsychologyStore(scope), patients: [adult, minor], sessions: [] };
  assert.equal(isPsychologyMinorOrAdolescent(minor, '2026-08-14'), true);
  assert.equal(isPsychologyMinorOrAdolescent(adult, '2026-08-14'), false);
  assert.throws(() => upsertPsychologyClinicalRecord(store, { patientId: adult.id, recordType: 'PARENT_ANAMNESIS_FEEDBACK', parentRecordType: 'FEEDBACK', date: '2026-08-14', content: 'não permitido' }));
  const created = upsertPsychologyClinicalRecord(store, { patientId: minor.id, recordType: 'PARENT_ANAMNESIS_FEEDBACK', parentRecordType: 'ANAMNESIS_AND_FEEDBACK', date: '2026-08-14', content: 'registro sintético' }, '2026-08-14T10:00:00.000Z');
  const record = created.sessionRecords[0];
  const edited = upsertPsychologyClinicalRecord(created, { id: record.id, patientId: minor.id, recordType: 'PARENT_ANAMNESIS_FEEDBACK', parentRecordType: 'FEEDBACK', date: '2026-08-15', content: 'registro sintético editado' }, '2026-08-15T10:00:00.000Z');
  assert.equal(edited.sessionRecords[0].createdAt, '2026-08-14T10:00:00.000Z');
  assert.equal(edited.sessionRecords[0].updatedAt, '2026-08-15T10:00:00.000Z');
});

test('Prontuário — UI mantém a ação junto da ficha e não referencia Portal do Responsável ou Neuro', () => {
  const chart = readFileSync('src/features/psychology-pilot/PsychologyPatientChart.tsx', 'utf8');
  const dialog = readFileSync('src/features/psychology-pilot/PsychologyClinicalRecordDialog.tsx', 'utf8');
  assert.match(chart, /Agendar sessão[\s\S]*Prontuário/);
  for (const label of ['Acompanhamento Terapêutico', 'Modelo SOAP', 'Anamnese \/ Devolutiva', 'Histórico do prontuário']) assert.match(dialog, new RegExp(label));
  assert.doesNotMatch(dialog, /Portal do Responsável|NEUROPSICOPEDAGOGIA|monitoramento/i);
  assert.match(dialog, /overflow-hidden/);
});

test('Prontuário — identificadores clínicos não atravessam as superfícies pública ou do responsável', () => {
  const publicSurfaces = [
    'src/components/Auth/ResponsiblePortal.tsx',
    'api/_lib/responsiblePortalPackages.js',
    'api/public-booking.ts',
  ].map(file => readFileSync(file, 'utf8')).join('\n');

  assert.doesNotMatch(publicSurfaces, /sessionRecords|session-records|clinicalSessionRecord|parentRecordType|soap\s*:/i);
});
