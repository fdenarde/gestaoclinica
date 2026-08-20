import { createHmac } from 'node:crypto';

const ENABLED = 'YES';
const DISABLED = 'NO';

export class MetaReadDisabledError extends Error {
  constructor() {
    super('META_READ_DISABLED: leitura Meta não habilitada ou configuração server-side ausente.');
    this.name = 'MetaReadDisabledError';
    this.code = 'META_READ_DISABLED';
  }
}

export class MetaWriteDisabledError extends Error {
  constructor() {
    super('META_WRITE_DISABLED: escrita Meta bloqueada por configuração segura.');
    this.name = 'MetaWriteDisabledError';
    this.code = 'META_WRITE_DISABLED';
    this.statusCode = 403;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function enabled(value) {
  return text(value).toUpperCase() === ENABLED;
}

/** Reads names and capabilities only; secret values never leave this module. */
export function readMetaTemplateConfig({ env = process.env } = {}) {
  const graphApiVersion = text(env.META_GRAPH_API_VERSION);
  const wabaId = text(env.META_WABA_ID);
  const accessToken = text(env.META_ACCESS_TOKEN);
  const readEnabled = enabled(env.META_TEMPLATE_READ_ENABLED);
  return {
    graphApiVersion,
    wabaId,
    hasAccessToken: Boolean(accessToken),
    readEnabled,
    canRead: readEnabled && Boolean(graphApiVersion && wabaId && accessToken),
    canWrite: false,
    metaWriteEnabled: false,
  };
}

export function mapMetaTemplateStatus(value) {
  const status = text(value).toUpperCase();
  if (status === 'APPROVED' || status === 'ACTIVE') return 'APPROVED';
  if (status === 'PENDING' || status === 'IN_REVIEW' || status === 'IN REVIEW') return 'PENDING';
  if (status === 'REJECTED' || status === 'ERROR') return 'REJECTED';
  if (status === 'PAUSED') return 'PAUSED';
  if (status === 'DISABLED' || status === 'DEACTIVATED') return 'DISABLED';
  return 'UNKNOWN';
}

export function normalizeMetaTemplate(value = {}) {
  return {
    id: text(value.id),
    name: text(value.name),
    language: text(value.language || value.language_code),
    category: text(value.category),
    status: mapMetaTemplateStatus(value.status),
  };
}

function sanitizeTemplates(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map(normalizeMetaTemplate).filter(item => item.id && item.name);
}

function dedupeTemplates(templates) {
  const byKey = new Map();
  for (const template of templates) {
    const key = template.id || `${template.name}:${template.language}`;
    if (!byKey.has(key)) byKey.set(key, template);
  }
  return [...byKey.values()];
}

/** @typedef {{ ok?: boolean, json: () => Promise<unknown> }} MetaReadResponse */
/** @typedef {(input: { url: string, accessToken: string }) => Promise<MetaReadResponse>} MetaReadRequest */

/** @returns {Promise<MetaReadResponse>} */
function defaultRequest({ url, accessToken }) {
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
}

function graphUrl(config, suffix) {
  return `https://graph.facebook.com/${config.graphApiVersion}/${config.wabaId}${suffix}`;
}

function assertRead(config) {
  if (!config.canRead) throw new MetaReadDisabledError();
}

async function readJson(response) {
  if (!response || response.ok === false) throw new Error('META_READ_FAILED');
  return response.json();
}

/** @param {{ env?: Record<string, string | undefined>, request?: MetaReadRequest }} options */
export function createMetaTemplateProvider({ env = process.env, request = defaultRequest } = {}) {
  const config = readMetaTemplateConfig({ env });
  const capabilities = Object.freeze({ canRead: config.canRead, canWrite: false, metaWriteEnabled: false });
  const listTemplates = async () => {
    assertRead(config);
    const response = await request({ url: graphUrl(config, '/message_templates?fields=id,name,language,category,status&limit=100'), accessToken: text(env.META_ACCESS_TOKEN) });
    return dedupeTemplates(sanitizeTemplates(await readJson(response)));
  };
  const getTemplateStatus = async templateId => {
    assertRead(config);
    const id = text(templateId);
    if (!id) throw new MetaReadDisabledError();
    const response = await request({ url: graphUrl(config, `/${encodeURIComponent(id)}?fields=id,name,language,category,status`), accessToken: text(env.META_ACCESS_TOKEN) });
    const payload = (await readJson(response)) || {};
    return normalizeMetaTemplate(Array.isArray(payload.data) ? payload.data[0] || {} : payload).status;
  };
  const writeDisabled = async (..._args) => { throw new MetaWriteDisabledError(); };
  return Object.freeze({
    capabilities: () => capabilities,
    async listTemplates() { return listTemplates(); },
    async getTemplateStatus(templateId) { return getTemplateStatus(templateId); },
    async syncTemplates(existing = []) { return dedupeTemplates([...(Array.isArray(existing) ? existing : []), ...(await listTemplates())]); },
    createTemplate: writeDisabled,
    editTemplate: writeDisabled,
    deleteTemplate: writeDisabled,
    submitTemplate: writeDisabled,
  });
}

export const META_TEMPLATE_READ_ENABLED_DEFAULT = DISABLED;
export const META_TEMPLATE_WRITE_ENABLED = DISABLED;

export class MetaBffError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'MetaBffError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function safeUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'https:') throw new Error('META_BFF_URL_MUST_USE_HTTPS');
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function readMetaBffConfig({ env = process.env } = {}) {
  const url = safeUrl(env.PSYCHOLOGY_META_BFF_URL);
  const secret = text(env.PSYCHOLOGY_META_BFF_HMAC_SECRET);
  const timeoutMs = Number(env.PSYCHOLOGY_META_BFF_TIMEOUT_MS || 8000);
  return {
    url,
    hasHmacSecret: secret.length >= 64,
    timeoutMs: Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 15000 ? timeoutMs : 8000,
    canRead: Boolean(url && secret.length >= 64),
    canWrite: false,
    metaWriteEnabled: false,
  };
}

function bffSignatureMessage({ method, path, timestamp }) {
  return `${String(method || '').toUpperCase()}\n${String(path || '')}\n${String(timestamp || '')}`;
}

export function createMetaBffSignature({ method = 'GET', path = '/meta/templates', timestamp, secret }) {
  const normalizedSecret = text(secret);
  if (normalizedSecret.length < 64) throw new MetaBffError('META_AUTH_FAILED', 'A autenticação server-side da Meta não está configurada.', 503);
  return createHmac('sha256', normalizedSecret)
    .update(bffSignatureMessage({ method, path, timestamp }))
    .digest('hex');
}

function allowedKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
}

export function validateMetaBffSnapshot(payload) {
  const topLevelKeys = new Set(['connectionStatus', 'lastSyncAt', 'canRead', 'canWrite', 'templates']);
  const templateKeys = new Set(['id', 'name', 'language', 'category', 'status']);
  const allowedStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'UNKNOWN']);
  if (!allowedKeys(payload, topLevelKeys) || payload.connectionStatus !== 'CONNECTED' || payload.canRead !== true || payload.canWrite !== false || typeof payload.lastSyncAt !== 'string' || Number.isNaN(Date.parse(payload.lastSyncAt)) || !Array.isArray(payload.templates)) {
    throw new MetaBffError('META_READ_FAILED', 'A resposta da Meta não corresponde ao contrato seguro.', 502);
  }
  const templates = payload.templates.map(template => {
    if (!allowedKeys(template, templateKeys)) throw new MetaBffError('META_READ_FAILED', 'A resposta da Meta contém campos não permitidos.', 502);
    const normalized = normalizeMetaTemplate(template);
    if (!normalized.id || !normalized.name || !normalized.language || !normalized.category || !allowedStatuses.has(normalized.status)) {
      throw new MetaBffError('META_READ_FAILED', 'A resposta da Meta contém um template inválido.', 502);
    }
    return normalized;
  });
  return {
    connectionStatus: 'CONNECTED',
    lastSyncAt: payload.lastSyncAt,
    canRead: true,
    canWrite: false,
    templates,
  };
}

async function defaultBffRequest({ url, headers, signal }) {
  return fetch(url, { method: 'GET', headers, signal });
}

async function readBffJson(response) {
  let payload = {};
  try { payload = await response.json(); } catch { /* handled as a safe generic error below */ }
  if (!response.ok) {
    const code = ['META_AUTH_FAILED', 'META_BACKEND_UNAVAILABLE', 'META_READ_FAILED'].includes(payload?.error) ? payload.error : response.status >= 500 ? 'META_BACKEND_UNAVAILABLE' : 'META_READ_FAILED';
    throw new MetaBffError(code, 'Não foi possível consultar a integração Meta.', response.status >= 500 ? 503 : 502);
  }
  return validateMetaBffSnapshot(payload);
}

/** Server-only adapter for the existing R3B6/R3B7A read-only endpoint. */
export function createMetaTemplateBffProvider({ env = process.env, request = defaultBffRequest, now = () => Date.now() } = {}) {
  const config = readMetaBffConfig({ env });
  const secret = text(env.PSYCHOLOGY_META_BFF_HMAC_SECRET);
  const capabilities = Object.freeze({ canRead: config.canRead, canWrite: false, metaWriteEnabled: false });
  const readSnapshot = async () => {
    if (!config.canRead) throw new MetaBffError('META_BACKEND_UNAVAILABLE', 'A integração Meta read-only não está configurada.', 503);
    const timestamp = String(now());
    const response = await request({
      url: `${config.url}/meta/templates`,
      headers: {
        Accept: 'application/json',
        'X-R3B6-Timestamp': timestamp,
        'X-R3B6-Signature': createMetaBffSignature({ timestamp, secret }),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    return readBffJson(response);
  };
  return Object.freeze({
    capabilities: () => capabilities,
    readSnapshot,
    async listTemplates() { return (await readSnapshot()).templates; },
  });
}
