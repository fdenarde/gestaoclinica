import {
  MESSAGE_VARIABLE_TOKENS,
  unknownVariables,
  type MessageModalityScope,
  type MessageSemanticVariable,
  type MessageTemplateDraft,
  type MetaTemplateSummary,
} from './messagingDomain';

export type TemplatePreflightStatus = 'READY' | 'BLOCKED';
export type LocalContentApproval = 'CONTENT_APPROVED_LOCALLY' | 'NOT_APPROVED';
export type ButtonCompatibility = 'SUPPORTED' | 'BLOCKED';

export interface SemanticVariableMapEntry {
  semanticVariable: MessageSemanticVariable;
  component: 'BODY' | 'BUTTONS';
  position: number | null;
  metaPlaceholder: string | null;
  source: string;
  compatibility: ButtonCompatibility;
}

export interface MetaTemplateButtonPlan {
  semanticVariable: 'MAPS' | 'MANAGE_APPOINTMENT';
  type: 'URL';
  text: string;
  compatibility: ButtonCompatibility;
  reason?: string;
  baseUrl?: string;
  placeholder?: string;
}

export interface MetaTemplateDryRunPayload {
  name: string;
  language: 'pt_BR';
  category: 'UTILITY';
  components: Array<
    | { type: 'BODY'; text: string; example: { body_text: string[][] } }
    | { type: 'BUTTONS'; buttons: Array<{ type: 'URL'; text: string; url: string; example: string[] }> }
  >;
}

export interface MessageTemplatePreflight {
  status: TemplatePreflightStatus;
  errors: string[];
  blockers: string[];
  warnings: string[];
  checks: Record<string, 'PASS' | 'BLOCKED'>;
  technicalName: string;
  language: 'pt_BR';
  requestedCategory: 'UTILITY';
  metaCategory: string | null;
  contentHash: string;
  draftVersion: number;
  semanticVariableMap: SemanticVariableMapEntry[];
  metaPlaceholderMap: SemanticVariableMapEntry[];
  buttonPlan: MetaTemplateButtonPlan[];
  payload: MetaTemplateDryRunPayload | null;
}

export interface CompiledMetaTemplate {
  technicalName: string;
  bodyText: string;
  bodyVariables: MessageSemanticVariable[];
  semanticVariableMap: SemanticVariableMapEntry[];
  metaPlaceholderMap: SemanticVariableMapEntry[];
  buttonPlan: MetaTemplateButtonPlan[];
  payload: MetaTemplateDryRunPayload;
  contentHash: string;
}

export interface TemplatePreparationOptions {
  existingMetaTemplates?: readonly MetaTemplateSummary[];
  metaLookupComplete?: boolean;
  existingLocalDrafts?: readonly MessageTemplateDraft[];
  collisionChecks?: readonly { technicalName: string; language: string; collision: boolean }[];
}

export const R2F3_TECHNICAL_NAMES = {
  PRESENCIAL: 'psicologia_lembrete_vespera_presencial',
  ONLINE: 'psicologia_lembrete_vespera_online',
} as const;

export const R2F3_MANAGEMENT_BASE_URL = 'https://app.gestaoclinica.example/consulta/';
export const R2F3_MAPS_BASE_URL = 'https://app.gestaoclinica.example/maps/';
export const R2F3_SYNTHETIC_MAPS_URL = 'https://maps.example.test/local-sintetico';

const SYNTHETIC_EXAMPLES: Record<MessageSemanticVariable, string> = {
  PROFESSIONAL: 'Profissional Teste – Psicóloga',
  DATE: '20/08/2026',
  TIME: '15:00',
  APPOINTMENT_TYPE: 'Presencial',
  LOCATION: 'Clínica Sintética',
  ADDRESS: 'Avenida Sintética, 100 – Vila Velha/ES',
  MAPS: 'maps-navigation-synthetic',
  MANAGE_APPOINTMENT: 'management-preview',
};

const PRESENCIAL_BODY = `Olá! Este é um lembrete da Gestão Clínica. Seu atendimento com [PROFISSIONAL] está agendado para amanhã, [DATA], às [HORÁRIO].

Local: [LOCAL]
Endereço: [ENDEREÇO]

Para confirmar, cancelar ou consultar os dados do atendimento:`;

const ONLINE_BODY = `Olá! Este é um lembrete da Gestão Clínica. Seu atendimento online com [PROFISSIONAL] está agendado para amanhã, [DATA], às [HORÁRIO].

Para confirmar, cancelar ou consultar os dados do atendimento:`;

export const R2F3_TEMPLATE_SPECS = {
  PRESENCIAL: {
    technicalName: R2F3_TECHNICAL_NAMES.PRESENCIAL,
    displayName: 'Véspera — Presencial',
    modalityScope: 'PRESENCIAL' as const,
    body: PRESENCIAL_BODY,
    approvedText: `${PRESENCIAL_BODY}\nGerenciar minha consulta`,
    semanticVariables: ['PROFESSIONAL', 'DATE', 'TIME', 'LOCATION', 'ADDRESS', 'MAPS', 'MANAGE_APPOINTMENT'] as MessageSemanticVariable[],
  },
  ONLINE: {
    technicalName: R2F3_TECHNICAL_NAMES.ONLINE,
    displayName: 'Véspera — Online',
    modalityScope: 'ONLINE' as const,
    body: ONLINE_BODY,
    approvedText: `${ONLINE_BODY}\nGerenciar minha consulta`,
    semanticVariables: ['PROFESSIONAL', 'DATE', 'TIME', 'MANAGE_APPOINTMENT'] as MessageSemanticVariable[],
  },
} as const;

export function createR2f3TemplateDrafts(scope: { workspaceId: string; contextId?: 'PSICOLOGIA'; professionalId: string }, now = '2026-08-17T12:00:00.000Z'): MessageTemplateDraft[] {
  return (['PRESENCIAL', 'ONLINE'] as const).map(modality => {
    const spec = R2F3_TEMPLATE_SPECS[modality];
    const draft: MessageTemplateDraft = {
      id: `r2f3-${modality.toLowerCase()}`,
      workspaceId: scope.workspaceId,
      contextId: scope.contextId || 'PSICOLOGIA',
      professionalId: scope.professionalId,
      displayName: spec.displayName,
      purpose: 'Lembrete administrativo de véspera',
      reminderType: 'EVE_OF_APPOINTMENT',
      modalityScope: spec.modalityScope,
      body: spec.body,
      semanticVariables: [...spec.semanticVariables],
      language: 'pt_BR',
      requestedCategory: 'UTILITY',
      localStatus: 'DRAFT',
      enabled: true,
      metaTemplateId: null,
      metaTemplateName: spec.technicalName,
      metaStatus: null,
      technicalName: spec.technicalName,
      draftVersion: 1,
      contentHash: '',
      localContentApproval: 'NOT_APPROVED',
      preflightStatus: 'BLOCKED',
      preflightBlockers: ['NAME COLLISION CHECK = PENDING'],
      metaNameCollisionStatus: 'UNVERIFIED',
      createdAt: now,
      updatedAt: now,
    };
    return prepareTemplateDraft(draft, { metaLookupComplete: false });
  });
}

export function createR2f3ReminderRules(drafts: readonly MessageTemplateDraft[], now = '2026-08-17T12:00:00.000Z') {
  return drafts.map(template => ({
    id: `r2f3-rule-${template.modalityScope.toLowerCase()}`,
    workspaceId: template.workspaceId,
    contextId: template.contextId,
    professionalId: template.professionalId,
    templateId: template.id,
    reminderType: 'EVE_OF_APPOINTMENT' as const,
    offsetDays: 1,
    sendTime: '',
    scheduleStatus: 'PENDING_USER_TIME' as const,
    modalityScope: template.modalityScope,
    enabled: false,
    createdAt: now,
    updatedAt: now,
  }));
}

export function isR2f3Template(template: Pick<MessageTemplateDraft, 'technicalName'>): boolean {
  return template.technicalName === R2F3_TECHNICAL_NAMES.PRESENCIAL || template.technicalName === R2F3_TECHNICAL_NAMES.ONLINE;
}

export function prepareTemplateDraft(template: MessageTemplateDraft, options: TemplatePreparationOptions = {}): MessageTemplateDraft {
  if (!isR2f3Template(template)) return template;
  const compiled = compileMetaTemplateDraft(template);
  const preflight = runTemplatePreflight(template, compiled, options);
  return {
    ...template,
    semanticVariables: expectedVariablesForTemplate(template),
    contentHash: compiled.contentHash,
    preflightStatus: preflight.status,
    preflightBlockers: [...preflight.blockers],
    metaNameCollisionStatus: resolveCollisionStatus(compiled.technicalName, template.language, options),
    localStatus: preflight.status === 'READY' ? 'READY_FOR_META' : 'DRAFT',
    localContentApproval: preflight.status === 'READY' ? 'CONTENT_APPROVED_LOCALLY' : 'NOT_APPROVED',
    publicRouteStatus: 'DEPLOYMENT_PENDING',
    contextBindingStatus: 'BOUND_LOCAL',
    submissionState: preflight.status === 'READY' && resolveCollisionStatus(compiled.technicalName, template.language, options) === 'NO_COLLISION' ? 'DEPLOYMENT_GATE_PENDING' : 'BLOCKED',
  };
}

export function invalidateTemplateApproval(template: MessageTemplateDraft, nextVersion = (template.draftVersion || 1) + 1): MessageTemplateDraft {
  return { ...template, draftVersion: nextVersion, localStatus: 'DRAFT', localContentApproval: 'NOT_APPROVED' };
}

export function compileMetaTemplateDraft(template: Pick<MessageTemplateDraft, 'technicalName' | 'body' | 'semanticVariables' | 'modalityScope' | 'language' | 'requestedCategory'> & Partial<Pick<MessageTemplateDraft, 'draftVersion'>>): CompiledMetaTemplate {
  const technicalName = template.technicalName || (template.modalityScope === 'PRESENCIAL' ? R2F3_TECHNICAL_NAMES.PRESENCIAL : R2F3_TECHNICAL_NAMES.ONLINE);
  const semanticVariables = template.semanticVariables.length ? [...template.semanticVariables] : expectedVariablesForTemplate(template);
  const bodyVariables = semanticVariables.filter(variable => template.body.includes(MESSAGE_VARIABLE_TOKENS[variable]));
  const bodyPosition = new Map<MessageSemanticVariable, number>(bodyVariables.map((variable, index) => [variable, index + 1]));
  const bodyText = bodyVariables.reduce((current, variable) => current.split(MESSAGE_VARIABLE_TOKENS[variable]).join(`{{${bodyPosition.get(variable)}}}`), template.body);
  const mapEntries: SemanticVariableMapEntry[] = semanticVariables.map(variable => {
    if (variable === 'MAPS') return { semanticVariable: variable, component: 'BUTTONS', position: 1, metaPlaceholder: '{{1}}', source: 'maps navigation capability da consulta', compatibility: 'SUPPORTED' };
    if (variable === 'MANAGE_APPOINTMENT') return { semanticVariable: variable, component: 'BUTTONS', position: 1, metaPlaceholder: '{{1}}', source: 'management URL segura da consulta', compatibility: 'SUPPORTED' };
    const position = bodyPosition.get(variable) || null;
    return { semanticVariable: variable, component: 'BODY', position, metaPlaceholder: position ? `{{${position}}}` : null, source: semanticVariableSource(variable), compatibility: 'SUPPORTED' };
  });
  const buttonPlan: MetaTemplateButtonPlan[] = semanticVariables.includes('MAPS')
    ? [
        { semanticVariable: 'MAPS', type: 'URL', text: 'Abrir no Google Maps', compatibility: 'SUPPORTED', baseUrl: R2F3_MAPS_BASE_URL, placeholder: '{{1}}' },
        { semanticVariable: 'MANAGE_APPOINTMENT', type: 'URL', text: 'Gerenciar minha consulta', compatibility: 'SUPPORTED', baseUrl: R2F3_MANAGEMENT_BASE_URL, placeholder: '{{1}}' },
      ]
    : [{ semanticVariable: 'MANAGE_APPOINTMENT', type: 'URL', text: 'Gerenciar minha consulta', compatibility: 'SUPPORTED', baseUrl: R2F3_MANAGEMENT_BASE_URL, placeholder: '{{1}}' }];
  const buttons = buttonPlan.filter(button => button.compatibility === 'SUPPORTED').map(button => ({ type: 'URL' as const, text: button.text, url: `${button.baseUrl}{{1}}`, example: [SYNTHETIC_EXAMPLES[button.semanticVariable]] }));
  const components: MetaTemplateDryRunPayload['components'] = [
    { type: 'BODY', text: bodyText, example: { body_text: [bodyVariables.map(variable => SYNTHETIC_EXAMPLES[variable])] } },
    ...(buttons.length ? [{ type: 'BUTTONS' as const, buttons }] : []),
  ];
  const contentForHash = {
    name: technicalName,
    language: template.language,
    requestedCategory: template.requestedCategory,
    modality: template.modalityScope,
    body: bodyText,
    semanticVariableMap: mapEntries,
    buttons: buttonPlan.map(({ compatibility, reason, ...button }) => ({ ...button, compatibility, reason: reason || null })),
    components: components.map(component => component.type === 'BODY' ? { type: component.type, text: component.text } : { type: component.type, buttons: component.buttons.map(({ example, ...button }) => button) }),
  };
  const payload: MetaTemplateDryRunPayload = { name: technicalName, language: 'pt_BR', category: 'UTILITY', components };
  return { technicalName, bodyText, bodyVariables, semanticVariableMap: mapEntries, metaPlaceholderMap: mapEntries, buttonPlan, payload, contentHash: sha256Hex(stableStringify(contentForHash)) };
}

export function runTemplatePreflight(template: MessageTemplateDraft, compiled = compileMetaTemplateDraft(template), options: TemplatePreparationOptions = {}): MessageTemplatePreflight {
  const errors: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks: Record<string, 'PASS' | 'BLOCKED'> = {};
  const technicalName = compiled.technicalName;
  const metaTemplates = options.existingMetaTemplates || [];
  const metaLookupComplete = options.metaLookupComplete === true;
  const localDuplicates = (options.existingLocalDrafts || []).filter(item => item.id !== template.id && item.technicalName === technicalName && item.language === template.language);
  checks['technical name'] = /^[a-z][a-z0-9_]{2,63}$/.test(technicalName) ? 'PASS' : 'BLOCKED';
  checks.language = template.language === 'pt_BR' ? 'PASS' : 'BLOCKED';
  checks['requested category'] = template.requestedCategory === 'UTILITY' ? 'PASS' : 'BLOCKED';
  checks.body = template.body.trim() ? 'PASS' : 'BLOCKED';
  const unknownSemanticVariables = template.semanticVariables.filter(variable => !expectedVariablesForTemplate(template).includes(variable));
  checks.variables = unknownSemanticVariables.length || unknownVariables(template.body).length ? 'BLOCKED' : 'PASS';
  checks['variable order'] = isStableVariableOrder(compiled.semanticVariableMap) ? 'PASS' : 'BLOCKED';
  checks.examples = Object.values(SYNTHETIC_EXAMPLES).every(value => /example|sintét|teste|preview|2026|15:00|Vila Velha/i.test(value)) ? 'PASS' : 'BLOCKED';
  checks.components = compiled.payload.components.length >= 1 ? 'PASS' : 'BLOCKED';
  checks.buttons = compiled.buttonPlan.filter(button => button.compatibility === 'BLOCKED').length ? 'BLOCKED' : 'PASS';
  checks.urls = compiled.buttonPlan.filter(button => button.compatibility === 'SUPPORTED').every(button => button.baseUrl?.startsWith('https://')) ? 'PASS' : 'BLOCKED';
  checks.placeholders = compiled.semanticVariableMap.filter(entry => entry.compatibility === 'SUPPORTED').every(entry => entry.metaPlaceholder) ? 'PASS' : 'BLOCKED';
  checks.modality = template.modalityScope === 'ONLINE' || template.modalityScope === 'PRESENCIAL' ? 'PASS' : 'BLOCKED';
  checks['content compatibility'] = compiled.buttonPlan.every(button => button.compatibility === 'SUPPORTED') ? 'PASS' : 'BLOCKED';
  const collision = resolveCollisionStatus(technicalName, template.language, options);
  checks['name collision'] = collision === 'UNVERIFIED' ? 'BLOCKED' : collision === 'COLLISION' ? 'BLOCKED' : 'PASS';
  checks['local duplicate'] = localDuplicates.length ? 'BLOCKED' : 'PASS';
  checks.draftVersion = Number.isInteger(template.draftVersion || 1) && (template.draftVersion || 1) >= 1 ? 'PASS' : 'BLOCKED';
  checks.contentHash = Boolean(compiled.contentHash) ? 'PASS' : 'BLOCKED';
  if (checks['technical name'] === 'BLOCKED') errors.push('Nome técnico inválido.');
  if (checks.language === 'BLOCKED') errors.push('Idioma deve ser pt_BR.');
  if (checks['requested category'] === 'BLOCKED') errors.push('Categoria solicitada deve ser UTILITY.');
  if (checks.body === 'BLOCKED') errors.push('Body vazio.');
  if (checks.variables === 'BLOCKED') errors.push('Variável semântica desconhecida ou placeholder não permitido.');
  if (checks['name collision'] === 'BLOCKED') blockers.push(collision === 'COLLISION' ? `NAME COLLISION: ${technicalName} + ${template.language} já existe na Meta.` : 'NAME COLLISION CHECK = UNVERIFIED; leitura Meta necessária antes de aceitar o draft.');
  if (checks['local duplicate'] === 'BLOCKED') blockers.push('DUPLICIDADE LOCAL: já existe draft ativo semanticamente idêntico.');
  if (compiled.buttonPlan.some(button => button.semanticVariable === 'MANAGE_APPOINTMENT' && button.compatibility === 'BLOCKED')) blockers.push('MANAGEMENT BUTTON COMPATIBILITY = BLOCKED.');
  if (template.modalityScope === 'ONLINE' && compiled.semanticVariableMap.some(entry => ['LOCATION', 'ADDRESS', 'MAPS'].includes(entry.semanticVariable))) errors.push('Template Online não pode conter Local, Endereço ou Maps.');
  if (template.modalityScope === 'PRESENCIAL' && !compiled.semanticVariableMap.some(entry => entry.semanticVariable === 'LOCATION')) errors.push('Template Presencial precisa de Local.');
  if (template.modalityScope === 'PRESENCIAL' && !compiled.semanticVariableMap.some(entry => entry.semanticVariable === 'ADDRESS')) errors.push('Template Presencial precisa de Endereço.');
  if (collision === 'UNVERIFIED') warnings.push('Colisão de nome Meta ainda depende da leitura read-only.');
  return { status: errors.length || blockers.length ? 'BLOCKED' : 'READY', errors, blockers, warnings, checks, technicalName, language: 'pt_BR', requestedCategory: 'UTILITY', metaCategory: metaTemplates.find(item => item.name === technicalName && item.language === 'pt_BR')?.category || null, contentHash: compiled.contentHash, draftVersion: template.draftVersion || 1, semanticVariableMap: compiled.semanticVariableMap, metaPlaceholderMap: compiled.metaPlaceholderMap, buttonPlan: compiled.buttonPlan, payload: errors.length ? null : compiled.payload };
}

export function semanticVariableSource(variable: MessageSemanticVariable): string {
  if (variable === 'PROFESSIONAL') return 'professional.displayName';
  if (variable === 'DATE') return 'appointment/session civilDate';
  if (variable === 'TIME') return 'appointment/session startTime';
  if (variable === 'LOCATION') return 'location.displayName via locationId';
  if (variable === 'ADDRESS') return 'location.fullAddress via locationId';
  if (variable === 'MAPS') return 'maps navigation capability via appointment/session';
  if (variable === 'MANAGE_APPOINTMENT') return 'management URL segura da consulta';
  return 'appointment/session modality';
}

function resolveCollisionStatus(technicalName: string, language: string, options: TemplatePreparationOptions): 'UNVERIFIED' | 'NO_COLLISION' | 'COLLISION' {
  const check = options.collisionChecks?.find(item => item.technicalName === technicalName && item.language === language);
  if (check) return check.collision ? 'COLLISION' : 'NO_COLLISION';
  if (options.metaLookupComplete !== true) return 'UNVERIFIED';
  return options.existingMetaTemplates?.some(item => item.name === technicalName && item.language === language) ? 'COLLISION' : 'NO_COLLISION';
}

export function expectedVariablesForTemplate(template: Pick<MessageTemplateDraft, 'modalityScope' | 'semanticVariables'> & Partial<Pick<MessageTemplateDraft, 'technicalName'>>): MessageSemanticVariable[] {
  const variables = template.technicalName === R2F3_TECHNICAL_NAMES.PRESENCIAL || template.modalityScope === 'PRESENCIAL'
    ? R2F3_TEMPLATE_SPECS.PRESENCIAL.semanticVariables
    : template.technicalName === R2F3_TECHNICAL_NAMES.ONLINE || template.modalityScope === 'ONLINE'
      ? R2F3_TEMPLATE_SPECS.ONLINE.semanticVariables
      : template.semanticVariables;
  return [...variables];
}

function isStableVariableOrder(entries: readonly SemanticVariableMapEntry[]): boolean {
  const body = entries.filter(entry => entry.component === 'BODY' && entry.position !== null);
  return body.every((entry, index) => entry.position === index + 1);
}

function stableStringify(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.replace(/\r\n?/g, '\n').normalize('NFC'));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

// Small synchronous SHA-256 implementation so the same fingerprint works in browser and Node.
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
  const data = new Uint8Array(paddedLength); data.set(bytes); data[bytes.length] = 0x80;
  const bitLengthHigh = Math.floor(bitLength / 0x100000000);
  const bitLengthLow = bitLength >>> 0;
  for (let index = 0; index < 4; index += 1) data[paddedLength - 1 - index] = (bitLengthLow >>> (index * 8)) & 0xff;
  for (let index = 0; index < 4; index += 1) data[paddedLength - 5 - index] = (bitLengthHigh >>> (index * 8)) & 0xff;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) { const at = offset + index * 4; w[index] = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0; }
    for (let index = 16; index < 64; index += 1) { const value = w[index - 15]; const value2 = w[index - 2]; const s0 = rotr(value, 7) ^ rotr(value, 18) ^ (value >>> 3); const s1 = rotr(value2, 17) ^ rotr(value2, 19) ^ (value2 >>> 10); w[index] = add32(w[index - 16], s0, w[index - 7], s1); }
    let [a,b,c,d,e,f,g,h] = H;
    for (let index = 0; index < 64; index += 1) { const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const ch = (e & f) ^ (~e & g); const temp1 = add32(h, S1, ch, K[index], w[index]); const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22); const maj = (a & b) ^ (a & c) ^ (b & c); const temp2 = add32(S0, maj); h=g; g=f; f=e; e=add32(d, temp1); d=c; c=b; b=a; a=add32(temp1, temp2); }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(value => value.toString(16).padStart(8, '0')).join('');
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function add32(...values: number[]): number {
  let result = 0;
  for (const value of values) result = (result + value) >>> 0;
  return result;
}
