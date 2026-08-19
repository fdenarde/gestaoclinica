import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { getSaoPauloDateKey } from '../shared/clinicalDate.js';
import {
  buildMonitoringPatientSummary,
  getMonitoringUpcomingSessionGroups,
  getSaoPauloWeekRange,
} from '../shared/monitoringPanel.js';
import { buildResponsiblePackages } from '../api/_lib/responsiblePortalPackages.js';
import { buildResponsiblePortalSessionProgress } from '../shared/responsiblePortalSessions.js';
import { resolveActivityUploadState } from '../shared/activityGalleryStatus.js';
import { buildUnregisteredActivityGroups } from '../shared/unregisteredActivities.js';

const projectRoot = new URL('../', import.meta.url);

function readProjectFile(relativePath) {
  return fs.readFileSync(new URL(relativePath, projectRoot), 'utf8');
}

test('AUD-006 usa a data civil de São Paulo e não a data UTC', () => {
  const lateBrt = new Date('2026-08-18T21:30:00-03:00');
  const earlyBrt = new Date('2026-08-19T00:30:00-03:00');
  const endOfDayBrt = new Date('2026-08-18T23:30:00-03:00');

  assert.equal(lateBrt.toISOString().slice(0, 10), '2026-08-19');
  assert.equal(getSaoPauloDateKey(lateBrt), '2026-08-18');
  assert.equal(getSaoPauloDateKey(earlyBrt), '2026-08-19');
  assert.equal(getSaoPauloDateKey(endOfDayBrt), '2026-08-18');
});

test('Portal, Monitoramento e semana clínica concordam no mesmo dia controlado', () => {
  const now = new Date('2026-08-18T21:30:00-03:00');
  const today = getSaoPauloDateKey(now);
  const sessions = [
    { id: 'today', patientId: 'p1', date: '2026-08-18', time: '18:00', status: 'Agendada' },
    { id: 'tomorrow', patientId: 'p1', date: '2026-08-19', time: '18:00', status: 'Agendada' },
  ];
  const patient = { id: 'p1', name: 'Paciente', status: 'Ativo' };

  assert.equal(today, '2026-08-18');
  assert.equal(getMonitoringUpcomingSessionGroups(sessions, now).today, today);
  assert.equal(buildMonitoringPatientSummary(patient, sessions, 0, 10, now).nextSession.id, 'today');
  assert.deepEqual(getSaoPauloWeekRange(now), { start: '2026-08-16', end: '2026-08-22' });

  const portalProgress = buildResponsiblePortalSessionProgress(
    sessions.map((session, index) => ({ ...session, sessionNumber: index + 1 })),
    { today, consumedCount: 0 },
  );
  assert.equal(portalProgress.visibleGroups.some(group => group.referenceEvent?.date === today), true);
  assert.equal(portalProgress.nextSessionNumber, 2);

  const portalPackages = buildResponsiblePackages(sessions, { today, payments: [], patient });
  assert.equal(portalPackages.packages[0].sessions[0].isFuture, false);
  assert.equal(portalPackages.packages[0].sessions[1].isFuture, true);
});

test('AUD-006 remove a fronteira UTC dos consumidores clínicos prioritários', () => {
  const accessSource = readProjectFile('api/access.js');
  const portalPackagesSource = readProjectFile('api/_lib/responsiblePortalPackages.js');
  const monitoringSource = readProjectFile('shared/monitoringPanel.js');
  const sessionSummarySource = readProjectFile('shared/sessionPackageSummary.js');

  for (const source of [accessSource, portalPackagesSource, monitoringSource, sessionSummarySource]) {
    assert.equal(source.includes("new Date().toISOString().slice(0, 10)"), false);
    assert.match(source, /getSaoPauloDateKey/);
  }
});

test('AUD-007 confirma sucesso somente com true, trata false e rejeição nos mocks', async () => {
  const outcomes = [];
  const submit = async (onUpdate) => {
    try {
      const persisted = await onUpdate();
      if (persisted !== true) throw new Error('Persistência não confirmada.');
      outcomes.push('success');
      return true;
    } catch {
      outcomes.push('error');
      return false;
    }
  };

  assert.equal(await submit(async () => true), true);
  assert.equal(await submit(async () => false), false);
  assert.equal(await submit(async () => { throw new Error('mock failure'); }), false);
  assert.deepEqual(outcomes, ['success', 'error', 'error']);
});

test('AUD-007 consumidores clínicos não exibem sucesso sem confirmação booleana', () => {
  for (const relativePath of [
    'src/components/Agenda.tsx',
    'src/components/Dashboard.tsx',
    'src/components/Patients.tsx',
  ]) {
    const source = readProjectFile(relativePath);
    assert.match(source, /persisted !== true/);
    assert.match(source, /Não foi possível/);
  }
});

test('AUD-008 protege ações prioritárias com locks locais e libera em finally', () => {
  const agenda = readProjectFile('src/components/Agenda.tsx');
  const dashboard = readProjectFile('src/components/Dashboard.tsx');
  const patients = readProjectFile('src/components/Patients.tsx');

  for (const token of ['scheduleSaveLockRef', 'repositionSaveLockRef', 'reopenLockRef', 'rescheduleLockRef']) {
    assert.match(agenda, new RegExp(token));
  }
  assert.match(agenda, /finally \{[\s\S]*?scheduleSaveLockRef\.current = false/);
  assert.match(agenda, /finally \{[\s\S]*?repositionSaveLockRef\.current = false/);
  assert.match(agenda, /disabled=\{isSavingSchedule/);
  assert.match(agenda, /disabled=\{isSavingReposition/);
  assert.match(dashboard, /manualActionLocksRef/);
  assert.match(dashboard, /finally \{[\s\S]*?manualActionLocksRef\.current\.delete/);
  assert.match(patients, /repositionWriteLockRef/);
  assert.match(patients, /generatePackageLockRef/);
  assert.match(patients, /sessionStatusLocksRef/);
});

test('R5 permanece intacto: Reposição, excused e falsa pendência seguem canônicos', () => {
  const session = {
    id: 'replacement-1',
    patientId: 'p1',
    date: '2026-08-18',
    time: '18:00',
    status: 'Reposição',
    type: 'Sessão simples',
  };
  const statusRecord = {
    patientId: 'p1',
    sessionId: 'replacement-1',
    hasMedia: false,
    mediaCount: 0,
    justification: { active: true, reason: 'technical_issue' },
  };
  const resolved = resolveActivityUploadState({
    session,
    monitoringStart: '2026-01-01',
    statusRecord,
    now: new Date('2026-08-20T12:00:00-03:00'),
  });
  assert.equal(resolved.state, 'excused');

  const groups = buildUnregisteredActivityGroups({
    patients: [{ id: 'p1', name: 'Paciente', status: 'Ativo' }],
    sessions: [session],
    activityRecords: [],
    googlePhotosAlbums: [],
    activityUploadStatus: [statusRecord],
    now: new Date('2026-08-20T12:00:00-03:00'),
  });
  assert.equal(groups.length, 0);
});
