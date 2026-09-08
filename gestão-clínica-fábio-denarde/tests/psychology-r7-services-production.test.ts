import assert from 'node:assert/strict';
import test from 'node:test';
import { readRealPsychologyStore, REAL_PSYCHOLOGY_TARGET } from '../src/features/psychology-persistence/realRead';
import { PSYCHOLOGY_SERVICE_CATALOG } from '../src/features/psychology-pilot/psychologyServiceCatalog';

const scope = {
  workspaceId: REAL_PSYCHOLOGY_TARGET.workspaceId,
  tenantId: REAL_PSYCHOLOGY_TARGET.tenantId,
  professionalId: REAL_PSYCHOLOGY_TARGET.professionalId,
  context: REAL_PSYCHOLOGY_TARGET.context,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function service(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Serviço ${id}`,
    defaultDurationMinutes: 50,
    defaultPrice: 0,
    modality: 'BOTH',
    active: true,
    context: scope.context,
    professionalId: scope.professionalId,
    ...overrides,
  };
}

function fetchFor({ settings, services = [], locations = [] }: { settings?: Record<string, unknown>; services?: unknown[]; locations?: unknown[] }) {
  return async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://local.test').pathname;
    if (path.endsWith('/settings')) return response({ scope, settings: { id: 'settings', scope, settings: settings || {} } });
    if (path.endsWith('/services')) return response({ scope, items: services });
    if (path.endsWith('/locations')) return response({ scope, items: locations });
    return response({ scope, items: [] });
  };
}

async function readCase(input: { settings?: Record<string, unknown>; services?: unknown[]; locations?: unknown[] }) {
  return readRealPsychologyStore({ fetchImpl: fetchFor(input), getToken: async () => 'synthetic-token', includeOperationalSettings: true });
}

function activeInternalServices(store: Awaited<ReturnType<typeof readCase>>) {
  return store.store.settings.services.filter(service => service.active && service.modality !== 'ONLINE');
}

test('R7 — settings.services ausente usa o catálogo canônico quando o agregado remoto está vazio', async () => {
  const result = await readCase({ settings: { agenda: { defaultDurationMinutes: 50 } } });
  assert.deepEqual(result.store.settings.services.map(item => item.id), PSYCHOLOGY_SERVICE_CATALOG.map(item => item.id));
  assert.equal(new Set(result.store.settings.services.map(item => item.id)).size, result.store.settings.services.length);
  assert.equal(activeInternalServices(result).every(item => item.defaultDurationMinutes === 50), true);
});

test('R7 — settings.services vazio também hidrata o catálogo sem duplicar', async () => {
  const result = await readCase({ settings: { services: [] } });
  assert.deepEqual(result.store.services.map(item => item.id), PSYCHOLOGY_SERVICE_CATALOG.map(item => item.id));
  assert.equal(new Set(result.store.settings.services.map(item => item.id)).size, result.store.settings.services.length);
});

test('R7 — settings.services configurado tem prioridade absoluta sobre o agregado separado', async () => {
  const configured = [service('custom-service', { name: 'Serviço personalizado', publicBooking: { active: false } })];
  const result = await readCase({ settings: { services: configured }, services: [service('aggregate-service')] });
  assert.deepEqual(result.store.settings.services.map(item => item.id), ['custom-service']);
  assert.equal(activeInternalServices(result)[0]?.name, 'Serviço personalizado');
  assert.equal(result.store.settings.services[0]?.publicBooking?.active, false);
});

test('R7 — active=false continua oculto e context/profissional divergentes continuam rejeitados', async () => {
  const result = await readCase({ settings: { services: [
    service('active-service'),
    service('inactive-service', { active: false }),
    service('foreign-professional', { professionalId: 'other-professional' }),
    service('foreign-context', { context: 'OUTRO_CONTEXTO' }),
  ] } });
  assert.deepEqual(result.store.settings.services.map(item => item.id), ['active-service', 'inactive-service']);
  assert.deepEqual(activeInternalServices(result).map(item => item.id), ['active-service']);
  assert.equal(result.store.settings.services.some(item => item.publicBooking?.active === false), false);
});

test('R7 — reload mantém serviços, duração, modalidade e local', async () => {
  const locations = [{ id: 'location-r7', displayName: 'Local R7', type: 'PRIMARY_OFFICE', active: true, isPrimary: true, context: scope.context, professionalId: scope.professionalId }];
  const input = { settings: { services: [service('reload-service', { defaultDurationMinutes: 50, modality: 'BOTH' })] }, locations };
  const first = await readCase(input);
  const second = await readCase(input);
  assert.deepEqual(second.store.settings.services.map(item => item.id), first.store.settings.services.map(item => item.id));
  assert.equal(second.store.settings.services[0]?.defaultDurationMinutes, 50);
  assert.equal(second.store.settings.services[0]?.modality, 'BOTH');
  assert.equal(second.store.locations[0]?.id, 'location-r7');
});
