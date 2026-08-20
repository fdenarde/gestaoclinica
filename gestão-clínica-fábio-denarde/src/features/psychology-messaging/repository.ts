import type { LocalStorageLike } from '../psychology-persistence/repositories/local';
import {
  createDefaultMessageCenterState,
  normalizeMessageCenterState,
  PSYCHOLOGY_MESSAGING_STORAGE_KEY,
  toMessageScope,
  type MessageCenterState,
  type MessageReminderRule,
  type MessageScope,
  type MessageTemplateDraft,
} from './messagingDomain';
import type { PsychologyPersistenceScope } from '../psychology-persistence/scope';
import { createR2f3ReminderRules, createR2f3TemplateDrafts, invalidateTemplateApproval, prepareTemplateDraft } from './templatePreparation';

export interface MessageCenterRepository {
  load(): MessageCenterState;
  save(state: MessageCenterState): void;
  createTemplate(input: Omit<MessageTemplateDraft, 'id' | 'workspaceId' | 'contextId' | 'professionalId' | 'createdAt' | 'updatedAt'>): MessageTemplateDraft;
  updateTemplate(id: string, patch: Partial<Pick<MessageTemplateDraft, 'displayName' | 'purpose' | 'reminderType' | 'modalityScope' | 'body' | 'semanticVariables' | 'localStatus' | 'enabled' | 'metaTemplateName'>>): MessageTemplateDraft;
  duplicateTemplate(id: string): MessageTemplateDraft;
  deleteTemplate(id: string): void;
  setTemplateEnabled(id: string, enabled: boolean): MessageTemplateDraft;
  createRule(input: Omit<MessageReminderRule, 'id' | 'workspaceId' | 'contextId' | 'professionalId' | 'createdAt' | 'updatedAt'>): MessageReminderRule;
  updateRule(id: string, patch: Partial<Pick<MessageReminderRule, 'templateId' | 'reminderType' | 'offsetDays' | 'sendTime' | 'modalityScope' | 'enabled'>>): MessageReminderRule;
  setRuleEnabled(id: string, enabled: boolean): MessageReminderRule;
}

export function messageCenterStorageKey(scope: MessageScope): string {
  return `${PSYCHOLOGY_MESSAGING_STORAGE_KEY}:${scope.workspaceId}:${scope.professionalId}:${scope.contextId}`;
}

export function createLocalMessageCenterRepository({ scope: persistenceScope, storage, now = () => new Date().toISOString() }: { scope: PsychologyPersistenceScope; storage: LocalStorageLike; now?: () => string }): MessageCenterRepository {
  const scope = toMessageScope(persistenceScope);
  let state = readState(storage, scope);
  const persist = (): void => storage.setItem(messageCenterStorageKey(scope), JSON.stringify(state));
  const findTemplate = (id: string): MessageTemplateDraft => {
    const template = state.templates.find(item => item.id === id);
    if (!template) throw new Error('Mensagem local não encontrada.');
    return template;
  };
  const findRule = (id: string): MessageReminderRule => {
    const rule = state.rules.find(item => item.id === id);
    if (!rule) throw new Error('Regra local não encontrada.');
    return rule;
  };
  return {
    load: () => state,
    save: next => { state = normalizeMessageCenterState(next, scope); persist(); },
    createTemplate: input => {
      const timestamp = now();
      const template: MessageTemplateDraft = { ...input, id: createId('message'), workspaceId: scope.workspaceId, contextId: scope.contextId, professionalId: scope.professionalId, createdAt: timestamp, updatedAt: timestamp };
      state = { ...state, templates: [...state.templates, template] }; persist(); return template;
    },
    updateTemplate: (id, patch) => {
      const current = findTemplate(id);
      const next = { ...current, ...patch, updatedAt: now() };
      state = { ...state, templates: state.templates.map(item => item.id === id ? next : item) }; persist(); return next;
    },
    duplicateTemplate: id => {
      const current = findTemplate(id);
      const timestamp = now();
      const copy: MessageTemplateDraft = { ...current, id: createId('message-copy'), displayName: `${current.displayName} · cópia`, localStatus: 'DRAFT', metaTemplateId: null, metaTemplateName: null, metaStatus: null, technicalName: undefined, draftVersion: 1, contentHash: undefined, localContentApproval: 'NOT_APPROVED', preflightStatus: 'BLOCKED', preflightBlockers: ['DRAFT DUPLICADO REQUER NOVA PREPARAÇÃO'], metaNameCollisionStatus: 'UNVERIFIED', createdAt: timestamp, updatedAt: timestamp };
      state = { ...state, templates: [...state.templates, copy] }; persist(); return copy;
    },
    deleteTemplate: id => {
      const current = findTemplate(id);
      if (current.metaTemplateId) throw new Error('Mensagem vinculada à Meta não pode ser excluída nesta etapa.');
      state = { ...state, templates: state.templates.filter(item => item.id !== id), rules: state.rules.filter(rule => rule.templateId !== id) }; persist();
    },
    setTemplateEnabled: (id, enabled) => {
      const current = findTemplate(id); const next = { ...current, enabled, updatedAt: now() };
      state = { ...state, templates: state.templates.map(item => item.id === id ? next : item) }; persist(); return next;
    },
    createRule: input => {
      const timestamp = now();
      const rule: MessageReminderRule = { ...input, id: createId('rule'), workspaceId: scope.workspaceId, contextId: scope.contextId, professionalId: scope.professionalId, createdAt: timestamp, updatedAt: timestamp };
      state = { ...state, rules: [...state.rules, rule] }; persist(); return rule;
    },
    updateRule: (id, patch) => {
      const current = findRule(id); const next = { ...current, ...patch, updatedAt: now() };
      state = { ...state, rules: state.rules.map(item => item.id === id ? next : item) }; persist(); return next;
    },
    setRuleEnabled: (id, enabled) => {
      const current = findRule(id); const next = { ...current, enabled, updatedAt: now() };
      state = { ...state, rules: state.rules.map(item => item.id === id ? next : item) }; persist(); return next;
    },
  };
}

/** Seeds only the two Psicologia R2F3 local drafts/rules; it never touches Meta or other contexts. */
export function ensurePsychologyR2f3LocalState({ repository, scope: persistenceScope, metaTemplates, metaCollisionChecks, now = () => new Date().toISOString() }: { repository: MessageCenterRepository; scope: PsychologyPersistenceScope; metaTemplates?: readonly import('./messagingDomain').MetaTemplateSummary[]; metaCollisionChecks?: readonly { technicalName: string; language: string; collision: boolean }[]; now?: () => string }): MessageCenterState {
  const scope = toMessageScope(persistenceScope);
  const current = repository.load();
  const preparedOptions = { existingMetaTemplates: metaTemplates, collisionChecks: metaCollisionChecks, metaLookupComplete: Array.isArray(metaTemplates) || Array.isArray(metaCollisionChecks) };
  const canonical = createR2f3TemplateDrafts(scope, now());
  let templates = [...current.templates];
  for (const seed of canonical) {
    const existing = templates.find(item => item.technicalName === seed.technicalName || item.id === seed.id);
    if (!existing) templates = [...templates, prepareTemplateDraft(seed, { ...preparedOptions, existingLocalDrafts: templates })];
  }
  templates = templates.map(template => {
    if (!template.technicalName || !canonical.some(seed => seed.technicalName === template.technicalName)) return template;
    if (!Array.isArray(metaTemplates) && !Array.isArray(metaCollisionChecks) && template.localContentApproval === 'CONTENT_APPROVED_LOCALLY') {
      return { ...template, preflightStatus: 'BLOCKED', preflightBlockers: ['NAME COLLISION CHECK = UNVERIFIED; leitura Meta necessária antes de aceitar o candidate.'], metaNameCollisionStatus: 'UNVERIFIED', submissionState: 'BLOCKED' };
    }
    const recalculated = prepareTemplateDraft(template, { ...preparedOptions, existingLocalDrafts: templates });
    if (template.contentHash && recalculated.contentHash !== template.contentHash) {
      return prepareTemplateDraft(invalidateTemplateApproval({ ...template, updatedAt: now() }, (template.draftVersion || 1) + 1), { ...preparedOptions, existingLocalDrafts: templates });
    }
    return recalculated;
  });
  const canonicalTemplates = templates.filter(template => canonical.some(seed => seed.technicalName === template.technicalName));
  const seededRules = createR2f3ReminderRules(canonicalTemplates, now());
  let rules = [...current.rules];
  for (const seedRule of seededRules) if (!rules.some(rule => rule.id === seedRule.id)) rules = [...rules, seedRule];
  repository.save({ ...current, templates, rules });
  return repository.load();
}

function readState(storage: LocalStorageLike, scope: MessageScope): MessageCenterState {
  const raw = storage.getItem(messageCenterStorageKey(scope));
  if (!raw) return createDefaultMessageCenterState(scope);
  try { return normalizeMessageCenterState(JSON.parse(raw), scope); } catch { return createDefaultMessageCenterState(scope); }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
