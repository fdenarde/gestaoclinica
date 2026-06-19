export const CLINIC_PACKAGE_VALUE = 1000;

function normalizePatientId(value) {
  return String(value || '').trim();
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizePackageNumber(value) {
  const packageNumber = Number(value);
  return Number.isInteger(packageNumber) && packageNumber > 0 ? packageNumber : 0;
}

export function getActivatedPackageNumber(rawPayments, {
  patientId = '',
  packageValue = CLINIC_PACKAGE_VALUE,
  allowLegacyFirstPackage = true,
} = {}) {
  const normalizedPatientId = normalizePatientId(patientId);
  const normalizedPackageValue = Number(packageValue) > 0 ? Number(packageValue) : CLINIC_PACKAGE_VALUE;
  const payments = (Array.isArray(rawPayments) ? rawPayments : [])
    .filter(payment => payment && (!normalizedPatientId || normalizePatientId(payment.patientId) === normalizedPatientId));

  let totalPaid = 0;
  let highestExplicitPackage = 0;

  for (const payment of payments) {
    const amount = normalizePositiveAmount(payment.amount);
    if (amount <= 0) continue;
    totalPaid += amount;
    highestExplicitPackage = Math.max(highestExplicitPackage, normalizePackageNumber(payment.packageNumber));
  }

  const inferredPackage = totalPaid > 0
    ? Math.floor(Math.max(totalPaid - 0.01, 0) / normalizedPackageValue) + 1
    : 0;

  return Math.max(allowLegacyFirstPackage ? 1 : 0, highestExplicitPackage, inferredPackage);
}

export function isPackageActivated(rawPayments, packageNumber, options = {}) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  if (!normalizedPackageNumber) return false;
  return normalizedPackageNumber <= getActivatedPackageNumber(rawPayments, options);
}
