import type { Session } from '../../types';
import { isCanonicalProfessionalId } from './canonicalProfessionalIdentity';

export interface CanonicalProfessionalCandidate {
  professionalId: string;
  contexts: readonly string[];
  active?: boolean;
}

function normalizeCandidateContexts(contexts: readonly string[] | undefined): string[] {
  return [...new Set((contexts || []).map(context => String(context || '').trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCanonicalProfessionalCandidates(
  candidates: unknown,
): CanonicalProfessionalCandidate[] {
  if (!Array.isArray(candidates)) {
    throw new Error('A lista de candidatos canônicos é inválida.');
  }

  return candidates.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`O candidato canônico na posição ${index} é inválido.`);
    }

    const professionalId = candidate.professionalId;
    const contexts = candidate.contexts;
    if (
      typeof professionalId !== 'string'
      || !Array.isArray(contexts)
      || contexts.some(context => typeof context !== 'string')
      || ('active' in candidate && typeof candidate.active !== 'boolean')
    ) {
      throw new Error(`O candidato canônico na posição ${index} não respeita o contrato esperado.`);
    }

    return {
      professionalId: professionalId.trim(),
      contexts: normalizeCandidateContexts(contexts),
      ...(typeof candidate.active === 'boolean' ? { active: candidate.active } : {}),
    };
  });
}

export function resolveCanonicalProfessionalForNewSession({
  candidates,
  context,
}: {
  candidates: unknown;
  context?: string | null;
}): string {
  const byProfessionalId = new Map<string, Set<string>>();

  for (const candidate of normalizeCanonicalProfessionalCandidates(candidates)) {
    if (candidate.active === false) continue;
    const professionalId = String(candidate.professionalId || '').trim();
    if (!isCanonicalProfessionalId(professionalId)) continue;
    const contexts = byProfessionalId.get(professionalId) || new Set<string>();
    for (const candidateContext of normalizeCandidateContexts(candidate.contexts)) contexts.add(candidateContext);
    byProfessionalId.set(professionalId, contexts);
  }

  if (byProfessionalId.size === 0) {
    throw new Error('Nenhum Professional canônico autorizado está disponível para a nova sessão.');
  }
  if (byProfessionalId.size > 1) {
    throw new Error('Mais de um Professional canônico está disponível; selecione o profissional antes de criar a sessão.');
  }

  const [professionalId, contextSet] = [...byProfessionalId.entries()][0];
  const requestedContext = String(context || '').trim();
  const contexts = [...contextSet];
  if (requestedContext && !contexts.includes(requestedContext)) {
    throw new Error('O Professional canônico não está vinculado ao contexto profissional solicitado.');
  }
  if (!requestedContext && contexts.length !== 1) {
    throw new Error('O contexto profissional exige seleção explícita antes de criar a sessão.');
  }

  return professionalId;
}

export function requiresCanonicalProfessional(session: Pick<Session, 'isBlocked'>): boolean {
  return session.isBlocked !== true;
}

export function attachCanonicalProfessionalToNewSessions({
  currentSessions,
  nextSessions,
  professionalId,
}: {
  currentSessions: readonly Session[];
  nextSessions: readonly Session[];
  professionalId: string;
}): Session[] {
  if (!isCanonicalProfessionalId(professionalId)) {
    throw new Error('O Professional canônico resolvido é inválido.');
  }

  const currentIds = new Set(currentSessions.map(session => session.id));
  return nextSessions.map(session => {
    if (currentIds.has(session.id) || !requiresCanonicalProfessional(session)) return session;
    const existingProfessionalId = String(session.professionalId || '').trim();
    if (existingProfessionalId && existingProfessionalId !== professionalId) {
      throw new Error('A nova sessão já possui um Professional diferente; persistência bloqueada.');
    }
    return existingProfessionalId ? session : { ...session, professionalId };
  });
}
