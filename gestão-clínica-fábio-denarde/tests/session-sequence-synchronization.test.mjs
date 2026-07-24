import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  dedupeSessionsByStableIdentity,
  getSessionCycleLabel,
  getSessionPackagePosition,
  getSessionSequenceSortKey,
  mergeSessionSequenceSource,
  sessionAllowsActivity,
  sessionConsumesPackage,
} from '../shared/sessionScheduling.js';
import { buildCurrentPackageSessionSummary } from '../shared/sessionPackageSummary.js';
import { buildResponsiblePackages } from '../api/_lib/responsiblePortalPackages.js';
import { buildResponsiblePortalSessionProgress } from '../shared/responsiblePortalSessions.js';
import { buildMonitoringPatientSummary } from '../shared/monitoringPanel.js';
import { buildActivityMediaPackageModel } from '../shared/activityMediaPackages.js';
import { removeSessionFromAgenda } from '../shared/sessionRemoval.js';

const PATIENT_ID = 'celso-fixture-isolada';
const PATIENT = {
  id: PATIENT_ID,
  name: 'Celso (Teste Isolado)',
  fullName: 'Celso (Teste Isolado)',
  guardianName: 'Responsável Fictício',
  status: 'Ativo',
  startDate: '2026-07-01',
};
const THROUGH_DATE = '2026-07-24';

function completedSessions(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    id: `consumed-${String(index + 1).padStart(2, '0')}`,
    patientId: PATIENT_ID,
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    time: '14:00',
    type: 'Sessão simples (50 min)',
    status: index === 3 ? 'Reposição' : 'Realizada',
  }));
}

function absence(id, time, consumesPackage, storedNumber) {
  return {
    id,
    patientId: PATIENT_ID,
    date: THROUGH_DATE,
    time,
    type: 'Sessão dupla (2 × 50 min)',
    status: 'Falta',
    consumesPackage,
    logicalSessionNumber: storedNumber,
    packageNumber: storedNumber,
  };
}

function buildCelsoScenario(firstConsumes, secondConsumes) {
  const first = absence('celso-double-14', '14:00', firstConsumes, 2);
  const second = absence('celso-double-15', '15:00', secondConsumes, 9);
  return {
    first,
    second,
    sessions: [...completedSessions(), first, second],
  };
}

function scenarioResult(firstConsumes, secondConsumes) {
  const scenario = buildCelsoScenario(firstConsumes, secondConsumes);
  const summary = buildCurrentPackageSessionSummary(
    PATIENT,
    scenario.sessions,
    10,
    { throughDate: THROUGH_DATE },
  );
  return {
    ...scenario,
    summary,
    firstPosition: getSessionPackagePosition(scenario.sessions, scenario.first),
    secondPosition: getSessionPackagePosition(scenario.sessions, scenario.second),
    firstLabel: getSessionCycleLabel(scenario.sessions, scenario.first),
    secondLabel: getSessionCycleLabel(scenario.sessions, scenario.second),
  };
}

test('1-2. oito consumidas e duas faltas false consecutivas projetam ambas a posição 9', () => {
  const result = scenarioResult(false, false);
  assert.deepEqual([result.summary.count, result.summary.remaining], [8, 2]);
  assert.deepEqual(
    [result.firstPosition.sessionNumber, result.secondPosition.sessionNumber],
    [9, 9],
  );
  assert.deepEqual([result.firstLabel, result.secondLabel], ['Sessão seria 9', 'Sessão seria 9']);
});

test('3. primeira true e segunda false ocupam/projetam posições 9 e 10', () => {
  const result = scenarioResult(true, false);
  assert.deepEqual([result.summary.count, result.summary.remaining], [9, 1]);
  assert.deepEqual(
    [result.firstPosition.logicalPosition, result.secondPosition.logicalPosition],
    [9, 10],
  );
  assert.deepEqual([result.firstLabel, result.secondLabel], ['Sessão foi 9', 'Sessão seria 10']);
});

test('4. primeira false e segunda true projetam/ocupam a mesma próxima posição 9', () => {
  const result = scenarioResult(false, true);
  assert.deepEqual([result.summary.count, result.summary.remaining], [9, 1]);
  assert.deepEqual(
    [result.firstPosition.logicalPosition, result.secondPosition.logicalPosition],
    [9, 9],
  );
  assert.deepEqual([result.firstLabel, result.secondLabel], ['Sessão seria 9', 'Sessão foi 9']);
});

test('5. ambas true ocupam posições 9 e 10 em ordem cronológica', () => {
  const result = scenarioResult(true, true);
  assert.deepEqual([result.summary.count, result.summary.remaining], [10, 0]);
  assert.deepEqual(
    [result.firstPosition.logicalPosition, result.secondPosition.logicalPosition],
    [9, 10],
  );
});

test('6. a primeira sessão da dupla nunca reutiliza o número legado 2', () => {
  const result = scenarioResult(false, false);
  assert.equal(result.first.packageNumber, 2);
  assert.equal(result.first.logicalSessionNumber, 2);
  assert.notEqual(result.firstLabel, 'Sessão seria 2');
  assert.equal(result.firstLabel, 'Sessão seria 9');
});

test('7-9. ordenação, IDs distintos e deduplicação real permanecem determinísticos', () => {
  const { first, second } = buildCelsoScenario(false, false);
  assert.ok(getSessionSequenceSortKey(first) < getSessionSequenceSortKey(second));

  const sameTimeA = { ...first, id: 'same-time-a', time: '16:00', consumesPackage: true };
  const sameTimeB = { ...first, id: 'same-time-b', time: '16:00', consumesPackage: true };
  assert.equal(dedupeSessionsByStableIdentity([sameTimeA, sameTimeB]).length, 2);
  assert.equal(dedupeSessionsByStableIdentity([sameTimeA, { ...sameTimeA }]).length, 1);

  const source = [...completedSessions(), sameTimeB, sameTimeA];
  assert.deepEqual(
    [
      getSessionPackagePosition(source, sameTimeA).logicalPosition,
      getSessionPackagePosition(source, sameTimeB).logicalPosition,
    ],
    [9, 10],
  );
});

test('10. reload preserva a sequência derivada sem depender de cache React', () => {
  const before = scenarioResult(false, false);
  const reloaded = JSON.parse(JSON.stringify(before.sessions));
  assert.deepEqual(
    reloaded.slice(-2).map(session => getSessionCycleLabel(reloaded, session)),
    ['Sessão seria 9', 'Sessão seria 9'],
  );
});

test('11-12. reabertura e remoção recalculam os eventos posteriores', () => {
  const counted = scenarioResult(true, false);
  const reopened = counted.sessions.map(session => session.id === counted.first.id
    ? { ...session, status: 'Agendada', consumesPackage: false }
    : session);
  assert.deepEqual(
    reopened.slice(-2).map(session => getSessionPackagePosition(reopened, session).sessionNumber),
    [9, 9],
  );

  const removed = removeSessionFromAgenda(counted.sessions, counted.first.id, {
    removedAt: '2026-07-24T18:00:00.000Z',
    removedBy: 'Teste automatizado',
  }).sessions;
  const second = removed.find(session => session.id === counted.second.id);
  assert.equal(getSessionPackagePosition(removed, second).sessionNumber, 9);
});

test('13-14. alternar true/false recalcula apenas a sequência posterior', () => {
  const bothCounted = scenarioResult(true, true);
  const onlySecondCounted = scenarioResult(false, true);
  const noneCounted = scenarioResult(false, false);
  const onlyFirstCounted = scenarioResult(true, false);

  assert.equal(bothCounted.secondPosition.sessionNumber, 10);
  assert.equal(onlySecondCounted.secondPosition.sessionNumber, 9);
  assert.equal(noneCounted.firstPosition.sessionNumber, 9);
  assert.equal(onlyFirstCounted.firstPosition.sessionNumber, 9);
});

test('15. sessão virtual e materializada produzem a mesma posição', () => {
  const realized = completedSessions();
  const virtual = {
    id: 'virtual-celso-2026-07-24-14:00',
    patientId: PATIENT_ID,
    date: THROUGH_DATE,
    time: '14:00',
    status: 'Agendada',
    type: 'Sessão dupla (2 × 50 min)',
    packageNumber: 0,
    isVirtual: true,
  };
  const materialized = {
    ...virtual,
    id: 'materialized-celso-14',
    packageNumber: 2,
    isVirtual: false,
  };
  const virtualSource = mergeSessionSequenceSource(realized, [virtual]);
  const materializedSource = [...realized, materialized];
  assert.equal(getSessionPackagePosition(virtualSource, virtual).sessionNumber, 9);
  assert.equal(getSessionPackagePosition(materializedSource, materialized).sessionNumber, 9);
});

test('16-20. Agenda, Patients, Relatórios, Portal, Dashboard e Monitoramento convergem', () => {
  const result = scenarioResult(false, false);
  const portal = buildResponsiblePackages(result.sessions, {
    today: THROUGH_DATE,
    payments: [{ patientId: PATIENT_ID, amount: 1000, packageNumber: 1 }],
  });
  const portalAbsences = portal.packages[0].sessions.filter(session => session.status === 'Falta');
  const portalProgress = buildResponsiblePortalSessionProgress(portal.packages[0].sessions, {
    today: THROUGH_DATE,
    consumedCount: portal.packages[0].consumedCount,
  });
  const monitoring = buildMonitoringPatientSummary(PATIENT, result.sessions, 0, 10);

  assert.deepEqual(portalAbsences.map(session => session.sessionNumber), [9, 9]);
  assert.deepEqual(portalAbsences.map(session => session.positionType), ['projected', 'projected']);
  assert.equal(portalProgress.visibleGroups.filter(group => group.number === 9).length, 2);
  assert.deepEqual(
    portalProgress.visibleGroups
      .filter(group => group.number === 9)
      .map(group => group.events.map(session => session.id)),
    [['celso-double-15'], ['celso-double-14']],
  );
  assert.deepEqual([portal.consumedTotal, portal.packages[0].remainingCount], [8, 2]);
  assert.equal(monitoring.currentPackageRealized, 8);
  assert.equal(result.summary.count, 8);
  assert.deepEqual(
    result.sessions.slice(-2).map(session => getSessionCycleLabel(result.sessions, session)),
    ['Sessão seria 9', 'Sessão seria 9'],
  );

  const patients = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  const dashboard = fs.readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const monitoringPanel = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
  const responsiblePortal = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.match(patients, /buildCurrentPackageSessionSummary/);
  assert.match(patients, /getSessionCycleLabel\(state\.sessions, session\)/);
  assert.match(reports, /buildCurrentPackageSessionSummary/);
  assert.match(reports, /getSessionCycleNumber/);
  assert.match(dashboard, /calculatePackageFinancialSummary/);
  assert.match(dashboard, /getSessionCycleLabel/);
  assert.match(dashboard, /dashboardSequenceSource/);
  assert.match(dashboard, /mergeSessionSequenceSource/);
  assert.match(monitoringPanel, /buildCurrentPackageSessionSummaries/);
  assert.match(responsiblePortal, /Sessão seria/);
});

test('20b. Dashboard numera as próximas sessões virtuais da dupla', () => {
  const result = scenarioResult(false, false);
  const nextFirst = {
    ...absence('virtual-next-14', '14:00', undefined, 0),
    date: '2026-07-31',
    status: 'Agendada',
  };
  const nextSecond = {
    ...absence('virtual-next-15', '15:00', undefined, 0),
    date: '2026-07-31',
    status: 'Agendada',
  };
  delete nextFirst.consumesPackage;
  delete nextSecond.consumesPackage;

  const source = mergeSessionSequenceSource(result.sessions, [nextFirst, nextSecond]);
  assert.deepEqual(
    [nextFirst, nextSecond].map(session => getSessionCycleLabel(source, session)),
    ['Sessão será 9', 'Sessão será 10'],
  );
});

test('21. galeria não cria atividade para ausência', () => {
  const result = scenarioResult(false, false);
  const model = buildActivityMediaPackageModel(result.sessions, {
    patientId: PATIENT_ID,
    now: new Date('2026-07-24T18:00:00-03:00'),
  });
  assert.equal(sessionAllowsActivity(result.first), false);
  assert.equal(model.currentSessions.some(session => session.id === result.first.id), false);
  assert.equal(model.currentSessions.some(session => session.id === result.second.id), false);
});

test('22-24. realizada e reposição consomem; falta do profissional não consome', () => {
  assert.equal(sessionConsumesPackage({ status: 'Realizada' }), true);
  assert.equal(sessionConsumesPackage({ status: 'Reposição' }), true);
  assert.equal(sessionConsumesPackage({ status: 'Falta.Prof', consumesPackage: true }), false);
});

test('25. pacote renovado não mistura a sequência anterior', () => {
  const sessions = completedSessions(18);
  const first = absence('renewed-14', '14:00', false, 2);
  const second = absence('renewed-15', '15:00', false, 9);
  const source = [...sessions, first, second];
  const summary = buildCurrentPackageSessionSummary(PATIENT, source, 10, { throughDate: THROUGH_DATE });
  assert.deepEqual([summary.count, summary.remaining], [8, 2]);
  assert.deepEqual(
    [first, second].map(session => getSessionPackagePosition(source, session).sessionNumber),
    [9, 9],
  );
});

test('25b. dupla na fronteira de renovação não inclui a 10ª sessão no pacote seguinte', () => {
  const sessions = completedSessions(11).map((session, index) => (
    index >= 9 ? { ...session, date: '2026-07-10', time: index === 9 ? '14:00' : '15:00' } : session
  ));
  const summary = buildCurrentPackageSessionSummary(PATIENT, sessions, 10, { throughDate: THROUGH_DATE });
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.sessions.map(session => session.id), ['consumed-11']);
});

test('26. datas e horários iguais têm desempate estável por ID', () => {
  const realized = completedSessions();
  const left = absence('equal-a', '14:00', true, 2);
  const right = absence('equal-b', '14:00', true, 2);
  const forward = [...realized, left, right];
  const reverse = [...realized, right, left];
  for (const source of [forward, reverse]) {
    assert.equal(getSessionPackagePosition(source, left).logicalPosition, 9);
    assert.equal(getSessionPackagePosition(source, right).logicalPosition, 10);
  }
});

test('decisão ausente não avança e aponta para a próxima posição consumível', () => {
  const sessions = completedSessions();
  const undecided = { ...absence('undecided', '14:00', undefined, 2) };
  delete undecided.consumesPackage;
  const source = [...sessions, undecided];
  const summary = buildCurrentPackageSessionSummary(PATIENT, source, 10, { throughDate: THROUGH_DATE });
  assert.deepEqual([summary.count, summary.remaining], [8, 2]);
  assert.equal(getSessionCycleLabel(source, undecided), 'Sessão seria 9');
});
