import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  hasPersistedScheduleOccurrence,
  isSessionRemovedFromAgenda,
  removeSessionFromAgenda,
} from '../shared/sessionRemoval.js';

function session(extra = {}) {
  return {
    id: 'fixed-cancelled',
    patientId: 'patient-1',
    date: '2026-06-22',
    time: '10:00',
    type: 'Sessão simples (50 min)',
    status: 'Cancelada',
    packageNumber: 1,
    isFixedSchedule: true,
    source: 'fixed',
    ...extra,
  };
}

test('remoção de ocorrência fixa cria tombstone e impede recriação virtual', () => {
  const result = removeSessionFromAgenda([session()], 'fixed-cancelled', {
    removedAt: '2026-06-21T12:00:00.000Z',
    removedBy: 'Teste',
  });

  assert.equal(result.changed, true);
  assert.equal(result.mode, 'suppressed');
  assert.equal(result.sessions.length, 1);
  assert.equal(isSessionRemovedFromAgenda(result.sessions[0]), true);
  assert.equal(result.sessions[0].status, 'Cancelada');
  assert.equal(result.sessions[0].isBlocked, true);
  assert.equal(result.sessions[0].consumesPackage, false);
  assert.equal(result.sessions[0].removedFromAgendaBy, 'Teste');
  assert.equal(hasPersistedScheduleOccurrence(result.sessions, {
    patientId: 'patient-1',
    date: '2026-06-22',
    time: '10:00',
  }), true);
});

test('remoção repetida é idempotente e não duplica tombstone', () => {
  const first = removeSessionFromAgenda([session()], 'fixed-cancelled');
  const second = removeSessionFromAgenda(first.sessions, 'fixed-cancelled');
  assert.equal(second.changed, false);
  assert.equal(second.mode, 'already_removed');
  assert.equal(second.sessions.length, 1);
});

test('sessão manual continua sendo excluída sem tombstone desnecessário', () => {
  const result = removeSessionFromAgenda([session({ isFixedSchedule: false, source: 'manual' })], 'fixed-cancelled');
  assert.equal(result.changed, true);
  assert.equal(result.mode, 'deleted');
  assert.deepEqual(result.sessions, []);
});

test('Agenda oculta tombstone, aguarda persistência e não usa exclusão otimista', () => {
  const agenda = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
  const utils = fs.readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8');
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');

  assert.match(agenda, /await onUpdate\(\{ sessions: removal\.sessions, repositions: updatedRepositions \}\)/);
  assert.match(agenda, /if \(!sessionToDelete \|\| deletingSession\) return/);
  assert.match(utils, /if \(isSessionRemovedFromAgenda\(s\)\) continue/);
  assert.match(utils, /hasPersistedScheduleOccurrence\(dbSessions/);
  assert.match(reports, /isSessionRemovedFromAgenda/);
});
