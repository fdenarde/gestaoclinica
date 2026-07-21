import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEffectiveSessionHistory,
  getCompletedSessions,
  getSessionCycleNumber,
  sessionAllowsActivity,
  sessionConsumesPackage,
} from '../shared/sessionScheduling.js';
import { buildCurrentPackageSessionSummary } from '../shared/sessionPackageSummary.js';

const PATIENT_ID = 'patient-fixture';
const THROUGH_DATE = '2026-07-31';

function session(id, date, status = 'Realizada', extra = {}) {
  return {
    id,
    patientId: PATIENT_ID,
    date,
    time: '08:00',
    type: 'Sessão simples (50 min)',
    status,
    ...extra,
  };
}

function scenarioSessions() {
  return [
    session('s1', '2026-05-09'),
    session('s2', '2026-05-16'),
    session('s3', '2026-05-23', 'late_cancellation_no_replacement', {
      consumesPackage: true,
      noReplacementReasonText: 'Aviso fora do prazo da fixture',
      logicalSessionPosition: 3,
      logicalSessionNumber: 3,
      packageNumber: 3,
    }),
    session('s4', '2026-05-30'),
    session('s5', '2026-06-06'),
    session('s6', '2026-06-13'),
    session('s7', '2026-06-20'),
    session('s8', '2026-06-27'),
    session('s9', '2026-07-04'),
    session('s10', '2026-07-11'),
  ];
}

test('cenário de 10 sessões inclui a falta contabilizada no consumo, progresso e histórico sem criar atividade', () => {
  const sessions = scenarioSessions();
  const activities = [
    { id: 'activity-s2', sessionId: 's2' },
    { id: 'activity-s4', sessionIds: ['s4'] },
  ];
  const summary = buildCurrentPackageSessionSummary({ id: PATIENT_ID, status: 'Ativo' }, sessions, 10, { throughDate: THROUGH_DATE });
  const history = buildEffectiveSessionHistory(sessions, { patientId: PATIENT_ID, activities, throughDate: THROUGH_DATE });
  const focused = history.filter(item => ['s2', 's3', 's4'].includes(item.sessionId));

  assert.equal(summary.count, 10);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.sessions.some(item => item.id === 's3' && item.date === '2026-05-23'), true);
  assert.deepEqual(focused.map(item => [item.sessionNumber, item.date]), [
    [2, '2026-05-16'],
    [3, '2026-05-23'],
    [4, '2026-05-30'],
  ]);
  assert.equal(focused[1].presentationStatus, 'Falta contabilizada');
  assert.equal(focused[1].consumesPackage, true);
  assert.equal(focused[1].hasActivity, false);
  assert.equal(focused[1].activityCount, 0);
  assert.equal(focused[0].activityCount, 1);
  assert.equal(focused[2].activityCount, 1);
  assert.equal(sessionAllowsActivity(sessions[2]), false);
});

test('fonte estável não duplica id e reload reconstrói consumo, número e ordem idênticos', () => {
  const sessions = scenarioSessions();
  const duplicated = [...sessions, { ...sessions[2] }];
  const before = buildEffectiveSessionHistory(duplicated, { patientId: PATIENT_ID, throughDate: THROUGH_DATE });
  const afterReload = buildEffectiveSessionHistory(JSON.parse(JSON.stringify(duplicated)), { patientId: PATIENT_ID, throughDate: THROUGH_DATE });

  assert.equal(getCompletedSessions(duplicated, PATIENT_ID).length, 10);
  assert.equal(before.filter(item => item.sessionId === 's3').length, 1);
  assert.deepEqual(afterReload, before);
  assert.equal(getSessionCycleNumber(sessions, sessions[2]), 3);
});

test('reabertura, cancelamento e remoção revertem consumo; reposição preserva a semântica atual', () => {
  const counted = scenarioSessions()[2];
  const reopened = {
    ...counted,
    status: 'Agendada',
    consumesPackage: false,
    noReplacementHistory: [{ previousStatus: 'Realizada', newStatus: 'late_cancellation_no_replacement' }],
  };
  const cancelled = { ...counted, status: 'Cancelada' };
  const removed = { ...counted, removedFromAgenda: true, isBlocked: true };

  assert.equal(sessionConsumesPackage(counted), true);
  assert.equal(sessionConsumesPackage(reopened), false);
  assert.equal(sessionConsumesPackage(cancelled), false);
  assert.equal(sessionConsumesPackage(removed), false);
  assert.equal(sessionConsumesPackage(session('replacement', '2026-05-24', 'Reposição')), true);
  assert.equal(sessionConsumesPackage(session('ordinary-absence', '2026-05-24', 'Falta')), false);
  assert.equal(sessionConsumesPackage(session('professional-absence', '2026-05-24', 'Falta.Prof', { consumesPackage: true })), false);
});

test('sessão futura não é consumida no recorte local e ordenação usa data, horário e id sem conversão UTC', () => {
  const sessions = [
    session('same-b', '2026-05-23', 'Realizada', { time: '09:00' }),
    session('same-a', '2026-05-23', 'Realizada', { time: '08:00' }),
    session('future', '2026-08-01', 'Realizada', { time: '08:00' }),
  ];
  const summary = buildCurrentPackageSessionSummary({ id: PATIENT_ID, status: 'Ativo' }, sessions, 10, { throughDate: THROUGH_DATE });
  const history = buildEffectiveSessionHistory(sessions, { patientId: PATIENT_ID, throughDate: THROUGH_DATE });

  assert.equal(summary.count, 2);
  assert.deepEqual(history.map(item => item.sessionId), ['same-a', 'same-b']);
  assert.deepEqual(history.map(item => item.date), ['2026-05-23', '2026-05-23']);
});

test('correção não introduz listener global nem consulta N+1 nas telas alteradas', () => {
  const files = [
    '../shared/sessionScheduling.js',
    '../shared/sessionPackageSummary.js',
    '../src/components/Reports.tsx',
    '../src/components/Patients.tsx',
    '../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx',
  ];
  const source = files.map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /onSnapshot\s*\(/);
  assert.doesNotMatch(source, /\.map\s*\(\s*async\b/);
});
