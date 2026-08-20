import type { Session } from '../../types';
import { CANONICAL_PROFESSIONAL_CONTEXTS, type AuthProfessionalLink, type ProfessionalContext, type ProfessionalId } from '../../types/professional';

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;
const RESERVED_PLACEHOLDER_PATTERN = /^(?:PROFESSIONAL-)?(?:UNMAPPED|UNKNOWN|PENDING|TEMPORARY)$/i;

export function asCanonicalProfessionalId(value: unknown): ProfessionalId {
  const normalized = String(value || '').trim();
  if (!OPAQUE_ID_PATTERN.test(normalized) || PHONE_PATTERN.test(normalized) || normalized.includes('@') || RESERVED_PLACEHOLDER_PATTERN.test(normalized)) {
    throw new Error('professionalId canônico inválido ou não opaco.');
  }
  return normalized as ProfessionalId;
}

export function isCanonicalProfessionalId(value: unknown): value is ProfessionalId {
  try {
    asCanonicalProfessionalId(value);
    return true;
  } catch {
    return false;
  }
}

export function resolveTypedSessionProfessionalId(session: Pick<Session, 'professionalId'>): ProfessionalId | null {
  const value = String(session.professionalId || '').trim();
  if (!value || !isCanonicalProfessionalId(value)) return null;
  return asCanonicalProfessionalId(value);
}

export function assertSessionProfessionalIdentity(session: Pick<Session, 'professionalId'>): ProfessionalId {
  const value = String(session.professionalId || '').trim();
  if (!value) throw new Error('Persistência real exige professionalId canônico explícito na sessão.');
  return asCanonicalProfessionalId(value);
}

export function assertExplicitAuthProfessionalLink(link: AuthProfessionalLink): AuthProfessionalLink {
  const authUid = String(link.authUid || '').trim();
  if (!authUid) throw new Error('authUid é obrigatório no vínculo explícito.');
  if (!String(link.tenantId || '').trim()) throw new Error('tenantId é obrigatório no vínculo explícito.');
  return { ...link, authUid, tenantId: link.tenantId.trim(), professionalId: asCanonicalProfessionalId(link.professionalId) };
}

export function isProfessionalContext(value: unknown): value is ProfessionalContext {
  return CANONICAL_PROFESSIONAL_CONTEXTS.includes(value as ProfessionalContext);
}

export function normalizeProfessionalContexts(values: readonly unknown[]): ProfessionalContext[] {
  const unique = [...new Set(values)];
  if (unique.some(value => !isProfessionalContext(value))) throw new Error('Contexto profissional não é canônico.');
  return CANONICAL_PROFESSIONAL_CONTEXTS.filter(context => unique.includes(context));
}

export function adminMayHaveProfessionalIdentity(role: string, professionalId: unknown): boolean {
  return role === 'ADMINISTRATOR' && isCanonicalProfessionalId(professionalId);
}
