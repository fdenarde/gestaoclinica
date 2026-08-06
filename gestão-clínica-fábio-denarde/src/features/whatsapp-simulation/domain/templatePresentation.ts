import type { SimulationTemplatePresentation } from '../simulationTypes';

const contactToken = '{{contato_nome}}';
const professionalToken = '{{profissional_nome}}';
const dateToken = '{{data_ficticia}}';
const timeToken = '{{horario_ficticio}}';
const tenantToken = '{{tenant_nome}}';

export const TEMPLATE_PREVIEW_VALUES = {
  contato_nome: 'Mariana',
  profissional_nome: 'Fábio Denarde',
  data_ficticia: '14/08/2026',
  horario_ficticio: '09:00',
  tenant_nome: 'Ambiente demonstrativo',
} as const;

export function createDefaultTemplatePresentation(): SimulationTemplatePresentation {
  return {
    body: '',
    useContactName: false,
    includeDateTime: false,
    signProfessional: false,
    preserveLegacy: false,
  };
}

export function composeTemplateContent(presentation: SimulationTemplatePresentation): string {
  if (presentation.preserveLegacy && presentation.legacyContent) return presentation.legacyContent;
  const sections: string[] = [];
  if (presentation.useContactName) sections.push(`Olá, ${contactToken}.`);
  const body = presentation.body.trim();
  if (presentation.includeDateTime && /^Lembramos que seu atendimento está agendado\.?$/i.test(body)) {
    sections.push(`Lembramos que seu atendimento está agendado para ${dateToken}, às ${timeToken}.`);
  } else {
    if (body) sections.push(body);
    if (presentation.includeDateTime) sections.push(`Lembramos que seu atendimento está agendado para ${dateToken}, às ${timeToken}.`);
  }
  if (presentation.signProfessional) sections.push(`Atenciosamente,\n${professionalToken}`);
  return sections.join('\n\n');
}

export function renderTemplatePreview(content: string): string {
  return content
    .replaceAll(contactToken, TEMPLATE_PREVIEW_VALUES.contato_nome)
    .replaceAll(professionalToken, TEMPLATE_PREVIEW_VALUES.profissional_nome)
    .replaceAll(dateToken, TEMPLATE_PREVIEW_VALUES.data_ficticia)
    .replaceAll(timeToken, TEMPLATE_PREVIEW_VALUES.horario_ficticio)
    .replaceAll(tenantToken, TEMPLATE_PREVIEW_VALUES.tenant_nome)
    .replace(/{{\s*[a-zA-Z0-9_]+\s*}}/g, '');
}

function friendlyLegacyBody(content: string): string {
  return renderTemplatePreview(content).trim();
}

export function createTemplatePresentation(content: string): SimulationTemplatePresentation {
  const trimmed = content.trim();
  const useContactName = new RegExp(`(?:^|\\n)\\s*(?:Olá,?\\s*)?${contactToken.replace(/[{}]/g, '\\$&')}[,.]?`, 'i').test(trimmed);
  const includeDateTime = content.includes(dateToken) && content.includes(timeToken);
  const signProfessional = new RegExp(`(?:^|\\n+)Atenciosamente,\\s*${professionalToken.replace(/[{}]/g, '\\$&')}\\s*$`, 'i').test(trimmed);
  let body = trimmed;

  if (useContactName) body = body.replace(new RegExp(`^\\s*(?:Olá,?\\s*)?${contactToken.replace(/[{}]/g, '\\$&')}[,.]?\\s*`, 'i'), '');
  if (signProfessional) body = body.replace(new RegExp(`\\s*(?:\\n+)?Atenciosamente,\\s*${professionalToken.replace(/[{}]/g, '\\$&')}\\s*$`, 'i'), '');
  if (includeDateTime) body = body.replace(new RegExp(`\\s*Lembramos que seu atendimento está agendado para ${dateToken.replace(/[{}]/g, '\\$&')}, às ${timeToken.replace(/[{}]/g, '\\$&')}\\.?`, 'i'), '');

  if (/{{\s*[a-zA-Z0-9_]+\s*}}/.test(body)) {
    if (includeDateTime) {
      body = body.replace(new RegExp(`(?:^|\\s)[^\\n.]*${dateToken.replace(/[{}]/g, '\\$&')}[^\\n.]*${timeToken.replace(/[{}]/g, '\\$&')}[^\\n.]*\\.?`, 'i'), ' ').trim();
    }
    return {
      body: friendlyLegacyBody(body) || 'Seu retorno está programado.',
      useContactName,
      includeDateTime,
      signProfessional,
      preserveLegacy: true,
      legacyContent: trimmed,
    };
  }

  return {
    body: body.trim(),
    useContactName,
    includeDateTime,
    signProfessional,
    preserveLegacy: false,
  };
}
