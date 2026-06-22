const VALID_ACCESS_ROLES = Object.freeze(['admin', 'professional', 'responsible', 'monitoring']);
const VALID_ACCESS_STATUSES = Object.freeze(['pending', 'information_requested', 'approved', 'rejected', 'revoked', 'disabled', 'canceled']);
const VALID_ACCESS_CONTEXTS = Object.freeze(['admin', 'professional', 'responsible', 'monitoring']);

export const ACCESS_ROLES = new Set(VALID_ACCESS_ROLES);
export const ACCESS_STATUSES = new Set(VALID_ACCESS_STATUSES);
export const ACCESS_CONTEXTS = new Set(VALID_ACCESS_CONTEXTS);

export const ACCESS_PERMISSION_KEYS = Object.freeze([
  'access.users.view',
  'access.users.manage',
  'access.permissions.manage',
  'access.view_as_user',
  'dashboard.global.view',
  'dashboard.own.view',
  'patients.list',
  'patients.create',
  'patients.edit',
  'patients.delete',
  'patients.clinical_notes.view',
  'patients.photo.view',
  'patients.photo.upload',
  'patients.photo.delete',
  'agenda.own.view',
  'agenda.general.view',
  'agenda.other_patient_identity',
  'agenda.edit',
  'sessions.status.manage',
  'sessions.history.view',
  'sessions.remaining.view',
  'activities.create',
  'activities.edit',
  'activities.delete',
  'activities.history.view',
  'media.gallery.view',
  'media.image.upload',
  'media.video.upload',
  'media.image.download',
  'media.video.download',
  'media.delete',
  'media.share.authorize',
  'media.duplicate.override',
  'media.video.play',
  'documents.view',
  'documents.upload',
  'documents.download',
  'finance.global.view',
  'finance.patient.view',
  'finance.manage',
  'reports.view',
  'reports.export',
  'settings.clinic.manage',
  'settings.firebase.manage',
  'settings.whatsapp.manage',
  'uploads.limits.manage',
  'uploads.exception.request',
  'uploads.exception.approve',
  'consumption.view',
  'consumption.manage',
  'audit.view',
  'audit.export',
  'emergency.controls',
  'responsible.portal.view',
  'responsible.profile.edit',
  'responsible.media.interact',
  'responsible.notifications',
  'monitoring.panel.view',
  'monitoring.search.local',
  'monitoring.media.download',
  'monitoring.any_write',
  'notifications.manage',
  'session.devices.view',
  'session.revoke_all',
]);

const PERMISSION_KEY_SET = new Set(ACCESS_PERMISSION_KEYS);

function permissionsFromAllowedKeys(allowedKeys) {
  return Object.fromEntries(ACCESS_PERMISSION_KEYS.map(key => [key, allowedKeys.includes(key)]));
}

const ADMIN_PERMISSIONS = permissionsFromAllowedKeys(ACCESS_PERMISSION_KEYS.filter(key => (
  key !== 'responsible.portal.view'
  && key !== 'responsible.profile.edit'
  && key !== 'responsible.media.interact'
  && key !== 'responsible.notifications'
  && key !== 'monitoring.media.download'
  && key !== 'monitoring.any_write'
)));

const PROFESSIONAL_PERMISSIONS = permissionsFromAllowedKeys([
  'dashboard.own.view',
  'patients.list',
  'patients.create',
  'patients.edit',
  'patients.clinical_notes.view',
  'patients.photo.view',
  'patients.photo.upload',
  'patients.photo.delete',
  'agenda.own.view',
  'agenda.edit',
  'sessions.status.manage',
  'sessions.history.view',
  'sessions.remaining.view',
  'activities.create',
  'activities.edit',
  'activities.delete',
  'media.gallery.view',
  'media.image.upload',
  'media.video.upload',
  'media.image.download',
  'media.video.download',
  'media.delete',
  'media.share.authorize',
  'media.video.play',
  'documents.view',
  'documents.upload',
  'documents.download',
  'uploads.exception.request',
  'notifications.manage',
  'session.devices.view',
  'session.revoke_all',
]);

const RESPONSIBLE_PERMISSIONS = permissionsFromAllowedKeys([
  'dashboard.own.view',
  'patients.list',
  'agenda.own.view',
  'sessions.history.view',
  'sessions.remaining.view',
  'media.gallery.view',
  'media.video.play',
  'documents.view',
  'finance.patient.view',
  'responsible.portal.view',
  'responsible.notifications',
  'session.devices.view',
  'session.revoke_all',
]);

const MONITORING_PERMISSIONS = permissionsFromAllowedKeys([
  'dashboard.own.view',
  'patients.list',
  'agenda.own.view',
  'agenda.general.view',
  'agenda.other_patient_identity',
  'sessions.history.view',
  'sessions.remaining.view',
  'media.gallery.view',
  'media.video.play',
  'monitoring.panel.view',
  'monitoring.search.local',
  'notifications.manage',
  'session.devices.view',
  'session.revoke_all',
]);

export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(ADMIN_PERMISSIONS),
  professional: Object.freeze(PROFESSIONAL_PERMISSIONS),
  responsible: Object.freeze(RESPONSIBLE_PERMISSIONS),
  monitoring: Object.freeze(MONITORING_PERMISSIONS),
});

const ADMIN_PERMISSION_CEILING = permissionsFromAllowedKeys(ACCESS_PERMISSION_KEYS);
const PROFESSIONAL_PERMISSION_CEILING = permissionsFromAllowedKeys([
  'dashboard.own.view',
  'patients.list',
  'patients.create',
  'patients.edit',
  'patients.clinical_notes.view',
  'patients.photo.view',
  'patients.photo.upload',
  'patients.photo.delete',
  'agenda.own.view',
  'agenda.general.view',
  'agenda.other_patient_identity',
  'agenda.edit',
  'sessions.status.manage',
  'sessions.history.view',
  'sessions.remaining.view',
  'activities.create',
  'activities.edit',
  'activities.delete',
  'activities.history.view',
  'media.gallery.view',
  'media.image.upload',
  'media.video.upload',
  'media.image.download',
  'media.video.download',
  'media.delete',
  'media.share.authorize',
  'media.video.play',
  'documents.view',
  'documents.upload',
  'documents.download',
  'finance.patient.view',
  'reports.view',
  'reports.export',
  'uploads.exception.request',
  'notifications.manage',
  'session.devices.view',
  'session.revoke_all',
]);
const RESPONSIBLE_PERMISSION_CEILING = permissionsFromAllowedKeys([
  'dashboard.own.view',
  'patients.list',
  'agenda.own.view',
  'sessions.history.view',
  'sessions.remaining.view',
  'media.gallery.view',
  'media.video.play',
  'documents.view',
  'finance.patient.view',
  'responsible.portal.view',
  'responsible.notifications',
  'session.devices.view',
  'session.revoke_all',
]);
const MONITORING_PERMISSION_CEILING = permissionsFromAllowedKeys([
  'dashboard.own.view',
  'patients.list',
  'agenda.own.view',
  'agenda.general.view',
  'agenda.other_patient_identity',
  'sessions.history.view',
  'sessions.remaining.view',
  'media.gallery.view',
  'media.video.play',
  'reports.view',
  'monitoring.panel.view',
  'monitoring.search.local',
  'notifications.manage',
  'session.devices.view',
  'session.revoke_all',
]);

const CONTEXT_PERMISSION_CEILINGS = Object.freeze({
  admin: Object.freeze(ADMIN_PERMISSION_CEILING),
  professional: Object.freeze(PROFESSIONAL_PERMISSION_CEILING),
  responsible: Object.freeze(RESPONSIBLE_PERMISSION_CEILING),
  monitoring: Object.freeze(MONITORING_PERMISSION_CEILING),
});

const ADDITIONAL_CONTEXTS_BY_ROLE = Object.freeze({
  admin: Object.freeze(['professional', 'responsible', 'monitoring']),
  professional: Object.freeze(['monitoring']),
  responsible: Object.freeze([]),
  monitoring: Object.freeze([]),
});

const MONITORING_ABSOLUTE_DENY = new Set([
  'patients.create',
  'patients.edit',
  'patients.delete',
  'patients.clinical_notes.view',
  'patients.photo.upload',
  'patients.photo.delete',
  'agenda.edit',
  'sessions.status.manage',
  'activities.create',
  'activities.edit',
  'activities.delete',
  'media.image.upload',
  'media.video.upload',
  'media.image.download',
  'media.video.download',
  'media.delete',
  'media.share.authorize',
  'media.duplicate.override',
  'documents.upload',
  'documents.download',
  'finance.global.view',
  'finance.patient.view',
  'finance.manage',
  'reports.export',
  'settings.clinic.manage',
  'settings.firebase.manage',
  'settings.whatsapp.manage',
  'uploads.limits.manage',
  'uploads.exception.request',
  'uploads.exception.approve',
  'consumption.manage',
  'audit.export',
  'emergency.controls',
  'responsible.profile.edit',
  'responsible.media.interact',
  'monitoring.media.download',
  'monitoring.any_write',
]);

function accessPermissionError(code, message, statusCode = 403) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value, maxLength = 300) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return normalizeText(value, 254).toLowerCase();
}

export function normalizeAccessRole(value, fallback = 'professional') {
  const normalized = normalizeText(value, 40);
  return ACCESS_ROLES.has(normalized) ? normalized : fallback;
}

export function normalizeAccessStatus(value, fallback = 'pending') {
  const normalized = normalizeText(value, 40);
  return ACCESS_STATUSES.has(normalized) ? normalized : fallback;
}

export function normalizeStringArray(value, maxItems = 200, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => normalizeText(item, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

export function normalizePermissionOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [key, permissionValue] of Object.entries(value)) {
    if (PERMISSION_KEY_SET.has(key) && typeof permissionValue === 'boolean') {
      normalized[key] = permissionValue;
    }
  }
  return normalized;
}


function toEpochMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value.toDate === 'function') {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  const millis = new Date(String(value)).getTime();
  return Number.isFinite(millis) ? millis : null;
}

function assertProfileAvailability(sourceProfile, now = Date.now()) {
  const suspension = sourceProfile?.suspension && typeof sourceProfile.suspension === 'object'
    ? sourceProfile.suspension
    : null;
  if (suspension?.active === true) {
    const endsAt = toEpochMillis(suspension.endsAt);
    if (endsAt === null || endsAt > now) {
      throw accessPermissionError(
        'access/account-suspended',
        'Esta conta está temporariamente suspensa.',
        403,
      );
    }
  }

  const temporaryAccess = sourceProfile?.temporaryAccess && typeof sourceProfile.temporaryAccess === 'object'
    ? sourceProfile.temporaryAccess
    : null;
  const directExpiresAt = toEpochMillis(sourceProfile?.expiresAt);
  if (temporaryAccess) {
    const startsAt = toEpochMillis(temporaryAccess.startsAt);
    const endsAt = toEpochMillis(temporaryAccess.endsAt);
    if (startsAt !== null && startsAt > now) {
      throw accessPermissionError(
        'access/temporary-access-not-started',
        'O período autorizado para esta conta ainda não começou.',
        403,
      );
    }
    if (endsAt !== null && endsAt <= now) {
      throw accessPermissionError(
        'access/temporary-access-expired',
        sourceProfile?.role === 'monitoring'
          ? 'Seu acesso ao Monitoramento expirou. Entre em contato com o administrador.'
          : 'O período autorizado para esta conta terminou.',
        403,
      );
    }
  }
  if (!temporaryAccess && directExpiresAt !== null && directExpiresAt <= now) {
    throw accessPermissionError(
      'access/temporary-access-expired',
      sourceProfile?.role === 'monitoring'
        ? 'Seu acesso ao Monitoramento expirou. Entre em contato com o administrador.'
        : 'O período autorizado para esta conta terminou.',
      403,
    );
  }
}

function resolveActiveContext({ role, enabledContexts, requestedContext }) {
  const normalizedRequested = ACCESS_CONTEXTS.has(requestedContext) ? requestedContext : role;
  if (normalizedRequested === role) return role;
  const permittedAdditionalContexts = ADDITIONAL_CONTEXTS_BY_ROLE[role] || [];
  return permittedAdditionalContexts.includes(normalizedRequested) && enabledContexts.includes(normalizedRequested)
    ? normalizedRequested
    : role;
}

function applyPermissionOverrides(basePermissions, overrides, ceiling) {
  const result = { ...basePermissions };
  for (const [key, value] of Object.entries(overrides)) {
    if (!PERMISSION_KEY_SET.has(key)) continue;
    if (value === false) {
      result[key] = false;
      continue;
    }
    if (ceiling?.[key] === true) result[key] = true;
  }
  return result;
}

function applyGlobalBlocks(permissions, globalBlocks) {
  const result = { ...permissions };
  for (const key of normalizeStringArray(globalBlocks, ACCESS_PERMISSION_KEYS.length, 120)) {
    if (PERMISSION_KEY_SET.has(key)) result[key] = false;
  }
  return result;
}

function applyContextAbsoluteDenies(permissions, activeContext) {
  if (activeContext !== 'monitoring') return permissions;
  const result = { ...permissions };
  for (const key of MONITORING_ABSOLUTE_DENY) result[key] = false;
  return result;
}

export function resolveEffectivePermissions({
  role,
  activeContext,
  permissionOverrides = {},
  globalBlocks = [],
} = {}) {
  const normalizedRole = normalizeAccessRole(role);
  const normalizedContext = ACCESS_CONTEXTS.has(activeContext) ? activeContext : normalizedRole;
  const contextDefaults = DEFAULT_ROLE_PERMISSIONS[normalizedContext] || DEFAULT_ROLE_PERMISSIONS[normalizedRole];
  const contextCeiling = CONTEXT_PERMISSION_CEILINGS[normalizedContext] || CONTEXT_PERMISSION_CEILINGS[normalizedRole];
  const normalizedOverrides = normalizePermissionOverrides(permissionOverrides);
  const withOverrides = applyPermissionOverrides(contextDefaults, normalizedOverrides, contextCeiling);
  const withBlocks = applyGlobalBlocks(withOverrides, globalBlocks);
  return Object.freeze(applyContextAbsoluteDenies(withBlocks, normalizedContext));
}

export function buildEffectiveAccessContext({
  decodedToken,
  profile,
  primaryAdminEmail,
  primaryAdminWorkspaceId,
  requestedContext,
  globalBlocks = [],
} = {}) {
  const uid = normalizeText(decodedToken?.uid, 160);
  const email = normalizeEmail(decodedToken?.email);
  if (!uid) {
    throw accessPermissionError('access/missing-user-id', 'Sua sessão não possui um identificador válido.', 401);
  }

  const normalizedPrimaryAdminEmail = normalizeEmail(primaryAdminEmail);
  const isPrimaryAdmin = Boolean(normalizedPrimaryAdminEmail && email === normalizedPrimaryAdminEmail);
  const sourceProfile = profile && typeof profile === 'object' ? profile : {};
  if (!isPrimaryAdmin && !ACCESS_ROLES.has(normalizeText(sourceProfile.role, 40))) {
    throw accessPermissionError('access/invalid-profile-role', 'O perfil desta conta é inválido.', 403);
  }
  const role = isPrimaryAdmin ? 'admin' : normalizeAccessRole(sourceProfile.role);
  const status = isPrimaryAdmin ? 'approved' : normalizeAccessStatus(sourceProfile.status);
  if (status !== 'approved') {
    throw accessPermissionError(
      'access/approved-profile-required',
      'Sua conta ainda não possui um perfil aprovado para esta operação.',
      403,
    );
  }
  if (!isPrimaryAdmin) assertProfileAvailability(sourceProfile);

  const permittedAdditionalContexts = ADDITIONAL_CONTEXTS_BY_ROLE[role] || [];
  const enabledContexts = normalizeStringArray(sourceProfile.enabledContexts, 4, 40)
    .filter(context => permittedAdditionalContexts.includes(context));
  const activeContext = resolveActiveContext({ role, enabledContexts, requestedContext });
  const workspaceId = normalizeText(
    sourceProfile.workspaceId || (isPrimaryAdmin ? uid : primaryAdminWorkspaceId),
    160,
  );
  if (!workspaceId) {
    throw accessPermissionError(
      'access/workspace-unavailable',
      'O workspace da clínica não está disponível para esta conta.',
      503,
    );
  }

  const permissionOverrides = normalizePermissionOverrides(sourceProfile.permissionOverrides);
  const permissions = resolveEffectivePermissions({
    role,
    activeContext,
    permissionOverrides,
    globalBlocks,
  });

  return Object.freeze({
    userId: uid,
    ownerUserId: workspaceId,
    workspaceId,
    legacyStorageOwnerId: uid,
    role,
    status,
    activeContext,
    enabledContexts: Object.freeze(enabledContexts),
    actorName: normalizeText(sourceProfile.displayName || decodedToken?.name || decodedToken?.email || 'Usuário', 120),
    actorEmail: email,
    allowedPatientIds: role === 'admin' || activeContext === 'monitoring'
      ? null
      : Object.freeze(normalizeStringArray(sourceProfile.linkedPatientIds, 200, 160)),
    permissionOverrides: Object.freeze(permissionOverrides),
    permissions,
    profileSchemaVersion: Number.isFinite(Number(sourceProfile.schemaVersion))
      ? Number(sourceProfile.schemaVersion)
      : 1,
  });
}

export function isPermissionAllowed(context, permissionKey) {
  return Boolean(context?.permissions?.[permissionKey]);
}

export function assertAccessPermission(context, permissionKey, message = 'Você não possui permissão para realizar esta ação.') {
  if (!PERMISSION_KEY_SET.has(permissionKey)) {
    throw accessPermissionError(
      'access/unknown-permission',
      'A permissão solicitada não está registrada no contrato de acesso.',
      500,
    );
  }
  if (!isPermissionAllowed(context, permissionKey)) {
    throw accessPermissionError('access/permission-denied', message, 403);
  }
}

export function assertPatientBinding(context, patientId, message = 'Você não possui autorização para acessar este atendente.') {
  const normalizedPatientId = normalizeText(patientId, 160);
  if (!normalizedPatientId) {
    throw accessPermissionError('access/invalid-patient', 'Não foi possível identificar o atendente.', 400);
  }
  if (context?.role === 'admin' || context?.activeContext === 'monitoring') return normalizedPatientId;
  if (!Array.isArray(context?.allowedPatientIds) || !context.allowedPatientIds.includes(normalizedPatientId)) {
    throw accessPermissionError('access/patient-access-denied', message, 403);
  }
  return normalizedPatientId;
}

export function assertAllowedRole(context, allowedRoles) {
  const normalizedAllowedRoles = normalizeStringArray(allowedRoles, 4, 40)
    .filter(role => ACCESS_ROLES.has(role));
  if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(context?.role)) {
    throw accessPermissionError('access/role-denied', 'Seu perfil não está autorizado para esta operação.', 403);
  }
}
