import { getAdminDb } from './firebaseAdmin.js';
import { resolveAccessContext } from './accessContext.js';
import { assertAnyAccessPermission } from './accessPermissions.js';

const PSYCHOLOGY_CONTEXT = 'PSICOLOGIA';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function psychologyError(code, message, statusCode = 403) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalize(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeProfessionalId(value) {
  const normalized = normalize(value, 128);
  return Boolean(normalized && SAFE_ID_PATTERN.test(normalized) && !normalized.includes('@'));
}

function snapshotData(snapshot) {
  return snapshot?.exists ? snapshot.data() || {} : null;
}

async function findByAuthUid(db, authUid) {
  const query = db.collection('professionals').where('authUid', '==', authUid);
  const snapshot = await query.get();
  return snapshot.docs.map(documentSnapshot => {
    const data = documentSnapshot.data() || {};
    return {
      ...data,
      documentId: documentSnapshot.id,
      professionalId: normalize(data.professionalId || documentSnapshot.id, 128),
    };
  });
}

async function findPsychologyContexts(db, professionalId) {
  const query = db.collection('professionalContexts').where('professionalId', '==', professionalId);
  const snapshot = await query.get();
  return snapshot.docs
    .map(documentSnapshot => ({ ...documentSnapshot.data(), documentId: documentSnapshot.id }))
    .filter(link => link.active === true && link.context === PSYCHOLOGY_CONTEXT);
}

/**
 * One compatibility seam for the legacy workspaceId/tenantId 1:1 model.
 * A future WorkspaceTenantBinding can replace the lookup without changing routes.
 */
export async function resolvePsychologyWorkspaceTenantBinding({ db, workspaceId, tenantId }) {
  const normalizedWorkspaceId = normalize(workspaceId);
  const normalizedTenantId = normalize(tenantId);
  if (!normalizedWorkspaceId || !normalizedTenantId) {
    throw psychologyError(
      'psychology/access-scope-unavailable',
      'O escopo da Psicologia não pôde ser resolvido.',
      503,
    );
  }

  const bindingSnapshot = await db.collection('workspaceTenantBindings').doc(normalizedWorkspaceId).get();
  const binding = snapshotData(bindingSnapshot);
  if (binding) {
    if (binding.active !== true || normalize(binding.tenantId) !== normalizedTenantId) {
      throw psychologyError(
        'psychology/workspace-tenant-mismatch',
        'O workspace e o tenant não correspondem.',
        403,
      );
    }
    return {
      workspaceId: normalizedWorkspaceId,
      tenantId: normalizedTenantId,
      bindingMode: 'EXPLICIT_BINDING',
      source: 'workspaceTenantBinding',
    };
  }

  if (normalizedWorkspaceId !== normalizedTenantId) {
    throw psychologyError(
      'psychology/workspace-tenant-mismatch',
      'O vínculo workspace/tenant não está disponível para esta operação.',
      403,
    );
  }

  return {
    workspaceId: normalizedWorkspaceId,
    tenantId: normalizedTenantId,
    bindingMode: 'LEGACY_ONE_TO_ONE',
    source: 'legacy-1-to-1',
  };
}

function assertLinkedProfessional(profile, professionalId) {
  const linkedProfessionalIds = Array.isArray(profile?.linkedProfessionalIds)
    ? profile.linkedProfessionalIds.map(value => normalize(value, 128)).filter(Boolean)
    : [];
  if (linkedProfessionalIds.length > 0 && !linkedProfessionalIds.includes(professionalId)) {
    throw psychologyError(
      'psychology/professional-not-linked',
      'O profissional solicitado não pertence ao perfil autorizado.',
      403,
    );
  }
}

/**
 * Resolves Auth -> AccessProfile -> Professional -> professionalContexts -> scope.
 * `resolveBaseAccessContext` is injectable so tests can use fake auth while the
 * production default remains the existing accessContext implementation.
 */
export async function resolvePsychologyAccessContext(req, options = {}) {
  const db = options.db || getAdminDb();
  const resolveBaseAccessContext = options.resolveBaseAccessContext || resolveAccessContext;
  const baseContext = await resolveBaseAccessContext(req, {
    allowedRoles: ['admin', 'professional'],
  });
  const authUid = normalize(baseContext?.userId, 160);
  const workspaceId = normalize(baseContext?.workspaceId, 160);
  if (!authUid || !workspaceId) {
    throw psychologyError(
      'psychology/access-context-unavailable',
      'O contexto de acesso da Psicologia não está disponível.',
      503,
    );
  }

  const profileSnapshot = await db.collection('accessProfiles').doc(authUid).get();
  const profile = snapshotData(profileSnapshot);
  const requestedProfessionalId = options.ignoreRequestedProfessionalId
    ? ''
    : normalize(options.professionalId || req?.query?.professionalId, 128);
  const candidates = (await findByAuthUid(db, authUid))
    .filter(professional => professional.active === true)
    .filter(professional => safeProfessionalId(professional.professionalId))
    .filter(professional => !requestedProfessionalId || professional.professionalId === requestedProfessionalId);

  if (candidates.length === 0) {
    throw psychologyError(
      'psychology/professional-not-found',
      'Não foi possível resolver o profissional autorizado.',
      403,
    );
  }
  if (candidates.length > 1) {
    throw psychologyError(
      'psychology/professional-ambiguous',
      'A conta possui mais de um profissional ativo compatível; selecione explicitamente o profissional.',
      409,
    );
  }

  const professional = candidates[0];
  assertLinkedProfessional(profile, professional.professionalId);
  const tenantId = normalize(professional.tenantId, 160);
  const binding = await resolvePsychologyWorkspaceTenantBinding({ db, workspaceId, tenantId });
  const contextLinks = (await findPsychologyContexts(db, professional.professionalId))
    .filter(link => normalize(link.tenantId) === binding.tenantId);

  if (contextLinks.length === 0) {
    throw psychologyError(
      'psychology/context-not-found',
      'O contexto Psicologia não está ativo para este profissional.',
      403,
    );
  }
  if (contextLinks.length > 1) {
    throw psychologyError(
      'psychology/context-ambiguous',
      'O contexto Psicologia possui vínculos duplicados e foi bloqueado.',
      409,
    );
  }

  const permissions = Object.entries(baseContext.permissions || {})
    .filter(([, enabled]) => enabled === true)
    .map(([permission]) => permission);
  for (const permission of options.requiredPermissions || []) {
    if (!baseContext.permissions?.[permission]) {
      throw psychologyError('access/permission-denied', 'Você não possui permissão para esta operação.', 403);
    }
  }
  if (options.requiredAnyPermissions !== undefined) {
    assertAnyAccessPermission(
      baseContext,
      options.requiredAnyPermissions,
      'Você não possui permissão para esta operação.',
    );
  }

  return Object.freeze({
    authUid,
    workspaceId: binding.workspaceId,
    tenantId: binding.tenantId,
    professionalId: professional.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    role: baseContext.role,
    permissions: Object.freeze(permissions),
    actorName: baseContext.actorName || null,
    bindingMode: binding.bindingMode,
    bindingSource: binding.source,
    accessContext: baseContext,
  });
}

function requestQueryValue(req, key) {
  const direct = req?.query?.[key];
  if (direct !== undefined && direct !== null) return normalize(direct, 160);
  try {
    return normalize(new URL(String(req?.url || ''), 'http://localhost').searchParams.get(key), 160);
  } catch {
    return '';
  }
}

async function listPsychologyContextLinks(db, professionalId = '') {
  const collection = db.collection('professionalContexts');
  const query = typeof collection.where === 'function'
    ? collection.where(professionalId ? 'professionalId' : 'context', '==', professionalId || PSYCHOLOGY_CONTEXT)
    : collection;
  const snapshot = await query.get();
  return (snapshot.docs || [])
    .map(documentSnapshot => ({ ...documentSnapshot.data(), documentId: documentSnapshot.id }))
    .filter(link => link.active === true && normalize(link.context) === PSYCHOLOGY_CONTEXT)
    .filter(link => !professionalId || normalize(link.professionalId, 128) === professionalId);
}

/**
 * Resolves an administrator to one explicitly requested (or unambiguous)
 * Psychology environment. No personal relationship or linked-patient rule is
 * consulted here; the only authorization gate is the administrative role and
 * the operational monitoring permission.
 */
export async function resolvePsychologyAdminMonitoringContext(req, options = {}) {
  const db = options.db || getAdminDb();
  const resolveBaseAccessContext = options.resolveBaseAccessContext || resolveAccessContext;
  const baseContext = await resolveBaseAccessContext(req, {
    allowedRoles: ['admin'],
    requestedContext: 'admin',
    requiredPermissions: ['monitoring.panel.view'],
  });
  if (baseContext?.role !== 'admin') {
    throw psychologyError(
      'psychology/monitoring-admin-required',
      'O monitoramento operacional da Psicologia está disponível apenas para administradores.',
      403,
    );
  }

  const requestedProfessionalId = normalize(
    options.professionalId || requestQueryValue(req, 'professionalId'),
    128,
  );
  const links = await listPsychologyContextLinks(db, requestedProfessionalId);
  const scopedLinks = [];
  for (const link of links) {
    const professionalId = normalize(link.professionalId, 128);
    const tenantId = normalize(link.tenantId, 160);
    if (!safeProfessionalId(professionalId) || !tenantId) continue;
    try {
      const binding = await resolvePsychologyWorkspaceTenantBinding({
        db,
        workspaceId: normalize(baseContext.workspaceId, 160),
        tenantId,
      });
      scopedLinks.push({ ...link, professionalId, tenantId, binding });
    } catch {
      // A context from another tenant/workspace is not a candidate for this
      // administrative support view.
    }
  }

  const candidates = [...new Map(scopedLinks.map(link => [
    `${link.professionalId}:${link.tenantId}`,
    link,
  ])).values()];
  if (candidates.length === 0) {
    throw psychologyError(
      requestedProfessionalId ? 'psychology/monitoring-scope-not-found' : 'psychology/monitoring-scope-unavailable',
      'O ambiente Psicologia solicitado não está disponível para monitoramento.',
      403,
    );
  }
  if (candidates.length > 1) {
    throw psychologyError(
      'psychology/monitoring-professional-required',
      'Informe explicitamente o profissional da Psicologia a ser monitorado.',
      409,
    );
  }

  const candidate = candidates[0];
  return Object.freeze({
    authUid: normalize(baseContext.userId, 160),
    workspaceId: candidate.binding.workspaceId,
    tenantId: candidate.binding.tenantId,
    professionalId: candidate.professionalId,
    context: PSYCHOLOGY_CONTEXT,
    role: 'admin',
    permissions: Object.freeze(Object.entries(baseContext.permissions || {})
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission)),
    actorName: baseContext.actorName || null,
    bindingMode: candidate.binding.bindingMode,
    bindingSource: candidate.binding.source,
    accessContext: baseContext,
  });
}
