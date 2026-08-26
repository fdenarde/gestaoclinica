import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildActivityRefreshSignature, selectActivityCandidateSessions, selectActivityRefreshPackages } from '../src/lib/activityRefreshPlan.ts';
import { createActivityRefreshGate } from '../src/lib/activityRefreshGate.ts';

const baseSession = {
  id: 's1',
  patientId: 'p1',
  date: '2026-08-20',
  time: '10:00',
  type: 'Sessão simples (50 min)',
  status: 'Realizada',
  packageNumber: 1,
};

function fixtureState() {
  return {
    patients: [{
      id: 'p1',
      name: 'Paciente 1',
      fullName: 'Paciente 1',
      guardianName: 'Responsável',
      fixedDay: 'terça',
      fixedTime: '10:00',
      paymentModal: 'PADRÃO: Pix integral — R$1.000 antes da 1ª sessão',
      startDate: '2026-08-01',
      packageTolerances: [],
    }],
    sessions: [{ ...baseSession }],
    payments: [],
    repositions: [],
    expenses: [],
    evolutions: [],
    settings: { activityMediaMonitoringStart: '2026-08-01' },
    personalAppointments: [],
    externalRegistrationForms: [],
  };
}

function wait(milliseconds = 10) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('R3-01 filtra candidatos antes das consultas de presença', () => {
  const state = fixtureState();
  state.sessions.push(
    { ...baseSession, id: 'old', date: '2026-07-31' },
    { ...baseSession, id: 'scheduled', status: 'Agendada' },
    { ...baseSession, id: 'blocked', isBlocked: true },
    { ...baseSession, id: 'reposition', status: 'Reposição' },
  );
  assert.deepEqual(selectActivityCandidateSessions(state).map(session => session.id), ['s1', 'reposition']);
});
test('R3-02 consulta somente pacotes que contêm sessões candidatas', () => {
  const state = fixtureState();
  const candidateSessions = selectActivityCandidateSessions(state);
  const packages = [
    { number: 1, status: 'previous', startDate: '', endDate: '', sessions: [{ id: 'old' }] },
    { number: 2, status: 'current', startDate: '', endDate: '', sessions: [{ id: 's1' }] },
  ];
  assert.deepEqual(selectActivityRefreshPackages(packages, candidateSessions).map(pkg => pkg.number), [2]);
});

test('R3-03 assinatura ignora despesas/agenda pessoal e reage a dados relevantes', () => {
  const state = fixtureState();
  const initial = buildActivityRefreshSignature(state);
  const unrelated = structuredClone(state);
  unrelated.expenses = [{ id: 'e1', description: 'Despesa', amount: 10, date: '2026-08-20', category: 'Outro' }];
  unrelated.personalAppointments = [{ id: 'a1', type: 'Outro', date: '2026-08-20', time: '12:00', durationMinutes: 30, recurrence: 'Não repetir', notes: '', alarmEnabled: false, isDone: false }];
  assert.equal(buildActivityRefreshSignature(unrelated), initial);

  const changedSession = structuredClone(state);
  changedSession.sessions[0].status = 'Reposição';
  assert.notEqual(buildActivityRefreshSignature(changedSession), initial);

  const changedTolerance = structuredClone(state);
  changedTolerance.patients[0].packageTolerances = [{ packageNumber: 1, grantedAt: '2026-08-20', grantedBy: 'tester' }];
  assert.notEqual(buildActivityRefreshSignature(changedTolerance), initial);
});

test('R3-04 gate compartilha a mesma execução para chamadas pendentes', async () => {
  const gate = createActivityRefreshGate();
  let calls = 0;
  const task = async () => { calls += 1; };
  await Promise.all([
    gate.schedule('same', task, 5),
    gate.schedule('same', task, 5),
  ]);
  assert.equal(calls, 1);
  await gate.schedule('same', task, 0);
  assert.equal(calls, 1);
  gate.dispose();
});

test('R3-05 gate substitui por uma única chamada a última assinatura relevante', async () => {
  const gate = createActivityRefreshGate();
  const calls = [];
  const first = gate.schedule('first', async () => { calls.push('first'); }, 20);
  const second = gate.schedule('second', async () => { calls.push('second'); }, 5);
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['second']);
  gate.dispose();
});

test('R3-06 gate deduplica execução concorrente e permite force após conclusão', async () => {
  const gate = createActivityRefreshGate();
  let calls = 0;
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const task = async () => { calls += 1; await blocker; };
  const first = gate.runNow('concurrent', task, true);
  const second = gate.runNow('concurrent', task, true);
  assert.equal(calls, 0);
  await wait(0);
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  await gate.runNow('concurrent', async () => { calls += 1; }, true);
  assert.equal(calls, 2);
  gate.dispose();
});

test('R3-07 consultas Google Photos têm contrato de in-flight, cache e evento preservados', () => {
  const source = readFileSync(new URL('../src/lib/googlePhotosAlbumsApi.ts', import.meta.url), 'utf8');
  assert.match(source, /const responseInFlight = new Map/);
  assert.match(source, /responseInFlight\.get\(cacheLookupKey\)/);
  assert.match(source, /responseInFlight\.set\(cacheLookupKey, requestPromise\)/);
  assert.match(source, /responseInFlight\.delete\(cacheLookupKey\)/);
  assert.match(source, /invalidateGooglePhotosAlbumsCache/);
  assert.match(source, /emitGooglePhotosAlbumsChanged/);
});

test('R3-08 App usa gate único e não depende do objeto state inteiro no callback', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /createActivityRefreshGate/);
  assert.match(source, /requestUnregisteredActivityRefresh\(true, 1200\)/);
  assert.doesNotMatch(source, /\}, \[canAccessInternalSystem, state\]\);/);
});
