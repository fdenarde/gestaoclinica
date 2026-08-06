import type {
  SimulationTemplate,
  SimulationTemplateDraft,
  SimulationTemplateVariable,
} from '../simulationTypes';

export const SIMULATION_TEMPLATE_VARIABLES: readonly SimulationTemplateVariable[] = [
  'contato_nome',
  'profissional_nome',
  'tenant_nome',
  'data_ficticia',
  'horario_ficticio',
];

const variablePattern = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

export function extractTemplateVariables(content: string): string[] {
  const variables: string[] = [];
  for (const match of content.matchAll(variablePattern)) {
    if (!variables.includes(match[1])) variables.push(match[1]);
  }
  return variables;
}

function invalidContentReason(content: string): string | null {
  if (/<\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|javascript\s*:/i.test(content)) {
    return 'O template não pode conter script ou elemento executável.';
  }
  if (/\b(?:https?|ftp):\/\/|<\s*a\b/i.test(content)) {
    return 'O template não pode conter links executáveis.';
  }
  if (/\b(?:patientId|diagnóstico|diagnostico|prontuário|prontuario|pagamento|prescrição|prescricao|documento clínico|documento clinico)\b/i.test(content)) {
    return 'O template não pode conter campos clínicos ou financeiros.';
  }
  if (/(?:\+?\d{2}\s?)?\d{4,5}[-\s]?\d{4}/.test(content) || /\b\d{8,15}\b/.test(content)) {
    return 'O template não pode conter telefone ou identificador real.';
  }
  return null;
}

export function validateTemplateDraft(draft: SimulationTemplateDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Nome obrigatório.');
  if (!draft.category) errors.push('Categoria obrigatória.');
  if (!draft.content.trim()) errors.push('Conteúdo obrigatório.');
  if (draft.content.length > 1000) errors.push('Conteúdo excede o limite sintético de 1000 caracteres.');

  const contentVariables = extractTemplateVariables(draft.content);
  const allowed = new Set(draft.allowedVariables);
  const unknownVariables = contentVariables.filter(variable => !SIMULATION_TEMPLATE_VARIABLES.includes(variable as SimulationTemplateVariable) || !allowed.has(variable as SimulationTemplateVariable));
  if (unknownVariables.length) errors.push(`Variáveis não permitidas: ${unknownVariables.join(', ')}.`);

  const contentError = invalidContentReason(draft.content);
  if (contentError) errors.push(contentError);
  return errors;
}

export function assertValidTemplateDraft(draft: SimulationTemplateDraft): void {
  const errors = validateTemplateDraft(draft);
  if (errors.length) throw new Error(errors.join(' '));
}

export function assertTemplateContentIsAllowed(template: SimulationTemplate): void {
  assertValidTemplateDraft({
    name: template.name,
    description: template.description,
    category: template.category,
    content: template.content,
    allowedVariables: template.allowedVariables,
  });
}

export function resolveTemplateContent(
  template: SimulationTemplate,
  values: Partial<Record<SimulationTemplateVariable, string>>,
): string {
  assertTemplateContentIsAllowed(template);
  return template.content.replace(variablePattern, (_match, variableName: string) => {
    const value = values[variableName as SimulationTemplateVariable]?.trim();
    if (!value) throw new Error(`A variável {{${variableName}}} precisa de valor fictício.`);
    return value;
  });
}

export function getTemplateVariables(template: SimulationTemplate): SimulationTemplateVariable[] {
  return extractTemplateVariables(template.content) as SimulationTemplateVariable[];
}
