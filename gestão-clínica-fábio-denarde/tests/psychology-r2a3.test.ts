import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  getActivePsychologySessionPackages,
  getPsychologySessionPackageProgress,
  getPsychologySessionPackageRemaining,
  upsertPsychologyPatient,
  upsertPsychologySession,
  upsertPsychologySessionPackage,
  type PsychologyPatientInput,
  type PsychologySessionPackageInput,
} from '../src/features/psychology-pilot/psychologyDomain.ts';

const patientInput: PsychologyPatientInput = {
  name: 'Paciente R2A3', birthDate: '1990-08-20', phone: '27999990000', email: '',
  preferredModality: 'online', administrativeNote: '', active: true,
};

const packageInput = (patientId: string, totalSessions: number, usedSessions = 0): PsychologySessionPackageInput => ({
  patientId, name: `Pacote de ${totalSessions}`, totalSessions, usedSessions, startDate: '2026-08-01', active: true,
});

test('Meu Dia calcula indicadores operacionais sem pacote obrigatório', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2a3-indicators'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-r2a3');
  store = upsertPsychologySession(store, { patientId: 'patient-r2a3', date: '2026-08-10', time: '09:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-realized');
  store = upsertPsychologySession(store, { patientId: 'patient-r2a3', date: '2026-08-11', time: '10:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-absence');
  store.sessions = store.sessions.map(session => session.id === 'session-realized' ? { ...session, status: 'realizada' as const } : session.id === 'session-absence' ? { ...session, status: 'falta' as const } : session);
  assert.equal(store.patients.filter(patient => patient.active).length, 1);
  assert.equal(store.sessions.length, 2);
  assert.equal(Math.round((store.sessions.filter(session => session.status === 'realizada').length / 2) * 100), 50);
  assert.equal(store.sessionPackages.length, 0);
});

test('pacotes de 4, 8 e 10 são válidos sem tornar 10 o padrão', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2a3-packages'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-r2a3');
  for (const [id, total] of [['package-4', 4], ['package-8', 8], ['package-10', 10]] as const) {
    store = upsertPsychologySessionPackage(store, packageInput('patient-r2a3', total), id);
  }
  assert.deepEqual(store.sessionPackages.map(item => item.totalSessions), [4, 8, 10]);
  assert.equal(store.sessionPackages.find(item => item.id === 'package-4')?.totalSessions, 4);
});

test('progresso, restante e limite de usedSessions são seguros', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2a3-progress'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-r2a3');
  store = upsertPsychologySessionPackage(store, packageInput('patient-r2a3', 8, 7), 'package-8');
  const item = store.sessionPackages[0];
  assert.equal(getPsychologySessionPackageProgress(item), 88);
  assert.equal(getPsychologySessionPackageRemaining(item), 1);
  assert.equal(upsertPsychologySessionPackage(store, packageInput('patient-r2a3', 8, 9), 'invalid').sessionPackages.length, 1);
});

test('pacote encerrado não aparece no acompanhamento ativo', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('r2a3-active'));
  store = upsertPsychologyPatient(store, patientInput, 'patient-r2a3');
  store = upsertPsychologySessionPackage(store, packageInput('patient-r2a3', 4, 4), 'closed');
  assert.equal(getActivePsychologySessionPackages(store).length, 0);
});

test('Meu Dia usa cards compactos e mantém somente indicadores operacionais prontos', async () => {
  const pilot = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  assert.match(pilot, /psychology-my-day-dashboard/);
  for (const label of ['Pacientes ativos', 'Sessões na semana', 'Assiduidade', 'Aniversariantes do mês', 'Hoje', 'Pendências', 'Agenda Pessoal', 'Próximas Sessões — Hoje', 'Próximas Sessões — Amanhã']) assert.match(pilot, new RegExp(label));
  const dayView = pilot.slice(pilot.indexOf('function DayView'), pilot.indexOf('function DateToolbar'));
  assert.doesNotMatch(dayView, /Recebido no mês|pagamentos locais|Acompanhamento|psychology-package-panel/);
  assert.match(pilot, /psychology-session-compact-card/);
  assert.doesNotMatch(pilot, /width: 100vw|w-screen/);
  assert.doesNotMatch(pilot, /Atendente|Responsável|Progresso dos Atendentes/);
});

test('pacotes e alertas permanecem separados do Financeiro Neuro', async () => {
  const domain = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/psychologyDomain.ts'), 'utf8');
  const r2a = await readFile(resolve(process.cwd(), 'src/features/psychology-pilot/psychologyR2a.ts'), 'utf8');
  assert.match(domain + r2a, /PsychologySessionPackage/);
  assert.match(domain, /professionalId: store\.scope\.professionalId/);
  assert.match(domain, /context: PSYCHOLOGY_CONTEXT/);
  assert.doesNotMatch(domain + r2a, /R\$ 1\.000|tolerância|reposiç/);
});
