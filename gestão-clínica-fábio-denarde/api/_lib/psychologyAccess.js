import { getAdminDb } from './firebaseAdmin.js';
import { resolveAccessContext } from './accessContext.js';

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
  const requestedProfessionalId = normalize(options.professionalId || req?.query?.professionalId, 128);
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
