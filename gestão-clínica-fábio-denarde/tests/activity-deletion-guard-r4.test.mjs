import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  evaluateActivityRecordDeletionGuard,
  evaluatePatientActivityRecordDeletionGuard,
  isActivityRecordDeletionBlocker,
} from '../shared/activityDeletionGuard.js';

function fakeGuard({ statusBlocker = false, driveFileBlocker = false, cleanupRecords = [] } = {}) {
  const calls = [];
  const writes = [];
  return {
    calls,
    writes,
    run: () => evaluateActivityRecordDeletionGuard({
      findStatusBlocker: async () => {
        calls.push({ kind: 'query', filter: 'status-not-in', limit: 1, documents: statusBlocker ? 1 : 0 });
        return statusBlocker;
      },
      findDriveFileBlocker: async () => {
        calls.push({ kind: 'query', filter: 'drive-file-present', limit: 1, documents: driveFileBlocker ? 1 : 0 });
        return driveFileBlocker;
      },
      cleanupNonBlockingRecords: async () => {
        calls.push({ kind: 'query', filter: 'failed-cancelled', limit: 100, documents: cleanupRecords.length });
        for (const record of cleanupRecords) {
          if (!isActivityRecordDeletionBlocker(record)) writes.push(record.id);
        }
      },
    }),
  };
}

test('R4-01 preserva exatamente a classificação atual dos estados', () => {
  assert.equal(isActivityRecordDeletionBlocker({ status: 'failed' }), false);
  assert.equal(isActivityRecordDeletionBlocker({ status: 'cancelled' }), false);
  assert.equal(isActivityRecordDeletionBlocker({ status: 'failed', driveFileId: 'drive-1' }), true);
  assert.equal(isActivityRecordDeletionBlocker({ status: 'cancelled', driveFileId: 'drive-2' }), true);
  assert.equal(isActivityRecordDeletionBlocker({ status: 'active' }), true);
  assert.equal(isActivityRecordDeletionBlocker({ status: 'uploading' }), true);
  assert.equal(isActivityRecordDeletionBlocker({ status: 'legacy-unknown' }), true);
});
test('R4-02 paciente sem atividade não consome lista extensa', async () => {
  const fake = fakeGuard();
  const result = await fake.run();
  assert.equal(result, false);
  assert.deepEqual(fake.calls, [
    { kind: 'query', filter: 'status-not-in', limit: 1, documents: 0 },
    { kind: 'query', filter: 'drive-file-present', limit: 1, documents: 0 },
    { kind: 'query', filter: 'failed-cancelled', limit: 100, documents: 0 },
  ]);
  assert.deepEqual(fake.writes, []);
});

test('R4-03 primeiro registro bloqueador encerra a guarda sem scan ou limpeza', async () => {
  const fake = fakeGuard({ statusBlocker: true, cleanupRecords: Array.from({ length: 100 }, (_, index) => ({ id: `failed-${index}`, status: 'failed' })) });
  const result = await fake.run();
  assert.equal(result, true);
  assert.deepEqual(fake.calls, [{ kind: 'query', filter: 'status-not-in', limit: 1, documents: 1 }]);
  assert.deepEqual(fake.writes, []);
});

test('R4-04 somente registros não bloqueadores permitem exclusão e mantêm limpeza', async () => {
  const fake = fakeGuard({
    cleanupRecords: [
      { id: 'failed-1', status: 'failed' },
      { id: 'cancelled-1', status: 'cancelled' },
    ],
  });
  const result = await fake.run();
  assert.equal(result, false);
  assert.deepEqual(fake.writes, ['failed-1', 'cancelled-1']);
  assert.equal(fake.calls.at(-1).limit, 100);
});

test('R4-05 registro cancelado com arquivo bloqueia pela consulta seletiva de arquivo', async () => {
  const fake = fakeGuard({ driveFileBlocker: true, cleanupRecords: [{ id: 'cancelled-drive', status: 'cancelled', driveFileId: 'drive-1' }] });
  const result = await fake.run();
  assert.equal(result, true);
  assert.deepEqual(fake.calls, [
    { kind: 'query', filter: 'status-not-in', limit: 1, documents: 0 },
    { kind: 'query', filter: 'drive-file-present', limit: 1, documents: 1 },
  ]);
  assert.deepEqual(fake.writes, []);
});

test('R4-06 estados mistos mantêm o bloqueio e não fazem manutenção extensa durante tentativa bloqueada', async () => {
  const fake = fakeGuard({ statusBlocker: true, cleanupRecords: [{ id: 'failed-1', status: 'failed' }] });
  const result = await fake.run();
  assert.equal(result, true);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.writes, []);
});

test('R4-07 paciente inexistente retorna false antes de consultar activityRecords', async () => {
  let recordQueries = 0;
  const result = await evaluatePatientActivityRecordDeletionGuard({
    getPatient: async () => ({ exists: false }),
    evaluate: async () => {
      recordQueries += 1;
      return true;
    },
  });
  assert.equal(result, false);
  assert.equal(recordQueries, 0);
});

test('R4-08 contrato do repositório mantém patient get, isolamento e consultas limitadas', () => {
  const source = readFileSync(new URL('../api/_lib/activityRecordsRepository.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function hasActivityRecords');
  const end = source.indexOf('export function serializeRecord', start);
  const guard = source.slice(start, end);
  assert.match(guard, /patientRef\(context, patientId\)\.get\(\)/);
  assert.match(source, /function patientRef\(context, patientId\)[\s\S]*?assertActivityPatientAccess\(context, patientId\)/);
  assert.match(guard, /where\('status', 'not-in', \['failed', 'cancelled'\]\)[\s\S]*?limit\(1\)/);
  assert.match(guard, /where\('driveFileId', '>', ''\)[\s\S]*?limit\(1\)/);
  assert.match(guard, /where\('status', 'in', \['failed', 'cancelled'\]\)[\s\S]*?limit\(100\)/);
  assert.doesNotMatch(guard, /collection\('activityRecords'\)\.limit\(100\)\.get\(\)/);
});
