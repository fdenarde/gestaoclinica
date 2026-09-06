import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import {
  assertAnyAccessPermission,
  buildEffectiveAccessContext,
} from '../api/_lib/accessPermissions.js';
import { resolvePsychologyAccessContext } from '../api/_lib/psychologyAccess.js';
import { SETTINGS_OPERATIONAL_FIELD_PATHS } from '../api/_lib/psychologySettingsProjection.js';

const PRIMARY_ADMIN_EMAIL = 'fixture-admin-2@synthetic.test';
const SCOPE = Object.freeze({
  authUid: 'professional-r86-auth',
  workspaceId: 'workspace-r86',
  tenantId: 'workspace-r86',
  professionalId: 'professional-r86',
  context: 'PSICOLOGIA',
  role: 'professional',
  permissions: ['agenda.own.view'],
  actorName: 'Profissional R86',
  bindingMode: 'LEGACY_ONE_TO_ONE',
  bindingSource: 'legacy-1-to-1',
});

function permissions({ agenda = false, manage = false } = {}) {
  return {
    'agenda.own.view': agenda,
    'settings.clinic.manage': manage,
  };
}

function baseContext(permissionState, role = 'professional') {
  return {
    userId: SCOPE.authUid,
    workspaceId: SCOPE.workspaceId,
    role,
    permissions: permissionState,
    actorName: SCOPE.actorName,
  };
}

function documentSnapshot(data = null) {
  return {
    exists: Boolean(data),
    data: () => data,
  };
}

function createPsychologyDb({ contextActive = true, professionalId = SCOPE.professionalId } = {}) {
  let reads = 0;
  let writes = 0;
  const settingsData = {
    id: 'settings',
    workspaceId: SCOPE.workspaceId,
    tenantId: SCOPE.tenantId,
    professionalId,
    context: 'PSICOLOGIA',
    settings: {},
  };
  const db = {
    collection(name) {
      if (name === 'accessProfiles') {
        return { doc: () => ({ get: async () => { reads += 1; return documentSnapshot({}); } }) };
      }
      if (name === 'professionals') {
        return {
          where: (field, operator, value) => {
            assert.deepEqual([field, operator, value], ['authUid', '==', SCOPE.authUid]);
            return {
              get: async () => {
                reads += 1;
                return {
                  docs: professionalId
                    ? [{ id: professionalId, data: () => ({ active: true, professionalId, tenantId: SCOPE.tenantId }) }]
                    : [],
                };
              },
            };
          },
        };
      }
      if (name === 'workspaceTenantBindings') {
        return { doc: () => ({ get: async () => { reads += 1; return documentSnapshot(); } }) };
      }
      if (name === 'professionalContexts') {
        return {
          where: () => ({
            get: async () => {
              reads += 1;
              return {
                docs: contextActive
                  ? [{ id: 'context-link-r86', data: () => ({ active: true, context: 'PSICOLOGIA', professionalId, tenantId: SCOPE.tenantId }) }]
                  : [],
              };
            },
          }),
        };
      }
      return {
        doc: id => ({
          get: async () => { reads += 1; return documentSnapshot(id === 'settings' ? settingsData : null); },
          set: async () => { writes += 1; },
        }),
        get: async () => { reads += 1; return { docs: [] }; },
      };
    },
  };
  return {
    db,
    get reads() { return reads; },
    get writes() { return writes; },
  };
}

function resolveWith({ permissionState, contextActive = true, requestedProfessionalId, role = 'professional' }) {
  const fakeDb = createPsychologyDb({ contextActive, professionalId: requestedProfessionalId === 'other-professional' ? '' : SCOPE.professionalId });
  const req = { query: requestedProfessionalId ? { professionalId: requestedProfessionalId } : {} };
  return {
    fakeDb,
    promise: resolvePsychologyAccessContext(req, {
      db: fakeDb.db,
      requiredAnyPermissions: ['agenda.own.view', 'settings.clinic.manage'],
      resolveBaseAccessContext: async (_request, options) => {
        assert.deepEqual(options.allowedRoles, ['admin', 'professional']);
        if (role === 'monitoring') {
          const error = new Error('role denied');
          error.code = 'access/role-denied';
          error.statusCode = 403;
          throw error;
        }
        return baseContext(permissionState, role);
      },
    }),
  };
}

function responseRecorder() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    payload: undefined,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

function request(method, path, body) {
  return {
    method,
    url: `/api/psychology/${path}`,
    query: { path: [path] },
    headers: { authorization: 'Bearer offline-test-token' },
    body,
  };
}

function createHandlerHarness(permissionState) {
  const calls = [];
  const fakeDb = createPsychologyDb();
  const handler = createPsychologyApiHandler({
    getDb: () => fakeDb.db,
    resolveAccess: async (_req, options) => {
      calls.push(options);
      if (options.requiredAnyPermissions) {
        assertAnyAccessPermission({ permissions: permissionState }, options.requiredAnyPermissions);
      }
      for (const permission of options.requiredPermissions || []) {
        if (!permissionState[permission]) {
          const error = new Error('permission denied');
          error.code = 'access/permission-denied';
          error.statusCode = 403;
          throw error;
        }
      }
      return SCOPE;
    },
    readSettingsProjection: async () => ({
      ok: true,
      settingsFound: true,
      settingsStructureValid: true,
      servicesPresent: false,
      servicesCount: 0,
      locationsPresent: false,
      locationsCount: 0,
      agendaDefaultsPresent: false,
    }),
    auditLogger: () => {},
  });
  return { handler, calls, fakeDb };
}

test('agenda.own.view é permission-based, escopada ao próprio contexto e está no teto professional', () => {
  const context = buildEffectiveAccessContext({
    decodedToken: { uid: 'professional-r86-auth', email: 'professional-r86@example.invalid' },
    profile: { role: 'professional', status: 'approved', workspaceId: SCOPE.workspaceId },
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: SCOPE.workspaceId,
    requestedContext: 'professional',
  });

  assert.equal(context.permissions['agenda.own.view'], true);
  assert.equal(context.permissions['settings.clinic.manage'], false);
  assert.equal(context.permissions['agenda.general.view'], false);
  assert.equal(context.workspaceId, SCOPE.workspaceId);
});

test('requiredAnyPermissions permite agenda própria ou gestão, e nega ausência de ambas', () => {
  assert.doesNotThrow(() => assertAnyAccessPermission({ permissions: permissions({ agenda: true }) }, ['agenda.own.view', 'settings.clinic.manage']));
  assert.doesNotThrow(() => assertAnyAccessPermission({ permissions: permissions({ manage: true }) }, ['agenda.own.view', 'settings.clinic.manage']));
  assert.throws(
    () => assertAnyAccessPermission({ permissions: permissions() }, ['agenda.own.view', 'settings.clinic.manage']),
    error => error.code === 'access/permission-denied' && error.statusCode === 403,
  );
});

test('resolver da Psicologia permite leitura com agenda própria e mantém vínculo de profissional/contexto', async () => {
  const { promise, fakeDb } = resolveWith({ permissionState: permissions({ agenda: true }) });
  const scope = await promise;
  assert.equal(scope.professionalId, SCOPE.professionalId);
  assert.equal(scope.workspaceId, SCOPE.workspaceId);
  assert.equal(scope.tenantId, SCOPE.tenantId);
  assert.equal(scope.context, 'PSICOLOGIA');
  assert.equal(fakeDb.writes, 0);
});

test('resolver da Psicologia permite leitura com manage e nega sem ambas', async () => {
  await assert.doesNotReject(resolveWith({ permissionState: permissions({ manage: true }) }).promise);
  await assert.rejects(
    resolveWith({ permissionState: permissions() }).promise,
    error => error.code === 'access/permission-denied' && error.statusCode === 403,
  );
});

test('contexto Psicologia inativo, outro profissional e monitoring continuam bloqueados', async () => {
  await assert.rejects(
    resolveWith({ permissionState: permissions({ agenda: true }), contextActive: false }).promise,
    error => error.code === 'psychology/context-not-found',
  );
  await assert.rejects(
    resolveWith({ permissionState: permissions({ agenda: true }), requestedProfessionalId: 'other-professional' }).promise,
    error => error.code === 'psychology/professional-not-found',
  );
  await assert.rejects(
    resolveWith({ permissionState: permissions({ agenda: true }), role: 'monitoring' }).promise,
    error => error.code === 'access/role-denied',
  );
});

test('GET Settings e readiness compartilham o contrato OR; PUT continua somente manage', async () => {
  const agendaHarness = createHandlerHarness(permissions({ agenda: true }));
  const agendaGetResponse = responseRecorder();
  await agendaHarness.handler(request('GET', 'settings'), agendaGetResponse);
  assert.equal(agendaGetResponse.statusCode, 200);
  assert.deepEqual(agendaHarness.calls[0].requiredAnyPermissions, ['agenda.own.view', 'settings.clinic.manage']);

  const agendaReadinessResponse = responseRecorder();
  await agendaHarness.handler(request('GET', 'settings-readiness'), agendaReadinessResponse);
  assert.equal(agendaReadinessResponse.statusCode, 200);
  assert.deepEqual(agendaHarness.calls[1].requiredAnyPermissions, ['agenda.own.view', 'settings.clinic.manage']);

  const agendaPutResponse = responseRecorder();
  await agendaHarness.handler(request('PUT', 'settings', { settings: {} }), agendaPutResponse);
  assert.equal(agendaPutResponse.statusCode, 403);
  assert.deepEqual(agendaHarness.calls[2].requiredPermissions, ['settings.clinic.manage']);

  const manageHarness = createHandlerHarness(permissions({ manage: true }));
  const manageGetResponse = responseRecorder();
  await manageHarness.handler(request('GET', 'settings'), manageGetResponse);
  assert.equal(manageGetResponse.statusCode, 200);
  const managePutResponse = responseRecorder();
  await manageHarness.handler(request('PUT', 'settings', { settings: {} }), managePutResponse);
  assert.equal(managePutResponse.statusCode, 200);

  const deniedHarness = createHandlerHarness(permissions());
  const deniedGetResponse = responseRecorder();
  await deniedHarness.handler(request('GET', 'settings'), deniedGetResponse);
  assert.equal(deniedGetResponse.statusCode, 403);
  const deniedReadinessResponse = responseRecorder();
  await deniedHarness.handler(request('GET', 'settings-readiness'), deniedReadinessResponse);
  assert.equal(deniedReadinessResponse.statusCode, 403);
  const deniedPutResponse = responseRecorder();
  await deniedHarness.handler(request('PUT', 'settings', { settings: {} }), deniedPutResponse);
  assert.equal(deniedPutResponse.statusCode, 403);
});

test('R83 mantém fieldMask operacional, exclui professionalProfile e não tem fallback bruto', () => {
  const source = fs.readFileSync(new URL('../api/_lib/psychologySettingsProjection.js', import.meta.url), 'utf8');
  assert.match(source, /getAll\(settingsReference,\s*\{\s*fieldMask:/s);
  assert.deepEqual(SETTINGS_OPERATIONAL_FIELD_PATHS, [
    'settings.services',
    'settings.locations',
    'settings.agenda.defaultDurationMinutes',
    'settings.agenda.intervalMinutes',
  ]);
  assert.equal(SETTINGS_OPERATIONAL_FIELD_PATHS.some(path => path.includes('professionalProfile')), false);
  assert.equal(source.includes("settingsReference.get()"), false);
});
