import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { analyzeDoctoraliaFiles } from '../src/features/psychology-import-export/doctoralia';
import type { ImportFileInput } from '../src/features/psychology-import-export/types';
import {
  createDoctoraliaShadowMemoryDestination,
  createDoctoraliaShadowMigrationPlan,
  rollbackDoctoraliaShadowMemory,
  runDoctoraliaShadowImport,
} from '../src/features/psychology-persistence/doctoraliaShadowImport';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope';
import { createMemoryPsychologyRepositories } from '../src/features/psychology-persistence/repositories/memory';

const patientsText = [
  'id,first name,last name,phone,additional phone,email,date of birth,address street,address number,address postal code,address neighbordhood,address city,address state,address province,address country,religion,education,profession,nationality,medications,status,observations,precedents,allergies,other information,fiscal fields,insurance,SUS/nation healthcare number,signed data privacy,signed data marketing,marketing metadata',
  'synthetic-a,Synthetic,History,550000000001,,synthetic-a@example.test,10/05/1990,Rua Sintética,10,01000-000,Bairro Teste,Cidade Teste,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,medicação sintética,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
  'synthetic-b,Synthetic,Future,550000000002,,synthetic-b@example.test,11/06/1991,Avenida Local,20,02000-000,Bairro Futuro,Cidade Teste,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
  'synthetic-c,Synthetic,Cancelled,550000000003,,synthetic-c@example.test,12/07/1992,Rua Cancelada,30,03000-000,Bairro Cancelado,Cidade Teste,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
  'synthetic-d,Synthetic,Excluded,550000000004,,synthetic-d@example.test,13/08/1993,Rua Sem Agenda,40,04000-000,Bairro Sem Agenda,Cidade Teste,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
].join('\n');

const appointmentsText = [
  'eventId,patient id,agenda,service,start time,end time,appointment status,schedule id,comments,recurrency type',
  'synthetic-old,synthetic-a,Consultório Sintético,Acompanhamento Terapêutico,2024-12-31 09:00,2024-12-31 09:50,Confirmed,s-old,ignorar,none',
  'synthetic-unknown,synthetic-a,Consultório Sintético,Acompanhamento Terapêutico,2025-01-01 10:00,2025-01-01 10:50,Confirmed,s-unknown,ignorar,none',
  'synthetic-future,synthetic-b,Teleatendimento (on-line),Acompanhamento Terapêutico,2026-09-01 09:00,2026-09-01 10:20,Confirmed,s-future,ignorar,none',
  'synthetic-cancelled,synthetic-c,Clínica Sintética,Psicoterapia Individual,2025-03-01 11:00,2025-03-01 11:50,CanceledByPatient,s-cancelled,ignorar,none',
].join('\n');

const patientsFile: ImportFileInput = { source: 'doctoralia', fileName: 'patients.csv', mimeType: 'text/csv', text: patientsText };
const appointmentsFile: ImportFileInput = { source: 'doctoralia', fileName: 'patients_appointments.csv', mimeType: 'text/csv', text: appointmentsText };
const now = '2026-08-14T19:00:00-03:00';
const analysis = analyzeDoctoraliaFiles({ patients: patientsFile, appointments: appointmentsFile, now });
const scope = createPsychologyPersistenceScope('synthetic-professional', 'synthetic-workspace');
const sourceFiles = [patientsFile, appointmentsFile].map(file => ({
  name: file.fileName,
  sha256: createHash('sha256').update(file.text || '').digest('hex'),
}));

function createPlan() {
  return createDoctoraliaShadowMigrationPlan({
    analysis,
    scope,
    migrationId: 'r2b4-synthetic-shadow',
    sourceFiles,
    now,
  });
}

test('R2B4 shadow 01 — plano importa somente candidatos e mantém Grupo C recuperável', () => {
  const plan = createPlan();
  assert.equal(analysis.dryRun.patientCounts.total, 4);
  assert.equal(plan.patients.length, 3);
  assert.equal(plan.excludedPatients.length, 1);
  assert.equal(plan.excludedPatients[0]?.recoverable, true);
  assert.equal(plan.manifest.destination, 'MEMORY');
  assert.equal(plan.manifest.reconciliationStatus, 'PENDING');
});

test('R2B4 shadow 02 — preserva estados canônicos sem inferir comparecimento', () => {
  const plan = createPlan();
  assert.deepEqual(plan.manifest.sessionCounts, {
    sourceTotal: 4,
    eligible: 3,
    cancelled: 1,
    legacyAttendanceUnknown: 1,
    scheduled: 1,
  });
  assert.deepEqual(plan.sessions.map(item => item.canonicalStatus).sort(), ['CANCELLED', 'LEGACY_ATTENDANCE_UNKNOWN', 'SCHEDULED']);
  assert.equal(plan.sessions.filter(item => item.status === 'realizada').length, 0);
  assert.equal(plan.sessions.filter(item => item.status === 'falta').length, 0);
});

test('R2B4 shadow 03 — cria catálogos canônicos e não atribui local físico a online', () => {
  const plan = createPlan();
  assert.equal(plan.services.length, analysis.dryRun.services.length);
  assert.equal(plan.locations.length, analysis.dryRun.locations.length);
  assert.equal(plan.sessions.some(item => item.modality === 'online' && item.locationId), false);
  assert.equal(plan.sessions.filter(item => item.modality === 'presencial' && item.locationId).length, 2);
  assert.equal(plan.patients.every(item => item.externalReferences?.[0]?.source === 'DOCTORALIA'), true);
  assert.equal(plan.services.every(item => item.externalReferences?.[0]?.source === 'DOCTORALIA'), true);
  assert.equal(plan.locations.every(item => item.externalReferences?.[0]?.source === 'DOCTORALIA'), true);
});

test('R2B4 shadow 04 — mantém histórico clínico fora do paciente administrativo e do financeiro', async () => {
  const plan = createPlan();
  const destination = createDoctoraliaShadowMemoryDestination(scope);
  const repositories = createMemoryPsychologyRepositories(scope, { state: destination.state, now: () => now });
  const run = await runDoctoraliaShadowImport(plan, repositories);
  assert.equal(run.reconciliation.clinical.administrativeMedicationLeaks, 0);
  assert.equal(run.store.sessionRecords.length, plan.clinicalBackgrounds.length);
  assert.equal((await repositories.sessionRecords.list(scope)).length, plan.clinicalBackgrounds.length);
  assert.equal(run.store.charges.length, 0);
  assert.equal(run.store.payments.length, 0);
  assert.equal(run.store.expenses.length, 0);
});

test('R2B4 shadow 05 — reconcilia, é idempotente e gera relatório conservador', async () => {
  const plan = createPlan();
  const destination = createDoctoraliaShadowMemoryDestination(scope);
  const repositories = createMemoryPsychologyRepositories(scope, { state: destination.state, now: () => now });
  const run = await runDoctoraliaShadowImport(plan, repositories);
  assert.equal(run.reconciliation.status, 'PASS');
  assert.equal(run.reconciliation.idempotency.passed, true);
  assert.equal(run.reconciliation.idempotency.duplicateDelta, 0);
  assert.equal(run.reconciliation.reports.total, plan.sessions.length);
  assert.equal(run.reconciliation.reports.cancelled, 1);
  assert.equal(run.reconciliation.reports.realized, 0);
  assert.equal(run.reconciliation.reports.absences, 0);
  assert.equal(run.reconciliation.reports.attendanceRate, null);
  assert.equal(run.reconciliation.session.orphanPatientReferences, 0);
  assert.equal(run.reconciliation.session.orphanServiceReferences, 0);
  assert.equal(run.reconciliation.session.orphanLocationReferences, 0);
  assert.equal(run.reconciliation.session.civilDateTimeMatches, plan.sessions.length);
  assert.equal(run.plan.manifest.writesPerformedShadow, run.writesPerformedShadow);
});

test('R2B4 shadow 06 — rollback local limpa todos os agregados de memória', async () => {
  const plan = createPlan();
  const destination = createDoctoraliaShadowMemoryDestination(scope);
  const repositories = createMemoryPsychologyRepositories(scope, { state: destination.state, now: () => now });
  await runDoctoraliaShadowImport(plan, repositories);
  rollbackDoctoraliaShadowMemory(destination.state);
  const empty = createMemoryPsychologyRepositories(scope, { state: destination.state, now: () => now });
  assert.equal((await empty.patients.list(scope)).length, 0);
  assert.equal((await empty.sessions.list(scope)).length, 0);
  assert.equal((await empty.sessionRecords.list(scope)).length, 0);
  assert.equal((await empty.services.list(scope)).length, 0);
  assert.equal((await empty.locations.list(scope)).length, 0);
  assert.equal((await empty.financial.listCharges(scope)).length, 0);
});

test('R2B4 shadow 07 — manifesto agregado não contém PII ou IDs externos individuais', () => {
  const plan = createPlan();
  const manifestText = JSON.stringify(plan.manifest);
  assert.equal(manifestText.includes('Synthetic'), false);
  assert.equal(manifestText.includes('550000000001'), false);
  assert.equal(manifestText.includes('synthetic-a@example.test'), false);
  assert.equal(manifestText.includes('synthetic-a'), false);
  assert.equal(manifestText.includes('medicação sintética'), false);
});
