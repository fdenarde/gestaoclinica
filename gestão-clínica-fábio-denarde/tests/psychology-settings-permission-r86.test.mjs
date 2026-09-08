import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { assertAnyAccessPermission, buildEffectiveAccessContext } from '../api/_lib/accessPermissions.js';
import { resolvePsychologyAccessContext } from '../api/_lib/psychologyAccess.js';
import { SETTINGS_OPERATIONAL_FIELD_PATHS } from '../api/_lib/psychologySettingsProjection.js';

const SCOPE = Object.freeze({ authUid: 'professional-r86-auth', workspaceId: 'workspace-r86', tenantId: 'workspace-r86', professionalId: 'professional-r86', context: 'PSICOLOGIA', role: 'professional', permissions: ['agenda.own.view'], actorName: 'Profissional R86', bindingMode: 'LEGACY_ONE_TO_ONE', bindingSource: 'legacy-1-to-1' });
const permissions = ({ agenda = false, manage = false } = {}) => ({ 'agenda.own.view': agenda, 'settings.clinic.manage': manage });
const snapshot = (data = null) => ({ exists: Boolean(data), data: () => data });
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json() { return this; }, end() { return this; } });
const request = (method, path, body) => ({ method, url: `/api/psychology/${path}`, query: { path: [path] }, headers: { authorization: 'Bearer offline-test-token' }, body });

function fakeDb() {
  return { collection(name) {
    if (name === 'accessProfiles') return { doc: () => ({ get: async () => snapshot({}) }) };
    if (name === 'professionals') return { where: () => ({ get: async () => ({ docs: [{ id: SCOPE.professionalId, data: () => ({ active: true, professionalId: SCOPE.professionalId, tenantId: SCOPE.tenantId }) }] }) }) };
    if (name === 'professionalContexts') return { where: () => ({ get: async () => ({ docs: [{ id: 'context-r86', data: () => ({ active: true, context: 'PSICOLOGIA', professionalId: SCOPE.professionalId, tenantId: SCOPE.tenantId }) }] }) }) };
    return { doc: id => ({ get: async () => snapshot(id === 'settings' ? { settings: {} } : null), set: async () => {} }), get: async () => ({ docs: [] }) };
  } };
}

test('requiredAnyPermissions é OR fail-closed', () => {
  assert.doesNotThrow(() => assertAnyAccessPermission({ permissions: permissions({ agenda: true }) }, ['agenda.own.view', 'settings.clinic.manage']));
  assert.doesNotThrow(() => assertAnyAccessPermission({ permissions: permissions({ manage: true }) }, ['agenda.own.view', 'settings.clinic.manage']));
  assert.throws(() => assertAnyAccessPermission({ permissions: permissions() }, ['agenda.own.view', 'settings.clinic.manage']), error => error.code === 'access/permission-denied' && error.statusCode === 403);
});

test('agenda própria resolve somente o escopo Psychology', async () => {
  const scope = await resolvePsychologyAccessContext({}, { db: fakeDb(), requiredAnyPermissions: ['agenda.own.view', 'settings.clinic.manage'], resolveBaseAccessContext: async () => ({ userId: SCOPE.authUid, workspaceId: SCOPE.workspaceId, role: 'professional', permissions: permissions({ agenda: true }), actorName: SCOPE.actorName }) });
  assert.equal(scope.context, 'PSICOLOGIA'); assert.equal(scope.professionalId, SCOPE.professionalId); assert.equal(scope.tenantId, SCOPE.tenantId);
});

test('GET Settings/readiness usam OR e PUT permanece manage-only', async () => {
  const calls = [];
  const handler = createPsychologyApiHandler({ getDb: fakeDb, resolveAccess: async (_req, options) => { calls.push(options); if (options.requiredAnyPermissions) assertAnyAccessPermission({ permissions: permissions({ agenda: true }) }, options.requiredAnyPermissions); if (options.requiredPermissions?.some(key => !permissions({ agenda: true })[key])) { const error = new Error('denied'); error.code = 'access/permission-denied'; error.statusCode = 403; throw error; } return SCOPE; }, readSettingsProjection: async () => ({ ok: true }), auditLogger: () => {} });
  const get = response(); await handler(request('GET', 'settings'), get); assert.equal(get.statusCode, 200); assert.deepEqual(calls[0].requiredAnyPermissions, ['agenda.own.view', 'settings.clinic.manage']);
  const readiness = response(); await handler(request('GET', 'settings-readiness'), readiness); assert.equal(readiness.statusCode, 200); assert.deepEqual(calls[1].requiredAnyPermissions, ['agenda.own.view', 'settings.clinic.manage']);
  const put = response(); await handler(request('PUT', 'settings', { settings: {} }), put); assert.equal(put.statusCode, 403); assert.deepEqual(calls[2].requiredPermissions, ['settings.clinic.manage']);
});

test('R83 fieldMask operacional não inclui professionalProfile', () => {
  const source = fs.readFileSync(new URL('../api/_lib/psychologySettingsProjection.js', import.meta.url), 'utf8');
  assert.match(source, /getAll\(settingsReference,\s*\{\s*fieldMask:/s); assert.deepEqual(SETTINGS_OPERATIONAL_FIELD_PATHS, ['settings.services', 'settings.locations', 'settings.agenda.defaultDurationMinutes', 'settings.agenda.intervalMinutes']); assert.equal(SETTINGS_OPERATIONAL_FIELD_PATHS.some(path => path.includes('professionalProfile')), false); assert.equal(source.includes('settingsReference.get()'), false);
});
