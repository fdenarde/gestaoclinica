import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebaseAdmin.js';
import { resolvePsychologyAccessContext } from './_lib/psychologyAccess.js';
import { buildPsychologyAuditEvent, createPsychologyRequestId, logPsychologyAuditEvent } from './_lib/psychologyObservability.js';
import { createPsychologyServerRepository } from './_lib/psychologyRepository.js';
import { deletePsychologyPatientSafely } from './_lib/psychologyPatientDeletion.js';
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
  packages: { aggregate: 'packages', readPermission: 'finance.patient.view', writePermission: null },
  charges: { aggregate: 'charges', readPermission: 'finance.patient.view', writePermission: null },
  payments: { aggregate: 'payments', readPermission: 'finance.patient.view', writePermission: null },
  expenses: { aggregate: 'expenses', readPermission: 'finance.patient.view', writePermission: null },
  documents: { aggregate: 'documents', readPermission: 'documents.view', writePermission: null },
  attachments: { aggregate: 'attachments', readPermission: 'documents.view', writePermission: null },
});

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
    administrativeNote: value.administrativeNote || value.administrativeNotes || '',
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
  if (!name || !birthDate || !phone || !['presencial', 'online'].includes(preferredModality)) {
    throw apiError('psychology/patient-invalid', 'Informe nome, nascimento, telefone e modalidade do paciente.', 422);
  }
  const id = normalize(source.id, 128) || `patient-${crypto.randomUUID()}`;
  const patient = {
    id,
    ...scopeFields(runtimeScope),
    name,
    birthDate,
    phone,
    email: normalize(source.email, 160),
    preferredModality,
    administrativeNote: normalize(source.administrativeNote || source.administrativeNotes, 1000),
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
  const now = dependencies.now || (() => new Date().toISOString());
  const auditLogger = dependencies.auditLogger || logPsychologyAuditEvent;

  return async function psychologyHandler(req, res) {
    const requestId = createPsychologyRequestId(req);
    const idempotencyKey = requestIdempotencyKey(req);
    let runtimeScope;
    let operation = `${req.method || 'UNKNOWN'}:unknown`;
    setSecurityHeaders(req, res);
    res.setHeader('X-Request-Id', requestId);
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
      operation = `${req.method}:${resource}`;
      const db = getDb();
      const body = parseBody(req);

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
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.delete'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation, idempotencyKey });
        const deletion = await deletePsychologyPatientSafely({ repository, patientId: id, now: now() });
        if (!deletion.deleted) throw apiError('psychology/patient-not-found', deletion.reason || 'Paciente não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), ...deletion });
      }

      if (resource === 'settings' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.manage'] });
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
        const aggregateRepository = repository[genericRoute.aggregate];
        const items = id ? [await aggregateRepository.get(id)].filter(Boolean) : await aggregateRepository.list();
        auditHeaders(res, runtimeScope, 'read', genericRoute.aggregate);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items });
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
