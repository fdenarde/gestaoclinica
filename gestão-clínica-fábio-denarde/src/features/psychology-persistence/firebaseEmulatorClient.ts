import type { FirestorePsychologyEmulatorClient } from './repositories/firestore';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface FirebaseFirestoreEmulatorClientOptions {
  projectId: string;
  host?: string;
  port?: number;
  idToken?: string;
  fetcher?: typeof fetch;
}

interface FirestoreValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

function assertLocalHost(host: string): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Firestore emulator exige host local; recebido: ${host}.`);
  }
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeValue(item)])),
      },
    };
  }
  throw new Error(`Valor Firestore não suportado: ${typeof value}.`);
}

function decodeValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([key, item]) => [key, decodeValue(item)]));
  return null;
}

function encodeFields(value: unknown): Record<string, FirestoreValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Documento Firestore precisa ser um objeto.');
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeValue(item)]));
}

function decodeDocument(document: FirestoreDocument): Record<string, unknown> {
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

function encodePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function documentId(document: FirestoreDocument): string {
  const id = document.name?.split('/').pop() || '';
  return decodeURIComponent(id);
}

export function assertFirebaseFirestoreEmulatorUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:') throw new Error('Firestore emulator deve usar HTTP local.');
  assertLocalHost(parsed.hostname);
  return parsed;
}

export function createFirebaseFirestoreEmulatorClient(options: FirebaseFirestoreEmulatorClientOptions): FirestorePsychologyEmulatorClient & { readonly baseUrl: string } {
  const host = options.host || '127.0.0.1';
  const port = options.port || 8081;
  assertLocalHost(host);
  if (!options.projectId.trim() || options.projectId.includes('/')) throw new Error('projectId local inválido.');
  const baseUrl = `http://${host}:${port}/v1/projects/${encodeURIComponent(options.projectId)}/databases/(default)/documents`;
  const fetcher = options.fetcher || fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetcher(`${baseUrl}/${encodePath(path)}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Firestore emulator ${response.status}: ${message}`);
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  }

  return {
    baseUrl,
    list: async <T>(collectionPath: string) => {
      try {
        const response = await request<{ documents?: FirestoreDocument[] }>('GET', collectionPath);
        return (response.documents || []).map(document => ({ id: documentId(document), ...decodeDocument(document) })) as T[];
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Firestore emulator 404')) return [];
        throw error;
      }
    },
    get: async <T>(documentPath: string) => {
      try {
        const document = await request<FirestoreDocument>('GET', documentPath);
        return { id: documentId(document), ...decodeDocument(document) } as T;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Firestore emulator 404')) return null;
        throw error;
      }
    },
    upsert: async <T>(documentPath: string, value: T) => {
      const document = await request<FirestoreDocument>('PATCH', documentPath, { fields: encodeFields(value) });
      return { id: documentId(document), ...decodeDocument(document) } as T;
    },
    update: async <T>(documentPath: string, value: Partial<T>) => {
      const document = await request<FirestoreDocument>('PATCH', documentPath, { fields: encodeFields(value) });
      return { id: documentId(document), ...decodeDocument(document) } as T;
    },
    delete: async (documentPath: string) => {
      await request<void>('DELETE', documentPath);
    },
  };
}

export async function checkFirebaseFirestoreEmulator(options: Omit<FirebaseFirestoreEmulatorClientOptions, 'idToken'>): Promise<void> {
  const client = createFirebaseFirestoreEmulatorClient(options);
  const response = await (options.fetcher || fetch)(client.baseUrl, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok && response.status !== 404) throw new Error(`Firestore emulator indisponível: HTTP ${response.status}.`);
}
