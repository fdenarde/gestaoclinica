export type PsychologyCatalogServiceModality = 'ONLINE' | 'PRESENTIAL' | 'BOTH';

export interface PsychologyServiceCatalogEntry {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  defaultPrice: number;
  modality: PsychologyCatalogServiceModality;
  sortOrder: number;
}

/**
 * The service catalog is shared by internal appointments and public booking.
 * Publication flags remain configuration on top of this canonical identity.
 */
export const PSYCHOLOGY_SERVICE_CATALOG: readonly PsychologyServiceCatalogEntry[] = [
  { id: 'psychotherapy-individual', name: 'Psicoterapia Individual', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', sortOrder: 1 },
  { id: 'therapy-couple', name: 'Terapia de Casal', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', sortOrder: 2 },
  { id: 'mentoring', name: 'Mentoria', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', sortOrder: 3 },
  { id: 'eneagram-test', name: 'Teste de Eneagrama', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', sortOrder: 4 },
  { id: 'psychotherapy-adolescent', name: 'Psicoterapia Adolescente', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', sortOrder: 5 },
];

const LEGACY_SERVICE_ID_ALIASES: Record<string, string> = {
  'psychology-service-psychotherapy': 'psychotherapy-individual',
};

export function canonicalPsychologyServiceId(value: unknown): string {
  const id = String(value || '').trim();
  return LEGACY_SERVICE_ID_ALIASES[id] || id;
}

export function psychologyCatalogEntry(id: unknown): PsychologyServiceCatalogEntry | undefined {
  const canonicalId = canonicalPsychologyServiceId(id);
  return PSYCHOLOGY_SERVICE_CATALOG.find(service => service.id === canonicalId);
}
