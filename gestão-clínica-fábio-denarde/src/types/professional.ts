export const CANONICAL_PROFESSIONAL_CONTEXTS = ['NEUROPSICOPEDAGOGIA', 'PSICOLOGIA'] as const;

export type ProfessionalContext = typeof CANONICAL_PROFESSIONAL_CONTEXTS[number];

/** O valor é opaco; sua origem nunca deve ser nome, telefone, e-mail ou especialidade. */
export type ProfessionalId = string & { readonly __brand: 'ProfessionalId' };

export interface Professional {
  professionalId: ProfessionalId;
  tenantId: string;
  authUid?: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProfessionalContextLink {
  tenantId: string;
  professionalId: ProfessionalId;
  context: ProfessionalContext;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthProfessionalLink {
  tenantId: string;
  authUid: string;
  professionalId: ProfessionalId;
  active: boolean;
}

/** Interface somente de leitura para a futura fonte canônica clínica. */
export interface ClinicalProfessionalRepository {
  getById(tenantId: string, professionalId: ProfessionalId): Promise<Professional | null>;
  findByAuthUid(tenantId: string, authUid: string): Promise<Professional | null>;
  listContexts(tenantId: string, professionalId: ProfessionalId): Promise<readonly ProfessionalContextLink[]>;
}
