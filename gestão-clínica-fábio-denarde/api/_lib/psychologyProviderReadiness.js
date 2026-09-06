import { getApp as getFirebaseApp } from 'firebase-admin/app';
import { getAdminDb, PRODUCTION_FIREBASE_PROJECT_ID } from './firebaseAdmin.js';
import { createPsychologyServerRepository } from './psychologyRepository.js';

const READINESS_SCOPE = Object.freeze({
  workspaceId: 'provider-readiness-workspace',
  professionalId: 'provider-readiness-professional',
  tenantId: 'provider-readiness-tenant',
  context: 'PSICOLOGIA',
});

function safeText(value, maxLength = 120) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized.slice(0, maxLength);
}

function safeErrorName(error) {
  const name = safeText(error?.name || 'Error', 80);
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(name) ? name : 'Error';
}

function initialResult() {
  return {
    ok: false,
    process: 'ok',
    firebaseAdmin: 'not-run',
    projectConfig: 'not-run',
    firestoreConfig: 'not-run',
    databaseConfig: 'not-run',
    runtimeCredential: 'not-run',
    databaseMetadata: 'not-run',
    databaseMetadataResult: 'not-run',
    repositories: 'not-run',
    failureLayer: null,
    errorName: null,
    errorCode: null,
    messageSanitized: null,
    httpStatus: null,
    cause: null,
    projectId: null,
    databaseId: null,
  };
}

function fail(result, { layer, cause, code, message, status, error }) {
  result.failureLayer = layer;
  result.cause = cause;
  result.errorCode = code;
  result.messageSanitized = message;
  result.httpStatus = Number.isInteger(status) ? status : null;
  result.errorName = safeErrorName(error);
  return result;
}

function metadataFailure(response, payload) {
  const status = Number(response?.status) || null;
  const apiStatus = safeText(payload?.error?.status || payload?.error?.code, 80).toUpperCase();
  if (status === 401 || apiStatus === 'UNAUTHENTICATED') {
    return {
      cause: 'PROVIDER_RUNTIME_CREDENTIAL_FAILURE',
      code: 'METADATA_UNAUTHENTICATED',
      message: 'A credencial runtime não foi aceita pela API de metadados.',
      status,
    };
  }
  if (status === 403 || apiStatus === 'PERMISSION_DENIED') {
    return {
      cause: 'PROVIDER_RUNTIME_PERMISSION_FAILURE',
      code: 'METADATA_PERMISSION_DENIED',
      message: 'A credencial runtime não possui autorização para os metadados do database.',
      status,
    };
  }
  if (status === 404 || apiStatus === 'NOT_FOUND') {
    return {
      cause: 'PROVIDER_DATABASE_NOT_FOUND',
      code: 'METADATA_DATABASE_NOT_FOUND',
      message: 'O database Firestore configurado não foi encontrado.',
      status,
    };
  }
  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    return {
      cause: 'PROVIDER_QUOTA_RESOURCE_EXHAUSTED',
      code: 'METADATA_RESOURCE_EXHAUSTED',
      message: 'A API de metadados recusou a solicitação por quota ou recurso esgotado.',
      status,
    };
  }
  return {
    cause: 'INDETERMINADA',
    code: 'METADATA_HTTP_ERROR',
    message: 'A API de metadados não confirmou o database configurado.',
    status,
  };
}

function networkFailure(error) {
  const code = safeText(error?.code, 80).toUpperCase();
  if (code.includes('CERT') || code.includes('TLS') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return {
      cause: 'PROVIDER_RUNTIME_TLS_FAILURE',
      code: 'METADATA_TLS_FAILURE',
      message: 'A conexão TLS com a API de metadados falhou.',
    };
  }
  return {
    cause: 'INDETERMINADA',
    code: code ? `METADATA_NETWORK_${code}`.slice(0, 80) : 'METADATA_NETWORK_ERROR',
    message: 'A API de metadados não pôde ser alcançada pelo runtime.',
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createPsychologyProviderReadiness(options = {}) {
  const getDb = options.getDb || getAdminDb;
  const getApp = options.getApp || getFirebaseApp;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const createRepositories = options.createRepositories || createPsychologyServerRepository;
  const expectedProjectId = options.expectedProjectId || PRODUCTION_FIREBASE_PROJECT_ID;

  return async function runPsychologyProviderReadiness() {
    const result = initialResult();
    if (typeof fetchImpl !== 'function') {
      result.process = 'error';
      return fail(result, {
        layer: 'process',
        cause: 'INDETERMINADA',
        code: 'RUNTIME_FETCH_UNAVAILABLE',
        message: 'O runtime Node não disponibiliza o cliente HTTP necessário para a readiness.',
      });
    }

    let app;
    let db;
    try {
      db = getDb();
      app = getApp();
      result.firebaseAdmin = 'ok';
    } catch (error) {
      result.firebaseAdmin = 'error';
      return fail(result, {
        layer: 'firebase-admin-initialization',
        cause: 'PROVIDER_ADMIN_INITIALIZATION_FAILURE',
        code: 'FIREBASE_ADMIN_INITIALIZATION_FAILED',
        message: 'O Firebase Admin não pôde ser inicializado no runtime.',
        error,
      });
    }

    const projectId = safeText(app?.options?.projectId || db?.projectId, 160);
    result.projectId = projectId || null;
    if (!projectId || projectId !== expectedProjectId) {
      result.projectConfig = 'error';
      return fail(result, {
        layer: 'project-config',
        cause: 'PROVIDER_PROJECT_CONFIG_ERROR',
        code: 'FIREBASE_PROJECT_MISMATCH',
        message: 'O projeto Firebase resolvido não corresponde ao projeto esperado.',
      });
    }
    result.projectConfig = 'ok';

    const databaseId = safeText(db?.databaseId, 160);
    result.databaseId = databaseId || null;
    if (!databaseId || databaseId === '(default)') {
      result.firestoreConfig = 'error';
      result.databaseConfig = 'error';
      return fail(result, {
        layer: 'firestore-config',
        cause: 'PROVIDER_DATABASE_CONFIG_ERROR',
        code: 'FIRESTORE_DATABASE_ID_MISSING',
        message: 'O database Firestore nomeado não está resolvido no runtime.',
      });
    }
    if (typeof db?.collection !== 'function') {
      result.firestoreConfig = 'error';
      return fail(result, {
        layer: 'firestore-initialization',
        cause: 'PROVIDER_FIRESTORE_INITIALIZATION_FAILURE',
        code: 'FIRESTORE_CLIENT_UNAVAILABLE',
        message: 'O cliente Firestore não expôs a interface esperada.',
      });
    }
    result.firestoreConfig = 'ok';
    result.databaseConfig = 'ok';

    let accessToken;
    try {
      accessToken = await app?.options?.credential?.getAccessToken?.();
      if (!safeText(accessToken?.access_token, 4096)) {
        throw new Error('A credencial não retornou access token.');
      }
      result.runtimeCredential = 'ok';
    } catch (error) {
      result.runtimeCredential = 'error';
      return fail(result, {
        layer: 'runtime-credential',
        cause: 'PROVIDER_RUNTIME_CREDENTIAL_FAILURE',
        code: 'RUNTIME_ACCESS_TOKEN_UNAVAILABLE',
        message: 'A credencial runtime não conseguiu autorização para a infraestrutura Google.',
        error,
      });
    }

    const metadataUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}`;
    try {
      const response = await fetchImpl(metadataUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken.access_token}`,
        },
      });
      if (!response.ok) {
        const failure = metadataFailure(response, await readJson(response));
        result.databaseMetadata = 'error';
        return fail(result, {
          layer: 'database-metadata',
          ...failure,
        });
      }
      result.databaseMetadata = 'ok';
      result.databaseMetadataResult = 'reachable';
    } catch (error) {
      result.databaseMetadata = 'error';
      return fail(result, {
        layer: 'database-metadata',
        ...networkFailure(error),
        error,
      });
    }

    try {
      const repositories = createRepositories({
        db,
        runtimeScope: READINESS_SCOPE,
        now: () => 'readiness-probe-time',
        requestId: 'provider-readiness',
        operation: 'provider-readiness:init',
      });
      if (!repositories || typeof repositories !== 'object') {
        throw new Error('A factory não retornou os repositórios esperados.');
      }
      result.repositories = 'ok';
    } catch (error) {
      result.repositories = 'error';
      return fail(result, {
        layer: 'repositories-initialization',
        cause: 'PROVIDER_REPOSITORY_INITIALIZATION_FAILURE',
        code: 'PSYCHOLOGY_REPOSITORIES_UNAVAILABLE',
        message: 'Os repositórios remotos da Psicologia não puderam ser construídos.',
        error,
      });
    }

    result.ok = true;
    result.cause = 'PROVIDER_INFRASTRUCTURE_READINESS_PASS';
    return result;
  };
}

export const runPsychologyProviderReadiness = createPsychologyProviderReadiness();
