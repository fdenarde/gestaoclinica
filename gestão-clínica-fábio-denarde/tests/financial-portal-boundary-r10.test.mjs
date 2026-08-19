import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applyResponsiblePackagePaymentSummary } from '../api/_lib/responsiblePortalPackages.js';
import { getPackagePaymentSummary } from '../shared/packagePayments.js';
import { resolvePackageContract } from '../shared/packageContract.js';

const TODAY = '2026-08-19';

function patient(id, packageContracts) {
  return { id, packageContracts };
}

function snapshot(packageNumber, packageContractValue) {
  return {
    packageNumber,
    packageContractValue,
    source: 'explicit',
    createdAt: `${TODAY}T10:00:00.000Z`,
  };
}

function payment(id, patientId, packageNumber, amount) {
  return {
    id,
    patientId,
    packageNumber,
    amount,
    date: TODAY,
    installment: 'Pagamento integral',
    method: 'Pix',
    status: 'active',
  };
}

function applySummaryFor(targetPatient, packageNumber, amount) {
  const payments = [payment(`r10-${packageNumber}`, targetPatient.id, packageNumber, amount)];
  const packageValueResolver = number => resolvePackageContract(targetPatient, number).contractValue;
  const summary = getPackagePaymentSummary(payments, packageNumber, {
    patientId: targetPatient.id,
    throughDate: TODAY,
    packageValueResolver,
  });
  const portalPackage = { number: packageNumber, status: 'current', sessions: [] };
  applyResponsiblePackagePaymentSummary(portalPackage, summary);
  return { portalPackage, summary };
}

test('R10: cálculo variável permanece interno e packageValue não atravessa a fronteira', () => {
  const p900 = applySummaryFor(patient('r10-900', [snapshot(1, 900)]), 1, 500);
  const p1200 = applySummaryFor(patient('r10-1200', [snapshot(1, 1200)]), 1, 800);

  assert.equal(p900.summary.packageValue, 900);
  assert.equal(p900.summary.pendingAmount, 400);
  assert.equal(p1200.summary.packageValue, 1200);
  assert.equal(p1200.summary.pendingAmount, 400);

  for (const portalPackage of [p900.portalPackage, p1200.portalPackage]) {
    assert.equal(Object.hasOwn(portalPackage, 'packageValue'), false);
    assert.equal(Object.hasOwn(portalPackage, 'contractValue'), false);
    assert.equal(Object.hasOwn(portalPackage, 'contractSource'), false);
  }
});

test('R10: os dois fluxos Portal usam whitelist financeira e mantêm campos legados', () => {
  const access = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const types = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');
  const portal = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');

  assert.equal((access.match(/applyResponsiblePackagePaymentSummary\(pkg, paymentSummary\)/g) || []).length, 2);
  assert.doesNotMatch(access, /Object\.assign\(pkg,\s*getPackagePaymentSummary/);
  assert.match(access, /packageValueResolver/);
  assert.doesNotMatch(types, /\bpackageValue\??\s*:/);
  assert.doesNotMatch(types, /\bcontractValue\??\s*:/);
  assert.doesNotMatch(types, /\bcontractSource\??\s*:/);
  assert.doesNotMatch(portal, /selectedPackage\.(packageValue|contractValue|contractSource)/);
  assert.doesNotMatch(portal, /Contratado:/);
});
