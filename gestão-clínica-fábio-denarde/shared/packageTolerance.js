import { getActivatedPackageNumber, getPackagePaymentSummary } from './packagePayments.js';
import { sessionConsumesPackage } from './sessionScheduling.js';

export const PACKAGE_TOLERANCE_SCHEMA_VERSION = 1;
export const DEFAULT_PACKAGE_TOLERANCE_DAYS = 5;
export const DEFAULT_PACKAGE_TOLERANCE_MAX_SESSIONS = 2;

export const PACKAGE_TOLERANCE_REASON_CODES = Object.freeze({
  requested_days: 'Responsável solicitou alguns dias',
  forgot_payment: 'Responsável esqueceu o pagamento',
  temporary_financial_difficulty: 'Dificuldade financeira temporária',
  payment_not_identified: 'Pagamento ainda não identificado',
  other: 'Outro motivo',
});

function normalizeText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizePatientId(value) {
  return normalizeText(value, 160);
}

function normalizePackageNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeMaxSessions(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return DEFAULT_PACKAGE_TOLERANCE_MAX_SESSIONS;
  return Math.min(Math.max(number, 1), 10);
}

export function normalizePackageToleranceDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function normalizeIso(value) {
  const parsed = value instanceof Date ? value : new Date(value || '');
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
}

function normalizeReasonCode(value) {
  const code = normalizeText(value, 80);
  return Object.prototype.hasOwnProperty.call(PACKAGE_TOLERANCE_REASON_CODES, code)
    ? code
    : 'other';
}

function dateKeyFromNow(value = new Date()) {
  const parsed = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date(value || Date.now());
  const normalized = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(normalized);
}

function dateToUtcDayNumber(dateKey) {
  const normalized = normalizePackageToleranceDate(dateKey);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function addPackageToleranceDays(dateKey, days) {
  const normalized = normalizePackageToleranceDate(dateKey);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return [
    target.getUTCFullYear(),
    String(target.getUTCMonth() + 1).padStart(2, '0'),
    String(target.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function normalizePackageTolerance(raw = {}) {
  const packageNumber = normalizePackageNumber(raw.packageNumber);
  const authorizedAt = normalizeIso(raw.authorizedAt || raw.createdAt || raw.updatedAt);
  const expiresAt = normalizePackageToleranceDate(raw.expiresAt || raw.deadlineDate);
  if (!packageNumber || !authorizedAt || !expiresAt) return null;

  const status = raw.status === 'closed' ? 'closed' : 'active';
  const id = normalizeText(raw.id, 180)
    || `tolerance-${packageNumber}-${authorizedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;
  return {
    id,
    version: PACKAGE_TOLERANCE_SCHEMA_VERSION,
    packageNumber,
    status,
    reasonCode: normalizeReasonCode(raw.reasonCode),
    reasonText: normalizeText(raw.reasonText, 300),
    notes: normalizeText(raw.notes, 1000),
    promisedPaymentDate: normalizePackageToleranceDate(raw.promisedPaymentDate) || expiresAt,
    expiresAt,
    maxSessions: normalizeMaxSessions(raw.maxSessions),
    authorizedAt,
    authorizedBy: normalizeText(raw.authorizedBy, 180) || 'Administrador',
    updatedAt: normalizeIso(raw.updatedAt || authorizedAt) || authorizedAt,
    updatedBy: normalizeText(raw.updatedBy, 180) || normalizeText(raw.authorizedBy, 180) || 'Administrador',
    closedAt: normalizeIso(raw.closedAt),
    closedBy: normalizeText(raw.closedBy, 180),
    closeReason: normalizeText(raw.closeReason, 120),
    supersedesId: normalizeText(raw.supersedesId, 180),
  };
}

export function listPackageTolerances(patientOrTolerances) {
  const source = Array.isArray(patientOrTolerances)
    ? patientOrTolerances
    : patientOrTolerances?.packageTolerances;
  return (Array.isArray(source) ? source : [])
    .map(normalizePackageTolerance)
    .filter(Boolean)
    .sort((left, right) => (
      String(left.authorizedAt).localeCompare(String(right.authorizedAt))
      || String(left.id).localeCompare(String(right.id))
    ));
}

export function getLatestPackageTolerance(patientOrTolerances, packageNumber) {
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  return listPackageTolerances(patientOrTolerances)
    .filter(item => item.packageNumber === normalizedPackageNumber)
    .at(-1) || null;
}

export function getHighestRecordedTolerancePackageNumber(patientOrTolerances) {
  return listPackageTolerances(patientOrTolerances)
    .reduce((highest, item) => Math.max(highest, item.packageNumber), 0);
}

export function resolvePackageToleranceOffer(summary = {}, { sessionsPerPackage = 10 } = {}) {
  const activeRecord = summary?.packageTolerance?.record;
  const hasOpenTolerance = Boolean(
    activeRecord && !['closed', 'paid'].includes(String(summary?.packageTolerance?.status || '')),
  );
  const currentPackageNumber = normalizePackageNumber(summary?.packageNumber);
  const paidActivatedPackageNumber = normalizePackageNumber(summary?.paidActivatedPackageNumber);
  const nextPackageRequiringAuthorization = normalizePackageNumber(summary?.nextPackageRequiringAuthorization);
  const pendingGross = Number(summary?.pendingGross || 0);
  const paidGross = Number(summary?.paidGross || 0);
  const hasCurrentUnpaidPackage = Boolean(
    summary?.hasCurrentPackage
      && currentPackageNumber > 0
      && pendingGross > 0
      && paidGross <= 0
      && !summary?.hasNewPackageWithoutPayment,
  );
  const normalizedSessionsPerPackage = Number.isInteger(Number(sessionsPerPackage)) && Number(sessionsPerPackage) > 0
    ? Number(sessionsPerPackage)
    : 10;
  const consumedSessionTotal = Math.max(Number(summary?.consumedSessionTotal || 0), 0);
  const completedPackageBoundary = consumedSessionTotal > 0
    && consumedSessionTotal % normalizedSessionsPerPackage === 0;

  let targetPackageNumber = 0;
  let reason = 'none';
  if (hasOpenTolerance) {
    targetPackageNumber = normalizePackageNumber(activeRecord.packageNumber);
    reason = 'existing_tolerance';
  } else if (hasCurrentUnpaidPackage) {
    targetPackageNumber = currentPackageNumber;
    reason = 'current_package_unpaid';
  } else if (summary?.hasNewPackageWithoutPayment) {
    targetPackageNumber = Math.max(
      paidActivatedPackageNumber + 1,
      nextPackageRequiringAuthorization || currentPackageNumber || 1,
    );
    reason = 'new_package_without_payment';
  } else if (completedPackageBoundary) {
    targetPackageNumber = Math.max(
      paidActivatedPackageNumber + 1,
      nextPackageRequiringAuthorization || currentPackageNumber + 1 || 1,
    );
    reason = 'completed_package_boundary';
  }

  return {
    canOffer: Boolean(targetPackageNumber),
    targetPackageNumber,
    reason,
    hasCurrentUnpaidPackage,
  };
}

function sessionSortKey(session) {
  const time = /^\d{1,2}:\d{2}$/.test(String(session?.time || ''))
    ? String(session.time).padStart(5, '0')
    : '00:00';
  return `${String(session?.date || '')}T${time}|${String(session?.id || '')}`;
}

export function countPackageConsumedSessions({
  sessions = [],
  patientId = '',
  packageNumber,
  throughDate = dateKeyFromNow(),
  sessionConsumesPackageFn = sessionConsumesPackage,
} = {}) {
  const normalizedPatientId = normalizePatientId(patientId);
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  if (!normalizedPatientId || !normalizedPackageNumber) return 0;

  const consumed = (Array.isArray(sessions) ? sessions : [])
    .filter(session => normalizePatientId(session?.patientId) === normalizedPatientId)
    .filter(session => sessionConsumesPackageFn(session, { throughDate }))
    .slice()
    .sort((left, right) => sessionSortKey(left).localeCompare(sessionSortKey(right)));
  const startIndex = (normalizedPackageNumber - 1) * 10;
  return consumed.slice(startIndex, startIndex + 10).length;
}

export function resolvePackageTolerance({
  patient = null,
  packageTolerances = null,
  sessions = [],
  payments = [],
  packageNumber = 0,
  now = new Date(),
  sessionConsumesPackageFn = sessionConsumesPackage,
  packageValueResolver,
} = {}) {
  const patientId = normalizePatientId(patient?.id || payments.find(item => item?.patientId)?.patientId || sessions.find(item => item?.patientId)?.patientId);
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  const record = getLatestPackageTolerance(packageTolerances || patient, normalizedPackageNumber);
  const today = dateKeyFromNow(now);
  const paidActivatedPackageNumber = getActivatedPackageNumber(payments, {
    patientId,
    throughDate: today,
    packageValueResolver,
  });
  const packagePaymentSummary = getPackagePaymentSummary(payments, normalizedPackageNumber, {
    patientId,
    throughDate: today,
    packageValueResolver,
  });
  const sessionsUsed = countPackageConsumedSessions({
    sessions,
    patientId,
    packageNumber: normalizedPackageNumber,
    throughDate: today,
    sessionConsumesPackageFn,
  });

  const expiresDay = dateToUtcDayNumber(record?.expiresAt);
  const todayDay = dateToUtcDayNumber(today);
  const daysRemaining = expiresDay === null || todayDay === null ? null : expiresDay - todayDay;
  const remainingSessions = record ? Math.max(record.maxSessions - sessionsUsed, 0) : 0;
  const paid = packagePaymentSummary.paidAmount > 0;

  let status = 'none';
  if (record) {
    if (record.status === 'closed') status = 'closed';
    else if (paid) status = 'paid';
    else if (daysRemaining !== null && daysRemaining < 0) status = 'expired';
    else if (sessionsUsed >= record.maxSessions) status = 'limit_reached';
    else status = 'active';
  }

  return {
    record,
    packageNumber: normalizedPackageNumber,
    patientId,
    today,
    paidActivatedPackageNumber,
    sessionsUsed,
    remainingSessions,
    daysRemaining,
    status,
    isActive: status === 'active',
    isExpired: status === 'expired' || status === 'limit_reached',
    isPaid: status === 'paid',
    canReceiveNewSessions: status === 'active',
    keepsHistoricalAccess: Boolean(record),
  };
}

export function getTemporaryAuthorizedPackageNumber({
  patient = null,
  packageTolerances = null,
  sessions = [],
  payments = [],
  now = new Date(),
  packageValueResolver,
} = {}) {
  const tolerances = listPackageTolerances(packageTolerances || patient);
  return tolerances.reduce((highest, tolerance) => {
    const resolution = resolvePackageTolerance({
      patient,
      packageTolerances: tolerances,
      sessions,
      payments,
      packageNumber: tolerance.packageNumber,
      now,
      packageValueResolver,
    });
    return resolution.isActive ? Math.max(highest, tolerance.packageNumber) : highest;
  }, 0);
}

export function getToleranceDisplayPackageNumber({
  patient = null,
  packageTolerances = null,
  sessions = [],
  payments = [],
  now = new Date(),
  packageValueResolver,
} = {}) {
  const tolerances = listPackageTolerances(packageTolerances || patient);
  return tolerances.reduce((highest, tolerance) => {
    const resolution = resolvePackageTolerance({
      patient,
      packageTolerances: tolerances,
      sessions,
      payments,
      packageNumber: tolerance.packageNumber,
      now,
      packageValueResolver,
    });
    if (resolution.status === 'closed') return highest;
    return Math.max(highest, tolerance.packageNumber);
  }, 0);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

export function grantPackageTolerance(patient, {
  packageNumber,
  reasonCode = 'requested_days',
  reasonText = '',
  notes = '',
  promisedPaymentDate,
  expiresAt,
  maxSessions = DEFAULT_PACKAGE_TOLERANCE_MAX_SESSIONS,
  actor = 'Administrador',
  now = new Date(),
} = {}) {
  if (!patient?.id) throw new Error('Atendente inválido para liberar a tolerância.');
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  if (!normalizedPackageNumber) throw new Error('Informe um pacote válido para a tolerância.');
  const authorizedAt = normalizeIso(now) || new Date().toISOString();
  const today = dateKeyFromNow(now);
  const normalizedExpiresAt = normalizePackageToleranceDate(expiresAt)
    || addPackageToleranceDays(today, DEFAULT_PACKAGE_TOLERANCE_DAYS);
  const normalizedPromisedDate = normalizePackageToleranceDate(promisedPaymentDate)
    || normalizedExpiresAt;
  if (normalizedExpiresAt < today) throw new Error('O prazo da tolerância não pode terminar no passado.');
  if (normalizedPromisedDate < today) throw new Error('A data prometida para pagamento não pode estar no passado.');
  if (normalizedPromisedDate > normalizedExpiresAt) {
    throw new Error('A data prometida para pagamento não pode ser posterior ao prazo final da tolerância.');
  }

  const actorName = normalizeText(actor, 180) || 'Administrador';
  const existing = listPackageTolerances(patient);
  const latest = getLatestPackageTolerance(existing, normalizedPackageNumber);
  const closedExisting = existing.map(item => (
    item.packageNumber === normalizedPackageNumber && item.status === 'active'
      ? {
          ...item,
          status: 'closed',
          closedAt: authorizedAt,
          closedBy: actorName,
          closeReason: 'superseded',
          updatedAt: authorizedAt,
          updatedBy: actorName,
        }
      : item
  ));
  const record = normalizePackageTolerance({
    id: `tolerance-${normalizedPackageNumber}-${authorizedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${randomSuffix()}`,
    packageNumber: normalizedPackageNumber,
    status: 'active',
    reasonCode,
    reasonText,
    notes,
    promisedPaymentDate: normalizedPromisedDate,
    expiresAt: normalizedExpiresAt,
    maxSessions,
    authorizedAt,
    authorizedBy: actorName,
    updatedAt: authorizedAt,
    updatedBy: actorName,
    supersedesId: latest?.id || '',
  });
  if (!record) throw new Error('Não foi possível criar a tolerância.');

  return {
    ...patient,
    packageTolerances: [...closedExisting, record],
  };
}

export function closePackageTolerance(patient, {
  packageNumber,
  actor = 'Administrador',
  reason = 'manual',
  now = new Date(),
} = {}) {
  if (!patient?.id) throw new Error('Atendente inválido para encerrar a tolerância.');
  const normalizedPackageNumber = normalizePackageNumber(packageNumber);
  const closedAt = normalizeIso(now) || new Date().toISOString();
  const actorName = normalizeText(actor, 180) || 'Administrador';
  let changed = false;
  const packageTolerances = listPackageTolerances(patient).map(item => {
    if (item.packageNumber !== normalizedPackageNumber || item.status !== 'active') return item;
    changed = true;
    return {
      ...item,
      status: 'closed',
      closedAt,
      closedBy: actorName,
      closeReason: normalizeText(reason, 120) || 'manual',
      updatedAt: closedAt,
      updatedBy: actorName,
    };
  });
  return changed ? { ...patient, packageTolerances } : patient;
}

export function closePackageToleranceAfterPayment(patient, {
  packageNumber,
  actor = 'Administrador',
  now = new Date(),
} = {}) {
  return closePackageTolerance(patient, {
    packageNumber,
    actor,
    reason: 'payment_confirmed',
    now,
  });
}
