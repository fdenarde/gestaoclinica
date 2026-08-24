import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebaseAdmin.js';
import { createMetaTemplatesBffHandler } from './_lib/metaTemplatesBff.js';
import { resolvePsychologyAccessContext } from './_lib/psychologyAccess.js';
import { logSanitizedAccessAudit } from './_lib/sanitizedAccessAudit.js';
import { buildPsychologyAuditEvent, createPsychologyRequestId, logPsychologyAuditEvent } from './_lib/psychologyObservability.js';
import { createPsychologyServerRepository } from './_lib/psychologyRepository.js';
import { normalizePhone } from '../shared/phoneNormalization.js';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5177',
  'http://127.0.0.1:5177',
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
    return normalizePhone(input, { defaultCountryCode: '55' }).canonicalPhone;
  } catch {
    throw apiError('psychology/phone-invalid', 'Informe um telefone válido.', 422);
  }
}

function requestIdempotencyKey(req) {
  const value = req.headers?.['x-idempotency-key'] || req.headers?.['X-Idempotency-Key'];
  const normalized = normalize(value, 200);
  return normalized && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized) ? normalized : undefined;
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
    tenantId: value.tenantId,
    professionalId: value.professionalId,
    context: value.context,
    name: value.name,
    dateOfBirth: value.dateOfBirth || value.birthDate || '',
    birthDate: value.birthDate,
    phone: value.phone,
    email: value.email || '',
    address: value.address || undefined,
    demographics: value.demographics || undefined,
    migrationReview: value.migrationReview || undefined,
    preferredModality: value.preferredModality,
    administrativeNote: value.administrativeNote || value.administrativeNotes || '',
    externalReferences: Array.isArray(value.externalReferences) ? value.externalReferences : [],
    active: value.active !== false,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sessionDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    tenantId: value.tenantId,
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
    canonicalStatus: value.canonicalStatus,
    sourceStatus: value.sourceStatus,
    externalSource: value.externalSource,
    externalEventId: value.externalEventId,
    externalScheduleId: value.externalScheduleId,
    bookingOrigin: value.bookingOrigin,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function serviceDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    tenantId: value.tenantId,
    professionalId: value.professionalId,
    context: value.context,
    name: value.name,
    defaultDurationMinutes: value.defaultDurationMinutes,
    defaultPrice: value.defaultPrice,
    modality: value.modality,
    active: value.active !== false,
    publicBooking: value.publicBooking || undefined,
    externalReferences: Array.isArray(value.externalReferences) ? value.externalReferences : [],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function locationDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    tenantId: value.tenantId,
    professionalId: value.professionalId,
    context: value.context,
    type: value.type,
    displayName: value.displayName,
    address: value.address || '',
    fullAddress: value.fullAddress || value.address || '',
    city: value.city || '',
    state: value.state || '',
    googleMapsUrl: value.googleMapsUrl || '',
    sortOrder: value.sortOrder,
    active: value.active !== false,
    isPrimary: value.isPrimary === true,
    color: value.color || '',
    colorKey: value.colorKey,
    externalReferences: Array.isArray(value.externalReferences) ? value.externalReferences : [],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function personalAppointmentDto(value) {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    tenantId: value.tenantId,
    professionalId: value.professionalId,
    context: value.context,
    date: value.date,
    time: value.time,
    durationMinutes: value.durationMinutes,
    type: value.type,
    title: value.title || undefined,
    note: value.note || undefined,
    recurrence: value.recurrence,
    alarmEnabled: value.alarmEnabled === true,
    alarmAdvance: value.alarmAdvance,
    alarmSound: value.alarmSound,
    alarmVolume: value.alarmVolume,
    alarmFadeIn: value.alarmFadeIn,
    isDone: value.isDone === true,
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

function preparePatient(body, runtimeScope, now, current) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.patient && typeof body.patient === 'object' ? body.patient : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const merged = { ...(current || {}), ...source };
  const name = normalize(merged.name, 160);
  const birthDate = normalize(merged.dateOfBirth || merged.birthDate, 32);
  const phone = normalizePhoneForWrite(merged.phone);
  const preferredModality = normalize(merged.preferredModality, 32);
  if (!name || !birthDate || !phone || !['presencial', 'online'].includes(preferredModality)) {
    throw apiError('psychology/patient-invalid', 'Informe nome, nascimento, telefone e modalidade do paciente.', 422);
  }
  const responsible = merged.administrativeResponsible && typeof merged.administrativeResponsible === 'object'
    ? {
      fullName: normalize(merged.administrativeResponsible.fullName, 160),
      relationship: normalize(merged.administrativeResponsible.relationship, 80),
      phone: normalizePhoneForWrite(merged.administrativeResponsible.phone),
      email: normalize(merged.administrativeResponsible.email, 160).toLowerCase(),
    }
    : undefined;
  const id = normalize(merged.id, 128) || `patient-${crypto.randomUUID()}`;
  const patient = {
    id,
    ...scopeFields(runtimeScope),
    name,
    dateOfBirth: birthDate,
    birthDate,
    phone,
    additionalPhone: normalizePhoneForWrite(merged.additionalPhone) || undefined,
    email: normalize(merged.email, 160),
    address: merged.address && typeof merged.address === 'object' ? merged.address : undefined,
    demographics: merged.demographics && typeof merged.demographics === 'object' ? merged.demographics : undefined,
    migrationReview: merged.migrationReview && typeof merged.migrationReview === 'object' ? merged.migrationReview : undefined,
    preferredModality,
    administrativeNote: normalize(merged.administrativeNote || merged.administrativeNotes, 1000),
    administrativeNotes: normalize(merged.administrativeNotes || merged.administrativeNote, 1000),
    administrativeResponsible: responsible,
    externalReferences: Array.isArray(merged.externalReferences) ? merged.externalReferences.slice(0, 20) : [],
    active: merged.active !== false,
    createdAt: current?.createdAt || normalize(merged.createdAt, 64) || now,
    updatedAt: now,
  };
  return patient;
}

function assertOperationalSettingsWrite(runtimeScope) {
  if (!runtimeScope.permissions?.includes('settings.clinic.edit') && !runtimeScope.permissions?.includes('settings.clinic.manage')) {
    throw apiError('access/permission-denied', 'Você não possui permissão para editar a operação da clínica.', 403);
  }
}

function prepareSession(body, runtimeScope, now, current) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.session && typeof body.session === 'object' ? body.session : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const merged = { ...(current || {}), ...source };
  const patientId = normalize(merged.patientId, 128);
  const date = normalize(merged.date, 32);
  const time = normalize(merged.time, 16);
  const durationMinutes = Number(merged.durationMinutes);
  const modality = normalize(merged.modality, 32);
  const status = normalize(merged.status, 32) || 'agendada';
  const locationType = normalize(merged.locationType, 40);
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
    id: normalize(merged.id, 128) || `session-${crypto.randomUUID()}`,
    ...scopeFields(runtimeScope),
    patientId,
    date,
    time,
    durationMinutes,
    modality,
    serviceId: normalize(merged.serviceId, 128) || undefined,
    locationId: normalize(merged.locationId, 128) || undefined,
    locationType: locationType || undefined,
    chargeId: normalize(merged.chargeId, 128) || undefined,
    administrativeNote: normalize(merged.administrativeNote, 1000),
    status,
    canonicalStatus: merged.canonicalStatus,
    sourceStatus: merged.sourceStatus,
    externalSource: merged.externalSource,
    externalEventId: merged.externalEventId,
    externalScheduleId: merged.externalScheduleId,
    bookingOrigin: merged.bookingOrigin,
    createdAt: current?.createdAt || normalize(merged.createdAt, 64) || now,
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
  const settings = {
    ...previous,
    scope: { professionalId: runtimeScope.professionalId, context: runtimeScope.context },
    professionalProfile,
  };
  if (source.agenda && typeof source.agenda === 'object') settings.agenda = { ...(previous.agenda || {}), ...source.agenda };
  if (source.colors && typeof source.colors === 'object') settings.colors = { ...(previous.colors || {}), ...source.colors };
  if (source.reminders && typeof source.reminders === 'object') settings.reminders = { ...(previous.reminders || {}), ...source.reminders };
  return {
    ...(current || defaultSettings(runtimeScope, now)),
    ...scopeFields(runtimeScope),
    id: 'settings',
    settings,
    updatedAt: now,
    createdAt: current?.createdAt || now,
  };
}

function prepareService(body, runtimeScope, now, current) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.service && typeof body.service === 'object' ? body.service : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const merged = { ...(current || {}), ...source };
  const name = normalize(merged.name, 160);
  const defaultDurationMinutes = Number(merged.defaultDurationMinutes);
  const defaultPrice = Number(merged.defaultPrice || 0);
  const modality = normalize(merged.modality, 32);
  if (!name || !Number.isInteger(defaultDurationMinutes) || defaultDurationMinutes < 1 || defaultDurationMinutes > 480 || !Number.isFinite(defaultPrice) || defaultPrice < 0 || !['ONLINE', 'PRESENTIAL', 'BOTH'].includes(modality)) {
    throw apiError('psychology/service-invalid', 'Informe nome, duração, preço e modalidade válidos para o serviço.', 422);
  }
  return {
    id: normalize(merged.id, 128) || `service-${crypto.randomUUID()}`,
    ...scopeFields(runtimeScope),
    name,
    defaultDurationMinutes,
    defaultPrice,
    modality,
    active: merged.active !== false,
    publicBooking: merged.publicBooking && typeof merged.publicBooking === 'object' ? merged.publicBooking : undefined,
    externalReferences: Array.isArray(merged.externalReferences) ? merged.externalReferences.slice(0, 20) : [],
    createdAt: current?.createdAt || normalize(merged.createdAt, 64) || now,
    updatedAt: now,
  };
}

function prepareLocation(body, runtimeScope, now, current) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.location && typeof body.location === 'object' ? body.location : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const merged = { ...(current || {}), ...source };
  const displayName = normalize(merged.displayName, 160);
  const type = normalize(merged.type, 40) || 'OTHER';
  if (!displayName || !['PRIMARY_OFFICE', 'EXTERNAL_OFFICE', 'OTHER'].includes(type)) {
    throw apiError('psychology/location-invalid', 'Informe nome e tipo válidos para o local.', 422);
  }
  return {
    id: normalize(merged.id, 128) || `location-${crypto.randomUUID()}`,
    ...scopeFields(runtimeScope),
    type,
    displayName,
    address: normalize(merged.address || merged.fullAddress, 240),
    fullAddress: normalize(merged.fullAddress || merged.address, 240),
    city: normalize(merged.city, 120),
    state: normalize(merged.state, 8).toUpperCase(),
    googleMapsUrl: normalize(merged.googleMapsUrl, 500),
    sortOrder: Number.isInteger(Number(merged.sortOrder)) ? Number(merged.sortOrder) : undefined,
    active: merged.active !== false,
    isPrimary: merged.isPrimary === true,
    color: normalize(merged.color, 32),
    colorKey: merged.colorKey,
    externalReferences: Array.isArray(merged.externalReferences) ? merged.externalReferences.slice(0, 20) : [],
    createdAt: current?.createdAt || normalize(merged.createdAt, 64) || now,
    updatedAt: now,
  };
}

function preparePersonalAppointment(body, runtimeScope, now, current) {
  assertScopePayloadDoesNotConflict(body, runtimeScope);
  const source = body.personalAppointment && typeof body.personalAppointment === 'object' ? body.personalAppointment : body;
  assertScopePayloadDoesNotConflict(source, runtimeScope);
  const merged = { ...(current || {}), ...source };
  const date = normalize(merged.date, 32);
  const time = normalize(merged.time, 16);
  const durationMinutes = Number(merged.durationMinutes);
  const type = normalize(merged.type, 64);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 || !type) {
    throw apiError('psychology/personal-appointment-invalid', 'Informe data, horário, duração e tipo válidos para o compromisso.', 422);
  }
  return {
    id: normalize(merged.id, 128) || `personal-${crypto.randomUUID()}`,
    ...scopeFields(runtimeScope),
    date,
    time,
    durationMinutes,
    type,
    title: normalize(merged.title, 160) || undefined,
    note: normalize(merged.note, 1000) || undefined,
    recurrence: normalize(merged.recurrence, 64) || 'Não repetir',
    alarmEnabled: merged.alarmEnabled === true,
    alarmAdvance: normalize(merged.alarmAdvance, 32) || undefined,
    alarmSound: normalize(merged.alarmSound, 64) || undefined,
    alarmVolume: merged.alarmVolume === undefined ? undefined : Number(merged.alarmVolume),
    alarmFadeIn: merged.alarmFadeIn === true,
    isDone: merged.isDone === true,
    createdAt: current?.createdAt || normalize(merged.createdAt, 64) || now,
    updatedAt: now,
  };
}

export function createPsychologyApiHandler(dependencies = {}) {
  const getDb = dependencies.getDb || getAdminDb;
  const resolveAccess = dependencies.resolveAccess || resolvePsychologyAccessContext;
  const now = dependencies.now || (() => new Date().toISOString());
  const auditLogger = dependencies.auditLogger || logPsychologyAuditEvent;
  const metaTemplatesHandler = dependencies.metaTemplatesHandler || createMetaTemplatesBffHandler();

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
      if (resource === 'meta' && id === 'templates') {
        const db = getDb();
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.manage'] });
        return metaTemplatesHandler(req, res, {
          contextId: runtimeScope.context,
          workspaceId: runtimeScope.workspaceId,
          professionalId: runtimeScope.professionalId,
          bindings: [],
        });
      }
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
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.patients.get(id);
        if (!current) throw apiError('psychology/patient-not-found', 'Paciente não encontrado neste escopo.', 404);
        const patient = await repository.patients.update(id, preparePatient(body, runtimeScope, now(), current));
        if (!patient) throw apiError('psychology/patient-not-found', 'Paciente não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'update', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), patient: administrativePatientDto(patient) });
      }

      if (resource === 'patients' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.patients.get(id);
        if (!current) throw apiError('psychology/patient-not-found', 'Paciente não encontrado neste escopo.', 404);
        const [hasRelatedSession, hasClinicalRecord, hasPackage, hasDocument, hasAttachment, hasCharge, hasPayment] = await Promise.all([
          repository.sessions.hasPatientReference(id),
          repository.sessionRecords.hasPatientReference(id),
          repository.packages.hasPatientReference(id),
          repository.documents.hasPatientReference(id),
          repository.attachments.hasPatientReference(id),
          repository.financial.hasChargeReference(id),
          repository.financial.hasPaymentReference(id),
        ]);
        const hasRelatedData = hasRelatedSession
          || hasClinicalRecord
          || hasPackage
          || hasDocument
          || hasAttachment
          || hasCharge
          || hasPayment;
        if (hasRelatedData) {
          const inactivated = await repository.patients.update(id, { active: false, updatedAt: now() });
          auditHeaders(res, runtimeScope, 'inactivate', 'patients');
          auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
          return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: false, inactivated: true, patient: administrativePatientDto(inactivated), id });
        }
        const deleted = await repository.patients.delete(id);
        if (!deleted) throw apiError('psychology/patient-not-found', 'Paciente não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (resource === 'settings' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.settings.get('settings');
        auditHeaders(res, runtimeScope, 'read', 'settings');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), settings: settingsDto(current, runtimeScope) });
      }

      if (resource === 'settings' && req.method === 'PUT' && !id) {
        const runtimeScope = await resolveAccess(req, { db });
        assertOperationalSettingsWrite(runtimeScope);
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.settings.get('settings');
        const settings = await repository.settings.upsert(prepareSettings(body, runtimeScope, current, now()));
        auditHeaders(res, runtimeScope, 'update', 'settings');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), settings: settingsDto(settings, runtimeScope) });
      }

      if ((resource === 'services' || resource === 'locations') && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const items = await repository[resource].list();
        auditHeaders(res, runtimeScope, 'read', resource);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        const dto = resource === 'services' ? serviceDto : locationDto;
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(dto) });
      }

      if ((resource === 'services' || resource === 'locations') && req.method === 'GET' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const item = await repository[resource].get(id);
        auditHeaders(res, runtimeScope, 'read', resource);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        const dto = resource === 'services' ? serviceDto : locationDto;
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: item ? [dto(item)] : [] });
      }

      if ((resource === 'services' || resource === 'locations') && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db });
        assertOperationalSettingsWrite(runtimeScope);
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const item = resource === 'services'
          ? await repository.services.upsert(prepareService(body, runtimeScope, now()))
          : await repository.locations.upsert(prepareLocation(body, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'create', resource);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        const dto = resource === 'services' ? serviceDto : locationDto;
        return res.status(201).json({ scope: scopeFields(runtimeScope), [resource === 'services' ? 'service' : 'location']: dto(item) });
      }

      if ((resource === 'services' || resource === 'locations') && req.method === 'PATCH' && id) {
        const runtimeScope = await resolveAccess(req, { db });
        assertOperationalSettingsWrite(runtimeScope);
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository[resource].get(id);
        if (!current) throw apiError(`psychology/${resource.slice(0, -1)}-not-found`, 'Registro não encontrado neste escopo.', 404);
        const item = resource === 'services'
          ? await repository.services.update(id, prepareService(body, runtimeScope, now(), current))
          : await repository.locations.update(id, prepareLocation(body, runtimeScope, now(), current));
        auditHeaders(res, runtimeScope, 'update', resource);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        const dto = resource === 'services' ? serviceDto : locationDto;
        return res.status(200).json({ scope: scopeFields(runtimeScope), [resource === 'services' ? 'service' : 'location']: item ? dto(item) : null });
      }

      if ((resource === 'services' || resource === 'locations') && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db });
        assertOperationalSettingsWrite(runtimeScope);
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const deleted = await repository[resource].delete(id);
        if (!deleted) throw apiError(`psychology/${resource.slice(0, -1)}-not-found`, 'Registro não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', resource);
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (resource === 'sessions' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.own.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const items = await repository.sessions.list();
        auditHeaders(res, runtimeScope, 'read', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(sessionDto) });
      }

      if (resource === 'sessions' && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
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
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.sessions.get(id);
        if (!current) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        const session = prepareSession(body, runtimeScope, now(), current);
        if (!await repository.patients.get(session.patientId)) throw apiError('psychology/session-patient-not-found', 'O paciente não pertence a este escopo Psicologia.', 422);
        const saved = await repository.sessions.update(id, session);
        if (!saved) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'update', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), session: sessionDto(saved) });
      }

      if (resource === 'sessions' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.sessions.get(id);
        if (!current) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        const [hasClinicalRecord, hasCharge, hasPayment] = await Promise.all([
          repository.sessionRecords.hasSessionReference(id),
          repository.financial.hasChargeSessionReference(id),
          repository.financial.hasPaymentSessionReference(id),
        ]);
        const hasRelatedData = hasClinicalRecord || hasCharge || hasPayment;
        if (hasRelatedData) {
          const cancelled = await repository.sessions.update(id, { status: 'cancelada', updatedAt: now() });
          auditHeaders(res, runtimeScope, 'cancel', 'sessions');
          auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
          return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: false, cancelled: true, session: sessionDto(cancelled), id });
        }
        const deleted = await repository.sessions.delete(id);
        if (!deleted) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'sessions');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (resource === 'personal-appointments' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.own.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const items = await repository.personalAppointments.list();
        auditHeaders(res, runtimeScope, 'read', 'personalAppointments');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(personalAppointmentDto) });
      }

      if (resource === 'personal-appointments' && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const item = await repository.personalAppointments.upsert(preparePersonalAppointment(body, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'create', 'personalAppointments');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(201).json({ scope: scopeFields(runtimeScope), personalAppointment: personalAppointmentDto(item) });
      }

      if (resource === 'personal-appointments' && req.method === 'PATCH' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const current = await repository.personalAppointments.get(id);
        if (!current) throw apiError('psychology/personal-appointment-not-found', 'Compromisso não encontrado neste escopo.', 404);
        const item = await repository.personalAppointments.update(id, preparePersonalAppointment(body, runtimeScope, now(), current));
        if (!item) throw apiError('psychology/personal-appointment-not-found', 'Compromisso não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'update', 'personalAppointments');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), personalAppointment: personalAppointmentDto(item) });
      }

      if (resource === 'personal-appointments' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const deleted = await repository.personalAppointments.delete(id);
        if (!deleted) throw apiError('psychology/personal-appointment-not-found', 'Compromisso não encontrado neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'personalAppointments');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), deleted: true, id: deleted.id });
      }

      if (resource === 'session-records' && req.method === 'GET' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.clinical_notes.view'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const items = await repository.sessionRecords.list();
        auditHeaders(res, runtimeScope, 'read', 'sessionRecords');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(clinicalSessionRecordDto) });
      }

      throw apiError('psychology/route-not-found', 'Rota Psicologia não encontrada.', 404);
    } catch (error) {
      auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'denied', timestamp: now(), code: error?.code || 'psychology/internal-error' }));
      logSanitizedAccessAudit(req, {
        endpoint: '/api/psychology',
        auditPrefix: '[PSYCHOLOGY ACCESS AUDIT]',
        authUid: runtimeScope?.authUid,
        accessProfileApproved: runtimeScope ? true : undefined,
        accessRole: runtimeScope?.role,
        statusHttp: Number(error?.statusCode) || 500,
        technicalCode: error?.code || 'psychology/internal-error',
        tokenVerificationResult: error?.tokenVerificationResult,
        professionalResolved: runtimeScope?.professionalId ? true : undefined,
        psychologyRouteAllowed: false,
        requestAccessScreenCause: Number(error?.statusCode) >= 500
          ? 'PSYCHOLOGY_TECHNICAL_FAILURE'
          : 'PSYCHOLOGY_ACCESS_BLOCKED',
      });
      return sendError(res, error);
    }
  };
}

const handler = createPsychologyApiHandler();
export default handler;
