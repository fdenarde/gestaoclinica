import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PersistenceBaselines, persistStateChange } from '../src/lib/statePersistence.ts';

const financeSource = readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');

const request = () => {
  const baselines = new PersistenceBaselines();
  const patient = baselines.remember({ id: 'fixture-patient', optional: undefined, packageTolerances: [] }, 'fixture-patient', { id: 'fixture-patient', packageTolerances: [] });
  return {
    baseline: { patients: [patient] },
    intended: { patients: [{ ...patient, packageTolerances: [{ packageNumber: 1, note: undefined }] }] },
    loaded: new Set(['patients']), baselines,
  };
};

test('gravação de pacientes remove valores undefined antes de enviar ao Firestore', async () => {
  const writes = [];
  const result = await persistStateChange(request(), {
    validate() {},
    run: async work => work({ get: async () => ({ id: 'fixture-patient', packageTolerances: [] }), write: op => writes.push(op) }),
  });
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(writes[0].changes.map(change => change.path), [['packageTolerances']]);
  assert.deepEqual(writes[0].changes[0].after.value, [{ packageNumber: 1 }]);
});

test('persistência distingue conflito e falha de commit de sucesso', async () => {
  const writes = [];
  const conflict = await persistStateChange(request(), {
    validate() {},
    run: async work => work({ get: async () => ({ id: 'fixture-patient', packageTolerances: [{ packageNumber: 2 }] }), write: op => writes.push(op) }),
  });
  assert.equal(conflict.status, 'CONFLICT');
  assert.equal(writes.length, 0);
  const failure = await persistStateChange(request(), { validate() {}, run: async () => { throw { code: 'unavailable' }; } });
  assert.equal(failure.status, 'PERSISTENCE_FAILED');
});

test('Financeiro não exibe sucesso quando a tolerância não foi persistida', () => {
  assert.match(financeSource, /const persisted = await onUpdate\(\{\s*patients:/s);
  assert.match(financeSource, /if \(persisted === false\) \{\s*throw new Error\('A tolerância não foi gravada\./s);
});

test('encerramento da tolerância também exige confirmação de persistência', () => {
  assert.match(financeSource, /throw new Error\('O encerramento não foi gravado\. A tolerância permanece inalterada\.'\)/);
});
