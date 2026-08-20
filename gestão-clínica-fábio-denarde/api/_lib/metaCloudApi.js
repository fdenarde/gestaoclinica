const META_SEND_ENABLED_DEFAULT = 'NO';
const META_SEND_ENABLED_FUTURE_VALUE = 'YES';
const META_GRAPH_API_VERSION_ENV = 'META_GRAPH_API_VERSION';

export class MetaConfigurationError extends Error {
  constructor(message = 'Configuração Meta inválida.') {
    super(message);
    this.name = 'MetaConfigurationError';
    this.code = 'META_CONFIG_INVALID';
  }
}

export class MetaSendDisabledError extends Error {
  constructor() {
    super('Envio Meta desabilitado por configuração segura.');
    this.name = 'MetaSendDisabledError';
    this.code = 'META_SEND_DISABLED';
  }
}

export class MetaTransportError extends Error {
  constructor(status = null) {
    super('Falha sanitizada no transporte Meta.');
    this.name = 'MetaTransportError';
    this.code = 'META_TRANSPORT_FAILED';
    if (Number.isInteger(status)) this.status = status;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function requiredText(value, message) {
  const normalized = text(value);
  if (!normalized) throw new MetaConfigurationError(message);
  return normalized;
}

export function resolveMetaSendEnabled(value) {
  return text(value || META_SEND_ENABLED_DEFAULT).toUpperCase() === META_SEND_ENABLED_FUTURE_VALUE
    ? META_SEND_ENABLED_FUTURE_VALUE
    : META_SEND_ENABLED_DEFAULT;
}

export function readMetaWhatsAppConfig({ env = process.env, overrides = {} } = {}) {
  const source = { ...env, ...overrides };
  return {
    sendEnabled: resolveMetaSendEnabled(source.META_SEND_ENABLED),
    graphApiVersion: text(source[META_GRAPH_API_VERSION_ENV]),
    phoneNumberId: text(source.META_PHONE_NUMBER_ID),
    accessToken: text(source.META_ACCESS_TOKEN),
  };
}

function validateGraphApiVersion(value) {
  const version = requiredText(value, 'Versão da Graph API ausente.');
  if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new MetaConfigurationError('Versão da Graph API inválida.');
  return version;
}

export function validateMetaWhatsAppConfig(config, { requireCredentials = false } = {}) {
  if (!config || typeof config !== 'object') throw new MetaConfigurationError();

  const sendEnabled = resolveMetaSendEnabled(config.sendEnabled);
  const graphApiVersion = text(config.graphApiVersion);
  const phoneNumberId = text(config.phoneNumberId);
  const accessToken = text(config.accessToken);

  if (requireCredentials || sendEnabled === META_SEND_ENABLED_FUTURE_VALUE) {
    validateGraphApiVersion(graphApiVersion);
    requiredText(phoneNumberId, 'Phone Number ID ausente.');
    requiredText(accessToken, 'Access token ausente.');
  }

  return {
    sendEnabled,
    graphApiVersion,
    phoneNumberId,
    accessToken,
  };
}

function validateSyntheticRecipient(recipient) {
  const normalized = text(recipient);
  if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
    throw new MetaConfigurationError('Destinatário sintético inválido.');
  }
  return normalized;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MetaConfigurationError('Payload Meta inválido.');
  }
  const entries = Object.entries(payload);
  if (entries.length === 0) throw new MetaConfigurationError('Payload Meta vazio.');
  return Object.fromEntries(entries);
}

/**
 * Monta a requisição sem transportá-la. O Authorization permanece separado
 * do payload e só existe no objeto efêmero devolvido ao sender.
 */
export function buildMetaMessagesRequest({ config, recipient, payload }) {
  const validatedConfig = validateMetaWhatsAppConfig(config, { requireCredentials: true });
  const target = validateSyntheticRecipient(recipient);
  const body = validatePayload(payload);
  const version = validateGraphApiVersion(validatedConfig.graphApiVersion);

  return {
    method: 'POST',
    url: `https://graph.facebook.com/${version}/${validatedConfig.phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${validatedConfig.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, to: target }),
  };
}

function safeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

/**
 * Converte falhas em erro sem transportar token, Authorization, telefone ou
 * payload para mensagem, logs ou relatório.
 */
export function sanitizeMetaError(error) {
  const status = safeStatus(error?.status ?? error?.statusCode);
  return {
    code: status ? 'META_HTTP_ERROR' : 'META_TRANSPORT_FAILED',
    status,
    message: status ? 'Resposta HTTP Meta não aprovada.' : 'Falha sanitizada no transporte Meta.',
  };
}

function assertTransport(transport) {
  if (!transport || typeof transport.send !== 'function') {
    throw new MetaConfigurationError('Transporte Meta injetável ausente.');
  }
}

/**
 * Sender server-side. Não existe transporte padrão: toda chamada precisa de
 * uma dependência explícita, e a flag desligada bloqueia antes do transporte.
 */
export function createMetaWhatsAppSender({ transport }) {
  assertTransport(transport);

  return Object.freeze({
    async send({ config, recipient, payload }) {
      const effectiveConfig = validateMetaWhatsAppConfig(config);
      if (effectiveConfig.sendEnabled !== META_SEND_ENABLED_FUTURE_VALUE) {
        throw new MetaSendDisabledError();
      }

      const request = buildMetaMessagesRequest({
        config: effectiveConfig,
        recipient,
        payload,
      });

      let response;
      try {
        response = await transport.send(request);
      } catch (error) {
        throw new MetaTransportError(safeStatus(error?.status ?? error?.statusCode));
      }

      const status = safeStatus(response?.status);
      if (!status || status < 200 || status >= 300) throw new MetaTransportError(status);
      return { accepted: true, status };
    },
  });
}

export const META_SEND_ENABLED_DEFAULT_VALUE = META_SEND_ENABLED_DEFAULT;
export const META_SEND_ENABLED_FUTURE_OPT_IN = META_SEND_ENABLED_FUTURE_VALUE;
export const META_GRAPH_API_VERSION_ENV_NAME = META_GRAPH_API_VERSION_ENV;
