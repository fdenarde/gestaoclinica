import {
  createMemoryPublicBookingServerStore,
  createPublicBookingServerHandler,
} from './_lib/publicBookingServer.bundle.js';
import type { PublicBookingServerStore, PublicBookingServerHttpRequest } from '../src/features/psychology-online-booking/publicServerRepository';
import { createFirestorePublicBookingServerStore } from './_lib/publicBookingFirestoreStore.js';
import { assertPublicBookingFirebaseProject } from './_lib/firebaseAdmin.js';

type VercelRequestLike = {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponseLike;
  json(value: unknown): void;
};

const globalStoreKey = '__psychologyPublicBookingLocalStore__';
const globalHandlerKey = '__psychologyPublicBookingLocalHandler__';
const globalRemoteStoreKey = '__psychologyPublicBookingFirestoreStore__';
const globalRemoteHandlerKey = '__psychologyPublicBookingFirestoreHandler__';

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getLocalHandler() {
  const runtime = globalThis as typeof globalThis & { [globalStoreKey]?: ReturnType<typeof createMemoryPublicBookingServerStore>; [globalHandlerKey]?: ReturnType<typeof createPublicBookingServerHandler> };
  if (!runtime[globalStoreKey]) runtime[globalStoreKey] = createMemoryPublicBookingServerStore();
  if (!runtime[globalHandlerKey]) runtime[globalHandlerKey] = createPublicBookingServerHandler({ store: runtime[globalStoreKey], allowSettingsWrite: false });
  return runtime[globalHandlerKey];
}

function getFirestoreHandler() {
  const runtime = globalThis as typeof globalThis & {
    [globalRemoteStoreKey]?: ReturnType<typeof createFirestorePublicBookingServerStore>;
    [globalRemoteHandlerKey]?: ReturnType<typeof createPublicBookingServerHandler>;
  };
  if (!runtime[globalRemoteStoreKey]) {
    assertPublicBookingFirebaseProject();
    runtime[globalRemoteStoreKey] = createFirestorePublicBookingServerStore();
  }
  if (!runtime[globalRemoteHandlerKey]) runtime[globalRemoteHandlerKey] = createPublicBookingServerHandler({ store: runtime[globalRemoteStoreKey] as unknown as PublicBookingServerStore, allowSettingsWrite: false });
  return runtime[globalRemoteHandlerKey];
}

export default async function publicBookingHandler(req: VercelRequestLike, res: VercelResponseLike): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const persistenceMode = process.env.PUBLIC_BOOKING_PERSISTENCE_MODE;
  if (persistenceMode !== 'local-memory' && persistenceMode !== 'firestore') {
    res.status(503).json({ error: { code: 'public-booking/persistence-not-configured', message: 'A persistência pública ainda não foi habilitada neste ambiente.' } });
    return;
  }

  const url = new URL(req.url || '/api/public-booking', 'https://local.invalid');
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => { query[key] = value; });
  Object.entries(req.query || {}).forEach(([key, value]) => { if (query[key] === undefined) query[key] = queryValue(value); });
  const request: PublicBookingServerHttpRequest = { method: req.method || 'GET', query, body: req.body };
  try {
    const result = await (persistenceMode === 'firestore' ? getFirestoreHandler() : getLocalHandler())(request);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[PUBLIC BOOKING] persistência indisponível:', error instanceof Error ? error.message : 'erro desconhecido');
    res.status(503).json({ error: { code: 'public-booking/persistence-not-configured', message: 'A persistência pública ainda não está disponível neste ambiente.' } });
  }
}
