export const LEGACY_PACKAGE_CONTRACT_VALUE = 1000;
export const PACKAGE_CONTRACT_SOURCE = Object.freeze({
  EXPLICIT: 'explicit',
  LEGACY_FALLBACK: 'legacy_fallback',
});

function normalizePackageNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function normalizePackageContractValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeCreatedAt(value) {
  const text = String(value || '').trim();
  if (text) return text;
  return new Date().toISOString();
}

function normalizeOptionalText(value, maxLength = 180) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : '';
}

export function normalizePackageContractSnapshot(raw = {}) {
  const packageNumber = normalizePackageNumber(raw.packageNumber);
  const packageContractValue = normalizePackageContractValue(
    raw.packageContractValue ?? raw.contractValue,
  );
  if (!packageNumber || !packageContractValue) return null;

  return {
    packageNumber,
    packageContractValue,
    contractValue: packageContractValue,
    source: raw.source === PACKAGE_CONTRACT_SOURCE.LEGACY_FALLBACK
      ? PACKAGE_CONTRACT_SOURCE.LEGACY_FALLBACK
      : PACKAGE_CONTRACT_SOURCE.EXPLICIT,
    createdAt: normalizeCreatedAt(raw.createdAt),
    ...(normalizeOptionalText(raw.createdBy) ? { createdBy: normalizeOptionalText(raw.createdBy) } : {}),
    ...(normalizeOptionalText(raw.updatedAt) ? { updatedAt: normalizeOptionalText(raw.updatedAt, 80) } : {}),
    ...(normalizeOptionalText(raw.updatedBy) ? { updatedBy: normalizeOptionalText(raw.updatedBy) } : {}),
  };
}

export function listPackageContractSnapshots(patientOrSnapshots) {
  const source = Array.isArray(patientOrSnapshots)
    ? patientOrSnapshots
    : patientOrSnapshots?.packageContracts;
  return (Array.isArray(source) ? source : [])
    .map(normalizePackageContractSnapshot)
    .filter(Boolean)
    .sort((left, right) => left.packageNumber - right.packageNumber || left.createdAt.localeCompare(right.createdAt));
}

export function getPackageContractSnapshot(patient, packageNumber) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  return listPackageContractSnapshots(patient)
    .filter(item => item.packageNumber === normalizedPackageNumber && item.source === PACKAGE_CONTRACT_SOURCE.EXPLICIT)
    .at(-1) || null;
}

export function resolvePackageContract(patient, packageNumber, {
  legacyFallbackValue = LEGACY_PACKAGE_CONTRACT_VALUE,
} = {}) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber) || 1;
  const explicit = getPackageContractSnapshot(patient, normalizedPackageNumber);
  if (explicit) {
    return {
      ...explicit,
      packageNumber: normalizedPackageNumber,
      source: PACKAGE_CONTRACT_SOURCE.EXPLICIT,
      contractValue: explicit.packageContractValue,
    };
  }

  const fallback = normalizePackageContractValue(legacyFallbackValue) || LEGACY_PACKAGE_CONTRACT_VALUE;
  return {
    packageNumber: normalizedPackageNumber,
    packageContractValue: fallback,
    contractValue: fallback,
    source: PACKAGE_CONTRACT_SOURCE.LEGACY_FALLBACK,
    snapshot: null,
  };
}

export function upsertPackageContractSnapshot(patient, {
  packageNumber,
  packageContractValue,
  createdAt = new Date().toISOString(),
  createdBy = '',
  updatedAt = '',
  updatedBy = '',
  receivedAmount = 0,
} = {}) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  const normalizedValue = normalizePackageContractValue(packageContractValue);
  if (!normalizedPackageNumber) throw new Error('O pacote informado é inválido.');
  if (!normalizedValue) throw new Error('O valor contratado deve ser finito e maior que zero.');
  const normalizedReceivedAmount = normalizePackageContractValue(receivedAmount);
  if (normalizedReceivedAmount > normalizedValue) {
    throw new Error(
      `O valor contratado de R$ ${normalizedValue.toFixed(2)} não pode ser menor que os pagamentos existentes de R$ ${normalizedReceivedAmount.toFixed(2)}.`,
    );
  }

  const previousSnapshot = listPackageContractSnapshots(patient)
    .find(item => item.packageNumber === normalizedPackageNumber) || null;
  const snapshot = normalizePackageContractSnapshot({
    packageNumber: normalizedPackageNumber,
    packageContractValue: normalizedValue,
    source: PACKAGE_CONTRACT_SOURCE.EXPLICIT,
    createdAt: previousSnapshot?.createdAt || createdAt,
    createdBy: previousSnapshot?.createdBy || createdBy,
    updatedAt,
    updatedBy,
  });
  const previous = Array.isArray(patient?.packageContracts) ? patient.packageContracts : [];
  const packageContracts = [
    ...previous.filter(item => normalizePackageNumber(item?.packageNumber) !== normalizedPackageNumber),
    snapshot,
  ];
  return { ...patient, packageContracts };
}
