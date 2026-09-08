import { createMetaTemplateBffProvider, MetaBffError } from './metaTemplateProvider.js';
import { buildMetaTemplateCollisionChecks, filterMetaTemplatesForContext, PSYCHOLOGY_META_CONTEXT } from './metaContextIsolation.js';

const R2F3_COLLISION_NAMES = [
  'psicologia_lembrete_vespera_presencial',
  'psicologia_lembrete_vespera_online',
];

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, statusCode, body) {
  if (typeof res.status === 'function') return res.status(statusCode).json(body);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
  return undefined;
}

function publicError(error) {
  if (error instanceof MetaBffError && ['META_AUTH_FAILED', 'META_BACKEND_UNAVAILABLE', 'META_READ_FAILED'].includes(error.code)) {
    return { code: error.code, statusCode: error.statusCode };
  }
  return { code: 'META_BACKEND_UNAVAILABLE', statusCode: 503 };
}

function contextualSnapshot(snapshot, context = {}) {
  const institutionalTemplates = Array.isArray(snapshot.templates) ? snapshot.templates : [];
  const contextId = context.contextId || PSYCHOLOGY_META_CONTEXT;
  const visibleTemplates = filterMetaTemplatesForContext(institutionalTemplates, {
    contextId,
    workspaceId: context.workspaceId,
    professionalId: context.professionalId,
    bindings: context.bindings || [],
  });
  return {
    connectionStatus: 'CONNECTED',
    lastSyncAt: snapshot.lastSyncAt,
    canRead: true,
    canWrite: false,
    templates: visibleTemplates,
    institutionalTemplateCount: institutionalTemplates.length,
    collisionChecks: buildMetaTemplateCollisionChecks(institutionalTemplates, R2F3_COLLISION_NAMES),
    contextBindingStatus: context.bindings?.length ? 'VERIFIED' : 'NO_PSYCHOLOGY_BINDING',
  };
}

export function createMetaTemplatesBffHandler({ env = process.env, provider = createMetaTemplateBffProvider({ env }) } = {}) {
  return async function metaTemplatesBffHandler(req, res, context = {}) {
    setSecurityHeaders(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: { code: 'META_METHOD_NOT_ALLOWED', message: 'Método não permitido para leitura Meta.' } });
    }
    try {
      return sendJson(res, 200, contextualSnapshot(await provider.readSnapshot(), context));
    } catch (error) {
      const safe = publicError(error);
      return sendJson(res, safe.statusCode, { error: { code: safe.code, message: 'Não foi possível carregar a integração Meta agora.' } });
    }
  };
}

const handler = createMetaTemplatesBffHandler();
export default handler;
