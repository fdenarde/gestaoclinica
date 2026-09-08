import type { PsychologyPersistenceScope } from '../psychology-persistence/scope';

export const PSYCHOLOGY_MESSAGING_CONTEXT = 'PSICOLOGIA' as const;
export const PSYCHOLOGY_MESSAGING_STORAGE_KEY = 'gestao-clinica:psychology-r2f1:messaging:v1';

export type MessageReminderType = 'EVE_OF_APPOINTMENT' | 'DAY_OF_APPOINTMENT' | 'CUSTOM';
export type MessageModalityScope = 'ALL' | 'ONLINE' | 'PRESENCIAL';
export type MessageTemplateLocalStatus = 'DRAFT' | 'READY_FOR_META';
export type MessageTemplatePreflightStatus = 'READY' | 'BLOCKED';
export type MessageTemplateLocalApproval = 'CONTENT_APPROVED_LOCALLY' | 'NOT_APPROVED';
export type MessagePublicRouteStatus = 'READY' | 'DEPLOYMENT_PENDING' | 'BLOCKED';
export type MessageSubmissionState = 'PREFLIGHT_READY' | 'DEPLOYMENT_GATE_PENDING' | 'SUBMISSION_READY' | 'BLOCKED';
export type MessageTemplateFutureMetaStatus = 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
export type MetaTemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'UNKNOWN';
export type MessageSemanticVariable =
  | 'PROFESSIONAL'
  | 'DATE'
  | 'TIME'
  | 'APPOINTMENT_TYPE'
  | 'LOCATION'
  | 'ADDRESS'
  | 'MAPS'
  | 'MANAGE_APPOINTMENT';

export const MESSAGE_VARIABLE_TOKENS: Record<MessageSemanticVariable, string> = {
  PROFESSIONAL: '[PROFISSIONAL]',
  DATE: '[DATA]',
  TIME: '[HORÁRIO]',
  APPOINTMENT_TYPE: '[TIPO_ATENDIMENTO]',
  LOCATION: '[LOCAL]',
  ADDRESS: '[ENDEREÇO]',
  MAPS: '[MAPS]',
  MANAGE_APPOINTMENT: '[GERENCIAR_CONSULTA]',
};

export const MESSAGE_VARIABLE_LABELS: Record<MessageSemanticVariable, string> = {
  PROFESSIONAL: 'Profissional',
  DATE: 'Data',
  TIME: 'Horário',
  APPOINTMENT_TYPE: 'Tipo de atendimento',
  LOCATION: 'Local',
  ADDRESS: 'Endereço',
  MAPS: 'Maps',
  MANAGE_APPOINTMENT: 'Gerenciar consulta',
};

const TOKEN_TO_VARIABLE = Object.fromEntries(
  Object.entries(MESSAGE_VARIABLE_TOKENS).map(([variable, token]) => [token, variable]),
) as Record<string, MessageSemanticVariable>;

const CLINICAL_VARIABLE_PATTERN = /\[(?:DIAGNÓSTICO|DIAGNOSTICO|MEDICA(?:ÇÃO|CAO)|PRONTUÁRIO|PRONTUARIO|NOTA_CLÍNICA|NOTA_CLINICA|EVOLUÇÃO|EVOLUCAO|DOCUMENTO_CLÍNICO|DOCUMENTO_CLINICO)\]/iu;
const UNKNOWN_VARIABLE_PATTERN = /\[[A-ZÁÉÍÓÚÃÕÇ0-9_]+\]/giu;

export interface MessageTemplateDraft {
  id: string;
  workspaceId: string;
  contextId: typeof PSYCHOLOGY_MESSAGING_CONTEXT;
  professionalId: string;
  displayName: string;
  purpose: string;
  reminderType: MessageReminderType;
  modalityScope: MessageModalityScope;
  body: string;
  semanticVariables: MessageSemanticVariable[];
  language: 'pt_BR';
  requestedCategory: 'UTILITY';
  localStatus: MessageTemplateLocalStatus;
  enabled: boolean;
  metaTemplateId: string | null;
  metaTemplateName: string | null;
  metaStatus: MessageTemplateFutureMetaStatus | null;
  technicalName?: string;
  draftVersion?: number;
  contentHash?: string;
  localContentApproval?: MessageTemplateLocalApproval;
  preflightStatus?: MessageTemplatePreflightStatus;
  preflightBlockers?: string[];
  metaNameCollisionStatus?: 'UNVERIFIED' | 'NO_COLLISION' | 'COLLISION';
  publicRouteStatus?: MessagePublicRouteStatus;
  contextBindingStatus?: 'BOUND_LOCAL' | 'BOUND_META' | 'UNVERIFIED';
  submissionState?: MessageSubmissionState;
  createdAt: string;
  updatedAt: string;
}

export interface MessageReminderRule {
  id: string;
  workspaceId: string;
  contextId: typeof PSYCHOLOGY_MESSAGING_CONTEXT;
  professionalId: string;
  templateId: string;
  reminderType: MessageReminderType;
  offsetDays: number;
  sendTime: string;
  modalityScope: MessageModalityScope;
  enabled: boolean;
  scheduleStatus?: 'PENDING_USER_TIME' | 'CONFIGURED';
  createdAt: string;
  updatedAt: string;
}

export interface MessageCenterState {
  schemaVersion: 1;
  templates: MessageTemplateDraft[];
  rules: MessageReminderRule[];
}

export interface MessageTemplateValidation {
  errors: string[];
  warnings: string[];
  semanticVariables: MessageSemanticVariable[];
  canMarkReady: boolean;
}

export interface MessagePreview {
  text: string;
  warnings: string[];
  modality: 'ONLINE' | 'PRESENCIAL';
  actions: MessagePreviewAction[];
}

export interface MessagePreviewAction {
  label: 'Abrir no Google Maps' | 'Gerenciar minha consulta';
  enabled: boolean;
  reason?: string;
}

export interface MetaTemplateSummary {
  id: string;
  name: string;
  language: string;
  category: string;
  status: MetaTemplateStatus;
}

export interface MetaTemplateStatusCounts {
  approved: number;
  pending: number;
  rejected: number;
  paused: number;
  disabled: number;
  unknown: number;
}

export interface MetaTemplateCategoryCounts {
  utility: number;
  marketing: number;
}

export interface MessageScope extends PsychologyPersistenceScope {
  contextId: typeof PSYCHOLOGY_MESSAGING_CONTEXT;
}

export function toMessageScope(scope: PsychologyPersistenceScope): MessageScope {
  return { ...scope, contextId: PSYCHOLOGY_MESSAGING_CONTEXT };
}

export function createDefaultMessageCenterState(scope: MessageScope): MessageCenterState {
  return { schemaVersion: 1, templates: [], rules: [] };
}

export function extractSemanticVariables(body: string): MessageSemanticVariable[] {
  const variables = Object.entries(MESSAGE_VARIABLE_TOKENS)
    .filter(([, token]) => body.includes(token))
    .map(([variable]) => variable as MessageSemanticVariable);
  return Object.keys(MESSAGE_VARIABLE_TOKENS)
    .filter(variable => variables.includes(variable as MessageSemanticVariable))
    .map(variable => variable as MessageSemanticVariable);
}

export function unknownVariables(body: string): string[] {
  return [...body.matchAll(UNKNOWN_VARIABLE_PATTERN)]
    .map(match => match[0])
    .filter(token => !TOKEN_TO_VARIABLE[token])
    .filter((token, index, tokens) => tokens.indexOf(token) === index);
}

export function validateMessageTemplate(input: Pick<MessageTemplateDraft, 'displayName' | 'body' | 'reminderType' | 'modalityScope' | 'language'>): MessageTemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const semanticVariables = extractSemanticVariables(input.body);
  const unknown = unknownVariables(input.body);

  if (!input.displayName.trim()) errors.push('Informe um nome para a mensagem.');
  if (!input.body.trim()) errors.push('Informe o texto da mensagem.');
  if (input.language !== 'pt_BR') errors.push('O idioma local precisa ser pt_BR.');
  if (unknown.length) errors.push(`Variável não permitida: ${unknown.join(', ')}.`);
  if (CLINICAL_VARIABLE_PATTERN.test(input.body)) errors.push('Variáveis clínicas não são permitidas.');
  if (input.modalityScope === 'ONLINE' && semanticVariables.some(variable => ['LOCATION', 'ADDRESS', 'MAPS'].includes(variable))) {
    warnings.push('A mensagem Online contém variáveis de localização. Remova Local, Endereço ou Maps antes de marcar como pronta.');
  }

  return {
    errors,
    warnings,
    semanticVariables,
    canMarkReady: errors.length === 0 && warnings.length === 0,
  };
}

export function messageReminderTypeLabel(type: MessageReminderType): string {
  if (type === 'EVE_OF_APPOINTMENT') return 'Véspera';
  if (type === 'DAY_OF_APPOINTMENT') return 'No dia';
  return 'Personalizado';
}

export function messageModalityLabel(scope: MessageModalityScope): string {
  if (scope === 'ONLINE') return 'Online';
  if (scope === 'PRESENCIAL') return 'Presencial';
  return 'Online e presencial';
}

export function messageStatusLabel(status: MessageTemplateLocalStatus): string {
  return status === 'READY_FOR_META' ? 'PRONTO PARA ENVIAR À META' : 'RASCUNHO';
}

export function normalizeMetaTemplateStatus(value: unknown): MetaTemplateStatus {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'APPROVED' || normalized === 'ACTIVE') return 'APPROVED';
  if (normalized === 'PENDING' || normalized === 'IN_REVIEW' || normalized === 'IN REVIEW') return 'PENDING';
  if (normalized === 'REJECTED' || normalized === 'ERROR') return 'REJECTED';
  if (normalized === 'PAUSED') return 'PAUSED';
  if (normalized === 'DISABLED' || normalized === 'DEACTIVATED') return 'DISABLED';
  return 'UNKNOWN';
}

export function countMetaTemplateStatuses(templates: readonly Pick<MetaTemplateSummary, 'status'>[]): MetaTemplateStatusCounts {
  return templates.reduce<MetaTemplateStatusCounts>((counts, template) => {
    if (template.status === 'APPROVED') counts.approved += 1;
    else if (template.status === 'PENDING') counts.pending += 1;
    else if (template.status === 'REJECTED') counts.rejected += 1;
    else if (template.status === 'PAUSED') counts.paused += 1;
    else if (template.status === 'DISABLED') counts.disabled += 1;
    else counts.unknown += 1;
    return counts;
  }, { approved: 0, pending: 0, rejected: 0, paused: 0, disabled: 0, unknown: 0 });
}

export function countMetaTemplateCategories(templates: readonly Pick<MetaTemplateSummary, 'category'>[]): MetaTemplateCategoryCounts {
  return templates.reduce<MetaTemplateCategoryCounts>((counts, template) => {
    const category = String(template.category || '').trim().toUpperCase();
    if (category === 'UTILITY') counts.utility += 1;
    if (category === 'MARKETING') counts.marketing += 1;
    return counts;
  }, { utility: 0, marketing: 0 });
}

export function messageRuleOffsetDays(type: MessageReminderType): number {
  if (type === 'EVE_OF_APPOINTMENT') return 1;
  if (type === 'DAY_OF_APPOINTMENT') return 0;
  return 0;
}

export function isReminderEligibleForSession(status: string): boolean {
  return !['CANCELLED', 'CANCELED'].includes(status.toUpperCase()) && status.toLowerCase() !== 'cancelada';
}

const PREVIEW_VALUES: Record<MessageSemanticVariable, string> = {
  PROFESSIONAL: 'Profissional Teste – Psicóloga',
  DATE: '20/08/2026',
  TIME: '15:00',
  APPOINTMENT_TYPE: 'Presencial',
  LOCATION: 'Clínica Sintética',
  ADDRESS: 'Avenida Sintética, 100 – Vila Velha/ES',
  MAPS: 'https://maps.example.test/local-sintetico',
  MANAGE_APPOINTMENT: 'https://example.test/consulta/management-preview',
};

export function renderMessagePreview(template: Pick<MessageTemplateDraft, 'body' | 'modalityScope'>, modality: 'ONLINE' | 'PRESENCIAL'): MessagePreview {
  const warnings: string[] = [];
  const semanticVariables = extractSemanticVariables(template.body);
  if (modality === 'ONLINE' && semanticVariables.some(variable => ['LOCATION', 'ADDRESS', 'MAPS'].includes(variable))) {
    warnings.push('Esta prévia Online não utiliza endereço, local ou Maps.');
  }
  let body = template.body;
  if (modality === 'ONLINE') {
    body = body.replace(/(?:local|endereço|maps|como chegar)\s*:?[ \t]*\[(?:LOCAL|ENDEREÇO|MAPS)\]\.?/giu, '');
  }
  const text = Object.entries(MESSAGE_VARIABLE_TOKENS).reduce((current, [variable, token]) => {
    const value = modality === 'ONLINE' && ['LOCATION', 'ADDRESS', 'MAPS'].includes(variable) ? '' : variable === 'APPOINTMENT_TYPE' ? (modality === 'ONLINE' ? 'Online' : PREVIEW_VALUES.APPOINTMENT_TYPE) : PREVIEW_VALUES[variable as MessageSemanticVariable];
    return current.split(token).join(value);
  }, body).replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\./g, '.').split('\n').filter(line => line.trim()).join('\n');
  const actions: MessagePreviewAction[] = modality === 'PRESENCIAL'
    ? [
        { label: 'Abrir no Google Maps', enabled: true },
        { label: 'Gerenciar minha consulta', enabled: true },
      ]
    : [{ label: 'Gerenciar minha consulta', enabled: true }];
  return { text, warnings, modality, actions };
}

export function normalizeMessageCenterState(raw: unknown, scope: MessageScope): MessageCenterState {
  const parsed = raw && typeof raw === 'object' ? raw as Partial<MessageCenterState> : {};
  const templates = Array.isArray(parsed.templates) ? parsed.templates : [];
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  return {
    schemaVersion: 1,
    templates: templates.filter(item => isInScope(item, scope)).map(item => normalizeTemplate(item, scope)),
    rules: rules.filter(item => isInScope(item, scope)).map(item => normalizeRule(item, scope)),
  };
}

function isInScope(value: unknown, scope: MessageScope): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.workspaceId === scope.workspaceId && item.professionalId === scope.professionalId && item.contextId === scope.contextId;
}

function normalizeTemplate(value: Record<string, unknown>, scope: MessageScope): MessageTemplateDraft {
  const body = typeof value.body === 'string' ? value.body : '';
  const reminderType = isReminderType(value.reminderType) ? value.reminderType : 'EVE_OF_APPOINTMENT';
  const modalityScope = isModalityScope(value.modalityScope) ? value.modalityScope : 'ALL';
  return {
    id: String(value.id || 'message-template-invalid'), workspaceId: scope.workspaceId, contextId: scope.contextId, professionalId: scope.professionalId,
    displayName: String(value.displayName || ''), purpose: String(value.purpose || 'Lembrete administrativo'), reminderType, modalityScope, body,
    semanticVariables: Array.isArray(value.semanticVariables) ? value.semanticVariables.filter(isSemanticVariable) : extractSemanticVariables(body), language: 'pt_BR', requestedCategory: 'UTILITY',
    localStatus: value.localStatus === 'READY_FOR_META' ? 'READY_FOR_META' : 'DRAFT', enabled: value.enabled !== false,
    metaTemplateId: typeof value.metaTemplateId === 'string' ? value.metaTemplateId : null,
    metaTemplateName: typeof value.metaTemplateName === 'string' ? value.metaTemplateName : null,
    metaStatus: isFutureMetaStatus(value.metaStatus) ? value.metaStatus : null,
    technicalName: typeof value.technicalName === 'string' ? value.technicalName : undefined,
    draftVersion: Number.isInteger(value.draftVersion) && Number(value.draftVersion) > 0 ? Number(value.draftVersion) : undefined,
    contentHash: typeof value.contentHash === 'string' ? value.contentHash : undefined,
    localContentApproval: value.localContentApproval === 'CONTENT_APPROVED_LOCALLY' ? 'CONTENT_APPROVED_LOCALLY' : 'NOT_APPROVED',
    preflightStatus: value.preflightStatus === 'READY' ? 'READY' : 'BLOCKED',
    preflightBlockers: Array.isArray(value.preflightBlockers) ? value.preflightBlockers.filter(item => typeof item === 'string') as string[] : [],
    metaNameCollisionStatus: value.metaNameCollisionStatus === 'NO_COLLISION' || value.metaNameCollisionStatus === 'COLLISION' ? value.metaNameCollisionStatus : 'UNVERIFIED',
    publicRouteStatus: value.publicRouteStatus === 'READY' || value.publicRouteStatus === 'BLOCKED' ? value.publicRouteStatus : 'DEPLOYMENT_PENDING',
    contextBindingStatus: value.contextBindingStatus === 'BOUND_META' || value.contextBindingStatus === 'BOUND_LOCAL' ? value.contextBindingStatus : 'UNVERIFIED',
    submissionState: value.submissionState === 'PREFLIGHT_READY' || value.submissionState === 'DEPLOYMENT_GATE_PENDING' || value.submissionState === 'SUBMISSION_READY' ? value.submissionState : 'BLOCKED',
    createdAt: String(value.createdAt || new Date(0).toISOString()), updatedAt: String(value.updatedAt || new Date(0).toISOString()),
  };
}

function normalizeRule(value: Record<string, unknown>, scope: MessageScope): MessageReminderRule {
  const reminderType = isReminderType(value.reminderType) ? value.reminderType : 'EVE_OF_APPOINTMENT';
  return {
    id: String(value.id || 'message-rule-invalid'), workspaceId: scope.workspaceId, contextId: scope.contextId, professionalId: scope.professionalId,
    templateId: String(value.templateId || ''), reminderType, offsetDays: Number.isFinite(value.offsetDays) ? Number(value.offsetDays) : messageRuleOffsetDays(reminderType),
    sendTime: value.scheduleStatus === 'PENDING_USER_TIME' ? '' : /^\d{2}:\d{2}$/.test(String(value.sendTime || '')) ? String(value.sendTime) : '09:00',
    modalityScope: isModalityScope(value.modalityScope) ? value.modalityScope : 'ALL', enabled: value.enabled !== false,
    scheduleStatus: value.scheduleStatus === 'CONFIGURED' ? 'CONFIGURED' : 'PENDING_USER_TIME',
    createdAt: String(value.createdAt || new Date(0).toISOString()), updatedAt: String(value.updatedAt || new Date(0).toISOString()),
  };
}

function isReminderType(value: unknown): value is MessageReminderType {
  return value === 'EVE_OF_APPOINTMENT' || value === 'DAY_OF_APPOINTMENT' || value === 'CUSTOM';
}

function isModalityScope(value: unknown): value is MessageModalityScope {
  return value === 'ALL' || value === 'ONLINE' || value === 'PRESENCIAL';
}

function isFutureMetaStatus(value: unknown): value is MessageTemplateFutureMetaStatus {
  return value === 'IN_REVIEW' || value === 'APPROVED' || value === 'REJECTED' || value === 'PAUSED' || value === 'DISABLED';
}

function isSemanticVariable(value: unknown): value is MessageSemanticVariable {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_VARIABLE_TOKENS, value);
}
