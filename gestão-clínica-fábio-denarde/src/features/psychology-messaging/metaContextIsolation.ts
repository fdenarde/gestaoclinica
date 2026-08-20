import type { MetaTemplateSummary } from './messagingDomain';

export const PSYCHOLOGY_META_CONTEXT = 'PSICOLOGIA' as const;

export type MetaTemplateContextClassification = 'PSICOLOGIA' | 'NEUROPSICOPEDAGOGIA' | 'UNASSIGNED_INSTITUTIONAL';

export interface MetaTemplateBinding {
  metaTemplateId?: string;
  metaTemplateName?: string;
  contextId: string;
  workspaceId?: string;
  area?: string;
  professionalId?: string | null;
  localDraftId?: string | null;
  language?: string;
  purpose?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MetaTemplateClassification {
  template: MetaTemplateSummary;
  classification: MetaTemplateContextClassification;
  binding?: MetaTemplateBinding;
}

export interface MetaTemplateCollisionCheck {
  technicalName: string;
  language: string;
  collision: boolean;
}

export function classifyInstitutionalMetaTemplate(template: MetaTemplateSummary, bindings: readonly MetaTemplateBinding[] = []): MetaTemplateClassification {
  const binding = bindings.find(item => (
    (item.metaTemplateId && item.metaTemplateId === template.id)
    || (item.metaTemplateName && item.metaTemplateName === template.name && (!item.language || item.language === template.language))
  ));
  if (binding?.contextId === PSYCHOLOGY_META_CONTEXT) return { template, classification: 'PSICOLOGIA', binding };
  if (template.name.toLocaleLowerCase().startsWith('neuro_')) return { template, classification: 'NEUROPSICOPEDAGOGIA', binding };
  return { template, classification: 'UNASSIGNED_INSTITUTIONAL', binding };
}

export function filterMetaTemplatesForContext(
  institutionalTemplates: readonly MetaTemplateSummary[],
  options: { contextId: string; workspaceId?: string; professionalId?: string; bindings?: readonly MetaTemplateBinding[] },
): MetaTemplateSummary[] {
  return institutionalTemplates
    .map(template => classifyInstitutionalMetaTemplate(template, options.bindings || []))
    .filter(item => item.classification === options.contextId)
    .filter(item => !item.binding?.workspaceId || !options.workspaceId || item.binding.workspaceId === options.workspaceId)
    .filter(item => !item.binding?.professionalId || !options.professionalId || item.binding.professionalId === options.professionalId)
    .map(item => item.template);
}

export function buildMetaTemplateCollisionChecks(
  institutionalTemplates: readonly MetaTemplateSummary[],
  requestedNames: readonly string[],
): MetaTemplateCollisionCheck[] {
  return requestedNames.map(technicalName => ({
    technicalName,
    language: 'pt_BR',
    collision: institutionalTemplates.some(template => template.name === technicalName && template.language === 'pt_BR'),
  }));
}
