import type {
  AccessPermissionKey,
  AccessProfile,
  AccessRole,
} from '../../types/access';
import type {
  AuthProfessionalLink,
  Professional,
  ProfessionalContextLink,
} from '../../types/professional';
import {
  createDefaultPsychologyProfessionalPresentation,
  type PsychologyProfessionalPresentation,
} from '../psychology-pilot/psychologyR2a';
import {
  LOCAL_PSYCHOLOGY_WORKSPACE_ID,
  assertPsychologyPersistenceScope,
  type PsychologyPersistenceScope,
} from './scope';

export interface PsychologyProfessionalProfile {
  workspaceId: string;
  professionalId: string;
  context: 'PSICOLOGIA';
  displayName: string;
  professionalTitle: string;
  professionalRegistration?: string;
  clinicDisplayName?: string;
  email?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PsychologyWorkspaceTenantBinding {
  workspaceId: string;
  tenantId: string;
}

export interface PsychologyRuntimeScope {
  workspaceId: string;
  tenantId: string | null;
  professionalId: string;
  context: 'PSICOLOGIA';
  role: AccessRole;
  permissions: readonly AccessPermissionKey[];
  authUid: string | null;
}

export interface PsychologyRuntimeIdentity {
  scope: PsychologyPersistenceScope;
  runtimeScope: PsychologyRuntimeScope;
  profile: PsychologyProfessionalProfile;
  authUid: string | null;
  permissions: readonly AccessPermissionKey[];
}

export interface PsychologyIdentityResolutionInput {
  scope: PsychologyPersistenceScope;
  presentationProfile?: Partial<PsychologyProfessionalPresentation> | null;
  accessProfile?: {
    workspaceId?: string;
    linkedProfessionalIds?: string[];
    effectivePermissions?: Partial<Record<AccessPermissionKey, boolean>>;
    role?: AccessRole;
    status?: AccessProfile['status'];
    uid?: string;
  } | null;
  professional?: Pick<Professional, 'professionalId'> & Partial<Pick<Professional, 'authUid' | 'tenantId'>> | null;
  contextLink?: Pick<ProfessionalContextLink, 'professionalId' | 'context'> & Partial<Pick<ProfessionalContextLink, 'tenantId'>> | null;
  authLink?: Pick<AuthProfessionalLink, 'professionalId' | 'authUid'> & Partial<Pick<AuthProfessionalLink, 'tenantId'>> | null;
  tenantId?: string | null;
  workspaceTenantBinding?: PsychologyWorkspaceTenantBinding | null;
  now?: string;
}

function assertKnownIdentity(input: PsychologyIdentityResolutionInput): void {
  const { scope, accessProfile, professional, contextLink, authLink } = input;
  if (accessProfile?.workspaceId && accessProfile.workspaceId !== scope.workspaceId) {
    throw new Error('AccessProfile não pertence ao workspace do scope Psicologia.');
  }
  if (accessProfile?.linkedProfessionalIds?.length && !accessProfile.linkedProfessionalIds.includes(scope.professionalId)) {
    throw new Error('AccessProfile não autoriza o professionalId do scope Psicologia.');
  }
  if (professional?.professionalId && professional.professionalId !== scope.professionalId) {
    throw new Error('Professional não corresponde ao professionalId do scope Psicologia.');
  }
  if (contextLink && (contextLink.professionalId !== scope.professionalId || contextLink.context !== 'PSICOLOGIA')) {
    throw new Error('ProfessionalContextLink não corresponde ao contexto Psicologia.');
  }
  if (authLink?.professionalId && authLink.professionalId !== scope.professionalId) {
    throw new Error('AuthProfessionalLink não corresponde ao professionalId do scope Psicologia.');
  }
  const authUids = [authLink?.authUid, professional?.authUid, accessProfile?.uid]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (new Set(authUids).size > 1) {
    throw new Error('Os vínculos de autenticação não correspondem ao mesmo authUid.');
  }
}

function resolveExplicitTenantId(input: PsychologyIdentityResolutionInput): string | null {
  const tenantIds = [
    input.tenantId,
    input.professional?.tenantId,
    input.contextLink?.tenantId,
    input.authLink?.tenantId,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const uniqueTenantIds = [...new Set(tenantIds)];
  if (uniqueTenantIds.length > 1) {
    throw new Error('Os vínculos canônicos apontam para tenants diferentes.');
  }
  const binding = input.workspaceTenantBinding;
  if (binding) {
    if (binding.workspaceId !== input.scope.workspaceId || !binding.tenantId.trim()) {
      throw new Error('Bridge workspace/tenant não corresponde ao workspace Psicologia.');
    }
    if (uniqueTenantIds.length && uniqueTenantIds[0] !== binding.tenantId) {
      throw new Error('Tenant explícito não corresponde ao bridge workspace/tenant.');
    }
    return binding.tenantId;
  }
  if (uniqueTenantIds.length) {
    throw new Error('Resolver tenantId exige bridge workspace/tenant explícito; não é permitido inferir igualdade.');
  }
  return null;
}

function fallbackPresentation(scope: PsychologyPersistenceScope): PsychologyProfessionalPresentation {
  return createDefaultPsychologyProfessionalPresentation({ professionalId: scope.professionalId, context: 'PSICOLOGIA' });
}

export function createPsychologyProfessionalProfile(
  scope: PsychologyPersistenceScope,
  presentationProfile?: Partial<PsychologyProfessionalPresentation> | null,
  now = new Date().toISOString(),
): PsychologyProfessionalProfile {
  assertPsychologyPersistenceScope(scope);
  const fallback = fallbackPresentation(scope);
  const input = presentationProfile || {};
  const displayName = String(input.displayName || input.name || fallback.displayName).trim() || fallback.displayName;
  const professionalTitle = String(input.professionalTitle || input.specialty || fallback.professionalTitle).trim() || fallback.professionalTitle;
  const professionalRegistration = String(input.professionalRegistration ?? input.crp ?? '').trim();
  return {
    workspaceId: scope.workspaceId,
    professionalId: scope.professionalId,
    context: 'PSICOLOGIA',
    displayName,
    professionalTitle,
    professionalRegistration: professionalRegistration || undefined,
    clinicDisplayName: String(input.clinicDisplayName || '').trim() || undefined,
    email: String(input.email || '').trim() || undefined,
    phone: String(input.phone || '').trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function resolvePsychologyRuntimeScope(input: PsychologyIdentityResolutionInput): PsychologyRuntimeScope {
  assertPsychologyPersistenceScope(input.scope);
  assertKnownIdentity(input);
  if (input.tenantId || input.workspaceTenantBinding) {
    if (!input.accessProfile || !input.professional || !input.contextLink || !input.authLink) {
      throw new Error('Runtime scope canônico exige AccessProfile, Professional, ProfessionalContextLink e AuthProfessionalLink.');
    }
  }
  const tenantId = resolveExplicitTenantId(input);
  const permissions = Object.entries(input.accessProfile?.effectivePermissions || {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key as AccessPermissionKey);
  const authUid = [input.authLink?.authUid, input.professional?.authUid, input.accessProfile?.uid]
    .map(value => String(value || '').trim())
    .find(Boolean) || null;
  return {
    workspaceId: input.scope.workspaceId,
    tenantId,
    professionalId: input.scope.professionalId,
    context: 'PSICOLOGIA',
    role: input.accessProfile?.role || 'professional',
    permissions,
    authUid,
  };
}

export function resolvePsychologyRuntimeIdentity(input: PsychologyIdentityResolutionInput): PsychologyRuntimeIdentity {
  const runtimeScope = resolvePsychologyRuntimeScope(input);
  const profile = createPsychologyProfessionalProfile(input.scope, input.presentationProfile, input.now);
  return {
    scope: input.scope,
    runtimeScope,
    profile,
    authUid: runtimeScope.authUid,
    permissions: runtimeScope.permissions,
  };
}

export function presentationProfileFromRuntimeIdentity(identity: PsychologyRuntimeIdentity): PsychologyProfessionalPresentation {
  return {
    displayName: identity.profile.displayName,
    professionalTitle: identity.profile.professionalTitle,
    professionalRegistration: identity.profile.professionalRegistration || '',
    clinicDisplayName: identity.profile.clinicDisplayName || '',
    email: identity.profile.email || '',
    phone: identity.profile.phone || '',
    name: identity.profile.displayName,
    crp: identity.profile.professionalRegistration || '',
    specialty: identity.profile.professionalTitle,
  };
}

export function isLocalPsychologyRuntimeIdentity(identity: PsychologyRuntimeIdentity): boolean {
  return identity.scope.workspaceId === LOCAL_PSYCHOLOGY_WORKSPACE_ID;
}
