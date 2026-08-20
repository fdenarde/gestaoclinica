const ALLOWED_COMPONENTS = new Set(['BODY', 'BUTTONS']);

export class MetaTemplateDryRunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MetaTemplateDryRunError';
    this.code = code;
  }
}

/** Server-side contract validator only. It never calls Meta and never submits a payload. */
export function validateMetaTemplateDryRunPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Payload Meta inválido.');
  const keys = Object.keys(payload).sort().join(',');
  if (keys !== 'category,components,language,name') throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Campos de payload não permitidos.');
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(payload.name) || payload.language !== 'pt_BR' || payload.category !== 'UTILITY') throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Identidade do template incompatível.');
  if (!Array.isArray(payload.components) || payload.components.length < 1 || payload.components.length > 2) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Componentes inválidos.');
  const types = payload.components.map(component => component?.type);
  if (!types.includes('BODY') || types.some(type => !ALLOWED_COMPONENTS.has(type)) || new Set(types).size !== types.length) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'BODY/BUTTONS inválidos.');
  const body = payload.components.find(component => component.type === 'BODY');
  if (!body || typeof body.text !== 'string' || !body.text.trim() || !body.example || !Array.isArray(body.example.body_text) || body.example.body_text.length !== 1 || !Array.isArray(body.example.body_text[0]) || body.example.body_text[0].some(value => typeof value !== 'string' || !value.trim())) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'BODY sem exemplo válido.');
  const placeholders = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  if (placeholders.some((position, index) => position !== index + 1)) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Ordem de placeholders do BODY inválida.');
  if (body.example.body_text[0].length !== placeholders.length) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Exemplos do BODY não cobrem os placeholders.');
  const buttonsComponent = payload.components.find(component => component.type === 'BUTTONS');
  if (buttonsComponent) {
    if (!Array.isArray(buttonsComponent.buttons) || buttonsComponent.buttons.length < 1 || buttonsComponent.buttons.length > 2) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Botões inválidos.');
    for (const button of buttonsComponent.buttons) {
      if (Object.keys(button).sort().join(',') !== 'example,text,type,url' || button.type !== 'URL' || typeof button.text !== 'string' || !button.text.trim() || typeof button.url !== 'string' || !/^https:\/\/[^\s]+\{\{1\}\}$/.test(button.url) || !Array.isArray(button.example) || button.example.length !== 1 || typeof button.example[0] !== 'string' || !button.example[0].trim()) throw new MetaTemplateDryRunError('META_DRY_RUN_INVALID', 'Botão URL sem base e exemplo válidos.');
    }
  }
  return { ...payload, validated: true, canWrite: false };
}
