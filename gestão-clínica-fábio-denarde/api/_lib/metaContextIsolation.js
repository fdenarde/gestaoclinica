const PSYCHOLOGY_META_CONTEXT = 'PSICOLOGIA';

function text(value, maxLength = 256) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function classifyInstitutionalMetaTemplate(template, bindings = []) {
  const binding = bindings.find(item => (
    (item.metaTemplateId && item.metaTemplateId === template.id)
    || (item.metaTemplateName && item.metaTemplateName === template.name && (!item.language || item.language === template.language))
  ));
  if (binding?.contextId === PSYCHOLOGY_META_CONTEXT) return { template, classification: PSYCHOLOGY_META_CONTEXT, binding };
  if (template.name.toLocaleLowerCase().startsWith('neuro_')) return { template, classification: 'NEUROPSICOPEDAGOGIA', binding };
  return { template, classification: 'UNASSIGNED_INSTITUTIONAL', binding };
}

export function filterMetaTemplatesForContext(institutionalTemplates, options = {}) {
  return institutionalTemplates
    .map(template => classifyInstitutionalMetaTemplate(template, options.bindings || []))
    .filter(item => item.classification === options.contextId)
    .filter(item => !item.binding?.workspaceId || !options.workspaceId || item.binding.workspaceId === options.workspaceId)
    .filter(item => !item.binding?.professionalId || !options.professionalId || item.binding.professionalId === options.professionalId)
    .map(item => item.template);
}

export function buildMetaTemplateCollisionChecks(institutionalTemplates, requestedNames = []) {
  return requestedNames.map(technicalName => ({
    technicalName: text(technicalName, 128),
    language: 'pt_BR',
    collision: institutionalTemplates.some(template => template.name === technicalName && template.language === 'pt_BR'),
  }));
}

export { PSYCHOLOGY_META_CONTEXT };
