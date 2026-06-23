import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  getSessionCycleLabel,
  getSessionCycleNumber,
  getSessionLogicalPosition,
  rescheduleSessionInAgenda,
} from '../shared/sessionScheduling.js';
import { buildCurrentPackageSessionSummary } from '../shared/sessionPackageSummary.js';
import {
  hasPersistedScheduleOccurrence,
  removeSessionFromAgenda,
} from '../shared/sessionRemoval.js';

function completedSessions(count, patientId = 'patient-1') {
  return Array.from({ length: count }, (_, index) => ({
    id: `done-${index + 1}`,
    patientId,
    date: `2026-05-${String(index + 1).padStart(2, '0')}`,
    time: '16:00',
    status: 'Realizada',
  }));
}

function scheduled(extra = {}) {
  return {
    id: 'scheduled-9',
    patientId: 'patient-1',
    date: '2026-06-22',
    time: '16:00',
    type: 'Sessão simples (50 min)',
    status: 'Agendada',
    notes: 'Observação preservada.',
    packageNumber: 9,
    source: 'manual',
    ...extra,
  };
}

test('o cenário 8/10 continua indicando a próxima sessão como 9 após cancelamento e exclusão', () => {
  const completed = completedSessions(8);
  const cancelled = scheduled({ id: 'cancelled', status: 'Cancelada' });
  const removal = removeSessionFromAgenda([...completed, cancelled], cancelled.id);
  const preview = scheduled({ id: 'preview', time: '18:00', packageNumber: 0 });
  const source = [...removal.sessions, preview];

  assert.equal(getSessionCycleNumber(source, preview), 9);
  assert.equal(getSessionCycleLabel(source, preview), 'Sessão será 9');
});

test('canceladas, tombstones e sessões de outro atendente não reservam posição no pacote', () => {
  const preview = scheduled({ id: 'preview', time: '18:00', packageNumber: 0 });
  const source = [
    ...completedSessions(8),
    scheduled({ id: 'cancelled', status: 'Cancelada' }),
    scheduled({ id: 'removed', removedFromAgenda: true, isBlocked: true }),
    scheduled({ id: 'other-patient', patientId: 'patient-2' }),
    preview,
  ];

  assert.equal(getSessionCycleNumber(source, preview), 9);
});

test('outra sessão futura válida continua ocupando a posição seguinte', () => {
  const ninth = scheduled();
  const tenth = scheduled({ id: 'scheduled-10', date: '2026-06-29', packageNumber: 10 });
  const source = [...completedSessions(8), ninth, tenth];

  assert.equal(getSessionCycleNumber(source, ninth), 9);
  assert.equal(getSessionCycleNumber(source, tenth), 10);
});

test('reagendamento real mantém o mesmo id, paciente, pacote, observação e número lógico', () => {
  const original = scheduled();
  const source = [...completedSessions(8), original];
  const result = rescheduleSessionInAgenda(source, original, {
    newDate: '2026-06-22',
    newTime: '18:00',
    logicalSessionPosition: 9,
    logicalSessionNumber: 9,
    rescheduledAt: '2026-06-22T16:00:00.000Z',
    rescheduledBy: 'Teste',
  });

  assert.equal(result.changed, true);
  assert.equal(result.mode, 'updated');
  assert.equal(result.sessions.length, source.length);
  assert.equal(result.session.id, original.id);
  assert.equal(result.session.patientId, original.patientId);
  assert.equal(result.session.packageNumber, 9);
  assert.equal(result.session.logicalSessionPosition, 9);
  assert.equal(result.session.logicalSessionNumber, 9);
  assert.equal(result.session.notes, original.notes);
  assert.equal(result.session.time, '18:00');
  assert.equal(result.session.rescheduleHistory.length, 1);
  assert.equal(Object.hasOwn(result.session, 'fixedScheduleOriginalDate'), false);
  assert.equal(Object.hasOwn(result.session, 'fixedScheduleOriginalTime'), false);
  assert.equal(Object.values(result.session).includes(undefined), false);
  assert.equal(getSessionCycleLabel(result.sessions, result.session), 'Sessão será 9');
});

test('reagendamento de ocorrência fixa virtual materializa uma sessão e suprime o horário original', () => {
  const virtual = scheduled({
    id: 'virtual-patient-1-2026-06-22-16:00',
    isVirtual: true,
    isValid: true,
    source: undefined,
    isFixedSchedule: undefined,
    packageNumber: 0,
  });
  const source = completedSessions(8);
  const result = rescheduleSessionInAgenda(source, virtual, {
    newDate: '2026-06-22',
    newTime: '18:00',
    generatedId: 'materialized-9',
    logicalSessionPosition: 9,
    logicalSessionNumber: 9,
    rescheduledAt: '2026-06-22T16:00:00.000Z',
    rescheduledBy: 'Teste',
  });

  assert.equal(result.mode, 'materialized');
  assert.equal(result.session.id, 'materialized-9');
  assert.equal(result.session.isFixedSchedule, true);
  assert.equal(result.session.source, 'fixed');
  assert.equal(result.session.fixedScheduleOriginalDate, '2026-06-22');
  assert.equal(result.session.fixedScheduleOriginalTime, '16:00');
  assert.equal(hasPersistedScheduleOccurrence(result.sessions, {
    patientId: 'patient-1',
    date: '2026-06-22',
    time: '16:00',
  }), true);
  assert.equal(getSessionCycleLabel(result.sessions, result.session), 'Sessão será 9');
});

test('reagendar a 9ª sessão para depois da 10ª preserva identidade sem duplicar números', () => {
  const ninth = scheduled({ id: 'scheduled-9', date: '2026-06-22', time: '16:00', packageNumber: 9, logicalSessionPosition: 9, logicalSessionNumber: 9 });
  const tenth = scheduled({ id: 'scheduled-10', date: '2026-06-29', time: '16:00', packageNumber: 10, logicalSessionPosition: 10, logicalSessionNumber: 10 });
  const source = [...completedSessions(8), ninth, tenth];
  const logicalSessionPosition = getSessionLogicalPosition(source, ninth);
  const result = rescheduleSessionInAgenda(source, ninth, {
    newDate: '2026-07-06',
    newTime: '18:00',
    logicalSessionPosition,
    logicalSessionNumber: 9,
    rescheduledAt: '2026-06-22T16:00:00.000Z',
    rescheduledBy: 'Teste',
  });

  const movedNinth = result.sessions.find(item => item.id === 'scheduled-9');
  const unchangedTenth = result.sessions.find(item => item.id === 'scheduled-10');
  assert.equal(getSessionCycleNumber(result.sessions, movedNinth), 9);
  assert.equal(getSessionCycleNumber(result.sessions, unchangedTenth), 10);

  const withTenthCompleted = result.sessions.map(item => item.id === 'scheduled-10'
    ? { ...item, status: 'Realizada' }
    : item);
  assert.equal(
    getSessionCycleNumber(withTenthCompleted, withTenthCompleted.find(item => item.id === 'scheduled-10')),
    10,
  );

  const next = scheduled({ id: 'scheduled-next', date: '2026-07-13', packageNumber: 0 });
  const withNext = [...result.sessions, next];
  assert.equal(getSessionCycleNumber(withNext, next), 1);
});

test('reagendar para o mesmo horário é idempotente e não altera a lista', () => {
  const original = scheduled();
  const source = [original];
  const result = rescheduleSessionInAgenda(source, original, {
    newDate: original.date,
    newTime: original.time,
    logicalSessionNumber: 9,
  });

  assert.equal(result.changed, false);
  assert.equal(result.mode, 'no_change');
  assert.equal(result.sessions, source);
});

test('Modal mantém o foco durante digitação mesmo quando onClose é uma função inline', () => {
  const source = fs.readFileSync(new URL('../src/components/Common/Modal.tsx', import.meta.url), 'utf8');
  assert.match(source, /const onCloseRef = useRef\(onClose\)/);
  assert.match(source, /onCloseRef\.current = onClose/);
  assert.match(source, /\}, \[initialFocusRef, isOpen\]\)/);
  assert.doesNotMatch(source, /\[closeDisabled, initialFocusRef, isOpen, onClose\]/);
});

test('Agenda expõe reagendamento, preserva o mesmo registro real e não grava observação a cada tecla', () => {
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(agenda, />Reagendar sessão</);
  assert.match(agenda, /getSessionLogicalPosition\(sequenceSource, session\)/);
  assert.match(agenda, /rescheduleSessionInAgenda\(state\.sessions, session/);
  assert.match(agenda, /await onUpdate\(\{ sessions: result\.sessions as Session\[\] \}\)/);
  assert.match(agenda, /const rescheduleLockRef = useRef\(false\)/);
  assert.match(agenda, /isRescheduling \|\| rescheduleLockRef\.current/);
  assert.match(agenda, /rescheduleLockRef\.current = true/);
  assert.match(agenda, /rescheduleLockRef\.current = false/);
  assert.match(agenda, /value=\{notes\}[\s\S]*onChange=\{\(e\) => setNotes\(e\.target\.value\)\}/);
  assert.doesNotMatch(agenda, /onChange=\{\(e\) => onUpdate\(\{ sessions:/);
  assert.match(app, /setState\(previousState => \(\{ \.\.\.previousState, \.\.\.newState \}\)\)/);
});


test('Agenda usa o mesmo avanço do card Sessões Restantes no segundo pacote', () => {
  const patient = {
    id: 'patient-1',
    name: 'Atendente Sintético',
    status: 'Ativo',
    startDate: '2026-01-01',
  };
  const realized = Array.from({ length: 18 }, (_, index) => ({
    id: `realized-${index + 1}`,
    patientId: patient.id,
    date: `2026-${String(Math.floor(index / 10) + 1).padStart(2, '0')}-${String((index % 10) + 1).padStart(2, '0')}`,
    time: '16:00',
    status: index === 13 ? 'Reposição' : 'Realizada',
  }));
  const preview = scheduled({ id: 'preview-second-package', date: '2026-06-22', time: '18:00', packageNumber: 0 });
  const summary = buildCurrentPackageSessionSummary(patient, realized, 10);

  assert.equal(summary.count, 8);
  assert.equal(summary.remaining, 2);
  assert.equal(getSessionCycleNumber([...realized, preview], preview), 9);
  assert.equal(getSessionCycleLabel([...realized, preview], preview), 'Sessão será 9');
});

test('agendamento antigo ainda marcado como Agendada antes da última realizada não reserva posição', () => {
  const realized = completedSessions(8);
  const stalePlanned = scheduled({
    id: 'stale-planned',
    date: '2026-05-03',
    time: '16:00',
    packageNumber: 9,
  });
  const preview = scheduled({ id: 'preview-current', date: '2026-06-22', time: '18:00', packageNumber: 0 });
  const source = [...realized, stalePlanned, preview];

  assert.equal(getSessionCycleNumber(source, preview), 9);
  assert.equal(getSessionCycleLabel(source, preview), 'Sessão será 9');
});

test('falta sem reposição e falta consumida não divergem do card de sessões realizadas', () => {
  const realized = completedSessions(8);
  const noReplacement = scheduled({
    id: 'late-cancel',
    date: '2026-06-15',
    status: 'late_cancellation_no_replacement',
    consumesPackage: true,
    packageNumber: 9,
  });
  const consumedAbsence = scheduled({
    id: 'consumed-absence',
    date: '2026-06-16',
    status: 'Falta',
    consumesPackage: true,
    packageNumber: 9,
  });
  const preview = scheduled({ id: 'preview-after-absence', date: '2026-06-22', time: '18:00', packageNumber: 0 });
  const source = [...realized, noReplacement, consumedAbsence, preview];

  assert.equal(getSessionCycleNumber(source, preview), 9);
  assert.equal(getSessionCycleLabel(source, preview), 'Sessão será 9');
  assert.equal(getSessionCycleNumber(source, noReplacement), 9);
  assert.equal(getSessionCycleNumber(source, consumedAbsence), 9);
});
