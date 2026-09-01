export const PSYCHOLOGY_CAPABILITY_RESOURCES = [
  'patients',
  'sessions',
  'services',
  'locations',
  'clinicalNotes',
  'personalAppointments',
  'finance',
  'packages',
  'documents',
  'attachments',
  'reports',
  'settings',
  'onlineBooking',
  'backup',
] as const;

export type PsychologyCapabilityResourceName = typeof PSYCHOLOGY_CAPABILITY_RESOURCES[number];
export type PsychologyCapabilityOperation = 'view' | 'create' | 'edit' | 'delete' | 'export';
export type PsychologyCapabilityLoadMode = 'bootstrap' | 'on-demand' | 'unavailable';

export interface PsychologyCapabilityResource {
  available: boolean;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  load: PsychologyCapabilityLoadMode;
  source: string;
  reason?: string;
}

export type PsychologyCapabilityResourceMap = Record<PsychologyCapabilityResourceName, PsychologyCapabilityResource>;

export interface PsychologyCapabilities {
  schemaVersion: 1;
  context: 'PSICOLOGIA';
  resources: PsychologyCapabilityResourceMap;
}

const UNAVAILABLE_RESOURCE: PsychologyCapabilityResource = {
  available: false,
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
  load: 'unavailable',
  source: 'none',
};

function closedResource(): PsychologyCapabilityResource {
  return { ...UNAVAILABLE_RESOURCE };
}

export function createClosedPsychologyCapabilities(): PsychologyCapabilities {
  return {
    schemaVersion: 1,
    context: 'PSICOLOGIA',
    resources: Object.fromEntries(PSYCHOLOGY_CAPABILITY_RESOURCES.map(name => [name, closedResource()])) as PsychologyCapabilityResourceMap,
  };
}

function normalizedResource(value: unknown): PsychologyCapabilityResource {
  if (!value || typeof value !== 'object') return closedResource();
  const source = value as Partial<PsychologyCapabilityResource>;
  const available = source.available === true;
  const load: PsychologyCapabilityLoadMode = source.load === 'bootstrap' || source.load === 'on-demand' ? source.load : 'unavailable';
  const result: PsychologyCapabilityResource = {
    available,
    view: available && source.view === true,
    create: available && source.create === true,
    edit: available && source.edit === true,
    delete: available && source.delete === true,
    export: available && source.export === true,
    load: available ? load : 'unavailable',
    source: typeof source.source === 'string' && source.source.length <= 80 ? source.source : 'none',
  };
  if (typeof source.reason === 'string' && source.reason.length <= 180) result.reason = source.reason;
  return result;
}

export function normalizePsychologyCapabilities(value: unknown): PsychologyCapabilities {
  if (!value || typeof value !== 'object') return createClosedPsychologyCapabilities();
  const source = value as { schemaVersion?: unknown; context?: unknown; resources?: unknown };
  if (source.schemaVersion !== 1 || source.context !== 'PSICOLOGIA' || !source.resources || typeof source.resources !== 'object') {
    return createClosedPsychologyCapabilities();
  }
  const rawResources = source.resources as Record<string, unknown>;
  return {
    schemaVersion: 1,
    context: 'PSICOLOGIA',
    resources: Object.fromEntries(PSYCHOLOGY_CAPABILITY_RESOURCES.map(name => [name, normalizedResource(rawResources[name])])) as PsychologyCapabilityResourceMap,
  };
}

export function psychologyCapabilityAllows(
  capabilities: PsychologyCapabilities | null | undefined,
  resource: PsychologyCapabilityResourceName,
  operation: PsychologyCapabilityOperation,
): boolean {
  return Boolean(capabilities?.context === 'PSICOLOGIA' && capabilities.resources[resource]?.available && capabilities.resources[resource]?.[operation]);
}

export function psychologyCapabilityIsAvailable(
  capabilities: PsychologyCapabilities | null | undefined,
  resource: PsychologyCapabilityResourceName,
): boolean {
  return Boolean(capabilities?.context === 'PSICOLOGIA' && capabilities.resources[resource]?.available);
}
