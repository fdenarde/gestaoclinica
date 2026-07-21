import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEffectiveSessionHistory,
  dedupeSessionsByStableIdentity,
  getSessionPresentationStatus,
  sessionAllowsActivity,
  sessionConsumesPackage,
} from '../shared/sessionScheduling.js';
import { buildCurrentPackageSessionSummary } from '../shared/sessionPackageSummary.js';
import { buildActivityMediaPackageModel } from '../shared/activityMediaPackages.js';
import { buildGooglePhotosVirtualAlbumCards } from '../shared/googlePhotosAlbums.js';
import { buildResponsiblePackages } from '../api/_lib/responsiblePortalPackages.js';
import { removeSessionFromAgenda } from '../shared/sessionRemoval.js';

const PATIENT_ID = 'paciente-teste-decisao';
const NOW = new Date('2026-06-30T15:00:00.000Z');
const THROUGH_DATE = '2026-06-30';

function makeSession(id, date, status, extra = {}) {
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

function buildScenario(consumesPackage, reason) {
  return [
    makeSession('s1', '2026-05-09', 'Realizada'),
    makeSession('s2', '2026-05-16', 'Realizada'),
    makeSession('s3', '2026-05-23', 'Falta', {
      consumesPackage,
      noReplacementReasonText: reason,
      logicalSessionPosition: 3,
      logicalSessionNumber: 3,
      packageNumber: 3,
    }),
    ...Array.from({ length: 7 }, (_, index) => (
      makeSession(`s${index + 4}`, `2026-06-${String(index + 1).padStart(2, '0')}`, 'Realizada')
    )),
  ];
}

test('1. Falta sem decisão explícita não consome', () => {
  assert.equal(sessionConsumesPackage(makeSession('f1', '2026-05-23', 'Falta')), false);
});

test('2. late_cancellation_no_replacement sem decisão explícita não consome', () => {
  assert.equal(sessionConsumesPackage(makeSession('f2', '2026-05-23', 'late_cancellation_no_replacement')), false);
});

test('3. falta com consumesPackage false não consome', () => {
  assert.equal(sessionConsumesPackage(makeSession('f3', '2026-05-23', 'Falta', { consumesPackage: false })), false);
});

test('4. falta com consumesPackage true consome', () => {
  assert.equal(sessionConsumesPackage(makeSession('f4', '2026-05-23', 'Falta', { consumesPackage: true })), true);
});

test('5. o motivo não altera automaticamente a decisão', () => {
  for (const reason of ['emergência familiar', 'ausência sem justificativa']) {
    assert.equal(sessionConsumesPackage(makeSession(`reason-${reason}`, '2026-05-23', 'Falta', { noReplacementReasonText: reason })), false);
  }
});

test('6. ausência sem reposição não implica consumo', () => {
  assert.equal(sessionConsumesPackage(makeSession('no-replacement', '2026-05-23', 'late_cancellation_no_replacement', {
    noReplacementReasonText: 'Sem reposição',
  })), false);
});

test('7. cancelamento tardio não implica consumo', () => {
  assert.equal(sessionConsumesPackage(makeSession('late', '2026-05-23', 'late_cancellation_no_replacement', {
    noReplacementReasonCode: 'late_notice_or_out_of_policy_cancellation',
  })), false);
});

test('8. a interface exige escolha e bloqueia salvar sem decisão', () => {
  const field = fs.readFileSync(new URL('../src/components/Common/PackageConsumptionDecisionField.tsx', import.meta.url), 'utf8');
  const modal = fs.readFileSync(new URL('../src/components/Common/PackageConsumptionDecisionModal.tsx', import.meta.url), 'utf8');
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  assert.match(field, /Esta ausência será contabilizada no pacote\?/);
  assert.match(modal, /disabled=\{value === null \|\| isSaving\}/);
  assert.match(agenda, /consumesPackage: null/);
});

test('9. a opção não contabilizar permite persistir false', () => {
  const field = fs.readFileSync(new URL('../src/components/Common/PackageConsumptionDecisionField.tsx', import.meta.url), 'utf8');
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  assert.match(field, /onChange\(false\)/);
  assert.match(field, /Esta decisão não reduzirá as sessões restantes\./);
  assert.match(agenda, /consumesPackage,/);
});

test('10. a opção contabilizar permite persistir true com confirmação', () => {
  const field = fs.readFileSync(new URL('../src/components/Common/PackageConsumptionDecisionField.tsx', import.meta.url), 'utf8');
  const modal = fs.readFileSync(new URL('../src/components/Common/PackageConsumptionDecisionModal.tsx', import.meta.url), 'utf8');
  assert.match(field, /onChange\(true\)/);
  assert.match(field, /Esta decisão consumirá uma sessão do pacote\./);
  assert.match(modal, /window\.confirm/);
});

test('11. alteração de false para true recalcula pacote de 9 para 10 consumidas', () => {
  const before = buildCurrentPackageSessionSummary({ id: PATIENT_ID, status: 'Ativo' }, buildScenario(false, 'emergência familiar'), 10, { throughDate: THROUGH_DATE });
  const after = buildCurrentPackageSessionSummary({ id: PATIENT_ID, status: 'Ativo' }, buildScenario(true, 'emergência familiar'), 10, { throughDate: THROUGH_DATE });
  assert.deepEqual([before.count, before.remaining], [9, 1]);
  assert.deepEqual([after.count, after.remaining], [10, 0]);
});

test('12. alteração de true para false recalcula pacote de 10 para 9 consumidas', () => {
  const modal = fs.readFileSync(new URL('../src/components/Common/PackageConsumptionDecisionModal.tsx', import.meta.url), 'utf8');
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  const before = buildCurrentPackageSessionSummary({ id: PATIENT_ID, status: 'Ativo' }, buildScenario(true, 'ausência sem justificativa'), 10, { throughDate: THROUGH_DATE });
  const after = buildCurrentPackageSessionSummary({ id: PATIENT_ID, status: 'Ativo' }, buildScenario(false, 'ausência sem justificativa'), 10, { throughDate: THROUGH_DATE });
  assert.deepEqual([before.count, before.remaining], [10, 0]);
  assert.deepEqual([after.count, after.remaining], [9, 1]);
  assert.match(modal, /confirmNonConsumption/);
  assert.match(modal, /A alteração devolverá uma sessão ao saldo restante\./);
  assert.match(agenda, /!consumesPackage && isEditing && !window\.confirm/);
});

test('13. reload preserva a decisão explícita', () => {
  for (const decision of [false, true]) {
    const session = makeSession(`reload-${decision}`, '2026-05-23', 'Falta', { consumesPackage: decision });
    assert.equal(sessionConsumesPackage(JSON.parse(JSON.stringify(session))), decision);
  }
});

test('14. histórico diferencia contabilizada, não contabilizada e legado', () => {
  assert.equal(getSessionPresentationStatus(makeSession('history-true', '2026-05-23', 'Falta', { consumesPackage: true })), 'Falta contabilizada');
  assert.equal(getSessionPresentationStatus(makeSession('history-false', '2026-05-23', 'Falta', { consumesPackage: false })), 'Falta não contabilizada');
  assert.equal(getSessionPresentationStatus(makeSession('history-legacy', '2026-05-23', 'Falta')), 'Falta — situação legada sem decisão explícita');
});

test('15. falta não permite atividade independentemente da decisão', () => {
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  assert.equal(sessionAllowsActivity(makeSession('activity-false', '2026-05-23', 'Falta', { consumesPackage: false })), false);
  assert.equal(sessionAllowsActivity(makeSession('activity-true', '2026-05-23', 'Falta', { consumesPackage: true })), false);
  assert.match(agenda, /sessionAllowsActivity\(actionSession\)/);
});

test('16. falta não cria mídia ou álbum independentemente da decisão', () => {
  for (const decision of [false, true]) {
    const sessions = [makeSession(`media-${decision}`, '2026-05-23', 'Falta', { consumesPackage: decision })];
    assert.equal(buildActivityMediaPackageModel(sessions, { patientId: PATIENT_ID, now: NOW }).currentSessions.length, 0);
    assert.equal(buildGooglePhotosVirtualAlbumCards(sessions, { patientId: PATIENT_ID, patientName: 'Paciente Teste', now: NOW }).length, 0);
  }
});

test('17. Portal do Responsável usa a mesma decisão explícita', () => {
  const notCounted = buildResponsiblePackages(buildScenario(false, 'emergência familiar'), { today: THROUGH_DATE, payments: [] });
  const counted = buildResponsiblePackages(buildScenario(true, 'ausência sem justificativa'), { today: THROUGH_DATE, payments: [] });
  assert.equal(notCounted.consumedTotal, 9);
  assert.equal(counted.consumedTotal, 10);
});

test('18. Relatórios usam o resumo compartilhado baseado na regra canônica', () => {
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  const summary = fs.readFileSync(new URL('../shared/sessionPackageSummary.js', import.meta.url), 'utf8');
  assert.match(reports, /buildCurrentPackageSessionSummaries/);
  assert.match(summary, /sessionConsumesPackage/);
});

test('19. financeiro usa a regra canônica compartilhada', () => {
  const finance = fs.readFileSync(new URL('../src/lib/financePackages.ts', import.meta.url), 'utf8');
  assert.match(finance, /sessionConsumesPackage/);
  assert.match(finance, /shared\/sessionScheduling\.js/);
});

test('20. sessão realizada continua consumindo corretamente', () => {
  assert.equal(sessionConsumesPackage(makeSession('realized', '2026-05-23', 'Realizada')), true);
});

test('21. reposição realizada continua consumindo corretamente', () => {
  assert.equal(sessionConsumesPackage(makeSession('replacement', '2026-05-23', 'Reposição')), true);
});

test('22. falta do profissional não consome mesmo com campo true', () => {
  assert.equal(sessionConsumesPackage(makeSession('professional', '2026-05-23', 'Falta.Prof', { consumesPackage: true })), false);
});

test('23. reabertura reverte o consumo', () => {
  const reopened = { ...makeSession('reopened', '2026-05-23', 'Falta', { consumesPackage: true }), status: 'Agendada' };
  assert.equal(sessionConsumesPackage(reopened), false);
});

test('24. remoção reverte o consumo', () => {
  const original = makeSession('removed', '2026-05-23', 'Falta', { consumesPackage: true, isFixedSchedule: true, source: 'fixed' });
  const result = removeSessionFromAgenda([original], original.id, { removedAt: '2026-06-30T12:00:00.000Z', removedBy: 'Profissional Teste' });
  assert.equal(sessionConsumesPackage(result.sessions[0]), false);
});

test('25. deduplicação por identidade estável permanece funcionando', () => {
  const counted = makeSession('dedupe', '2026-05-23', 'Falta', { consumesPackage: true });
  const sessions = [counted, { ...counted }];
  assert.equal(dedupeSessionsByStableIdentity(sessions).length, 1);
  assert.equal(buildEffectiveSessionHistory(sessions, { patientId: PATIENT_ID, throughDate: THROUGH_DATE }).length, 1);
});

test('26. nenhuma regra infere consumo apenas pelo status ou por aliases legados', () => {
  const sequence = fs.readFileSync(new URL('../shared/sessionScheduling.js', import.meta.url), 'utf8');
  assert.equal(sessionConsumesPackage(makeSession('alias-1', '2026-05-23', 'Falta', { consumePackageSession: true })), false);
  assert.equal(sessionConsumesPackage(makeSession('alias-2', '2026-05-23', 'late_cancellation_no_replacement', { countsTowardPackage: true })), false);
  const consumingStatuses = sequence.match(/PACKAGE_CONSUMING_STATUSES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.doesNotMatch(consumingStatuses, /late_cancellation_no_replacement/);
});
