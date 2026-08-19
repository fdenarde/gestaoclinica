import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const financeSource = fs.readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');
const patientsSource = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
const portalTypeSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');
const portalRepositorySource = fs.readFileSync(new URL('../api/_lib/responsiblePortalPackages.js', import.meta.url), 'utf8');
const typesSource = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

async function requireStrictPersistence(onUpdate) {
  const persisted = await onUpdate();
  if (persisted !== true) throw new Error('A persistência não foi confirmada.');
  return 'success';
}

test('R9: Portal não expõe contrato e mantém a fronteira financeira interna', () => {
  assert.doesNotMatch(portalSource, /selectedPackage\.(contractValue|contractSource)/);
  assert.doesNotMatch(portalSource, /Contratado:/);
  assert.doesNotMatch(portalTypeSource, /contractValue|contractSource/);
  assert.doesNotMatch(portalRepositorySource, /contractValue:\s*contract\.contractValue/);
  assert.doesNotMatch(portalRepositorySource, /contractSource:\s*contract\.source/);
  assert.match(portalRepositorySource, /resolvePackageContract\(patient, packageNumber\)\.contractValue/);
});

test('R9: os dois fluxos de contrato aceitam somente persistência true', async () => {
  const financeStart = financeSource.indexOf('const handleSavePackageContract');
  const financeEnd = financeSource.indexOf('const closeToleranceModal', financeStart);
  const patientsStart = patientsSource.indexOf('const handleSavePackageContract');
  const patientsEnd = patientsSource.indexOf('const handleRegisterPaymentClick', patientsStart);
  assert.match(financeSource.slice(financeStart, financeEnd), /persisted !== true/);
  assert.match(patientsSource.slice(patientsStart, patientsEnd), /persisted !== true/);

  for (const flow of ['Finance', 'Patients']) {
    await assert.doesNotReject(() => requireStrictPersistence(async () => true), `${flow}: true`);
    for (const value of [false, undefined]) {
      await assert.rejects(() => requireStrictPersistence(async () => value), `${flow}: ${String(value)}`);
    }
    await assert.rejects(
      () => requireStrictPersistence(async () => { throw new Error('persistência rejeitada'); }),
      `${flow}: reject`,
    );
  }
});

test('R9: PaymentModal continua legado e a apresentação ativa usa valor de contrato', () => {
  assert.match(typesSource, /PIX_FULL = '[^']*R\$1\.000/);
  assert.match(typesSource, /PARCELADO = '[^']*R\$500/);
  assert.match(patientsSource, /function getPaymentModalLabel/);
  assert.match(patientsSource, /formatCurrency\(value \/ 2\)/);
  assert.doesNotMatch(patientsSource, /<option value=\{PaymentModal\.PIX_FULL\}>\{PaymentModal\.PIX_FULL\}<\/option>/);
  assert.doesNotMatch(patientsSource, /<option value=\{PaymentModal\.PARCELADO\}>\{PaymentModal\.PARCELADO\}<\/option>/);
});
