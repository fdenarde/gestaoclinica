import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebaseAdmin.js';
import { createMetaTemplatesBffHandler } from './_lib/metaTemplatesBff.js';
import { resolvePsychologyAccessContext } from './_lib/psychologyAccess.js';
import { buildPsychologyAuditEvent, createPsychologyRequestId, logPsychologyAuditEvent } from './_lib/psychologyObservability.js';
import { createPsychologyServerRepository } from './_lib/psychologyRepository.js';

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
    .map(key => [key, normalize(input[key], key === 'phone' ? 32 : 160)]));
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
  const phone = normalize(source.phone, 32);
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
    createdAt: now,
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
  return {
    ...(current || defaultSettings(runtimeScope, now)),
    ...scopeFields(runtimeScope),
    id: 'settings',
    settings: { ...previous, professionalProfile },
    updatedAt: now,
    createdAt: current?.createdAt || now,
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
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const items = id ? [await repository.patients.get(id)].filter(Boolean) : await repository.patients.list();
        auditHeaders(res, runtimeScope, 'read', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(200).json({ scope: scopeFields(runtimeScope), items: items.map(administrativePatientDto) });
      }

      if (resource === 'patients' && req.method === 'POST' && !id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.create'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const patient = await repository.patients.upsert(preparePatient(body, runtimeScope, now()));
        auditHeaders(res, runtimeScope, 'create', 'patients');
        auditLogger(buildPsychologyAuditEvent({ requestId, runtimeScope, operation, status: 'success', timestamp: now() }));
        return res.status(201).json({ scope: scopeFields(runtimeScope), patient: administrativePatientDto(patient) });
      }

      if (resource === 'patients' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['patients.delete'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
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
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['settings.clinic.manage'] });
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

      if (resource === 'sessions' && req.method === 'DELETE' && id) {
        const runtimeScope = await resolveAccess(req, { db, requiredPermissions: ['agenda.edit'] });
        const repository = createPsychologyServerRepository({ db, runtimeScope, now, requestId, operation });
        const deleted = await repository.sessions.delete(id);
        if (!deleted) throw apiError('psychology/session-not-found', 'Sessão não encontrada neste escopo.', 404);
        auditHeaders(res, runtimeScope, 'delete', 'sessions');
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
      return sendError(res, error);
    }
  };
}

const handler = createPsychologyApiHandler();
export default handler;
