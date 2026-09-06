import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allSettledWithConcurrency,
  PSYCHOLOGY_BULK_DELETE_CONCURRENCY,
} from '../src/features/psychology-persistence/bulkDeleteConcurrency.ts';

test('R2 bulk 01 — concorrência máxima é limitada e a ordem dos resultados é preservada', async () => {
  let active = 0;
  let maximum = 0;
  const results = await allSettledWithConcurrency(['p1', 'p2', 'p3', 'p4', 'p5'], PSYCHOLOGY_BULK_DELETE_CONCURRENCY, async id => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, id === 'p2' ? 8 : 2));
    active -= 1;
    return id;
  });

  assert.equal(maximum, PSYCHOLOGY_BULK_DELETE_CONCURRENCY);
  assert.deepEqual(results.map(result => result.status === 'fulfilled' ? result.value : null), ['p1', 'p2', 'p3', 'p4', 'p5']);
});

test('R2 bulk 02 — falha individual não gera retry e não interrompe os demais', async () => {
  const calls = [];
  const results = await allSettledWithConcurrency(['p1', 'p2', 'p3'], 2, async id => {
    calls.push(id);
    if (id === 'p2') throw new Error('falha sintética');
    return id;
  });

  assert.deepEqual(calls.sort(), ['p1', 'p2', 'p3']);
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[2].status, 'fulfilled');
});
