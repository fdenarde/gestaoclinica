import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DoctoraliaImportAdapter } from '../src/features/psychology-import-export/adapters';
import {
  analyzeDoctoraliaFiles,
  buildDoctoraliaDryRunReport,
  DOCTORALIA_APPOINTMENT_CUTOFF,
  DOCTORALIA_IGNORED_FIELDS,
  DOCTORALIA_TIMEZONE,
  recognizeDoctoraliaAppointmentsCsv,
  recognizeDoctoraliaPatientsCsv,
} from '../src/features/psychology-import-export/doctoralia';
import { DOCTORALIA_UNRECOGNIZED_MESSAGE, type ImportFileInput } from '../src/features/psychology-import-export/types';

const patientsText = [
  'id,first name,last name,phone,additional phone,email,date of birth,address street,address number,address postal code,address neighbordhood,address city,address state,address province,address country,religion,education,profession,nationality,medications,status,observations,precedents,allergies,other information,fiscal fields,insurance,SUS/nation healthcare number,signed data privacy,signed data marketing,marketing metadata',
  'p-a,Paciente,Historico,11999990001,11888880001,paciente.a@example.test,10/05/1990,Rua Sintética,10,01000-000,Bairro Teste,São Paulo,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,medicação protegida,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
  'p-b,Paciente,Futuro,11999990002,,paciente.b@example.test,11/06/1991,Avenida Local,20,02000-000,Bairro Futuro,Campinas,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
  'p-c,Paciente,Cancelado,11999990003,,paciente.c@example.test,12/07/1992,Rua Cancelada,30,03000-000,Bairro Cancelado,Santos,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
  'p-d,Paciente,SemAgenda,11999990004,,paciente.d@example.test,13/08/1993,Rua Sem Agenda,40,04000-000,Bairro Sem Agenda,Osasco,SP,SP,Brasil,Não informado,Superior,Profissional,Brasileira,,Active,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,ignorar,yes,no,ignorar',
].join('\n');

const appointmentsText = [
  'eventId,patient id,agenda,service,start time,end time,appointment status,schedule id,comments,recurrency type',
  'e-old,p-a,Consultório Sintético,Acompanhamento Terapêutico,2024-12-31 09:00,2024-12-31 09:50,Confirmed,s-1,não importar comentário,none',
  'e-cutoff,p-a,Consultório Sintético,Acompanhamento Terapêutico,2025-01-01 10:00,2025-01-01 10:45,Confirmed,s-2,não importar comentário,none',
  'e-future,p-b,Teleatendimento (on-line),Acompanhamento Terapêutico,2026-09-01 09:00,2026-09-01 10:20,Confirmed,s-3,não importar comentário,weekly',
  'e-cancelled,p-c,Clínica Sintética,Acompanhamento Terapêutico,2025-03-01 11:00,2025-03-01 11:50,CanceledByPatient,s-4,não importar comentário,none',
].join('\n');

const patientsFile: ImportFileInput = { source: 'doctoralia', fileName: 'patients.csv', mimeType: 'text/csv', text: patientsText };
const appointmentsFile: ImportFileInput = { source: 'doctoralia', fileName: 'patients_appointments.csv', mimeType: 'text/csv', text: appointmentsText };
const analysis = analyzeDoctoraliaFiles({ patients: patientsFile, appointments: appointmentsFile, now: '2026-08-14T18:00:00.000Z' });

test('R2B2 adapter 01 — reconhece patients.csv pelo schema', () => assert.equal(recognizeDoctoraliaPatientsCsv(patientsFile), true));
test('R2B2 adapter 02 — reconhece patients_appointments.csv pelo schema', () => assert.equal(recognizeDoctoraliaAppointmentsCsv(appointmentsFile), true));
test('R2B2 adapter 03 — exige os dois arquivos para reconhecimento completo', () => { const adapter = new DoctoraliaImportAdapter(); assert.equal(adapter.recognize({ ...patientsFile, relatedFiles: [] }).recognized, false); });
test('R2B2 adapter 04 — mantém mensagem conservadora para formato desconhecido', () => assert.equal(new DoctoraliaImportAdapter().recognize({ source: 'doctoralia', fileName: 'export.csv', text: 'sem schema' }).message, DOCTORALIA_UNRECOGNIZED_MESSAGE));
test('R2B2 groups 05 — calcula total de pacientes a partir das linhas', () => assert.equal(analysis.dryRun.patientCounts.total, 4));
test('R2B2 groups 06 — classifica histórico não cancelado como Grupo A', () => assert.equal(analysis.dryRun.patientCounts.groupA, 2));
test('R2B2 groups 07 — classifica somente cancelados como Grupo B', () => assert.equal(analysis.dryRun.patientCounts.groupB, 1));
test('R2B2 groups 08 — classifica sem agendamentos como Grupo C', () => assert.equal(analysis.dryRun.patientCounts.groupC, 1));
test('R2B2 groups 09 — Grupo A sem evidência futura fica inativo para revisão', () => { const patient = analysis.dryRun.patients.find(item => item.externalPatientId === 'p-a'); assert.equal(patient?.status, 'INACTIVE'); assert.equal(patient?.migrationReview?.reason, 'STATUS_NOT_CONFIRMED'); });
test('R2B2 groups 10 — Grupo A com consulta futura fica ativo', () => assert.equal(analysis.dryRun.patients.find(item => item.externalPatientId === 'p-b')?.status, 'ACTIVE'));
test('R2B2 groups 11 — Grupo B fica inativo com motivo explícito', () => { const patient = analysis.dryRun.patients.find(item => item.externalPatientId === 'p-c'); assert.equal(patient?.status, 'INACTIVE'); assert.equal(patient?.migrationReview?.reason, 'ONLY_CANCELLED_APPOINTMENTS'); });
test('R2B2 groups 12 — Grupo C não entra na primeira lista de pacientes', () => { assert.equal(analysis.dryRun.patients.some(item => item.externalPatientId === 'p-d'), false); assert.equal(analysis.dryRun.notImportedPatients[0]?.reason, 'NO_APPOINTMENTS_FOUND'); });
test('R2B2 groups 13 — Grupo C é recuperável apenas localmente', () => assert.equal(analysis.dryRun.notImportedPatients[0]?.reviewable, true));
test('R2B2 cutoff 14 — aplica corte inclusivo de 2025-01-01', () => assert.equal(analysis.cutoff, DOCTORALIA_APPOINTMENT_CUTOFF));
test('R2B2 cutoff 15 — conta histórico anterior ao corte', () => assert.equal(analysis.dryRun.appointmentCounts.beforeCutoff, 1));
test('R2B2 cutoff 16 — mantém consulta na data do corte', () => assert.equal(analysis.dryRun.appointments.some(item => item.externalEventId === 'e-cutoff'), true));
test('R2B2 cutoff 17 — não elimina paciente por ter apenas histórico antigo', () => assert.equal(analysis.dryRun.patients.some(item => item.externalPatientId === 'p-a'), true));
test('R2B2 appointments 18 — calcula quantidade original sem hardcode', () => assert.equal(analysis.dryRun.appointmentCounts.totalOriginal, 4));
test('R2B2 appointments 19 — conta consultas elegíveis após o corte', () => assert.equal(analysis.dryRun.appointmentCounts.atOrAfterCutoff, 3));
test('R2B2 appointments 20 — preserva status cancelado e status de origem', () => { const item = analysis.dryRun.appointments.find(candidate => candidate.externalEventId === 'e-cancelled'); assert.equal(item?.status, 'CANCELLED'); assert.equal(item?.sourceStatus, 'CanceledByPatient'); });
test('R2B2 appointments 21 — não infere comparecimento histórico', () => { const item = analysis.dryRun.appointments.find(candidate => candidate.externalEventId === 'e-cutoff'); assert.equal(item?.status, 'LEGACY_ATTENDANCE_UNKNOWN'); assert.equal(item?.historicalAttendanceUnknown, true); });
test('R2B2 appointments 22 — consulta futura é operacionalmente agendada', () => assert.equal(analysis.dryRun.appointments.find(item => item.externalEventId === 'e-future')?.status, 'SCHEDULED'));
test('R2B2 appointments 23 — duração é calculada pelo intervalo de origem', () => assert.equal(analysis.dryRun.appointments.find(item => item.externalEventId === 'e-future')?.durationMinutes, 80));
test('R2B2 appointments 24 — conserva data civil no fuso Doctoralia', () => { const item = analysis.dryRun.appointments.find(candidate => candidate.externalEventId === 'e-future'); assert.equal(item?.civilDate, '2026-09-01'); assert.equal(item?.startTime, '09:00'); assert.equal(analysis.timezone, DOCTORALIA_TIMEZONE); });
test('R2B2 appointments 25 — reconhece teleatendimento como ONLINE', () => assert.equal(analysis.dryRun.appointments.find(item => item.externalEventId === 'e-future')?.modality, 'ONLINE'));
test('R2B2 appointments 26 — reconhece agenda física como PRESENCIAL', () => assert.equal(analysis.dryRun.appointments.find(item => item.externalEventId === 'e-cutoff')?.modality, 'PRESENCIAL'));
test('R2B2 appointments 27 — não reconstrói recorrência', () => assert.equal(analysis.dryRun.appointments.some(item => 'recurrencyType' in item), false));
test('R2B2 appointments 28 — não importa comentários no candidato', () => assert.equal(analysis.dryRun.appointments.some(item => 'comments' in item || 'comment' in item), false));
test('R2B2 refs 29 — paciente tem uma referência externa Doctoralia', () => { const ref = analysis.dryRun.patients.find(item => item.externalPatientId === 'p-a')?.externalReference; assert.deepEqual(ref, { source: 'DOCTORALIA', externalId: 'p-a' }); });
test('R2B2 refs 30 — consulta preserva eventId como referência externa', () => { const ref = analysis.dryRun.appointments.find(item => item.externalEventId === 'e-future')?.externalReference; assert.deepEqual(ref, { source: 'DOCTORALIA', externalId: 'e-future' }); });
test('R2B2 refs 31 — schedule id não vira id interno', () => { const item = analysis.dryRun.appointments.find(candidate => candidate.externalEventId === 'e-future'); assert.equal(item?.externalScheduleId, 's-3'); assert.notEqual(item?.externalEventId, item?.externalScheduleId); });
test('R2B2 fields 32 — normaliza endereço com typo neighbordhood', () => { const address = analysis.dryRun.patients.find(item => item.externalPatientId === 'p-a')?.address; assert.equal(address?.street, 'Rua Sintética'); assert.equal(address?.neighborhood, 'Bairro Teste'); assert.equal(address?.postalCode, '01000-000'); });
test('R2B2 fields 33 — preserva dados sociodemográficos opcionais', () => { const demographics = analysis.dryRun.patients.find(item => item.externalPatientId === 'p-a')?.demographics; assert.equal(demographics?.profession, 'Profissional'); assert.equal(demographics?.nationality, 'Brasileira'); });
test('R2B2 security 34 — medicamentos ficam fora do paciente administrativo', () => { const patient = analysis.dryRun.patients.find(item => item.externalPatientId === 'p-a'); assert.equal('medications' in patient!, false); });
test('R2B2 security 35 — medicamentos ficam no background protegido', () => { const background = analysis.dryRun.clinicalBackgrounds.find(item => item.externalPatientId === 'p-a'); assert.equal(background?.protected, true); assert.equal(background?.source, 'DOCTORALIA'); });
test('R2B2 catalog 36 — deduplica serviços pela origem normalizada', () => assert.equal(analysis.dryRun.services.length, 1));
test('R2B2 catalog 37 — cria catálogo de local físico sem lista hardcoded', () => { assert.equal(analysis.dryRun.locations.length, 2); assert.equal(analysis.dryRun.locations.some(item => item.name === 'Consultório Sintético'), true); });
test('R2B2 safety 38 — dry-run não grava', () => { assert.equal(analysis.dryRun.writesPerformed, false); assert.equal(analysis.dryRun.persisted, false); assert.equal(analysis.dryRun.deletesPerformed, false); });
test('R2B2 safety 39 — relatório agregado não expõe PII', () => { const report = buildDoctoraliaDryRunReport(analysis); assert.equal(report.includes('Paciente'), false); assert.equal(report.includes('11999990001'), false); assert.equal(report.includes('paciente.a@example.test'), false); assert.equal(report.includes('medicação protegida'), false); assert.equal(report.includes('p-a'), false); });
test('R2B2 safety 40 — relatório declara dry-run e ausência de IDs individuais', () => { const report = buildDoctoraliaDryRunReport(analysis); assert.match(report, /writesPerformed=false/); assert.match(report, /sem nomes/); });
test('R2B2 safety 41 — lista de campos ignorados cobre comentários e recorrência', () => { assert.equal(DOCTORALIA_IGNORED_FIELDS.includes('comments'), true); assert.equal(DOCTORALIA_IGNORED_FIELDS.includes('recurrency type'), true); });
test('R2B2 adapter 42 — adapter completo expõe análise Doctoralia', () => { const input: ImportFileInput = { ...patientsFile, relatedFiles: [appointmentsFile] }; const result = new DoctoraliaImportAdapter().analyze(input); assert.equal(result.doctoralia?.recognition.recognized, true); assert.equal(result.doctoralia?.dryRun.writesPerformed, false); });
test('R2B2 adapter 43 — bundle padrão recebe apenas candidatos importáveis', () => assert.deepEqual(analysis.bundle.patients.map(item => item.externalId), ['p-a', 'p-b', 'p-c']));
test('R2B2 adapter 44 — bundle padrão não recebe medicamento clínico', () => assert.equal(JSON.stringify(analysis.bundle).includes('medicação protegida'), false));
