import { auth } from '../../firebase';
import { normalizeMetaTemplateStatus, type MetaTemplateStatus, type MetaTemplateSummary } from './messagingDomain';

export interface MetaTemplateSnapshot {
  connectionStatus: 'CONNECTED';
  lastSyncAt: string;
  canRead: true;
  canWrite: false;
  templates: MetaTemplateSummary[];
  institutionalTemplateCount?: number;
  collisionChecks?: Array<{ technicalName: string; language: string; collision: boolean }>;
  contextBindingStatus?: 'VERIFIED' | 'NO_PSYCHOLOGY_BINDING' | 'UNVERIFIED';
}

export class MetaBffClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'MetaBffClientError';
    this.code = code;
    this.status = status;
  }
}

type FetchLike = typeof fetch;
type TokenGetter = () => Promise<string | null>;

function safeText(value: unknown, maxLength = 512): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validateSnapshot(payload: unknown): MetaTemplateSnapshot {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MetaBffClientError('META_READ_FAILED', 'A resposta da integração Meta é inválida.');
  }
  const source = payload as Record<string, unknown>;
  const allowedTopLevel = new Set(['connectionStatus', 'lastSyncAt', 'canRead', 'canWrite', 'templates', 'institutionalTemplateCount', 'collisionChecks', 'contextBindingStatus']);
  if (Object.keys(source).some(key => !allowedTopLevel.has(key)) || source.connectionStatus !== 'CONNECTED' || source.canRead !== true || source.canWrite !== false || typeof source.lastSyncAt !== 'string' || Number.isNaN(Date.parse(source.lastSyncAt)) || !Array.isArray(source.templates)) {
    throw new MetaBffClientError('META_READ_FAILED', 'A resposta da integração Meta não corresponde ao contrato seguro.');
  }
  const templates = source.templates.map((value): MetaTemplateSummary => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MetaBffClientError('META_READ_FAILED', 'A lista de templates recebida é inválida.');
    const template = value as Record<string, unknown>;
    const allowedTemplateKeys = new Set(['id', 'name', 'language', 'category', 'status']);
    if (Object.keys(template).some(key => !allowedTemplateKeys.has(key))) throw new MetaBffClientError('META_READ_FAILED', 'A lista de templates recebeu um campo não permitido.');
    const normalizedStatus = normalizeMetaTemplateStatus(template.status) as MetaTemplateStatus;
    const result = {
      id: safeText(template.id, 128),
      name: safeText(template.name),
      language: safeText(template.language, 32),
      category: safeText(template.category, 32).toUpperCase(),
      status: normalizedStatus,
    } satisfies MetaTemplateSummary;
    if (!result.id || !result.name || !result.language || !result.category) throw new MetaBffClientError('META_READ_FAILED', 'A lista de templates recebeu um item incompleto.');
    return result;
  });
  const collisionChecks = source.collisionChecks === undefined ? undefined : Array.isArray(source.collisionChecks)
    ? source.collisionChecks.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MetaBffClientError('META_READ_FAILED', 'A verificação de colisão contextual é inválida.');
      const item = value as Record<string, unknown>;
      if (typeof item.technicalName !== 'string' || typeof item.language !== 'string' || typeof item.collision !== 'boolean') throw new MetaBffClientError('META_READ_FAILED', 'A verificação de colisão contextual é inválida.');
      return { technicalName: safeText(item.technicalName, 128), language: safeText(item.language, 32), collision: item.collision };
    })
    : (() => { throw new MetaBffClientError('META_READ_FAILED', 'A verificação de colisão contextual é inválida.'); })();
  const contextBindingStatus = source.contextBindingStatus === undefined ? undefined : source.contextBindingStatus === 'VERIFIED' || source.contextBindingStatus === 'NO_PSYCHOLOGY_BINDING' || source.contextBindingStatus === 'UNVERIFIED' ? source.contextBindingStatus : (() => { throw new MetaBffClientError('META_READ_FAILED', 'O contexto Meta recebido é inválido.'); })();
  const institutionalTemplateCount = source.institutionalTemplateCount === undefined ? undefined : Number.isInteger(source.institutionalTemplateCount) && Number(source.institutionalTemplateCount) >= templates.length ? Number(source.institutionalTemplateCount) : (() => { throw new MetaBffClientError('META_READ_FAILED', 'O inventário institucional recebido é inválido.'); })();
  return { connectionStatus: 'CONNECTED', lastSyncAt: source.lastSyncAt, canRead: true, canWrite: false, templates, institutionalTemplateCount, collisionChecks, contextBindingStatus };
}

async function defaultToken(): Promise<string | null> {
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export function createRemoteMetaTemplateProvider({
  endpoint = '/api/psychology/meta/templates',
  fetchImpl = globalThis.fetch.bind(globalThis),
  getToken = defaultToken,
}: { endpoint?: string; fetchImpl?: FetchLike; getToken?: TokenGetter } = {}) {
  const readSnapshot = async (): Promise<MetaTemplateSnapshot> => {
    const token = await getToken();
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new MetaBffClientError('META_READ_FAILED', 'A integração Meta retornou uma resposta inválida.', response.status || 502); }
    if (!response.ok) {
      const remoteCode = payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in payload && payload.error && typeof payload.error === 'object' && 'code' in payload.error ? safeText((payload.error as Record<string, unknown>).code, 64) : '';
      throw new MetaBffClientError(remoteCode || 'META_BACKEND_UNAVAILABLE', 'Não foi possível consultar a integração Meta agora.', response.status || 502);
    }
    return validateSnapshot(payload);
  };
  return Object.freeze({ readSnapshot });
}
