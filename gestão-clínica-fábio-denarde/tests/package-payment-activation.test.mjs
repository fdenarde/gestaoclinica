import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getActivatedPackageNumber, isPackageActivated } from '../shared/packagePayments.js';

function payment(id, amount, packageNumber) {
  return {
    id,
    patientId: 'patient-1',
    amount,
    date: '2026-06-01',
    installment: amount >= 1000 ? 'Pagamento integral' : '1ª parcela',
    method: 'Pix',
    packageNumber,
  };
}

test('primeiro pacote permanece compatível mesmo sem pagamento legado identificado', () => {
  assert.equal(getActivatedPackageNumber([], { patientId: 'patient-1' }), 1);
  assert.equal(isPackageActivated([], 1, { patientId: 'patient-1' }), true);
  assert.equal(isPackageActivated([], 2, { patientId: 'patient-1' }), false);
});

test('pagamento parcial explicitamente vinculado ativa o novo pacote', () => {
  const payments = [payment('p1', 1000, 1), payment('p2', 500, 2)];
  assert.equal(getActivatedPackageNumber(payments, { patientId: 'patient-1' }), 2);
});

test('pagamentos legados sem número usam o total acumulado sem criar pacote apenas por sessão', () => {
  assert.equal(getActivatedPackageNumber([payment('p1', 1000)], { patientId: 'patient-1' }), 1);
  assert.equal(getActivatedPackageNumber([payment('p1', 1000), payment('p2', 1000)], { patientId: 'patient-1' }), 2);
});

test('financeiro usa pagamento ou tolerância explícita sem ativar pacote apenas por sessão', () => {
  const financeSource = fs.readFileSync(new URL('../src/lib/financePackages.ts', import.meta.url), 'utf8');
  assert.match(financeSource, /packageValueResolver/);
  assert.match(financeSource, /completedPackageNumber > Math\.max\(/);
  assert.match(financeSource, /summary\.toleranceDisplayPackageNumber/);
  assert.doesNotMatch(financeSource, /hasStartedNextPackageWithoutPayment \? completedPackageNumber/);
});
