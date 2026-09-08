import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebaseAdmin.js';
import { resolvePsychologyAccessContext, resolvePsychologyAdminMonitoringContext } from './_lib/psychologyAccess.js';
import { buildPsychologyAuditEvent, createPsychologyRequestId, logPsychologyAuditEvent } from './_lib/psychologyObservability.js';
import { createPsychologyServerRepository, psychologyCollectionPath } from './_lib/psychologyRepository.js';
import { deletePsychologyPatientSafely } from './_lib/psychologyPatientDeletion.js';
import { buildScopedPsychologyBackup } from './_lib/psychologyBackup.js';
import { readPsychologySettingsProjection, sanitizePsychologySettingsProjectionError } from './_lib/psychologySettingsProjection.js';
import { attachFirestoreDiagnostics } from './_lib/firestoreDiagnostics.js';
import { normalizePhone } from '../shared/phoneNormalization.js';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'https://gestaoclinica-solucoes.vercel.app',
]);

function apiError(code, message, statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalize(value, maxLength = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizePhoneForWrite(value) {
  const input = normalize(value, 32);
  if (!input) return '';
  try {
    // New writes remove import artifacts but retain the human-readable mask.
    return normalizePhone(input).displayPhone;
  } catch {
    throw apiError('psychology/phone-invalid', 'Informe um telefone válido.', 422);
  }
}

function normalizeAdministrativeResponsible(value) {
  if (!value || typeof value !== 'object') return undefined;
  const source = value;
  const normalized = {
    fullName: normalize(source.fullName, 160),
    relationship: normalize(source.relationship, 120),
    phone: normalize(source.phone, 64),
    email: normalize(source.email, 160).toLocaleLowerCase(),
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function normalizePatientFinancialSettings(value) {
  if (!value || typeof value !== 'object') return undefined;
  const source = value;
  const mode = source.mode === 'single' || source.mode === 'package' ? source.mode : 'none';
  const numberOrUndefined = candidate => {
    const number = Number(candidate);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };
  const packageQuantity = Number(source.packageQuantity);
  return {
    mode,
    serviceId: normalize(source.serviceId, 128) || undefined,
    sessionPrice: numberOrUndefined(source.sessionPrice),
    packageId: normalize(source.packageId, 128) || undefined,
    packageQuantity: Number.isInteger(packageQuantity) && packageQuantity > 0 && packageQuantity <= 100 ? packageQuantity : undefined,
    packageTotalPrice: numberOrUndefined(source.packageTotalPrice),
    packageDueDate: /^\d{4}-\d{2}-\d{2}$/u.test(normalize(source.packageDueDate, 32)) ? normalize(source.packageDueDate, 32) : undefined,
    note: normalize(source.note, 1000) || undefined,
    updatedAt: normalize(source.updatedAt, 64) || undefined,
  };
}

function validateAdministrativeResponsibleForWrite(value) {
  const normalized = normalizeAdministrativeResponsible(value);
  if (!normalized) return undefined;
  if (normalized.phone) {
    try {
      normalizePhone(normalized.phone);
    } catch {
      throw apiError('psychology/responsible-phone-invalid', 'Informe um telefone válido para o responsável.', 422);
    }
  }
  if (normalized.email && !/^\S+@\S+\.\S+$/u.test(normalized.email)) {
    throw apiError('psychology/responsible-email-invalid', 'Informe um e-mail válido para o responsável.', 422);
  }
  return normalized;
}

function setSecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const origin = String(req.headers?.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    throw apiError('psychology/invalid-json', 'A solicitação enviada é inválida.', 422);
  }
}

function requestIdempotencyKey(req) {
  const value = req.headers?.['x-idempotency-key'] || req.headers?.['X-Idempotency-Key'];
  const normalized = normalize(value, 200);
  return normalized && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(normalized) ? normalized : undefined;
}

function routeParts(req) {
  if (Array.isArray(req.query?.path)) return req.query.path.map(value => normalize(value, 128)).filter(Boolean);
  if (typeof req.query?.path === 'string' && req.query.path.trim()) return req.query.path.split('/').map(value => normalize(value, 128)).filter(Boolean);
  const rawUrl = String(req.url || '');
  const pathname = rawUrl.split('?')[0];
  const marker = '/api/psychology';
  const markerIndex = pathname.indexOf(marker);
  const rest = markerIndex >= 0 ? pathname.slice(markerIndex + marker.length) : pathname;
  return rest.split('/').map(value => normalize(value, 128)).filter(Boolean);
}

const GENERIC_OPERATION_ROUTES = Object.freeze({
  'personal-appointments': { aggregate: 'personalAppointments', readPermission: 'agenda.own.view', writePermission: 'agenda.edit' },
  services: { aggregate: 'services', readPermission: 'agenda.own.view', writePermission: 'agenda.edit' },
  locations: { aggregate: 'locations', readPermission: 'agenda.own.view', writePermission: 'agenda.edit' },
  packages: { aggregate: 'packages', readPermission: 'finance.patient.view', writePermission: 'finance.manage' },
  charges: { aggregate: 'charges', readPermission: 'finance.patient.view', writePermission: 'finance.manage' },
  payments: { aggregate: 'payments', readPermission: 'finance.patient.view', writePermission: 'finance.manage' },
  expenses: { aggregate: 'expenses', readPermission: 'finance.patient.view', writePermission: 'finance.manage' },
  documents: { aggregate: 'documents', readPermission: 'documents.view', writePermission: null },
  attachments: { aggregate: 'attachments', readPermission: 'documents.view', writePermission: null },
});

const FINANCIAL_AGGREGATES = new Set(['charges', 'payments', 'expenses']);
const FINANCIAL_PAYMENT_METHODS = new Set(['PIX', 'CASH', 'CARD', 'TRANSFER', 'OTHER']);
const FINANCIAL_EXPENSE_CATEGORIES = new Set(['Aluguel', 'Materiais', 'Serviços', 'Impostos/Taxas', 'Marketing', 'Capacitação', 'Tecnologia', 'Outros']);
const CANONICAL_PSYCHOLOGY_SERVICE_IDS = new Set([
  'psychotherapy-individual',
  'therapy-couple',
  'mentoring',
  'eneagram-test',
  'psychotherapy-adolescent',
]);

function financialRecordSource(body) {
  return body?.item && typeof body.item === 'object' ? body.item : body || {};
}

function assertFinancialAmount(value, { allowZero = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || (allowZero ? numeric < 0 : numeric <= 0)) {
    throw apiError('psychology/financial-invalid-amount', 'Informe um valor financeiro válido.', 422);
  }
  return numeric;
}

function assertFinancialDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10))) {
    throw apiError('psychology/financial-invalid-date', 'Informe uma data financeira válida.', 422);
  }
}

async function validateFinancialRecord({ aggregate, record, repository, existing }) {
  if (aggregate === 'charges') {
    if (record.description !== undefined && typeof record.description !== 'string') throw apiError('psychology/financial-invalid-description', 'A descrição da cobrança é inválida.', 422);
    assertFinancialAmount(record.amount, { allowZero: true });
    if (!normalize(record.patientId, 128)) throw apiError('psychology/financial-patient-required', 'A cobrança exige um paciente da Psicologia.', 422);
    const patient = await repository.patients.get(record.patientId);
    if (!patient || patient.active === false) throw apiError('psychology/financial-patient-invalid', 'Selecione um paciente ativo da Psicologia.', 422);
    if (record.packageId) {
      const sessionPackage = await repository.packages.get(record.packageId);
      if (!sessionPackage || sessionPackage.patientId !== record.patientId || sessionPackage.active === false || Number(sessionPackage.usedSessions || 0) >= Number(sessionPackage.totalSessions || 0)) throw apiError('psychology/package-reference-invalid', 'Selecione um pacote ativo deste paciente com sessões disponíveis.', 422);
      const packageTotal = sessionPackage.totalPrice ?? sessionPackage.price;
      if (packageTotal !== undefined && Math.abs(Number(packageTotal) - Number(record.amount)) > 0.0001) throw apiError('psychology/package-amount-mismatch', 'A cobrança do pacote deve usar o total cadastrado do pacote.', 422);
    }
    if (!['pending', 'partial', 'paid', 'exempt', 'canceled', 'cancelled'].includes(String(record.status || '').toLowerCase())) {
      throw apiError('psychology/financial-invalid-status', 'O status da cobrança é inválido.', 422);
    }
    if (record.dueDate) assertFinancialDate(record.dueDate);
  }
  if (aggregate === 'payments') {
    if (!normalize(record.chargeId, 128) || !normalize(record.patientId, 128)) throw apiError('psychology/financial-reference-required', 'O pagamento exige cobrança e paciente válidos.', 422);
    const charge = await repository.financial.getCharge(record.chargeId);
    if (!charge || charge.patientId !== record.patientId) throw apiError('psychology/financial-reference-invalid', 'O pagamento não corresponde a uma cobrança da Psicologia.', 422);
    assertFinancialAmount(record.amount);
    assertFinancialDate(record.date);
    if (!FINANCIAL_PAYMENT_METHODS.has(record.method)) throw apiError('psychology/financial-invalid-method', 'Informe um meio de pagamento válido.', 422);
    if (!['active', 'voided'].includes(String(record.status || '').toLowerCase())) throw apiError('psychology/financial-invalid-status', 'O status do pagamento é inválido.', 422);
    if (String(record.status).toLowerCase() === 'active') {
      const payments = await repository.financial.listPayments();
      const received = payments
        .filter(payment => payment.chargeId === charge.id && payment.id !== existing?.id && String(payment.status || '').toLowerCase() !== 'voided' && (!payment.reversedAt || payment.reactivatedAt) && (!payment.voidedAt || payment.reactivatedAt))
        .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);
      if (received + Number(record.amount) > Math.max(0, Number(charge.amount) || 0) + 0.0001) {
        throw apiError('psychology/financial-balance-exceeded', 'O pagamento ultrapassa o saldo atual da cobrança.', 422);
      }
    }
  }
  if (aggregate === 'expenses') {
    if (record.description !== undefined && typeof record.description !== 'string') throw apiError('psychology/financial-invalid-description', 'A descrição da despesa é inválida.', 422);
    assertFinancialAmount(record.amount);
    assertFinancialDate(record.date);
    if (!FINANCIAL_EXPENSE_CATEGORIES.has(record.category)) throw apiError('psychology/financial-invalid-category', 'Informe uma categoria válida.', 422);
    if (!['REALIZED', 'PENDING', 'REVERSED'].includes(record.status)) throw apiError('psychology/financial-invalid-status', 'O status da despesa é inválido.', 422);
  }
  return record;
}

async function validatePackageRecord({ record, repository }) {
  if (!normalize(record.patientId, 128)) throw apiError('psychology/package-patient-required', 'O pacote exige um paciente da Psicologia.', 422);
  const patient = await repository.patients.get(record.patientId);
  if (!patient || patient.active === false) throw apiError('psychology/package-patient-invalid', 'Selecione um paciente ativo da Psicologia.', 422);
  if (!normalize(record.name, 240)) throw apiError('psychology/package-invalid-name', 'Informe o nome do pacote.', 422);
  if (!Number.isInteger(Number(record.totalSessions)) || Number(record.totalSessions) < 1) throw apiError('psychology/package-invalid-total', 'Informe uma quantidade válida de sessões.', 422);
  if (!Number.isInteger(Number(record.usedSessions || 0)) || Number(record.usedSessions || 0) < 0 || Number(record.usedSessions || 0) > Number(record.totalSessions)) throw apiError('psychology/package-invalid-used', 'As sessões utilizadas não podem ultrapassar o total.', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.startDate || ''))) throw apiError('psychology/package-invalid-start-date', 'Informe uma data inicial válida para o pacote.', 422);
  if (record.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(record.endDate))) throw apiError('psychology/package-invalid-end-date', 'Informe uma data final válida para o pacote.', 422);
  if (record.endDate && record.endDate < record.startDate) throw apiError('psychology/package-invalid-range', 'A data final não pode ser anterior à inicial.', 422);
  if (record.serviceId) {
    const settingsRecord = await repository.settings.get('settings');
    const configuredServices = Array.isArray(settingsRecord?.settings?.services) ? settingsRecord.settings.services : [];
    const serviceIsActive = configuredServices.length > 0
      ? configuredServices.some(service => service?.id === record.serviceId && service.active !== false)
      : CANONICAL_PSYCHOLOGY_SERVICE_IDS.has(record.serviceId);
    if (!serviceIsActive) throw apiError('psychology/package-service-invalid', 'Selecione um serviço ativo.', 422);
  }
  for (const [field, label] of [['price', 'preço'], ['pricePerSession', 'valor por sessão'], ['totalPrice', 'valor total']]) {
    if (record[field] !== undefined && (!Number.isFinite(Number(record[field])) || Number(record[field]) < 0)) throw apiError(`psychology/package-invalid-${field}`, `Informe um ${label} válido.`, 422);
  }
  return record;
}

function isActiveFinancialPayment(payment) {
  const status = String(payment?.status || '').toLowerCase();
  return status !== 'voided' && status !== 'reversed' && (!payment?.reversedAt || payment?.reactivatedAt) && (!payment?.voidedAt || payment?.reactivatedAt);
}

function chargeStatusAfterPaymentDeletion(charge, payments) {
  const currentStatus = String(charge?.status || '').toLowerCase();
  if (currentStatus === 'canceled' || currentStatus === 'cancelled') return currentStatus;
  if (currentStatus === 'exempt' || Number(charge?.amount || 0) === 0) return 'exempt';
  const received = payments
    .filter(payment => payment.chargeId === charge.id && isActiveFinancialPayment(payment))
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);
  if (received >= Math.max(0, Number(charge.amount) || 0)) return 'paid';
  return received > 0 ? 'partial' : 'pending';
}

async function deleteFinancialRecord({ aggregate, id, repository }) {
  if (aggregate === 'charges') {
    const charge = await repository.financial.getCharge(id);
    if (!charge) throw apiError('psychology/resource-not-found', 'Cobrança não encontrada neste escopo.', 404);
    const payments = await repository.financial.listPayments();
    if (payments.some(payment => payment.chargeId === charge.id)) {
      throw apiError('psychology/charge-delete-blocked-by-payments', 'Esta cobrança possui pagamentos vinculados. Estorne ou exclua os pagamentos antes de excluir a cobrança.', 409);
    }
    return repository.financial.deleteChargeKnown(charge);
  }
  if (aggregate === 'payments') {
    const payment = await repository.financial.getPayment(id);
    if (!payment) throw apiError('psychology/resource-not-found', 'Pagamento não encontrado neste escopo.', 404);
    const charge = payment.chargeId ? await repository.financial.getCharge(payment.chargeId) : null;
    const remainingPayments = charge
      ? (await repository.financial.listPayments()).filter(candidate => candidate.id !== payment.id)
      : [];
    const deleted = await repository.financial.deletePaymentKnown(payment);
    if (charge) {
      await repository.financial.updateChargeKnown(charge, {
        status: chargeStatusAfterPaymentDeletion(charge, remainingPayments),
      });
    }
    return deleted;
  }
  const expense = await repository.financial.getExpense(id);
  if (!expense) throw apiError('psychology/resource-not-found', 'Despesa não encontrada neste escopo.', 404);
  return repository.financial.deleteExpenseKnown(expense);
}

async function deletePackageRecord({ id, repository }) {
  const sessionPackage = await repository.packages.get(id);
  if (!sessionPackage) throw apiError('psychology/resource-not-found', 'Pacote não encontrado neste escopo.', 404);
  const [charges, patients] = await Promise.all([
    repository.financial.listCharges(),
    repository.patients.list(),
  ]);
  const hasOperationalDependency = Number(sessionPackage.usedSessions || 0) > 0
    || charges.some(charge => charge.packageId === sessionPackage.id)
    || patients.some(patient => patient?.financialSettings?.packageId === sessionPackage.id);
  if (hasOperationalDependency) {
    throw apiError('psychology/package-delete-blocked-by-dependencies', 'Este pacote já possui uso ou vínculo financeiro. Desative-o para preservar o histórico.', 409);
  }
  return repository.packages.delete(sessionPackage.id);
}

function financialRepositoryFor(repository, aggregate) {
  if (aggregate === 'charges') return {
    get: repository.financial.getCharge,
    list: repository.financial.listCharges,
    upsert: repository.financial.upsertCharge,
  };
  if (aggregate === 'payments') return {
    get: repository.financial.getPayment,
    list: repository.financial.listPayments,
    upsert: repository.financial.createPayment,
  };
  return {
    get: repository.financial.getExpense,
    list: repository.financial.listExpenses,
    upsert: repository.financial.upsertExpense,
  };
}

function prepareGenericRecord(body, runtimeScope, now) {
  const source = body.item && typeof body.item === 'object' ? body.item : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const id = normalize(source.id, 128) || `${crypto.randomUUID()}`;
  return {
    ...source,
    id,
    ...scopeFields(runtimeScope),
    createdAt: now,
    updatedAt: now,
  };
}

function assertScopePayloadDoesNotConflict(body, runtimeScope) {
  for (const key of ['workspaceId', 'professionalId', 'tenantId', 'context']) {
    if (!(key in body) || body[key] === undefined || body[key] === null || body[key] === '') continue;
    if (normalize(body[key]) !== normalize(runtimeScope[key])) {
      throw apiError('psychology/scope-conflict', 'O payload não pode escolher outro escopo.', 422);
    }
  }
}

function scopeFields(runtimeScope) {
  return {
    workspaceId: runtimeScope.workspaceId,
    tenantId: runtimeScope.tenantId,
    professionalId: runtimeScope.professionalId,
    context: runtimeScope.context,
    bindingMode: runtimeScope.bindingMode,
  };
}

function administrativePatientDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    professionalId: value.professionalId,
    context: value.context,
    name: value.name,
    birthDate: value.birthDate,
    phone: value.phone,
    email: value.email || '',
    preferredModality: value.preferredModality,
    financialSettings: normalizePatientFinancialSettings(value.financialSettings),
    administrativeNote: value.administrativeNote || value.administrativeNotes || '',
    administrativeResponsible: normalizeAdministrativeResponsible(value.administrativeResponsible),
    externalReferences: Array.isArray(value.externalReferences) ? value.externalReferences : [],
    inReview: value.inReview === true,
    reviewMarkedAt: value.reviewMarkedAt || undefined,
    active: value.active !== false,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sessionDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    professionalId: value.professionalId,
    context: value.context,
    patientId: value.patientId,
    date: value.date,
    time: value.time,
    durationMinutes: value.durationMinutes,
    modality: value.modality,
    serviceId: value.serviceId || undefined,
    locationId: value.locationId || undefined,
    locationType: value.locationType || undefined,
    chargeId: value.chargeId || undefined,
    administrativeNote: value.administrativeNote || '',
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function clinicalSessionRecordDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    professionalId: value.professionalId,
    context: value.context,
    patientId: value.patientId,
    sessionId: value.sessionId || undefined,
    sessionDate: value.sessionDate || value.date || undefined,
    sessionTime: value.sessionTime || undefined,
    date: value.date || undefined,
    authorProfessionalId: value.authorProfessionalId,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function cleanProfessionalProfile(input = {}) {
  const allowed = ['displayName', 'professionalTitle', 'professionalRegistration', 'clinicDisplayName', 'email', 'phone'];
  return Object.fromEntries(allowed
    .filter(key => input[key] !== undefined)
    .map(key => [key, key === 'phone' ? normalizePhoneForWrite(input[key]) : normalize(input[key], 160)]));
}

function cleanSettingsAgenda(input = {}, previous = {}) {
  const allowed = ['defaultDurationMinutes', 'intervalMinutes', 'weeklyAvailability', 'dayParts', 'workingDays', 'availableTimes'];
  return {
    ...previous,
    ...Object.fromEntries(allowed
      .filter(key => input[key] !== undefined)
      .map(key => [key, input[key]])),
  };
}

function cleanSettingsServices(input, runtimeScope, previous = []) {
  if (!Array.isArray(input)) return previous;
  return input.map((item, index) => ({
    id: normalize(item?.id, 128) || `service-${index + 1}`,
    ...scopeFields(runtimeScope),
    name: normalize(item?.name, 160),
    defaultDurationMinutes: Math.max(1, Math.min(480, Number(item?.defaultDurationMinutes) || 50)),
    defaultPrice: Math.max(0, Number(item?.defaultPrice) || 0),
    modality: ['ONLINE', 'PRESENTIAL', 'BOTH'].includes(item?.modality) ? item.modality : 'BOTH',
    active: item?.active !== false,
    createdAt: normalize(item?.createdAt, 64) || previous[index]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function cleanSettingsLocations(input, runtimeScope, previous = []) {
  if (!Array.isArray(input)) return previous;
  return input.map((item, index) => ({
    id: normalize(item?.id, 128) || `location-${index + 1}`,
    ...scopeFields(runtimeScope),
    type: ['PRIMARY_OFFICE', 'EXTERNAL_OFFICE', 'OTHER'].includes(item?.type) ? item.type : 'OTHER',
    displayName: normalize(item?.displayName, 160),
    address: normalize(item?.address, 320),
    fullAddress: normalize(item?.fullAddress || item?.address, 320),
    city: normalize(item?.city, 100),
    state: normalize(item?.state, 2).toUpperCase(),
    googleMapsUrl: normalize(item?.googleMapsUrl, 500),
    sortOrder: Math.max(1, Number(item?.sortOrder) || index + 1),
    active: item?.active !== false,
    isPrimary: Boolean(item?.isPrimary),
    color: normalize(item?.color, 16),
    colorKey: normalize(item?.colorKey, 40) || undefined,
    createdAt: normalize(item?.createdAt, 64) || previous[index]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function settingsDto(record, runtimeScope) {
  return {
    ...scopeFields(runtimeScope),
    id: 'settings',
    settings: record?.settings || {},
    updatedAt: record?.updatedAt || null,
  };
}

function defaultSettings(runtimeScope, now) {
  return {
    ...scopeFields(runtimeScope),
    id: 'settings',
    settings: {
      scope: { professionalId: runtimeScope.professionalId, context: runtimeScope.context },
      professionalProfile: {
        displayName: 'Profissional',
        professionalTitle: 'Psicologia',
        professionalRegistration: '',
        clinicDisplayName: '',
        email: '',
        phone: '',
      },
      agenda: { defaultDurationMinutes: 50, intervalMinutes: 15, workingDays: [1, 2, 3, 4, 5], availableTimes: [] },
      services: [],
      locations: [],
      colors: {},
      reminders: { enabled: false, advanceMinutes: 30 },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function auditHeaders(res, runtimeScope, action, aggregate) {
  res.setHeader('X-Psychology-Context', runtimeScope.context);
  res.setHeader('X-Psychology-Action', `${action}:${aggregate}`);
  res.setHeader('X-Psychology-Binding-Mode', runtimeScope.bindingMode || 'UNKNOWN');
}

function maskOperationalPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length < 8) return value ? '***' : 'Não informado';
  const area = digits.length >= 10 ? digits.slice(0, 2) : '';
  const maskedLocal = '*'.repeat(Math.max(3, digits.length - (area ? 2 : 0) - 4));
  const suffix = digits.slice(-4);
  return area ? `(${area}) ${maskedLocal}-${suffix}` : `${maskedLocal}-${suffix}`;
}

async function countOperationalDocuments(reference, predicate) {
  if (typeof reference?.count === 'function') {
    const aggregateSnapshot = await reference.count().get();
    const aggregateData = typeof aggregateSnapshot?.data === 'function' ? aggregateSnapshot.data() : aggregateSnapshot?.data;
    const count = Number(aggregateData?.count);
    if (Number.isFinite(count)) return count;
  }
  const snapshot = await reference.get();
  const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
  return predicate ? documents.filter(document => predicate(document.data() || {})).length : documents.length;
}

function publicBookingStateReference(db, runtimeScope) {
  const path = `workspaces/${runtimeScope.workspaceId}/tenants/${runtimeScope.tenantId}/professionals/${runtimeScope.professionalId}/contexts/${runtimeScope.context}/publicBooking`;
  return typeof db.doc === 'function' ? db.doc(`${path}/state`) : db.collection(path).doc('state');
}

async function getPsychologyOperationalMonitoringData({ db, runtimeScope, now }) {
  const settingsReference = db.collection(psychologyCollectionPath(runtimeScope, 'settings')).doc('settings');
  const patientsReference = db.collection(psychologyCollectionPath(runtimeScope, 'patients'));
  const sessionsReference = db.collection(psychologyCollectionPath(runtimeScope, 'sessions'));
  const servicesReference = db.collection(psychologyCollectionPath(runtimeScope, 'services'));
  const locationsReference = db.collection(psychologyCollectionPath(runtimeScope, 'locations'));
  const packagesReference = db.collection(psychologyCollectionPath(runtimeScope, 'packages'));
  const personalAppointmentsReference = db.collection(psychologyCollectionPath(runtimeScope, 'personalAppointments'));
  const documentsReference = db.collection(psychologyCollectionPath(runtimeScope, 'documents'));
  const attachmentsReference = db.collection(psychologyCollectionPath(runtimeScope, 'attachments'));
  const publicBookingReference = publicBookingStateReference(db, runtimeScope);

  const [
    settingsSnapshot,
    patients,
    sessions,
    patientsInReview,
    activeServices,
    activeLocations,
    packages,
    personalAppointments,
    documents,
    attachments,
    publicBookingSnapshot,
  ] = await Promise.all([
    settingsReference.get(),
    countOperationalDocuments(patientsReference),
    countOperationalDocuments(sessionsReference),
    countOperationalDocuments(
      typeof patientsReference.where === 'function' ? patientsReference.where('inReview', '==', true) : patientsReference,
      data => data.inReview === true,
    ),
    countOperationalDocuments(
      typeof servicesReference.where === 'function' ? servicesReference.where('active', '==', true) : servicesReference,
      data => data.active !== false,
    ),
    countOperationalDocuments(
      typeof locationsReference.where === 'function' ? locationsReference.where('active', '==', true) : locationsReference,
      data => data.active !== false,
    ),
    countOperationalDocuments(packagesReference),
    countOperationalDocuments(personalAppointmentsReference),
    countOperationalDocuments(documentsReference),
    countOperationalDocuments(attachmentsReference),
    publicBookingReference.get(),
  ]);

  const settingsRecord = settingsSnapshot?.exists ? settingsSnapshot.data() || {} : {};
  const settings = settingsRecord.settings && typeof settingsRecord.settings === 'object' ? settingsRecord.settings : {};
  const profile = settings.professionalProfile && typeof settings.professionalProfile === 'object'
    ? settings.professionalProfile
    : {};
  const publicBooking = publicBookingSnapshot?.exists && publicBookingSnapshot.data()?.settings && typeof publicBookingSnapshot.data().settings === 'object'
    ? publicBookingSnapshot.data().settings
    : null;
  const alerts = [];
  if (!settingsSnapshot?.exists) alerts.push('Ajustes do ambiente ainda não foram configurados.');
  if (activeServices === 0) alerts.push('Nenhum serviço ativo foi encontrado.');
  if (publicBooking && publicBooking.active === false) alerts.push('Agendamento Online está desativado.');

  return {
    generatedAt: now(),
    scope: {
      workspaceId: runtimeScope.workspaceId,
      professionalId: runtimeScope.professionalId,
      context: runtimeScope.context,
    },
    environment: {
      professionalName: normalize(profile.displayName, 160) || 'Profissional da Psicologia',
      professionalPhone: maskOperationalPhone(profile.phone),
      provider: 'API remota da Psicologia',
      status: alerts.length ? 'atenção' : 'operacional',
    },
    persistence: {
      status: 'leitura concluída',
      mode: 'server-authoritative',
      lastSyncAt: settingsRecord.updatedAt || settings.updatedAt || null,
    },
    counts: {
      patients,
      sessions,
      patientsInReview,
      activeServices,
      activeLocations,
      packages,
      personalAppointments,
      documentManifests: documents,
      attachmentManifests: attachments,
    },
    backup: {
      status: 'disponível sob demanda',
      scope: 'escopo autenticado da Psicologia',
    },
    onlineBooking: {
      status: publicBooking ? (publicBooking.active === false ? 'desativado' : 'configurado') : 'não consultado',
      lastUpdatedAt: publicBooking?.updatedAt || null,
    },
    integrations: {
      status: 'não consultadas nesta visão operacional',
    },
    clinicalContent: {
      loaded: false,
      status: 'não consultado',
    },
    alerts,
  };
}

function sendError(res, error) {
  const knownStatus = Number(error?.statusCode);
  const statusCode = [401, 403, 404, 409, 422, 500, 501, 503].includes(knownStatus) ? knownStatus : 500;
  const message = statusCode === 500
    ? 'A API da Psicologia encontrou um erro inesperado.'
    : error?.message || 'Não foi possível concluir a operação.';
  return res.status(statusCode).json({ error: { code: error?.code || 'psychology/internal-error', message } });
}

function preparePatient(body, runtimeScope, now) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.patient && typeof body.patient === 'object' ? body.patient : body;
  const name = normalize(source.name, 160);
  const birthDate = normalize(source.birthDate, 32);
  const phone = normalizePhoneForWrite(source.phone);
  const preferredModality = normalize(source.preferredModality, 32);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/u.test(birthDate)) {
    throw apiError('psychology/patient-invalid', 'Informe uma data de nascimento válida.', 422);
  }
  if (!name || !phone || !['presencial', 'online'].includes(preferredModality)) {
    throw apiError('psychology/patient-invalid', 'Informe nome, telefone e modalidade do paciente.', 422);
  }
  const id = normalize(source.id, 128) || `patient-${crypto.randomUUID()}`;
  const patient = {
    id,
    ...scopeFields(runtimeScope),
    name,
    birthDate: birthDate || undefined,
    phone,
    email: normalize(source.email, 160) || '',
    preferredModality,
    financialSettings: normalizePatientFinancialSettings(source.financialSettings),
    administrativeNote: normalize(source.administrativeNote || source.administrativeNotes, 1000),
    administrativeResponsible: validateAdministrativeResponsibleForWrite(source.administrativeResponsible),
    externalReferences: Array.isArray(source.externalReferences) ? source.externalReferences.slice(0, 20) : [],
    inReview: source.inReview === true,
    reviewMarkedAt: source.inReview === true ? normalize(source.reviewMarkedAt, 64) || now : undefined,
    active: source.active !== false,
    createdAt: normalize(source.createdAt, 64) || now,
    updatedAt: now,
  };
  return patient;
}

function prepareSession(body, runtimeScope, now) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.session && typeof body.session === 'object' ? body.session : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const patientId = normalize(source.patientId, 128);
  const date = normalize(source.date, 32);
  const time = normalize(source.time, 16);
  const durationMinutes = Number(source.durationMinutes);
  const modality = normalize(source.modality, 32);
  const status = normalize(source.status, 32) || 'agendada';
  const locationType = normalize(source.locationType, 40);
  if (!patientId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw apiError('psychology/session-invalid', 'Informe paciente, data e horário válidos para a sessão.', 422);
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
    throw apiError('psychology/session-invalid', 'Informe uma duração válida para a sessão.', 422);
  }
  if (!['presencial', 'online'].includes(modality) || !['agendada', 'realizada', 'falta', 'cancelada'].includes(status)) {
    throw apiError('psychology/session-invalid', 'A modalidade ou status da sessão é inválido.', 422);
  }
  if (locationType && !['PRIMARY_OFFICE', 'EXTERNAL_OFFICE', 'OTHER'].includes(locationType)) {
    throw apiError('psychology/session-invalid', 'O tipo de local da sessão é inválido.', 422);
  }
  return {
    id: normalize(source.id, 128) || `session-${crypto.randomUUID()}`,
    ...scopeFields(runtimeScope),
    patientId,
    date,
    time,
    durationMinutes,
    modality,
    serviceId: normalize(source.serviceId, 128) || undefined,
    locationId: normalize(source.locationId, 128) || undefined,
    locationType: locationType || undefined,
    chargeId: normalize(source.chargeId, 128) || undefined,
    administrativeNote: normalize(source.administrativeNote, 1000),
    status,
    createdAt: normalize(source.createdAt, 64) || now,
    updatedAt: now,
  };
}

function prepareSettings(body, runtimeScope, current, now) {
  const source = body.settings && typeof body.settings === 'object' ? body.settings : body;
  for (const key of ['workspaceId', 'professionalId', 'tenantId', 'context', 'permissions', 'effectivePermissions', 'role']) {
    if (key in source) throw apiError('psychology/settings-immutable-field', 'Ajustes não podem alterar identidade técnica ou permissões.', 422);
  }
  const requestedProfile = source.professionalProfile && typeof source.professionalProfile === 'object'
    ? source.professionalProfile
    : source;
  const previous = current?.settings || defaultSettings(runtimeScope, now).settings;
  const professionalProfile = {
    ...(previous.professionalProfile || {}),
    ...cleanProfessionalProfile(requestedProfile),
  };
  const nextSettings = {
    ...previous,
    professionalProfile,
    ...(source.agenda && typeof source.agenda === 'object' ? { agenda: cleanSettingsAgenda(source.agenda, previous.agenda || {}) } : {}),
    ...(source.services !== undefined ? { services: cleanSettingsServices(source.services, runtimeScope, previous.services || []) } : {}),
    ...(source.locations !== undefined ? { locations: cleanSettingsLocations(source.locations, runtimeScope, previous.locations || []) } : {}),
    ...(source.colors && typeof source.colors === 'object' ? { colors: {
      ...(previous.colors || {}),
      ...Object.fromEntries(['ONLINE', 'PRESENTIAL_PRIMARY', 'EXTERNAL_OFFICE', 'PERSONAL', 'MENTORING']
        .filter(key => source.colors[key] !== undefined)
        .map(key => [key, source.colors[key]])),
    } } : {}),
    ...(source.reminders && typeof source.reminders === 'object' ? { reminders: { enabled: Boolean(source.reminders.enabled), advanceMinutes: Math.max(0, Number(source.reminders.advanceMinutes) || 0) } } : {}),
  };
  return {
    ...(current || defaultSettings(runtimeScope, now)),
    ...scopeFields(runtimeScope),
    id: 'settings',
    settings: nextSettings,
    updatedAt: now,
    createdAt: current?.createdAt || now,
  };
}

export function createPsychologyApiHandler(dependencies = {}) {
  const getDb = dependencies.getDb || getAdminDb;
  const resolveAccess = dependencies.resolveAccess || resolvePsychologyAccessContext;
  const resolveAdminMonitoring = dependencies.resolveAdminMonitoring || resolvePsychologyAdminMonitoringContext;
  const readSettingsProjection = dependencies.readSettingsProjection || readPsychologySettingsProjection;
  const now = dependencies.now || (() => new Date().toISOString());
  const auditLogger = dependencies.auditLogger || logPsychologyAuditEvent;

  return async function psychologyHandler(req, res) {
    const requestId = createPsychologyRequestId(req);
    const idempotencyKey = requestIdempotencyKey(req);
    let runtimeScope;
    let operation = `${req.method || 'UNKNOWN'}:unknown`;
    setSecurityHeaders(req, res);
    res.setHeader('X-Request-Id', requestId);
    attachFirestoreDiagnostics(res, {
      endpoint: 'psychology',
      logicalMode: 'psychology-api',
      operations: 'patients,sessions,session-records,settings',
      writeAttempted: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
      dedupeHit: false,
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(405).json({ error: { code: 'psychology/method-not-allowed', message: 'Método não permitido.' } });
    }
    try {
      const authorization = req.headers?.authorization || req.headers?.Authorization || '';
      if (!/^Bearer\s+.+$/i.test(String(authorization))) {
        throw apiError('psychology/missing-auth-token', 'Sua sessão não foi identificada. Entre novamente.', 401);
      }
      const [resource, id] = routeParts(req);
      if (!resource) throw apiError('psychology/route-not-found', 'Rota Psicologia não encontrada.', 404);
      if (resource === 'settings-readiness' && req.method === 'GET' && !id) {
        const db = getDb();
        const resolvedScope = await resolveAccess(req, {
          db,
          requiredAnyPermissions: ['agenda.own.view', 'settings.clinic.manage'],
        });
        try {
          const readiness = await readSettingsProjection({ db, runtimeScope: resolvedScope });
          auditHeaders(res, resolvedScope, 'read', 'settings-readiness');
          auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope: resolvedScope, operation: 'GET:settings-readiness', status: 'success', timestamp: now() }));
          return res.status(200).json(readiness);
        } catch (error) {
          const sanitized = sanitizePsychologySettingsProjectionError(error);
          auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope: resolvedScope, operation: 'GET:settings-readiness', status: 'denied', timestamp: now(), code: sanitized.errorCode }));
          return res.status(sanitized.httpStatus).json({ error: sanitized });
        }
      }
      operation = `${req.method}:${resource}`;
      const db = getDb();
      const body = parseBody(req);

      if (resource === 'monitoring' && req.method === 'GET' && !id) {
        runtimeScope = await resolveAdminMonitoring(req, { db });
        const monitoring = await getPsychologyOperationalMonitoringData({ db, runtimeScope, now });
        auditHeaders(res, runtimeScope, 'read', 'adminOperationalMonitoring');
        auditLogger({
          ...buildPsychologyAuditEvent({
            requestId,
            runtimeScope,
            operation: 'admin-operational-monitoring:read',
            status: 'success',
            timestamp: now(),
          }),
          actorRole: 'admin',
        });
        return res.status(200).json(monitoring);
      }

      if (resource === 'backup' && req.method === 'GET' && !id) {
        runtimeScope = await resolveAccess(req, {
          db,
          requiredPermissions: ['patients.clinical_notes.view'],
          ignoreRequestedProfessionalId: true,
        });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const [patients, sessions, personalAppointments, sessionRecords, services, locations, charges, payments, expenses, packages, documents, attachments, settings] = await Promise.all([
          repository.patients.list(),
          repository.sessions.list(),
          repository.personalAppointments.list(),
          repository.sessionRecords.list(),
          repository.services.list(),
          repository.locations.list(),
          repository.financial.listCharges(),
          repository.financial.listPayments(),
          repository.financial.listExpenses(),
          repository.packages.list(),
          repository.documents.list(),
          repository.attachments.list(),
          repository.settings.get('settings'),
        ]);
        const backup = buildScopedPsychologyBackup({
          scope: runtimeScope,
          generatedAt: now(),
          records: {
            patients,
            sessions,
            personalAppointments,
            sessionRecords,
            services,
            locations,
            charges,
            payments,
            expenses,
            sessionPackages: packages,
            documents,
            attachments,
            settings,
          },
        });
        auditHeaders(res, runtimeScope, 'read', 'backup');
        auditLogger(buildPsychologyAuditEvent({
          requestId,
          runtimeScope,
          operation: 'backup:read',
          status: 'success',
          timestamp: now(),
        }));
        return res.status(200).json({ ...backup, scope: scopeFields(runtimeScope) });
      }

      if (resource === 'patients' && req.method === 'GET') {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.list'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const items = id ? [await repository.patients.get(id)].filter(Boolean) : await repository.patients.list();
        auditHeaders(res, runtimeScope, 'read', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(administrativePatientDto) });
      }

      if (resource === 'patients' && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.create'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const patient = await repository.patients.upsert(preparePatient(body, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'create', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(201).json({ scope: scopeFields(runtimeScope), patient: administrativePatientDto(patient) });
      }

      if (resource === 'patients' && req.method === 'PATCH' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const current = await repository.patients.get(id);
        if (!current) throw apiError('psychology/patient-not-found', 'Paciente não encontrado neste escopo.', 404);
        const patient = await repository.patients.upsert(preparePatient({ ...current, ...body, id }, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'update', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), patient: administrativePatientDto(patient) });
      }

      if (resource === 'patients' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const deletion = await deletePsychologyPatientSafely({ repository, patientId: id, now: now() });
        if (!deletion.deleted) throw apiError('psychology/patient-not-found', deletion.reason || 'Paciente não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), ...deletion });
      }

      if (resource === 'settings' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, {
          db,
          requiredAnyPermissions: ['agenda.own.view', 'settings.clinic.manage'],
        });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const current = await repository.settings.get('settings');
        auditHeaders(res, runtimeScope, 'read', 'settings');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), settings: settingsDto(current, runtimeScope) });
      }

      if (resource === 'settings' && req.method === 'PUT' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.manage'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const current = await repository.settings.get('settings');
        const settings = await repository.settings.upsert(prepareSettings(body, runtimeScope, current, now()));
        auditHeaders(res, runtimeScope, 'update', 'settings');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), settings: settingsDto(settings, runtimeScope) });
      }

      if (resource === 'sessions' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.own.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const items = await repository.sessions.list();
        auditHeaders(res, runtimeScope, 'read', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(sessionDto) });
      }

      if (resource === 'sessions' && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const session = prepareSession(body, runtimeScope, now());
        if (!await repository.patients.get(session.patientId)) {
          throw apiError('psychology/session-patient-not-found', 'O paciente não pertence a este escopo Psicologia.', 422);
        }
        const saved = await repository.sessions.upsert(session);
        auditHeaders(res, runtimeScope, 'create', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(201).json({ scope: scopeFields(runtimeScope), session: sessionDto(saved) });
      }

      if (resource === 'sessions' && req.method === 'PATCH' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const current = await repository.sessions.get(id);
        if (!current) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        const session = prepareSession({ ...current, ...body, id }, runtimeScope, now());
        if (!await repository.patients.get(session.patientId)) {
          throw apiError('psychology/session-patient-not-found', 'O paciente não pertence a este escopo Psicologia.', 422);
        }
        const saved = await repository.sessions.upsert(session);
        auditHeaders(res, runtimeScope, 'update', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), session: sessionDto(saved) });
      }

      if (resource === 'sessions' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const deleted = await repository.sessions.delete(id);
        if (!deleted) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (resource === 'session-records' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.clinical_notes.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const items = await repository.sessionRecords.list();
        auditHeaders(res, runtimeScope, 'read', 'sessionRecords');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(clinicalSessionRecordDto) });
      }

      const genericRoute = GENERIC_OPERATION_ROUTES[resource];
      if (genericRoute && req.method === 'GET') {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.readPermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const aggregateRepository = FINANCIAL_AGGREGATES.has(genericRoute.aggregate)
          ? financialRepositoryFor(repository, genericRoute.aggregate)
          : repository[genericRoute.aggregate];
        const items = id ? [await aggregateRepository.get(id)].filter(Boolean) : await aggregateRepository.list();
        auditHeaders(res, runtimeScope, 'read', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items });
      }

      if (genericRoute?.writePermission && FINANCIAL_AGGREGATES.has(genericRoute.aggregate) && (req.method === 'POST' || req.method === 'PATCH')) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const financialRepository = financialRepositoryFor(repository, genericRoute.aggregate);
        const current = req.method === 'PATCH' ? await financialRepository.get(id) : undefined;
        if (req.method === 'PATCH' && !current) throw apiError('psychology/resource-not-found', 'Registro financeiro não encontrado neste escopo.', 404);
        const source = financialRecordSource(body);
        const candidate = prepareGenericRecord(req.method === 'PATCH' ? { ...current, ...source, id } : source, runtimeScope, now());
        await validateFinancialRecord({ aggregate: genericRoute.aggregate, record: candidate, repository, existing: current });
        if (req.method === 'POST' && genericRoute.aggregate === 'payments' && candidate.operationKey) {
          const existingByOperation = (await financialRepository.list()).find(item => item.operationKey === candidate.operationKey);
          if (existingByOperation) {
            auditHeaders(res, runtimeScope, 'create', genericRoute.aggregate);
            auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
            return res.status(200).json({ scope: scopeFields(runtimeScope), item: existingByOperation });
          }
        }
        const item = await financialRepository.upsert(candidate);
        auditHeaders(res, runtimeScope, req.method === 'POST' ? 'create' : 'update', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(req.method === 'POST' ? 201 : 200).json({ scope: scopeFields(runtimeScope), item });
      }

      if (genericRoute?.writePermission && genericRoute.aggregate === 'packages' && (req.method === 'POST' || req.method === 'PATCH')) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const current = req.method === 'PATCH' ? await repository.packages.get(id) : undefined;
        if (req.method === 'PATCH' && !current) throw apiError('psychology/resource-not-found', 'Pacote não encontrado neste escopo.', 404);
        const candidate = prepareGenericRecord(req.method === 'PATCH' ? { ...current, ...financialRecordSource(body), id } : body, runtimeScope, now());
        await validatePackageRecord({ record: candidate, repository });
        const item = await repository.packages.upsert(candidate);
        auditHeaders(res, runtimeScope, req.method === 'POST' ? 'create' : 'update', 'packages');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(req.method === 'POST' ? 201 : 200).json({ scope: scopeFields(runtimeScope), item });
      }

      if (genericRoute?.writePermission && FINANCIAL_AGGREGATES.has(genericRoute.aggregate) && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const deleted = await deleteFinancialRecord({ aggregate: genericRoute.aggregate, id, repository });
        auditHeaders(res, runtimeScope, 'delete', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (genericRoute?.writePermission && genericRoute.aggregate === 'packages' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const deleted = await deletePackageRecord({ id, repository });
        auditHeaders(res, runtimeScope, 'delete', 'packages');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (genericRoute?.writePermission && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const item = await repository[genericRoute.aggregate].upsert(prepareGenericRecord(body, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'create', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(201).json({ scope: scopeFields(runtimeScope), item });
      }

      if (genericRoute?.writePermission && req.method === 'PATCH' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const current = await repository[genericRoute.aggregate].get(id);
        if (!current) throw apiError('psychology/resource-not-found', 'Registro não encontrado neste escopo.', 404);
        const item = await repository[genericRoute.aggregate].upsert(prepareGenericRecord({ ...current, ...body, id }, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'update', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), item });
      }

      if (genericRoute?.writePermission && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: [genericRoute.writePermission] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const deleted = await repository[genericRoute.aggregate].delete(id);
        if (!deleted) throw apiError('psychology/resource-not-found', 'Registro não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      throw apiError('psychology/route-not-found', 'Rota Psicologia não encontrada.', 404);
    } catch (error) {
      auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'denied', timestamp: now(), code: error?.code || 'psychology/internal-error' }));
      return sendError(res, error);
    }
  };
}

const handler = createPsychologyApiHandler();
export default handler;
